// Original file: src/protos/hello.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { RequestWorld as _HelloServicePackage_RequestWorld, RequestWorld__Output as _HelloServicePackage_RequestWorld__Output } from '../HelloServicePackage/RequestWorld';
import type { ResponseWorld as _HelloServicePackage_ResponseWorld, ResponseWorld__Output as _HelloServicePackage_ResponseWorld__Output } from '../HelloServicePackage/ResponseWorld';

export interface WorldServiceClient extends grpc.Client {
  ServiceWorld(argument: _HelloServicePackage_RequestWorld, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_HelloServicePackage_ResponseWorld__Output>): grpc.ClientUnaryCall;
  ServiceWorld(argument: _HelloServicePackage_RequestWorld, metadata: grpc.Metadata, callback: grpc.requestCallback<_HelloServicePackage_ResponseWorld__Output>): grpc.ClientUnaryCall;
  ServiceWorld(argument: _HelloServicePackage_RequestWorld, options: grpc.CallOptions, callback: grpc.requestCallback<_HelloServicePackage_ResponseWorld__Output>): grpc.ClientUnaryCall;
  ServiceWorld(argument: _HelloServicePackage_RequestWorld, callback: grpc.requestCallback<_HelloServicePackage_ResponseWorld__Output>): grpc.ClientUnaryCall;
  serviceWorld(argument: _HelloServicePackage_RequestWorld, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_HelloServicePackage_ResponseWorld__Output>): grpc.ClientUnaryCall;
  serviceWorld(argument: _HelloServicePackage_RequestWorld, metadata: grpc.Metadata, callback: grpc.requestCallback<_HelloServicePackage_ResponseWorld__Output>): grpc.ClientUnaryCall;
  serviceWorld(argument: _HelloServicePackage_RequestWorld, options: grpc.CallOptions, callback: grpc.requestCallback<_HelloServicePackage_ResponseWorld__Output>): grpc.ClientUnaryCall;
  serviceWorld(argument: _HelloServicePackage_RequestWorld, callback: grpc.requestCallback<_HelloServicePackage_ResponseWorld__Output>): grpc.ClientUnaryCall;
  
}

export interface WorldServiceHandlers extends grpc.UntypedServiceImplementation {
  ServiceWorld: grpc.handleUnaryCall<_HelloServicePackage_RequestWorld__Output, _HelloServicePackage_ResponseWorld>;
  
}

export interface WorldServiceDefinition extends grpc.ServiceDefinition {
  ServiceWorld: MethodDefinition<_HelloServicePackage_RequestWorld, _HelloServicePackage_ResponseWorld, _HelloServicePackage_RequestWorld__Output, _HelloServicePackage_ResponseWorld__Output>
}
