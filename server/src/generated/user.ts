import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { CreateUserRequest as _filefarm_user_CreateUserRequest, CreateUserRequest__Output as _filefarm_user_CreateUserRequest__Output } from './filefarm/user/CreateUserRequest';
import type { CreateUserResponse as _filefarm_user_CreateUserResponse, CreateUserResponse__Output as _filefarm_user_CreateUserResponse__Output } from './filefarm/user/CreateUserResponse';
import type { GetUserRequest as _filefarm_user_GetUserRequest, GetUserRequest__Output as _filefarm_user_GetUserRequest__Output } from './filefarm/user/GetUserRequest';
import type { GetUserResponse as _filefarm_user_GetUserResponse, GetUserResponse__Output as _filefarm_user_GetUserResponse__Output } from './filefarm/user/GetUserResponse';
import type { UserServiceClient as _filefarm_user_UserServiceClient, UserServiceDefinition as _filefarm_user_UserServiceDefinition } from './filefarm/user/UserService';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  filefarm: {
    user: {
      CreateUserRequest: MessageTypeDefinition<_filefarm_user_CreateUserRequest, _filefarm_user_CreateUserRequest__Output>
      CreateUserResponse: MessageTypeDefinition<_filefarm_user_CreateUserResponse, _filefarm_user_CreateUserResponse__Output>
      GetUserRequest: MessageTypeDefinition<_filefarm_user_GetUserRequest, _filefarm_user_GetUserRequest__Output>
      GetUserResponse: MessageTypeDefinition<_filefarm_user_GetUserResponse, _filefarm_user_GetUserResponse__Output>
      UserService: SubtypeConstructor<typeof grpc.Client, _filefarm_user_UserServiceClient> & { service: _filefarm_user_UserServiceDefinition }
    }
  }
}

