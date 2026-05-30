FROM golang:1.21-alpine AS builder

WORKDIR /app
COPY load-stand/go.mod load-stand/go.sum ./
RUN go mod download
COPY load-stand/ .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o /load-stand-server .

FROM alpine:latest

WORKDIR /app
COPY --from=builder /load-stand-server .

ENV HTTP_PORT=8081
ENV TARGET_GRPC=file-farm-envoy:8080
ENV PROTO_DIR=/proto

EXPOSE 8081
CMD ["./load-stand-server"]
