# Сцена 1: Сборка Go приложения
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o /load-stand-server .

# TODO: Добавить сцену для сборки React/Vite UI
# FROM node:18-alpine AS frontend-builder
# ...
# RUN npm run build

# Сцена 2: Финальный образ
FROM alpine:latest
WORKDIR /app
# Копируем скомпилированный бинарник
COPY --from=builder /load-stand-server .
# Копируем .proto файлы, чтобы парсер мог их найти
COPY ./proto ./proto

# TODO: Скопировать собранный UI из frontend-builder
# COPY --from=frontend-builder /app/dist ./dist

EXPOSE 8081
CMD ["./load-stand-server"]