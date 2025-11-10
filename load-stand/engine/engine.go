package engine

import (
	"context"
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
	"google.golang.org/grpc/credentials/insecure"
	rpb "google.golang.org/grpc/reflection/grpc_reflection_v1alpha"
)

type Stats struct {
	SuccessfulRequests atomic.Int64
	FailedRequests     atomic.Int64
}

type TestConfig struct {
	Concurrency int      `json:"concurrency"`
	Duration    int      `json:"duration"`
	Endpoints   []string `json:"endpoints"`
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

	conn, err := grpc.Dial(target, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to target '%s': %w", target, err)
	}

	return &Engine{
		target:           target,
		availableMethods: endpoints,
		conn:             conn,
		stub:             grpcdynamic.NewStub(conn),
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

func (e *Engine) StartTest(config TestConfig) error {
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

	ctx, cancel := context.WithCancel(context.Background())
	e.cancelFunc = cancel
	e.mu.Unlock()

	log.Printf("Starting test: %d clients, %d seconds, endpoints: %v", config.Concurrency, config.Duration, config.Endpoints)

	refClient := rpb.NewServerReflectionClient(e.conn)
	refl := grpcreflect.NewClient(ctx, refClient)

	methodDescriptors := make(map[string]*desc.MethodDescriptor)
	for _, endpoint := range config.Endpoints {
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
		e.StopTest()
		return fmt.Errorf("none of the selected endpoints found via reflection")
	}

	var wg sync.WaitGroup
	for i := 0; i < config.Concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			e.runVirtualUser(ctx, methodDescriptors)
		}()
	}

	if config.Duration > 0 {
		go func() {
			time.Sleep(time.Duration(config.Duration) * time.Second)
			log.Println("Test duration expired, stopping...")
			e.StopTest()
		}()
	}

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
	log.Println("Test stopped")
}

func (e *Engine) runVirtualUser(ctx context.Context, methodDescriptors map[string]*desc.MethodDescriptor) {
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

			_, err := e.stub.InvokeRpc(ctx, md, inputMsg)
			if err != nil {
				e.stats.FailedRequests.Add(1)
			} else {
				e.stats.SuccessfulRequests.Add(1)
			}
		}
	}
}
