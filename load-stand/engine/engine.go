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
	"google.golang.org/grpc/status"
	rpb "google.golang.org/grpc/reflection/grpc_reflection_v1alpha"

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
}

func NewEngine(target string, protoDir string) (*Engine, error) {
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
		stats: Stats{
			EndpointStats: make(map[string]*EndpointStats),
		},
	}, nil
}

func (e *Engine) GetAvailableMethods() []string {
	return e.availableMethods
}

func (e *Engine) GetStatus() (bool, *Stats) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.isRunning, &e.stats
}

func (e *Engine) getEndpointStats(endpoint string) *EndpointStats {
	if stats, ok := e.stats.EndpointStats[endpoint]; ok {
		return stats
	}
	stats := &EndpointStats{}
	e.stats.EndpointStats[endpoint] = stats
	return stats
}

func (e *Engine) recordResult(endpoint string, success bool) {
	metrics.RecordRequest(endpoint, success)
	if success {
		e.stats.SuccessfulRequests.Add(1)
		e.getEndpointStats(endpoint).SuccessfulRequests.Add(1)
		return
	}
	e.stats.FailedRequests.Add(1)
	e.getEndpointStats(endpoint).FailedRequests.Add(1)
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
	e.stats.EndpointStats = make(map[string]*EndpointStats)

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
		e.StopTest()
		return err
	}

	builder := NewPayloadBuilder(config.FileSizeKB)
	if err := e.runWarmup(ctx, methodDescriptors, config, builder); err != nil {
		log.Printf("Warmup warning: %v", err)
	}

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
			time.Sleep(time.Duration(config.Duration) * time.Second)
			log.Println("Test duration expired, stopping...")
			e.StopTest()
		}()
	}

	go func() {
		wg.Wait()
		e.mu.Lock()
		if e.isRunning {
			e.isRunning = false
			log.Println("All virtual users finished")
		}
		e.mu.Unlock()
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
			req := dynamic.NewMessage(uploadMD.GetInputType())
			if err := builder.Populate(uploadMD, req); err != nil {
				return err
			}
			resp, err := e.stub.InvokeRpc(ctx, uploadMD, req)
			if err != nil {
				if isStopError(ctx, err) {
					return ctx.Err()
				}
				e.recordResult(UploadFileRPC, false)
				continue
			}
			_ = resp
			builder.HandleResponse(uploadMD, req)
			e.recordResult(UploadFileRPC, true)
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
	e.isRunning = false
	e.mu.Unlock()
	metrics.SetTestStopped()
	log.Println("Test stopped")
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
			endpoint := endpoints[rand.Intn(len(endpoints))]
			md := methodDescriptors[endpoint]
			inputMsg := dynamic.NewMessage(md.GetInputType())

			if err := builder.Populate(md, inputMsg); err != nil {
				if ctx.Err() != nil {
					return
				}
				e.recordResult(endpoint, false)
				continue
			}

			resp, err := e.stub.InvokeRpc(ctx, md, inputMsg)
			if err != nil {
				if isStopError(ctx, err) {
					return
				}
				e.recordResult(endpoint, false)
				continue
			}

			_ = resp
			builder.HandleResponse(md, inputMsg)
			e.recordResult(endpoint, true)
		}
	}
}

func (s *Stats) SnapshotEndpointStats() map[string]map[string]int64 {
	result := make(map[string]map[string]int64)
	for endpoint, stats := range s.EndpointStats {
		result[endpoint] = map[string]int64{
			"successfulRequests": stats.SuccessfulRequests.Load(),
			"failedRequests":     stats.FailedRequests.Load(),
		}
	}
	return result
}
