package engine

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/dynamic"
	"github.com/jhump/protoreflect/dynamic/grpcdynamic"
	"github.com/jhump/protoreflect/grpcreflect"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	rpb "google.golang.org/grpc/reflection/grpc_reflection_v1alpha"
	"google.golang.org/grpc/status"

	"load-stand/metrics"
)

const maxGrpcMessageSize = 64 * 1024 * 1024

type EndpointStats struct {
	SuccessfulRequests atomic.Int64
	FailedRequests     atomic.Int64
}

type Stats struct {
	SuccessfulRequests atomic.Int64
	FailedRequests     atomic.Int64
	EndpointStats      map[string]*EndpointStats
	endpointStatsMu    sync.RWMutex
	latencyBuckets     []atomic.Int64
	Report             *TestMetrics
}

type StatusSnapshot struct {
	SuccessfulRequests int64                       `json:"SuccessfulRequests"`
	FailedRequests     int64                       `json:"FailedRequests"`
	EndpointStats      map[string]map[string]int64 `json:"EndpointStats"`
	Report             *TestMetrics                `json:"Report"`
	Servers            []ServerStatus              `json:"Servers"`
	ElapsedSeconds     int                         `json:"elapsedSeconds"`
	DurationSeconds    int                         `json:"durationSeconds"`
	WaveIteration      int                         `json:"waveIteration"`
	WaveIndex          int                         `json:"waveIndex"`
	WaveCount          int                         `json:"waveCount"`
	WaveIterations     int                         `json:"waveIterations"`
}

type TestConfig struct {
	Concurrency    int         `json:"concurrency"`
	Duration       int         `json:"duration"`
	Endpoints      []string    `json:"endpoints"`
	Preset         string      `json:"preset"`
	Algorithm      string      `json:"algorithm"`
	FileSizeKB     int         `json:"fileSizeKb"`
	FileSizeMinKB  int         `json:"fileSizeMinKb"`
	FileSizeMaxKB  int         `json:"fileSizeMaxKb"`
	WarmupFiles    int         `json:"warmupFiles"`
	StopServer     string      `json:"stopServer"`
	StopAfterSec   int         `json:"stopAfterSec"`
	OutageServers  []string    `json:"outageServers,omitempty"`
	OutageMinSec   int         `json:"outageMinSec"`
	OutageMaxSec   int         `json:"outageMaxSec"`
	Phases         []LoadPhase `json:"phases,omitempty"`
	WaveIterations *int        `json:"waveIterations,omitempty"`
}

type LoadPhase struct {
	Concurrency   int `json:"concurrency"`
	DurationSec   int `json:"durationSec"`
	FileSizeMinKB int `json:"fileSizeMinKb"`
	FileSizeMaxKB int `json:"fileSizeMaxKb"`
}

type Engine struct {
	mu                    sync.Mutex
	isRunning             bool
	cancelFunc            context.CancelFunc
	stats                 Stats
	availableMethods      []string
	target                string
	conn                  *grpc.ClientConn
	stub                  grpcdynamic.Stub
	envoyAdminURL         string
	loadBalancerURL       string
	prometheusURL         string
	docker                *dockerClient
	serversToRestore      map[string]struct{}
	loadGeneration        uint64
	userCancels           []context.CancelFunc
	testStartedAt         time.Time
	testDurationSec       int
	waveIteration         int
	waveIndex             int
	waveCount             int
	plannedWaveIterations int
	backendCounters       map[string]envoyEndpointCounters
	builder               *PayloadBuilder
}

func NewEngine(target string, protoDir string, envoyAdminURL string, loadBalancerURL string, prometheusURL string, dockerSocket string) (*Engine, error) {
	endpoints, err := ParseProtoFiles(protoDir)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize engine: %w", err)
	}

	conn, err := grpc.Dial(
		target,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(maxGrpcMessageSize),
			grpc.MaxCallSendMsgSize(maxGrpcMessageSize),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to target '%s': %w", target, err)
	}

	return &Engine{
		target:           target,
		availableMethods: endpoints,
		conn:             conn,
		stub:             grpcdynamic.NewStub(conn),
		envoyAdminURL:    envoyAdminURL,
		loadBalancerURL:  loadBalancerURL,
		prometheusURL:    prometheusURL,
		docker:           newDockerClient(dockerSocket),
		stats: Stats{
			EndpointStats:  make(map[string]*EndpointStats),
			latencyBuckets: make([]atomic.Int64, len(latencyBucketBounds)+1),
		},
	}, nil
}

