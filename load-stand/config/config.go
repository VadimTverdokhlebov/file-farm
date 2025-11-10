package config

import (
    "os"
    "path/filepath"
    "strconv"

    "github.com/joho/godotenv"
)

type Config struct {
    HttpPort   int
    ProtoDir   string
    GrpcTarget string
}

func getEnv(key, fallback string) string {
    if value, ok := os.LookupEnv(key); ok {
        return value
    }
    return fallback
}

func New() *Config {
    _ = godotenv.Load()

    port, _ := strconv.Atoi(getEnv("HTTP_PORT", "8081"))

    protoDir, _ := filepath.Abs(getEnv("PROTO_DIR", "../protos"))

    return &Config{
        HttpPort:   port,
        ProtoDir:   protoDir,
        GrpcTarget: getEnv("TARGET_GRPC", "localhost:8080"),
    }
}
