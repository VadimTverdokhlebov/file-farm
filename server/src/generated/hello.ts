import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { HelloServiceClient as _filefarm_hello_HelloServiceClient, HelloServiceDefinition as _filefarm_hello_HelloServiceDefinition } from './filefarm/hello/HelloService';
import type { WorldServiceClient as _filefarm_hello_WorldServiceClient, WorldServiceDefinition as _filefarm_hello_WorldServiceDefinition } from './filefarm/hello/WorldService';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  filefarm: {
    hello: {
      HelloService: SubtypeConstructor<typeof grpc.Client, _filefarm_hello_HelloServiceClient> & { service: _filefarm_hello_HelloServiceDefinition }
      RequestHello: MessageTypeDefinition
      RequestWorld: MessageTypeDefinition
      ResponseHello: MessageTypeDefinition
      ResponseWorld: MessageTypeDefinition
      WorldService: SubtypeConstructor<typeof grpc.Client, _filefarm_hello_WorldServiceClient> & { service: _filefarm_hello_WorldServiceDefinition }
    }
  }
}

