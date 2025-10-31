// Original file: src/protos/hello.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { RequestWorld as _filefarm_hello_RequestWorld, RequestWorld__Output as _filefarm_hello_RequestWorld__Output } from './RequestWorld';
import type { ResponseWorld as _filefarm_hello_ResponseWorld, ResponseWorld__Output as _filefarm_hello_ResponseWorld__Output } from './ResponseWorld';

export interface WorldServiceClient extends grpc.Client {
  ServiceWorld(argument: _filefarm_hello_RequestWorld, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_hello_ResponseWorld__Output>): grpc.ClientUnaryCall;
  ServiceWorld(argument: _filefarm_hello_RequestWorld, metadata: grpc.Metadata, callback: grpc.requestCallback<_filefarm_hello_ResponseWorld__Output>): grpc.ClientUnaryCall;
  ServiceWorld(argument: _filefarm_hello_RequestWorld, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_hello_ResponseWorld__Output>): grpc.ClientUnaryCall;
  ServiceWorld(argument: _filefarm_hello_RequestWorld, callback: grpc.requestCallback<_filefarm_hello_ResponseWorld__Output>): grpc.ClientUnaryCall;
  serviceWorld(argument: _filefarm_hello_RequestWorld, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_hello_ResponseWorld__Output>): grpc.ClientUnaryCall;
  serviceWorld(argument: _filefarm_hello_RequestWorld, metadata: grpc.Metadata, callback: grpc.requestCallback<_filefarm_hello_ResponseWorld__Output>): grpc.ClientUnaryCall;
  serviceWorld(argument: _filefarm_hello_RequestWorld, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_hello_ResponseWorld__Output>): grpc.ClientUnaryCall;
  serviceWorld(argument: _filefarm_hello_RequestWorld, callback: grpc.requestCallback<_filefarm_hello_ResponseWorld__Output>): grpc.ClientUnaryCall;
  
}

export interface WorldServiceHandlers extends grpc.UntypedServiceImplementation {
  ServiceWorld: grpc.handleUnaryCall<_filefarm_hello_RequestWorld__Output, _filefarm_hello_ResponseWorld>;
  
}

export interface WorldServiceDefinition extends grpc.ServiceDefinition {
  ServiceWorld: MethodDefinition<_filefarm_hello_RequestWorld, _filefarm_hello_ResponseWorld, _filefarm_hello_RequestWorld__Output, _filefarm_hello_ResponseWorld__Output>
}