func (e *Engine) GetAvailableMethods() []string {
	return e.availableMethods
}

func (e *Engine) GetStatus() (bool, StatusSnapshot) {
	servers, _ := FetchServerStatuses(e.prometheusURL)
	if states, err := e.docker.running(context.Background()); err == nil {
		applyContainerPower(servers, states)
	} else {
		applyContainerPower(servers, nil)
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	elapsed := 0
	if e.isRunning && !e.testStartedAt.IsZero() {
		elapsed = int(time.Since(e.testStartedAt).Seconds())
	} else if e.stats.Report != nil {
		elapsed = int(e.stats.Report.DurationSeconds)
	}

	return e.isRunning, StatusSnapshot{
		SuccessfulRequests: e.stats.SuccessfulRequests.Load(),
		FailedRequests:     e.stats.FailedRequests.Load(),
		EndpointStats:      e.stats.SnapshotEndpointStats(),
		Report:             e.stats.Report,
		Servers:            servers,
		ElapsedSeconds:     elapsed,
		DurationSeconds:    e.testDurationSec,
		WaveIteration:      e.waveIteration,
		WaveIndex:          e.waveIndex,
		WaveCount:          e.waveCount,
		WaveIterations:     e.plannedWaveIterations,
	}
}

func (e *Engine) SetServerPower(ctx context.Context, name, action string) error {
	return e.docker.setPower(ctx, name, action)
}

func (e *Engine) markServerForRestore(name string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.serversToRestore == nil {
		e.serversToRestore = map[string]struct{}{}
	}
	e.serversToRestore[name] = struct{}{}
}

func (e *Engine) unmarkServerForRestore(name string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	delete(e.serversToRestore, name)
}

func (e *Engine) restoreStoppedServers() {
	e.mu.Lock()
	names := make([]string, 0, len(e.serversToRestore))
	for name := range e.serversToRestore {
		names = append(names, name)
	}
	e.serversToRestore = nil
	e.mu.Unlock()

	for _, name := range names {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		err := e.SetServerPower(ctx, name, "start")
		cancel()
		if err != nil {
			log.Printf("Failed to start %s after the scenario: %v", name, err)
			continue
		}
		log.Printf("Restored %s after the scenario", name)
	}
}

func (e *Engine) getEndpointStats(endpoint string) *EndpointStats {
	e.stats.endpointStatsMu.Lock()
	defer e.stats.endpointStatsMu.Unlock()
	if stats, ok := e.stats.EndpointStats[endpoint]; ok {
		return stats
	}
	stats := &EndpointStats{}
	e.stats.EndpointStats[endpoint] = stats
	return stats
}

func (e *Engine) recordResult(endpoint string, success bool, latency time.Duration) {
	metrics.RecordRequest(endpoint, success)
	e.stats.latencyBuckets[latencyBucketIndex(latency)].Add(1)
	endpointStats := e.getEndpointStats(endpoint)
	if success {
		e.stats.SuccessfulRequests.Add(1)
		endpointStats.SuccessfulRequests.Add(1)
		return
	}
	e.stats.FailedRequests.Add(1)
	endpointStats.FailedRequests.Add(1)
}

func (e *Engine) resetLoadStats() {
	e.stats.SuccessfulRequests.Store(0)
	e.stats.FailedRequests.Store(0)
	e.stats.endpointStatsMu.Lock()
	e.stats.EndpointStats = make(map[string]*EndpointStats)
	e.stats.endpointStatsMu.Unlock()
	for index := range e.stats.latencyBuckets {
		e.stats.latencyBuckets[index].Store(0)
	}
}

func isStopError(ctx context.Context, err error) bool {
	if ctx.Err() != nil {
		return true
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	if st, ok := status.FromError(err); ok && st.Code() == codes.Canceled {
		return true
	}
	return false
}

func (e *Engine) StartTest(rawConfig TestConfig) error {
	config := rawConfig.WithDefaults()

	e.mu.Lock()
	if e.isRunning {
		e.mu.Unlock()
		return fmt.Errorf("test already running")
	}
	if len(config.Endpoints) == 0 {
		e.mu.Unlock()
		return fmt.Errorf("no endpoints selected")
	}
	if config.FileSizeMinKB < 1 || config.FileSizeMaxKB < config.FileSizeMinKB || config.FileSizeMaxKB > MaxTestFileSizeKB() {
		e.mu.Unlock()
		return fmt.Errorf("file size range must be between 1 and %d KB, with min <= max", MaxTestFileSizeKB())
	}
	if err := validatePhases(config.Phases); err != nil {
		e.mu.Unlock()
		return err
	}
	if err := validateOutages(config); err != nil {
		e.mu.Unlock()
		return err
	}
	if config.StopServer != "" && len(config.OutageServers) == 0 {
		if !allowedServerName(config.StopServer) {
			e.mu.Unlock()
			return fmt.Errorf("stopServer must be one of file-farm-server-1..4")
		}
		if config.StopAfterSec < 5 {
			e.mu.Unlock()
			return fmt.Errorf("stopAfterSec must be at least 5 seconds")
		}
		if config.Duration > 0 && config.StopAfterSec >= config.Duration {
			e.mu.Unlock()
			return fmt.Errorf("stopAfterSec must be earlier than the test duration")
		}
	}
	e.isRunning = true
	e.stats.SuccessfulRequests.Store(0)
	e.stats.FailedRequests.Store(0)
	e.stats.endpointStatsMu.Lock()
	e.stats.EndpointStats = make(map[string]*EndpointStats)
	e.stats.endpointStatsMu.Unlock()
	for index := range e.stats.latencyBuckets {
		e.stats.latencyBuckets[index].Store(0)
	}
	e.stats.Report = nil

	ctx, cancel := context.WithCancel(context.Background())
	e.cancelFunc = cancel
	e.loadGeneration++
	generation := e.loadGeneration
	e.userCancels = nil
	e.mu.Unlock()

	if config.Algorithm != "" {
		switchCtx, switchCancel := context.WithTimeout(ctx, 5*time.Second)
		err := e.SetBalancerAlgorithm(switchCtx, config.Algorithm)
		switchCancel()
		if err != nil {
			e.abortTest()
			return fmt.Errorf("failed to select load-balancing algorithm: %w", err)
		}
	}

	preset := config.Preset
	if preset == "" {
		preset = "custom"
	}
	metrics.SetTestRunning(preset, config.Concurrency, config.Duration, config.FileSizeKB)

	durationLabel := fmt.Sprintf("%ds", config.Duration)
	if config.Duration == 0 {
		durationLabel = "infinite"
	}
	log.Printf(
		"Starting test: concurrency=%d duration=%s fileSizeKb=%d-%d warmupFiles=%d preset=%q endpoints=%v",
		config.Concurrency,
		durationLabel,
		config.FileSizeMinKB,
		config.FileSizeMaxKB,
		config.WarmupFiles,
		config.Preset,
		config.Endpoints,
	)

	methodDescriptors, err := e.resolveMethodDescriptors(ctx, config.Endpoints)
	if err != nil {
		e.abortTest()
		return err
	}

	builder := NewPayloadBuilder(config.FileSizeMinKB, config.FileSizeMaxKB)
	e.builder = builder
	if err := e.runWarmup(ctx, methodDescriptors, config, builder); err != nil {
		log.Printf("Warmup warning: %v", err)
	}
	e.resetLoadStats()
	e.backendCounters = nil
	if counters, err := fetchEnvoyEndpointCounters(e.envoyAdminURL); err != nil {
		log.Printf("Envoy endpoint counters unavailable; Jain index will be omitted: %v", err)
	} else {
		e.backendCounters = counters
	}
	waveIterations := resolvedWaveIterations(config)
	e.mu.Lock()
	e.testStartedAt = time.Now()
	e.testDurationSec = config.Duration
	e.waveCount = len(config.Phases)
	e.plannedWaveIterations = waveIterations
	if len(config.Phases) > 0 {
		e.waveIteration = 1
		e.waveIndex = 1
	} else {
		e.waveIteration = 0
		e.waveIndex = 0
	}
	e.mu.Unlock()

	var wg sync.WaitGroup
	e.scaleVirtualUsers(ctx, generation, config.Concurrency, &wg, methodDescriptors, builder)
	if len(config.Phases) > 0 {
		log.Printf(
			"Wave cycle %s phase 1/%d: concurrency=%d fileSizeKb=%d-%d for %ds",
			waveCycleLabel(1, waveIterations),
			len(config.Phases),
			config.Phases[0].Concurrency,
			config.Phases[0].FileSizeMinKB,
			config.Phases[0].FileSizeMaxKB,
			config.Phases[0].DurationSec,
		)
		phases := append([]LoadPhase(nil), config.Phases...)
		go e.runLoadWaves(ctx, generation, phases, waveIterations, &wg, methodDescriptors, builder)
	}

	if config.Duration > 0 {
		go func() {
			timer := time.NewTimer(time.Duration(config.Duration) * time.Second)
			defer timer.Stop()
			select {
			case <-timer.C:
				log.Println("Test duration expired, stopping...")
				e.StopTest()
			case <-ctx.Done():
			}
		}()
	}

	if len(config.OutageServers) > 0 {
		servers := append([]string(nil), config.OutageServers...)
		go e.runServerOutages(ctx, servers, config.OutageMinSec, config.OutageMaxSec)
	} else if config.StopServer != "" {
		serverName := config.StopServer
		go func() {
			timer := time.NewTimer(time.Duration(config.StopAfterSec) * time.Second)
			defer timer.Stop()
			select {
			case <-timer.C:
				stopCtx, stopCancel := context.WithTimeout(context.Background(), 20*time.Second)
				err := e.SetServerPower(stopCtx, serverName, "stop")
				stopCancel()
				if err != nil {
					log.Printf("Failed to stop %s for the scenario: %v", serverName, err)
					return
				}
				e.markServerForRestore(serverName)
				log.Printf("Scenario stopped %s; it will be started again when the test ends", serverName)
			case <-ctx.Done():
			}
		}()
	}

	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				e.updateReport()
			}
		}
	}()

	go func() {
		wg.Wait()
		e.finishTest()
	}()

	return nil
}

