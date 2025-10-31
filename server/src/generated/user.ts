import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { UserServiceClient as _filefarm_user_UserServiceClient, UserServiceDefinition as _filefarm_user_UserServiceDefinition } from './filefarm/user/UserService';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  filefarm: {
    user: {
      CreateUserRequest: MessageTypeDefinition
      CreateUserResponse: MessageTypeDefinition
      GetUserRequest: MessageTypeDefinition
      GetUserResponse: MessageTypeDefinition
      UserService: SubtypeConstructor<typeof grpc.Client, _filefarm_user_UserServiceClient> & { service: _filefarm_user_UserServiceDefinition }
    }
  }
}

