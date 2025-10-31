// Original file: src/protos/user.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { CreateUserRequest as _filefarm_user_CreateUserRequest, CreateUserRequest__Output as _filefarm_user_CreateUserRequest__Output } from './CreateUserRequest';
import type { CreateUserResponse as _filefarm_user_CreateUserResponse, CreateUserResponse__Output as _filefarm_user_CreateUserResponse__Output } from './CreateUserResponse';
import type { GetUserRequest as _filefarm_user_GetUserRequest, GetUserRequest__Output as _filefarm_user_GetUserRequest__Output } from './GetUserRequest';
import type { GetUserResponse as _filefarm_user_GetUserResponse, GetUserResponse__Output as _filefarm_user_GetUserResponse__Output } from './GetUserResponse';

export interface UserServiceClient extends grpc.Client {
  CreateUser(argument: _filefarm_user_CreateUserRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_user_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  CreateUser(argument: _filefarm_user_CreateUserRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_filefarm_user_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  CreateUser(argument: _filefarm_user_CreateUserRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_user_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  CreateUser(argument: _filefarm_user_CreateUserRequest, callback: grpc.requestCallback<_filefarm_user_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  createUser(argument: _filefarm_user_CreateUserRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_user_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  createUser(argument: _filefarm_user_CreateUserRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_filefarm_user_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  createUser(argument: _filefarm_user_CreateUserRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_user_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  createUser(argument: _filefarm_user_CreateUserRequest, callback: grpc.requestCallback<_filefarm_user_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  
  GetUser(argument: _filefarm_user_GetUserRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_user_GetUserResponse__Output>): grpc.ClientUnaryCall;
  GetUser(argument: _filefarm_user_GetUserRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_filefarm_user_GetUserResponse__Output>): grpc.ClientUnaryCall;
  GetUser(argument: _filefarm_user_GetUserRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_user_GetUserResponse__Output>): grpc.ClientUnaryCall;
  GetUser(argument: _filefarm_user_GetUserRequest, callback: grpc.requestCallback<_filefarm_user_GetUserResponse__Output>): grpc.ClientUnaryCall;
  getUser(argument: _filefarm_user_GetUserRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_user_GetUserResponse__Output>): grpc.ClientUnaryCall;
  getUser(argument: _filefarm_user_GetUserRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_filefarm_user_GetUserResponse__Output>): grpc.ClientUnaryCall;
  getUser(argument: _filefarm_user_GetUserRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_user_GetUserResponse__Output>): grpc.ClientUnaryCall;
  getUser(argument: _filefarm_user_GetUserRequest, callback: grpc.requestCallback<_filefarm_user_GetUserResponse__Output>): grpc.ClientUnaryCall;
  
}

export interface UserServiceHandlers extends grpc.UntypedServiceImplementation {
  CreateUser: grpc.handleUnaryCall<_filefarm_user_CreateUserRequest__Output, _filefarm_user_CreateUserResponse>;
  
  GetUser: grpc.handleUnaryCall<_filefarm_user_GetUserRequest__Output, _filefarm_user_GetUserResponse>;
  
}

export interface UserServiceDefinition extends grpc.ServiceDefinition {
  CreateUser: MethodDefinition<_filefarm_user_CreateUserRequest, _filefarm_user_CreateUserResponse, _filefarm_user_CreateUserRequest__Output, _filefarm_user_CreateUserResponse__Output>
  GetUser: MethodDefinition<_filefarm_user_GetUserRequest, _filefarm_user_GetUserResponse, _filefarm_user_GetUserRequest__Output, _filefarm_user_GetUserResponse__Output>
}
