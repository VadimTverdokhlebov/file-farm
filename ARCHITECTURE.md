# Архитектура проекта File Farm

## Обзор

File Farm — это распределенная система для хранения и управления файлами, построенная на микросервисной архитектуре с использованием gRPC, React, TypeScript, PostgreSQL и Docker. Система обеспечивает загрузку и скачивание файлов через веб-интерфейс с использованием gRPC-Web протокола.

## Общая архитектура

Проект состоит из следующих основных компонентов:

1. **Client (React + Vite)** — веб-интерфейс пользователя
2. **Envoy Proxy** — прокси-сервер для преобразования gRPC-Web в gRPC
3. **Server (Node.js + TypeScript + gRPC)** — бэкенд-сервис для обработки файлов
4. **PostgreSQL** — база данных для хранения метаданных файлов
5. **Prometheus** — система мониторинга и сбора метрик

Все компоненты работают в Docker-контейнерах и взаимодействуют через единую Docker-сеть `appnet`.

## Схема взаимодействия компонентов

```
┌─────────────┐
│   Browser   │
│  (React)    │
└──────┬──────┘
       │ HTTP/gRPC-Web
       │
┌──────▼──────────────┐
│   Envoy Proxy       │  Port: 8080
│  (gRPC-Web → gRPC)  │
└──────┬──────────────┘
       │ gRPC
       │
┌──────▼──────────────┐
│  gRPC Server        │  Port: 50051
│  (Node.js/TS)       │
└──────┬──────────────┘
       │
       ├──────────────┐
       │              │
┌──────▼──────┐  ┌────▼─────────┐
│ PostgreSQL  │  │  File System │
│  (Metadata) │  │  (uploads/)  │
└─────────────┘  └──────────────┘
```

## Детальное описание компонентов

### 1. Client (React + Vite)

**Технологии:**
- React 18
- TypeScript
- Vite (сборщик)
- @protobuf-ts/grpcweb-transport (gRPC-Web клиент)

**Расположение:** `client/`

**Основные компоненты:**
- `FilesPage.tsx` — главная страница с интерфейсом загрузки/скачивания файлов
- `grpc.ts` — инициализация gRPC-Web клиентов
- `api/fileService.ts` — обёртки для работы с файловым сервисом
- `generated/` — сгенерированные TypeScript типы из proto-файлов

**Функциональность:**
- Загрузка файлов через веб-интерфейс
- Скачивание файлов по имени
- Отображение статуса операций
- Преобразование файлов в `Uint8Array` для передачи через gRPC

**Конфигурация:**
- Порт: `5173` (настраивается через `CLIENT_PORT` в `.env`)
- API URL: настраивается через `VITE_API_URL` (обычно `http://localhost:8080`)

**Docker:**
- Multi-stage build: сборка через `node:20-alpine`, статическая раздача через `serve`
- Контейнер: `file-farm-client`

### 2. Envoy Proxy

**Технологии:**
- Envoy Proxy v1.33
- gRPC-Web фильтр
- CORS поддержка

**Расположение:** `envoy/`

**Функциональность:**
- Принимает HTTP/gRPC-Web запросы от клиента
- Преобразует gRPC-Web в нативный gRPC
- Проксирует запросы к gRPC серверу
- Обеспечивает CORS для кросс-доменных запросов
- Логирование всех запросов в JSON формате
- Health checks для мониторинга

**Конфигурация:**
- Порт: `8080` (настраивается через `ENVOY_PORT`)
- Backend: `host.docker.internal:50051` (настраивается через `ENVOY_BACKEND_HOST` и `ENVOY_BACKEND_PORT`)
- Admin интерфейс: `9901`

**Особенности:**
- Использует `host.docker.internal` для доступа к серверу, запущенному на хосте (для локальной разработки)
- Поддержка `host.docker.internal:host-gateway` в `docker-compose.yml` для Linux/WSL

**Docker:**
- Образ: `envoyproxy/envoy:v1.33-latest`
- Контейнер: `file-farm-envoy`

### 3. gRPC Server

**Технологии:**
- Node.js 16.13.0
- TypeScript
- @grpc/grpc-js
- TypeORM
- PostgreSQL драйвер

**Расположение:** `server/`

