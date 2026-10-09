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
	SuccessfulRequests int64
	FailedRequests     int64
	EndpointStats      map[string]map[string]int64
	Report             *TestMetrics
}

type TestConfig struct {
	Concurrency int      `json:"concurrency"`
	Duration    int      `json:"duration"`
	Endpoints   []string `json:"endpoints"`
	Preset      string   `json:"preset"`
	FileSizeKB  int      `json:"fileSizeKb"`
	WarmupFiles int      `json:"warmupFiles"`
}

type Engine struct {
	mu               sync.Mutex
	isRunning        bool
	cancelFunc       context.CancelFunc
	stats            Stats
	availableMethods []string
	target           string
	conn             *grpc.ClientConn
	stub             grpcdynamic.Stub
	envoyAdminURL    string
	testStartedAt    time.Time
	backendCounters  map[string]envoyEndpointCounters
}

func NewEngine(target string, protoDir string, envoyAdminURL string) (*Engine, error) {
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
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.isRunning, StatusSnapshot{
		SuccessfulRequests: e.stats.SuccessfulRequests.Load(),
		FailedRequests:     e.stats.FailedRequests.Load(),
		EndpointStats:      e.stats.SnapshotEndpointStats(),
		Report:             e.stats.Report,
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
	e.mu.Unlock()

	preset := config.Preset
	if preset == "" {
		preset = "custom"
	}
	metrics.SetTestRunning(preset, config.Concurrency, config.Duration, config.FileSizeKB)

	log.Printf(
		"Starting test: concurrency=%d duration=%ds fileSizeKb=%d warmupFiles=%d preset=%q endpoints=%v",
		config.Concurrency,
		config.Duration,
		config.FileSizeKB,
		config.WarmupFiles,
		config.Preset,
		config.Endpoints,
	)

	methodDescriptors, err := e.resolveMethodDescriptors(ctx, config.Endpoints)
	if err != nil {
		e.abortTest()
		return err
	}

	builder := NewPayloadBuilder(config.FileSizeKB)
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
	e.testStartedAt = time.Now()

	var wg sync.WaitGroup
	for i := 0; i < config.Concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			e.runVirtualUser(ctx, methodDescriptors, builder)
		}()
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
		log.Printf("Warmup: uploading %d files before download load", config.WarmupFiles)
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
	e.mu.Unlock()
	metrics.SetTestStopped()
	log.Printf(
		"Test completed: RPS=%.2f p50=%.2fms p99=%.2fms errors=%.2f%% Jain=%.4f (available=%t)",
		report.RPS,
		report.P50Millis,
		report.P99Millis,
		report.ErrorRatePercent,
		report.JainIndex,
		report.JainAvailable,
	)
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
