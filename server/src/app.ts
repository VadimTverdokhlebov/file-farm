import * as grpc from '@grpc/grpc-js';
import path from 'path';
import * as protoLoader from '@grpc/proto-loader';
import { GRPC_PROTO_FILE } from './utils/secrets';
import { ProtoGrpcType } from './generated/service';
import { UserServiceHandlers } from './generated/filefarm/user/UserService';
import { FileServiceHandlers } from './generated/filefarm/file/FileService';
import { CreateUser, GetUser } from './services/user_service';
import { UploadFile, DownloadFile } from './services/file_service';

const protoFilePath = path.resolve(__dirname, GRPC_PROTO_FILE!);
const servicePackageDef = protoLoader.loadSync(protoFilePath);
const serviceGrpcObject = grpc.loadPackageDefinition(servicePackageDef) as unknown as ProtoGrpcType;

const UserService = serviceGrpcObject.filefarm.user.UserService.service;
const FileService = serviceGrpcObject.filefarm.file.FileService.service;

export default function getServer() {
    const server = new grpc.Server();

    server.addService(UserService, { CreateUser, GetUser } as UserServiceHandlers);
    server.addService(FileService, { UploadFile, DownloadFile } as FileServiceHandlers);

    return server;
}
