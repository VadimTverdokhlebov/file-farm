// Original file: src/protos/file.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { UploadFileRequest as _filefarm_file_UploadFileRequest, UploadFileRequest__Output as _filefarm_file_UploadFileRequest__Output } from './UploadFileRequest';
import type { UploadFileResponse as _filefarm_file_UploadFileResponse, UploadFileResponse__Output as _filefarm_file_UploadFileResponse__Output } from './UploadFileResponse';

export interface FileServiceClient extends grpc.Client {
  UploadFile(argument: _filefarm_file_UploadFileRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_file_UploadFileResponse__Output>): grpc.ClientUnaryCall;
  UploadFile(argument: _filefarm_file_UploadFileRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_filefarm_file_UploadFileResponse__Output>): grpc.ClientUnaryCall;
  UploadFile(argument: _filefarm_file_UploadFileRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_file_UploadFileResponse__Output>): grpc.ClientUnaryCall;
  UploadFile(argument: _filefarm_file_UploadFileRequest, callback: grpc.requestCallback<_filefarm_file_UploadFileResponse__Output>): grpc.ClientUnaryCall;
  uploadFile(argument: _filefarm_file_UploadFileRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_file_UploadFileResponse__Output>): grpc.ClientUnaryCall;
  uploadFile(argument: _filefarm_file_UploadFileRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_filefarm_file_UploadFileResponse__Output>): grpc.ClientUnaryCall;
  uploadFile(argument: _filefarm_file_UploadFileRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_file_UploadFileResponse__Output>): grpc.ClientUnaryCall;
  uploadFile(argument: _filefarm_file_UploadFileRequest, callback: grpc.requestCallback<_filefarm_file_UploadFileResponse__Output>): grpc.ClientUnaryCall;
  
}

export interface FileServiceHandlers extends grpc.UntypedServiceImplementation {
  UploadFile: grpc.handleUnaryCall<_filefarm_file_UploadFileRequest__Output, _filefarm_file_UploadFileResponse>;
  
}

export interface FileServiceDefinition extends grpc.ServiceDefinition {
  UploadFile: MethodDefinition<_filefarm_file_UploadFileRequest, _filefarm_file_UploadFileResponse, _filefarm_file_UploadFileRequest__Output, _filefarm_file_UploadFileResponse__Output>
}
