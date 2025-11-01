import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import { FileServiceClient } from './generated/file.client';
import { UserServiceClient } from './generated/user.client';

if (!import.meta.env.VITE_API_URL) {
  throw new Error('VITE_API_URL is not set');
}

const transport = new GrpcWebFetchTransport({
  baseUrl: import.meta.env.VITE_API_URL,
});

export const fileClient = new FileServiceClient(transport);
export const userClient = new UserServiceClient(transport);