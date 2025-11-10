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

// Stats содержит статистику выполнения теста.
type Stats struct {
	SuccessfulRequests atomic.Int64 `json:"successfulRequests"`
	FailedRequests     atomic.Int64 `json:"failedRequests"`
}

// TestConfig содержит параметры для запуска теста.
type TestConfig struct {
	Concurrency int      `json:"concurrency"`
	Duration    int      `json:"duration"` // в секундах
	Endpoints   []string `json:"endpoints"`
}

// Engine - это ядро нагрузочного стенда.
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

// NewEngine создает новый экземпляр движка.
func NewEngine(target string, protoDir string) (*Engine, error) {
	endpoints, err := ParseProtoFiles(protoDir)
	if err != nil {
		return nil, fmt.Errorf("не удалось инициализировать движок: %w", err)
	}

	// Подключаемся к Envoy
	conn, err := grpc.Dial(target, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("не удалось подключиться к цели '%s': %w", target, err)
	}

	return &Engine{
		target:           target,
		availableMethods: endpoints,
		conn:             conn,
		stub:             grpcdynamic.NewStub(conn),
	}, nil
}

// GetAvailableMethods возвращает список доступных gRPC методов.
func (e *Engine) GetAvailableMethods() []string {
	return e.availableMethods
}

// GetStatus возвращает текущий статус и статистику.
func (e *Engine) GetStatus() (bool, *Stats) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.isRunning, &e.stats
}

// StartTest запускает нагрузочный тест.
func (e *Engine) StartTest(config TestConfig) error {
	e.mu.Lock()
	if e.isRunning {
		e.mu.Unlock()
		return fmt.Errorf("тест уже запущен")
	}
    if len(config.Endpoints) == 0 {
        e.mu.Unlock()
        return fmt.Errorf("не выбрано ни одного эндпоинта для теста")
    }
	e.isRunning = true
	e.stats.SuccessfulRequests.Store(0)
	e.stats.FailedRequests.Store(0)

	ctx, cancel := context.WithCancel(context.Background())
	e.cancelFunc = cancel
	e.mu.Unlock()

	log.Printf("Запуск теста: %d клиентов, %d секунд, эндпоинты: %v", config.Concurrency, config.Duration, config.Endpoints)

	// Используем gRPC reflection для получения метаданных методов от сервера
	refClient := rpb.NewServerReflectionClient(e.conn)
	refl := grpcreflect.NewClient(ctx, refClient)

	// Предварительно находим дескрипторы для всех нужных методов
	methodDescriptors := make(map[string]*desc.MethodDescriptor)
	for _, endpoint := range config.Endpoints {
		// Полное имя метода - это все, что после первого слэша.
		// Например, для "/myapp.MyService/SayHello" это будет "myapp.MyService.SayHello"
		fullyQualifiedName := strings.TrimPrefix(endpoint, "/")
		serviceName := fullyQualifiedName[:strings.LastIndex(fullyQualifiedName, "/")]
		methodName := fullyQualifiedName[strings.LastIndex(fullyQualifiedName, "/")+1:]
		
		sd, err := refl.ResolveService(serviceName)
		if err != nil {
			log.Printf("ПРЕДУПРЕЖДЕНИЕ: Не удалось найти сервис '%s' через reflection: %v", serviceName, err)
			continue
		}
		md := sd.FindMethodByName(methodName)
		if md == nil {
			log.Printf("ПРЕДУПРЕЖДЕНИЕ: Не удалось найти метод '%s' в сервисе '%s'", methodName, serviceName)
			continue
		}
		methodDescriptors[endpoint] = md
	}
    
    if len(methodDescriptors) == 0 {
        e.StopTest()
        return fmt.Errorf("ни один из выбранных эндпоинтов не был найден на сервере через reflection")
    }

	var wg sync.WaitGroup
	for i := 0; i < config.Concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			e.runVirtualUser(ctx, config, methodDescriptors)
		}()
	}

	if config.Duration > 0 {
		go func() {
			time.Sleep(time.Duration(config.Duration) * time.Second)
			log.Println("Длительность теста истекла. Остановка...")
			e.StopTest()
		}()
	}

	return nil
}

// StopTest останавливает текущий тест.
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
	log.Println("Тест остановлен.")
}

// runVirtualUser симулирует одного клиента.
func (e *Engine) runVirtualUser(ctx context.Context, config TestConfig, methodDescriptors map[string]*desc.MethodDescriptor) {
	endpoints := make([]string, 0, len(methodDescriptors))
    for k := range methodDescriptors {
        endpoints = append(endpoints, k)
    }

	for {
		select {
		case <-ctx.Done(): // Если контекст отменен, выходим
			return
		default:
			// Выбираем случайный эндпоинт из списка
			endpoint := endpoints[rand.Intn(len(endpoints))]
			md := methodDescriptors[endpoint]

			// Создаем пустое сообщение-запрос (можно расширить для передачи данных из UI)
			inputMsg := dynamic.NewMessage(md.GetInputType())

			// Выполняем динамический RPC вызов (ИСПРАВЛЕННЫЙ МЕТОД)
			_, err := e.stub.InvokeRpc(ctx, md, inputMsg)
			if err != nil {
				e.stats.FailedRequests.Add(1)
			} else {
				e.stats.SuccessfulRequests.Add(1)
			}
		}
	}
}