import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { FileServiceClient as _filefarm_file_FileServiceClient, FileServiceDefinition as _filefarm_file_FileServiceDefinition } from './filefarm/file/FileService';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  filefarm: {
    file: {
      FileService: SubtypeConstructor<typeof grpc.Client, _filefarm_file_FileServiceClient> & { service: _filefarm_file_FileServiceDefinition }
      UploadFileRequest: MessageTypeDefinition
      UploadFileResponse: MessageTypeDefinition
    }
  }
}

