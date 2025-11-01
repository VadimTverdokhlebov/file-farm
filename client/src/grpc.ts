import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import { FileServiceClient } from './generated/file.client';
import { UserServiceClient } from './generated/user.client';

const apiUrl = 'http://localhost:8080';

const transport = new GrpcWebFetchTransport({
  baseUrl: apiUrl,
});
export const fileClient = new FileServiceClient(transport);
export const userClient = new UserServiceClient(transport);