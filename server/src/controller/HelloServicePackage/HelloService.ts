// Original file: src/protos/hello.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { RequestHello as _HelloServicePackage_RequestHello, RequestHello__Output as _HelloServicePackage_RequestHello__Output } from '../HelloServicePackage/RequestHello';
import type { ResponseHello as _HelloServicePackage_ResponseHello, ResponseHello__Output as _HelloServicePackage_ResponseHello__Output } from '../HelloServicePackage/ResponseHello';

export interface HelloServiceClient extends grpc.Client {
  ServiceHello(argument: _HelloServicePackage_RequestHello, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_HelloServicePackage_ResponseHello__Output>): grpc.ClientUnaryCall;
  ServiceHello(argument: _HelloServicePackage_RequestHello, metadata: grpc.Metadata, callback: grpc.requestCallback<_HelloServicePackage_ResponseHello__Output>): grpc.ClientUnaryCall;
  ServiceHello(argument: _HelloServicePackage_RequestHello, options: grpc.CallOptions, callback: grpc.requestCallback<_HelloServicePackage_ResponseHello__Output>): grpc.ClientUnaryCall;
  ServiceHello(argument: _HelloServicePackage_RequestHello, callback: grpc.requestCallback<_HelloServicePackage_ResponseHello__Output>): grpc.ClientUnaryCall;
  serviceHello(argument: _HelloServicePackage_RequestHello, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_HelloServicePackage_ResponseHello__Output>): grpc.ClientUnaryCall;
  serviceHello(argument: _HelloServicePackage_RequestHello, metadata: grpc.Metadata, callback: grpc.requestCallback<_HelloServicePackage_ResponseHello__Output>): grpc.ClientUnaryCall;
  serviceHello(argument: _HelloServicePackage_RequestHello, options: grpc.CallOptions, callback: grpc.requestCallback<_HelloServicePackage_ResponseHello__Output>): grpc.ClientUnaryCall;
  serviceHello(argument: _HelloServicePackage_RequestHello, callback: grpc.requestCallback<_HelloServicePackage_ResponseHello__Output>): grpc.ClientUnaryCall;
  
}

export interface HelloServiceHandlers extends grpc.UntypedServiceImplementation {
  ServiceHello: grpc.handleUnaryCall<_HelloServicePackage_RequestHello__Output, _HelloServicePackage_ResponseHello>;
  
}

export interface HelloServiceDefinition extends grpc.ServiceDefinition {
  ServiceHello: MethodDefinition<_HelloServicePackage_RequestHello, _HelloServicePackage_ResponseHello, _HelloServicePackage_RequestHello__Output, _HelloServicePackage_ResponseHello__Output>
}
