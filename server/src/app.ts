import * as grpc from '@grpc/grpc-js';
import path from 'path';
import * as protoLoader from '@grpc/proto-loader';
import { GRPC_PROTO_FILE } from './utils/secrets';
import { ProtoGrpcType } from './controller/user';
import { UserServiceHandlers } from './controller/UserPackage/UserService';
import { CreateUser, GetUser } from './services/UserService';

const protoFilePath = path.resolve(__dirname, GRPC_PROTO_FILE!);
console.log('protoFilePath:', protoFilePath);

const packageDefinition = protoLoader.loadSync(protoFilePath);
const grpcObject = grpc.loadPackageDefinition(packageDefinition) as unknown as ProtoGrpcType;
const UserService = grpcObject.UserPackage.UserService.service;

export default function getServer() {
    const server = new grpc.Server();

    server.addService(UserService, { CreateUser, GetUser } as UserServiceHandlers);

    return server;
}
