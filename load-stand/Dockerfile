# Dockerfile

# Сцена 1: Сборка Go приложения
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Компилируем бинарник
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o /load-stand-server .

# Сцена 2: Финальный образ
FROM alpine:latest
WORKDIR /app

# Копируем скомпилированный бинарник из первой сцены
COPY --from=builder /load-stand-server .
# Копируем .proto файлы, чтобы парсер мог их найти
COPY ./proto ./proto

# Устанавливаем переменные окружения по умолчанию.
# Они будут использоваться, если их не переопределить в docker-compose.yml.
ENV HTTP_PORT=8081
ENV TARGET_GRPC=envoy:8080
ENV PROTO_DIR=./proto

# Открываем порт, который задан в переменной окружения
EXPOSE ${HTTP_PORT}

# Запускаем наш сервер
CMD ["./load-stand-server"]