// Original file: src/protos/user.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { CreateUserRequest as _UserPackage_CreateUserRequest, CreateUserRequest__Output as _UserPackage_CreateUserRequest__Output } from '../UserPackage/CreateUserRequest';
import type { CreateUserResponse as _UserPackage_CreateUserResponse, CreateUserResponse__Output as _UserPackage_CreateUserResponse__Output } from '../UserPackage/CreateUserResponse';
import type { GetUserRequest as _UserPackage_GetUserRequest, GetUserRequest__Output as _UserPackage_GetUserRequest__Output } from '../UserPackage/GetUserRequest';
import type { GetUserResponse as _UserPackage_GetUserResponse, GetUserResponse__Output as _UserPackage_GetUserResponse__Output } from '../UserPackage/GetUserResponse';

export interface UserServiceClient extends grpc.Client {
  CreateUser(argument: _UserPackage_CreateUserRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_UserPackage_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  CreateUser(argument: _UserPackage_CreateUserRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_UserPackage_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  CreateUser(argument: _UserPackage_CreateUserRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_UserPackage_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  CreateUser(argument: _UserPackage_CreateUserRequest, callback: grpc.requestCallback<_UserPackage_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  createUser(argument: _UserPackage_CreateUserRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_UserPackage_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  createUser(argument: _UserPackage_CreateUserRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_UserPackage_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  createUser(argument: _UserPackage_CreateUserRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_UserPackage_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  createUser(argument: _UserPackage_CreateUserRequest, callback: grpc.requestCallback<_UserPackage_CreateUserResponse__Output>): grpc.ClientUnaryCall;
  
  GetUser(argument: _UserPackage_GetUserRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_UserPackage_GetUserResponse__Output>): grpc.ClientUnaryCall;
  GetUser(argument: _UserPackage_GetUserRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_UserPackage_GetUserResponse__Output>): grpc.ClientUnaryCall;
  GetUser(argument: _UserPackage_GetUserRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_UserPackage_GetUserResponse__Output>): grpc.ClientUnaryCall;
  GetUser(argument: _UserPackage_GetUserRequest, callback: grpc.requestCallback<_UserPackage_GetUserResponse__Output>): grpc.ClientUnaryCall;
  getUser(argument: _UserPackage_GetUserRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_UserPackage_GetUserResponse__Output>): grpc.ClientUnaryCall;
  getUser(argument: _UserPackage_GetUserRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_UserPackage_GetUserResponse__Output>): grpc.ClientUnaryCall;
  getUser(argument: _UserPackage_GetUserRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_UserPackage_GetUserResponse__Output>): grpc.ClientUnaryCall;
  getUser(argument: _UserPackage_GetUserRequest, callback: grpc.requestCallback<_UserPackage_GetUserResponse__Output>): grpc.ClientUnaryCall;
  
}

export interface UserServiceHandlers extends grpc.UntypedServiceImplementation {
  CreateUser: grpc.handleUnaryCall<_UserPackage_CreateUserRequest__Output, _UserPackage_CreateUserResponse>;
  
  GetUser: grpc.handleUnaryCall<_UserPackage_GetUserRequest__Output, _UserPackage_GetUserResponse>;
  
}

export interface UserServiceDefinition extends grpc.ServiceDefinition {
  CreateUser: MethodDefinition<_UserPackage_CreateUserRequest, _UserPackage_CreateUserResponse, _UserPackage_CreateUserRequest__Output, _UserPackage_CreateUserResponse__Output>
  GetUser: MethodDefinition<_UserPackage_GetUserRequest, _UserPackage_GetUserResponse, _UserPackage_GetUserRequest__Output, _UserPackage_GetUserResponse__Output>
}