func (e *Engine) resolveMethodDescriptors(ctx context.Context, endpoints []string) (map[string]*desc.MethodDescriptor, error) {
	refClient := rpb.NewServerReflectionClient(e.conn)
	refl := grpcreflect.NewClient(ctx, refClient)

	methodDescriptors := make(map[string]*desc.MethodDescriptor)
	for _, endpoint := range endpoints {
		fullyQualifiedName := strings.TrimPrefix(endpoint, "/")
		serviceName := fullyQualifiedName[:strings.LastIndex(fullyQualifiedName, "/")]
		methodName := fullyQualifiedName[strings.LastIndex(fullyQualifiedName, "/")+1:]

		sd, err := refl.ResolveService(serviceName)
		if err != nil {
			log.Printf("Warning: failed to find service '%s': %v", serviceName, err)
			continue
		}
		md := sd.FindMethodByName(methodName)
		if md == nil {
			log.Printf("Warning: failed to find method '%s' in service '%s'", methodName, serviceName)
			continue
		}
		methodDescriptors[endpoint] = md
	}

	if len(methodDescriptors) == 0 {
		return nil, fmt.Errorf("none of the selected endpoints found via reflection")
	}

	return methodDescriptors, nil
}

func (e *Engine) runWarmup(ctx context.Context, methods map[string]*desc.MethodDescriptor, config TestConfig, builder *PayloadBuilder) error {
	if !config.needsDownloadWarmup() || config.WarmupFiles <= 0 {
		return nil
	}

	uploadMD, ok := methods[UploadFileRPC]
	if ok {
		log.Printf("Warmup: uploading %d files before download and delete load", config.WarmupFiles)
		for i := 0; i < config.WarmupFiles; i++ {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			startedAt := time.Now()
			req := dynamic.NewMessage(uploadMD.GetInputType())
			if err := builder.Populate(uploadMD, req); err != nil {
				return err
			}
			resp, err := e.stub.InvokeRpc(ctx, uploadMD, req)
			if err != nil {
				if isStopError(ctx, err) {
					return ctx.Err()
				}
				e.recordResult(UploadFileRPC, false, time.Since(startedAt))
				continue
			}
			_ = resp
			builder.HandleResponse(uploadMD, req)
			e.recordResult(UploadFileRPC, true, time.Since(startedAt))
		}
		return nil
	}

	log.Printf("Warmup skipped: DownloadFile selected but UploadFile is not available")
	return nil
}

