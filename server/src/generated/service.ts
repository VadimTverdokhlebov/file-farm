import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { FileServiceClient as _filefarm_file_FileServiceClient, FileServiceDefinition as _filefarm_file_FileServiceDefinition } from './filefarm/file/FileService';
import type { HelloServiceClient as _filefarm_hello_HelloServiceClient, HelloServiceDefinition as _filefarm_hello_HelloServiceDefinition } from './filefarm/hello/HelloService';
import type { WorldServiceClient as _filefarm_hello_WorldServiceClient, WorldServiceDefinition as _filefarm_hello_WorldServiceDefinition } from './filefarm/hello/WorldService';
import type { UserServiceClient as _filefarm_user_UserServiceClient, UserServiceDefinition as _filefarm_user_UserServiceDefinition } from './filefarm/user/UserService';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  filefarm: {
    file: {
      FileService: SubtypeConstructor<typeof grpc.Client, _filefarm_file_FileServiceClient> & { service: _filefarm_file_FileServiceDefinition }
      UploadFileRequest: MessageTypeDefinition
      UploadFileResponse: MessageTypeDefinition
    }
    hello: {
      HelloService: SubtypeConstructor<typeof grpc.Client, _filefarm_hello_HelloServiceClient> & { service: _filefarm_hello_HelloServiceDefinition }
      RequestHello: MessageTypeDefinition
      RequestWorld: MessageTypeDefinition
      ResponseHello: MessageTypeDefinition
      ResponseWorld: MessageTypeDefinition
      WorldService: SubtypeConstructor<typeof grpc.Client, _filefarm_hello_WorldServiceClient> & { service: _filefarm_hello_WorldServiceDefinition }
    }
    user: {
      CreateUserRequest: MessageTypeDefinition
      CreateUserResponse: MessageTypeDefinition
      GetUserRequest: MessageTypeDefinition
      GetUserResponse: MessageTypeDefinition
      UserService: SubtypeConstructor<typeof grpc.Client, _filefarm_user_UserServiceClient> & { service: _filefarm_user_UserServiceDefinition }
    }
  }
}

