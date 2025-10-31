import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { DownloadFileRequest as _filefarm_file_DownloadFileRequest, DownloadFileRequest__Output as _filefarm_file_DownloadFileRequest__Output } from './filefarm/file/DownloadFileRequest';
import type { DownloadFileResponse as _filefarm_file_DownloadFileResponse, DownloadFileResponse__Output as _filefarm_file_DownloadFileResponse__Output } from './filefarm/file/DownloadFileResponse';
import type { FileServiceClient as _filefarm_file_FileServiceClient, FileServiceDefinition as _filefarm_file_FileServiceDefinition } from './filefarm/file/FileService';
import type { UploadFileRequest as _filefarm_file_UploadFileRequest, UploadFileRequest__Output as _filefarm_file_UploadFileRequest__Output } from './filefarm/file/UploadFileRequest';
import type { UploadFileResponse as _filefarm_file_UploadFileResponse, UploadFileResponse__Output as _filefarm_file_UploadFileResponse__Output } from './filefarm/file/UploadFileResponse';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  filefarm: {
    file: {
      DownloadFileRequest: MessageTypeDefinition<_filefarm_file_DownloadFileRequest, _filefarm_file_DownloadFileRequest__Output>
      DownloadFileResponse: MessageTypeDefinition<_filefarm_file_DownloadFileResponse, _filefarm_file_DownloadFileResponse__Output>
      FileService: SubtypeConstructor<typeof grpc.Client, _filefarm_file_FileServiceClient> & { service: _filefarm_file_FileServiceDefinition }
      UploadFileRequest: MessageTypeDefinition<_filefarm_file_UploadFileRequest, _filefarm_file_UploadFileRequest__Output>
      UploadFileResponse: MessageTypeDefinition<_filefarm_file_UploadFileResponse, _filefarm_file_UploadFileResponse__Output>
    }
  }
}

