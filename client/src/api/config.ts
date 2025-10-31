// gRPC service configuration
export const GRPC_SERVER_URL = import.meta.env.VITE_GRPC_SERVER_URL || 'http://localhost:50051';

// Note: For gRPC-Web to work in browser, you need an Envoy proxy
// This configuration assumes Envoy is running and forwarding to gRPC server

