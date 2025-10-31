import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { HelloServiceClient as _HelloServicePackage_HelloServiceClient, HelloServiceDefinition as _HelloServicePackage_HelloServiceDefinition } from './HelloServicePackage/HelloService';
import type { WorldServiceClient as _HelloServicePackage_WorldServiceClient, WorldServiceDefinition as _HelloServicePackage_WorldServiceDefinition } from './HelloServicePackage/WorldService';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  HelloServicePackage: {
    HelloService: SubtypeConstructor<typeof grpc.Client, _HelloServicePackage_HelloServiceClient> & { service: _HelloServicePackage_HelloServiceDefinition }
    RequestHello: MessageTypeDefinition
    RequestWorld: MessageTypeDefinition
    ResponseHello: MessageTypeDefinition
    ResponseWorld: MessageTypeDefinition
    WorldService: SubtypeConstructor<typeof grpc.Client, _HelloServicePackage_WorldServiceClient> & { service: _HelloServicePackage_WorldServiceDefinition }
  }
}

