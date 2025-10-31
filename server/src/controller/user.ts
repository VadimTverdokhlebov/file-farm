import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { UserServiceClient as _UserPackage_UserServiceClient, UserServiceDefinition as _UserPackage_UserServiceDefinition } from './UserPackage/UserService';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  UserPackage: {
    CreateUserRequest: MessageTypeDefinition
    CreateUserResponse: MessageTypeDefinition
    GetUserRequest: MessageTypeDefinition
    GetUserResponse: MessageTypeDefinition
    UserService: SubtypeConstructor<typeof grpc.Client, _UserPackage_UserServiceClient> & { service: _UserPackage_UserServiceDefinition }
  }
}