**Структура:**
```
server/
├── src/
│   ├── app.ts              # Инициализация gRPC сервера и регистрация сервисов
│   ├── server.ts           # Точка входа, запуск сервера и БД
│   ├── db.ts               # Подключение к PostgreSQL через TypeORM
│   ├── services/
│   │   ├── file_service.ts # Логика загрузки/скачивания файлов
│   │   └── user_service.ts # Логика работы с пользователями
│   ├── persistance/
│   │   ├── models/
│   │   │   └── File.ts     # TypeORM entity для файлов
│   │   └── query/
│   │       └── FileRepository.ts # Репозиторий для работы с БД
│   ├── utils/
│   │   ├── secrets.ts      # Управление переменными окружения
│   │   ├── logger.ts       # Логирование
│   │   └── uuid.ts         # Генерация UUID
│   └── generated/          # Сгенерированные типы из proto-файлов
└── build/                  # Скомпилированный JavaScript
```

**Сервисы:**

#### FileService
- `UploadFile` — загрузка файла:
  - Принимает `filename`, `content` (bytes), `mimetype`
  - Генерирует уникальное имя файла (UUID)
  - Сохраняет файл в файловую систему (`uploads/`)
  - Сохраняет метаданные в PostgreSQL
  - Возвращает статус операции

- `DownloadFile` — скачивание файла:
  - Принимает `filename` (оригинальное или уникальное)
  - Ищет файл в БД по оригинальному или уникальному имени
  - Читает файл из файловой системы
  - Возвращает `content` (bytes) и `mimetype`

#### UserService
- `CreateUser` — создание пользователя
- `GetUser` — получение пользователя

**База данных:**
- **TypeORM** с PostgreSQL
- Entity: `File` (id, filename, originalFilename, mimetype, size, filePath, createdAt, updatedAt)
- Автоматическая синхронизация схемы (`synchronize: true`)

**Хранение файлов:**
- Файлы сохраняются в директории `uploads/` в корне проекта
- Имена файлов: `{originalName}_{UUID}.{extension}`
- Полный путь хранится в БД

**Конфигурация:**
- Порт: `50051` (настраивается через `GRPC_PORT`)
- Proto файл: `/src/protos/service.proto` (настраивается через `GRPC_PROTO_FILE`)
- Директория файлов: `/src/uploads` (настраивается через `FILES_DIR`)

**Docker:**
- Контейнер: `file-farm-server`
- Volumes:
  - `./logs:/src/logs` — логи
  - `../uploads:/src/uploads` — загруженные файлы
  - `../protos:/src/protos` — proto-файлы

### 4. PostgreSQL

**Технологии:**
- PostgreSQL 15

**Расположение:** `postgres/`

**Функциональность:**
- Хранение метаданных файлов
- Таблица `files` с полями: id, filename, originalFilename, mimetype, size, filePath, createdAt, updatedAt

**Конфигурация:**
- Порт: `5432` (настраивается через `POSTGRES_PORT`)
- Пользователь: настраивается через `POSTGRES_USER`
- Пароль: настраивается через `POSTGRES_PASSWORD`
- База данных: настраивается через `POSTGRES_DB`

**Docker:**
- Образ: `postgres:15`
- Контейнер: `file-farm-postgres`
- Volume: `pgdata` для персистентного хранения данных
- Health check: `pg_isready`

### 5. Prometheus

**Технологии:**
- Prometheus

**Расположение:** `prometheus/`

**Функциональность:**
- Сбор метрик из Envoy Proxy
- Мониторинг производительности системы
- Scrape интервал: 15 секунд

**Конфигурация:**
- Порт: `9090`
- Targets:
  - Envoy: `172.20.0.6:9901` (stats endpoint)
  - Prometheus: `localhost:9090`

**Docker:**
- Контейнер: `file-farm-prometheus`

## Protocol Buffers (gRPC)

**Расположение:** `protos/` (централизованная директория)

**Файлы:**
- `service.proto` — главный файл, импортирует остальные
- `file.proto` — определение FileService и сообщений для работы с файлами
- `user.proto` — определение UserService и сообщений для работы с пользователями

**Генерация кода:**
- Server: `npm run gen:proto` в `server/`
- Client: `npm run gen:proto` в `client/`
- Генерируются TypeScript типы в `generated/`

## Сетевая архитектура

Все сервисы работают в единой Docker-сети `appnet`:

