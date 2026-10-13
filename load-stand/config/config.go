package config

import (
	"os"
	"path/filepath"
	"strconv"

	"github.com/joho/godotenv"
)

type Config struct {
	HttpPort        int
	ProtoDir        string
	GrpcTarget      string
	EnvoyAdminURL   string
	LoadBalancerURL string
	PrometheusURL   string
	DockerSocket    string
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
		HttpPort:        port,
		ProtoDir:        protoDir,
		GrpcTarget:      getEnv("TARGET_GRPC", "localhost:8080"),
		EnvoyAdminURL:   getEnv("ENVOY_ADMIN_URL", "http://localhost:9901"),
		LoadBalancerURL: getEnv("LB_CONTROLLER_URL", "http://localhost:9094"),
		PrometheusURL:   getEnv("PROMETHEUS_URL", "http://file-farm-prometheus:9090"),
		DockerSocket:    getEnv("DOCKER_SOCKET", "/var/run/docker.sock"),
	}
}