func (e *Engine) StopTest() {
	e.mu.Lock()
	if !e.isRunning {
		e.mu.Unlock()
		return
	}
	if e.cancelFunc != nil {
		e.cancelFunc()
	}
	e.mu.Unlock()
	log.Println("Stopping test and waiting for virtual users")
}

func (e *Engine) abortTest() {
	e.mu.Lock()
	if e.cancelFunc != nil {
		e.cancelFunc()
	}
	e.isRunning = false
	e.cancelFunc = nil
	e.userCancels = nil
	e.mu.Unlock()
	metrics.SetTestStopped()
}

func (e *Engine) finishTest() {
	duration := time.Since(e.testStartedAt)
	var after map[string]envoyEndpointCounters
	if counters, err := fetchEnvoyEndpointCounters(e.envoyAdminURL); err != nil {
		log.Printf("Envoy endpoint counters unavailable; Jain index will be omitted: %v", err)
	} else {
		after = counters
	}

	latencyBuckets := make([]int64, len(e.stats.latencyBuckets))
	for index := range e.stats.latencyBuckets {
		latencyBuckets[index] = e.stats.latencyBuckets[index].Load()
	}
	report := summarizeTest(
		e.stats.SuccessfulRequests.Load(),
		e.stats.FailedRequests.Load(),
		latencyBuckets,
		duration,
		e.backendCounters,
		after,
	)

	e.mu.Lock()
	e.stats.Report = &report
	e.isRunning = false
	e.cancelFunc = nil
	e.userCancels = nil
	builder := e.builder
	e.builder = nil
	e.mu.Unlock()
	metrics.SetTestStopped()
	e.restoreStoppedServers()

	if builder != nil && builder.DeleteMethodDesc != nil {
		filesToDelete := builder.PopAllUploadedFiles()
		if len(filesToDelete) > 0 {
			log.Printf("Cleaning up %d remaining files after test in background...", len(filesToDelete))
			go func() {
				cleanupCtx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
				defer cancel()
				for _, filename := range filesToDelete {
					req := dynamic.NewMessage(builder.DeleteMethodDesc.GetInputType())
					req.TrySetFieldByName("filename", filename)
					_, _ = e.stub.InvokeRpc(cleanupCtx, builder.DeleteMethodDesc, req)
				}
				log.Printf("Cleanup finished")
			}()
		}
	}
	log.Printf(
		"Test completed: RPS=%.2f p50=%.2fms p95=%.2fms p99=%.2fms errors=%.2f%% Jain=%.4f (available=%t)",
		report.RPS,
		report.P50Millis,
		report.P95Millis,
		report.P99Millis,
		report.ErrorRatePercent,
		report.JainIndex,
		report.JainAvailable,
	)
}

