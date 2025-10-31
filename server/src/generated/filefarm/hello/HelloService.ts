// Original file: src/protos/hello.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { RequestHello as _filefarm_hello_RequestHello, RequestHello__Output as _filefarm_hello_RequestHello__Output } from './RequestHello';
import type { ResponseHello as _filefarm_hello_ResponseHello, ResponseHello__Output as _filefarm_hello_ResponseHello__Output } from './ResponseHello';

export interface HelloServiceClient extends grpc.Client {
  ServiceHello(argument: _filefarm_hello_RequestHello, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_hello_ResponseHello__Output>): grpc.ClientUnaryCall;
  ServiceHello(argument: _filefarm_hello_RequestHello, metadata: grpc.Metadata, callback: grpc.requestCallback<_filefarm_hello_ResponseHello__Output>): grpc.ClientUnaryCall;
  ServiceHello(argument: _filefarm_hello_RequestHello, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_hello_ResponseHello__Output>): grpc.ClientUnaryCall;
  ServiceHello(argument: _filefarm_hello_RequestHello, callback: grpc.requestCallback<_filefarm_hello_ResponseHello__Output>): grpc.ClientUnaryCall;
  serviceHello(argument: _filefarm_hello_RequestHello, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_hello_ResponseHello__Output>): grpc.ClientUnaryCall;
  serviceHello(argument: _filefarm_hello_RequestHello, metadata: grpc.Metadata, callback: grpc.requestCallback<_filefarm_hello_ResponseHello__Output>): grpc.ClientUnaryCall;
  serviceHello(argument: _filefarm_hello_RequestHello, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_hello_ResponseHello__Output>): grpc.ClientUnaryCall;
  serviceHello(argument: _filefarm_hello_RequestHello, callback: grpc.requestCallback<_filefarm_hello_ResponseHello__Output>): grpc.ClientUnaryCall;
  
}

export interface HelloServiceHandlers extends grpc.UntypedServiceImplementation {
  ServiceHello: grpc.handleUnaryCall<_filefarm_hello_RequestHello__Output, _filefarm_hello_ResponseHello>;
  
}

export interface HelloServiceDefinition extends grpc.ServiceDefinition {
  ServiceHello: MethodDefinition<_filefarm_hello_RequestHello, _filefarm_hello_ResponseHello, _filefarm_hello_RequestHello__Output, _filefarm_hello_ResponseHello__Output>
}