```
appnet (bridge network)
├── file-farm-client (5173)
├── file-farm-envoy (8080)
├── file-farm-server (50051)
├── file-farm-postgres (5432)
└── file-farm-prometheus (9090)
```

**Особенности:**
- Сеть создаётся при первом запуске `postgres/docker-compose.yml`
- Остальные сервисы подключаются к существующей сети (`external: true`)
- Envoy использует `host.docker.internal` для доступа к серверу на хосте (локальная разработка)

## Управление переменными окружения

**Подход:** Один `.env` файл для каждого сервиса, копируемый из централизованных примеров.

**Структура:**
- `.env.development.example` — шаблон для разработки
- `.env.production.example` — шаблон для продакшена
- Каждый сервис имеет свой `.env` файл:
  - `server/.env`
  - `client/.env`
  - `postgres/.env`
  - `envoy/.env`

**Команды:**
- `make env-dev` — копирует development примеры
- `make env-prod` — копирует production примеры

**Важные переменные:**
- `GRPC_PORT` — порт gRPC сервера
- `GRPC_PROTO_FILE` — путь к proto-файлу
- `FILES_DIR` — директория для хранения файлов
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` — параметры БД
- `ENVOY_PORT`, `ENVOY_BACKEND_HOST`, `ENVOY_BACKEND_PORT` — параметры Envoy
- `CLIENT_PORT`, `VITE_API_URL` — параметры клиента

## Процесс работы системы

### Загрузка файла:

1. Пользователь выбирает файл в браузере
2. React конвертирует файл в `Uint8Array`
3. Клиент отправляет gRPC-Web запрос на Envoy (`http://localhost:8080`)
4. Envoy преобразует gRPC-Web в gRPC и проксирует на сервер (`host.docker.internal:50051`)
5. Сервер:
   - Генерирует уникальное имя файла (UUID)
   - Сохраняет файл в `uploads/`
   - Сохраняет метаданные в PostgreSQL
   - Возвращает ответ с результатом
6. Ответ проходит обратно через Envoy к клиенту
7. Клиент отображает статус операции

### Скачивание файла:

1. Пользователь вводит имя файла
2. Клиент отправляет gRPC-Web запрос на Envoy
3. Envoy проксирует запрос на сервер
4. Сервер:
   - Ищет файл в БД по оригинальному или уникальному имени
   - Читает файл из файловой системы
   - Возвращает содержимое и mimetype
5. Клиент создаёт Blob и инициирует скачивание

## Автоматизация (Makefile)

**Основные команды:**

- `make init` — установка npm зависимостей
- `make env-dev` / `make env-prod` — настройка окружения
- `make build` — сборка всех сервисов
- `make up` — запуск всех сервисов
- `make down` — остановка всех сервисов
- `make logs-{service}` — просмотр логов конкретного сервиса
- `make clean` — удаление всех контейнеров и volumes

**Селективный запуск:**
- `make up-server`, `make up-client`, `make up-envoy`, `make up-postgres`, `make up-prometheus`
- Аналогично для `down-*` и `build-*`

## Особенности разработки

### Локальная разработка:
- Сервер и клиент могут запускаться локально (`npm run dev`)
- PostgreSQL и Envoy запускаются в Docker
- Envoy использует `host.docker.internal` для доступа к локальному серверу

### Production:
- Все сервисы запускаются в Docker
- Сервер подключается к PostgreSQL по имени контейнера (`postgres`)

### Адаптация путей:
- `secrets.ts` автоматически определяет окружение (Docker/локальное)
- Динамически настраиваются пути к файлам, proto-файлам и БД

## Мониторинг

- **Prometheus** собирает метрики из Envoy
- **Envoy** предоставляет статистику через `/stats/prometheus` на порту `9901`
- Логи сервера сохраняются в `server/logs/` (all.log, error.log)

## Безопасность

- gRPC использует insecure credentials (для разработки)
- В продакшене рекомендуется использовать TLS
- Пароли БД хранятся в `.env` файлах (не коммитятся в Git)
- CORS настроен в Envoy для кросс-доменных запросов

## Масштабируемость

- Сервер может быть масштабирован горизонтально (несколько инстансов)
- Envoy поддерживает load balancing (round_robin)
- PostgreSQL может быть заменён на кластер для высокой доступности
- Файлы хранятся на файловой системе (можно заменить на объектное хранилище)