func validateOutages(config TestConfig) error {
	if len(config.OutageServers) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(config.OutageServers))
	for _, name := range config.OutageServers {
		if !allowedServerName(name) {
			return fmt.Errorf("outage server %q must be one of file-farm-server-1..4", name)
		}
		if _, exists := seen[name]; exists {
			return fmt.Errorf("outage server %q is listed twice", name)
		}
		seen[name] = struct{}{}
	}
	if config.OutageMinSec < 5 {
		return fmt.Errorf("outageMinSec must be at least 5 seconds")
	}
	if config.OutageMaxSec < config.OutageMinSec {
		return fmt.Errorf("outageMaxSec must be greater than or equal to outageMinSec")
	}
	if config.Duration > 0 && config.OutageMinSec >= config.Duration {
		return fmt.Errorf("outageMinSec must be earlier than the test duration")
	}
	return nil
}

func outageDelay(rng *rand.Rand, minSec int, maxSec int) time.Duration {
	seconds := minSec
	if maxSec > minSec {
		seconds += rng.Intn(maxSec - minSec + 1)
	}
	return time.Duration(seconds) * time.Second
}

func waitOutage(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (e *Engine) pickRunningOutageServer(ctx context.Context, rng *rand.Rand, servers []string) (string, error) {
	order := append([]string(nil), servers...)
	rng.Shuffle(len(order), func(i int, j int) {
		order[i], order[j] = order[j], order[i]
	})
	running := make([]string, 0, len(order))
	var lastErr error
	for _, name := range order {
		up, err := e.docker.isRunning(ctx, name)
		if err != nil {
			lastErr = err
			continue
		}
		if up {
			running = append(running, name)
		}
	}
	if lastErr != nil && len(running) == 0 {
		return "", lastErr
	}
	// Keep one selected server up when several are eligible, so the cluster does not go dark.
	if len(servers) > 1 && len(running) < 2 {
		return "", nil
	}
	if len(running) == 0 {
		return "", nil
	}
	return running[rng.Intn(len(running))], nil
}

func (e *Engine) runServerOutages(ctx context.Context, servers []string, minSec int, maxSec int) {
	defer e.restoreStoppedServers()
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	for {
		if !waitOutage(ctx, outageDelay(rng, minSec, maxSec)) || ctx.Err() != nil {
			return
		}
		name, err := e.pickRunningOutageServer(ctx, rng, servers)
		if err != nil {
			log.Printf("Failed to choose a server to stop: %v", err)
			continue
		}
		if name == "" {
			log.Printf("Skipped a server outage; fewer than two selected servers are running")
			continue
		}
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 20*time.Second)
		err = e.SetServerPower(stopCtx, name, "stop")
		stopCancel()
		if err != nil {
			log.Printf("Failed to stop %s for the scenario: %v", name, err)
			continue
		}
		e.markServerForRestore(name)
		downFor := outageDelay(rng, minSec, maxSec)
		log.Printf("Scenario stopped %s; it will start again after %s", name, downFor)
		if !waitOutage(ctx, downFor) || ctx.Err() != nil {
			return
		}
		startCtx, startCancel := context.WithTimeout(context.Background(), 20*time.Second)
		err = e.SetServerPower(startCtx, name, "start")
		startCancel()
		if err != nil {
			log.Printf("Failed to start %s during the scenario: %v", name, err)
			continue
		}
		e.unmarkServerForRestore(name)
		log.Printf("Scenario started %s again", name)
	}
}

func validatePhases(phases []LoadPhase) error {
	for index, phase := range phases {
		if phase.Concurrency < 1 {
			return fmt.Errorf("wave %d needs at least 1 client", index+1)
		}
		if phase.DurationSec < 5 {
			return fmt.Errorf("wave %d must last at least 5 seconds", index+1)
		}
		if phase.FileSizeMinKB < 1 || phase.FileSizeMaxKB < phase.FileSizeMinKB || phase.FileSizeMaxKB > MaxTestFileSizeKB() {
			return fmt.Errorf("wave %d file size must be between 1 and %d KB, with min <= max", index+1, MaxTestFileSizeKB())
		}
	}
	return nil
}

func resolvedWaveIterations(config TestConfig) int {
	if len(config.Phases) == 0 || config.WaveIterations == nil || *config.WaveIterations < 0 {
		return 1
	}
	return *config.WaveIterations
}

func waveCycleLabel(cycle int, iterations int) string {
	if iterations == 0 {
		return fmt.Sprintf("%d/infinite", cycle)
	}
	return fmt.Sprintf("%d/%d", cycle, iterations)
}

func (e *Engine) setWaveProgress(iteration int, index int) {
	e.mu.Lock()
	e.waveIteration = iteration
	e.waveIndex = index
	e.mu.Unlock()
}

func (e *Engine) runLoadWaves(ctx context.Context, generation uint64, phases []LoadPhase, iterations int, wg *sync.WaitGroup, methods map[string]*desc.MethodDescriptor, builder *PayloadBuilder) {
	if len(phases) == 0 {
		return
	}
	cycle := 1
	position := 0
	for {
		timer := time.NewTimer(time.Duration(phases[position].DurationSec) * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if position == len(phases)-1 && iterations > 0 && cycle >= iterations {
			log.Println("Wave iterations finished, stopping...")
			e.StopTest()
			return
		}
		nextPosition := position + 1
		nextCycle := cycle
		if nextPosition >= len(phases) {
			nextPosition = 0
			nextCycle = cycle + 1
		}
		phase := phases[nextPosition]
		builder.SetFileSizeRange(phase.FileSizeMinKB, phase.FileSizeMaxKB)
		e.scaleVirtualUsers(ctx, generation, phase.Concurrency, wg, methods, builder)
		cycle = nextCycle
		position = nextPosition
		e.setWaveProgress(cycle, position+1)
		log.Printf(
			"Wave cycle %s phase %d/%d: concurrency=%d fileSizeKb=%d-%d for %ds",
			waveCycleLabel(cycle, iterations),
			position+1,
			len(phases),
			phase.Concurrency,
			phase.FileSizeMinKB,
			phase.FileSizeMaxKB,
			phase.DurationSec,
		)
	}
}

func (e *Engine) scaleVirtualUsers(ctx context.Context, generation uint64, target int, wg *sync.WaitGroup, methods map[string]*desc.MethodDescriptor, builder *PayloadBuilder) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.loadGeneration != generation || !e.isRunning || ctx.Err() != nil {
		return
	}
	for len(e.userCancels) < target {
		userCtx, cancel := context.WithCancel(ctx)
		e.userCancels = append(e.userCancels, cancel)
		wg.Add(1)
		go func() {
			defer wg.Done()
			e.runVirtualUser(userCtx, methods, builder)
		}()
	}
	for len(e.userCancels) > target {
		last := len(e.userCancels) - 1
		e.userCancels[last]()
		e.userCancels = e.userCancels[:last]
	}
}

func (e *Engine) runVirtualUser(ctx context.Context, methodDescriptors map[string]*desc.MethodDescriptor, builder *PayloadBuilder) {
	endpoints := make([]string, 0, len(methodDescriptors))
	for k := range methodDescriptors {
		endpoints = append(endpoints, k)
	}

	for {
		select {
		case <-ctx.Done():
			return
		default:
			startedAt := time.Now()
			endpoint := endpoints[rand.Intn(len(endpoints))]
			md := methodDescriptors[endpoint]
			inputMsg := dynamic.NewMessage(md.GetInputType())

			if err := builder.Populate(md, inputMsg); err != nil {
				if ctx.Err() != nil {
					return
				}
				e.recordResult(endpoint, false, time.Since(startedAt))
				continue
			}

			resp, err := e.stub.InvokeRpc(ctx, md, inputMsg)
			if err != nil {
				if isStopError(ctx, err) {
					return
				}
				e.recordResult(endpoint, false, time.Since(startedAt))
				continue
			}

			_ = resp
			builder.HandleResponse(md, inputMsg)
			e.recordResult(endpoint, true, time.Since(startedAt))
		}
	}
}

func (s *Stats) SnapshotEndpointStats() map[string]map[string]int64 {
	s.endpointStatsMu.RLock()
	defer s.endpointStatsMu.RUnlock()
	result := make(map[string]map[string]int64)
	for endpoint, stats := range s.EndpointStats {
		result[endpoint] = map[string]int64{
			"successfulRequests": stats.SuccessfulRequests.Load(),
			"failedRequests":     stats.FailedRequests.Load(),
		}
	}
	return result
}
