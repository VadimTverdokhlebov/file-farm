// Original file: ../protos/file.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { DownloadFileRequest as _filefarm_file_DownloadFileRequest, DownloadFileRequest__Output as _filefarm_file_DownloadFileRequest__Output } from '../../filefarm/file/DownloadFileRequest';
import type { DownloadFileResponse as _filefarm_file_DownloadFileResponse, DownloadFileResponse__Output as _filefarm_file_DownloadFileResponse__Output } from '../../filefarm/file/DownloadFileResponse';
import type { UploadFileRequest as _filefarm_file_UploadFileRequest, UploadFileRequest__Output as _filefarm_file_UploadFileRequest__Output } from '../../filefarm/file/UploadFileRequest';
import type { UploadFileResponse as _filefarm_file_UploadFileResponse, UploadFileResponse__Output as _filefarm_file_UploadFileResponse__Output } from '../../filefarm/file/UploadFileResponse';

export interface FileServiceClient extends grpc.Client {
  DownloadFile(argument: _filefarm_file_DownloadFileRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_file_DownloadFileResponse__Output>): grpc.ClientUnaryCall;
  DownloadFile(argument: _filefarm_file_DownloadFileRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_filefarm_file_DownloadFileResponse__Output>): grpc.ClientUnaryCall;
  DownloadFile(argument: _filefarm_file_DownloadFileRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_file_DownloadFileResponse__Output>): grpc.ClientUnaryCall;
  DownloadFile(argument: _filefarm_file_DownloadFileRequest, callback: grpc.requestCallback<_filefarm_file_DownloadFileResponse__Output>): grpc.ClientUnaryCall;
  downloadFile(argument: _filefarm_file_DownloadFileRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_file_DownloadFileResponse__Output>): grpc.ClientUnaryCall;
  downloadFile(argument: _filefarm_file_DownloadFileRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_filefarm_file_DownloadFileResponse__Output>): grpc.ClientUnaryCall;
  downloadFile(argument: _filefarm_file_DownloadFileRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_filefarm_file_DownloadFileResponse__Output>): grpc.ClientUnaryCall;
  downloadFile(argument: _filefarm_file_DownloadFileRequest, callback: grpc.requestCallback<_filefarm_file_DownloadFileResponse__Output>): grpc.ClientUnaryCall;
  
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
  DownloadFile: grpc.handleUnaryCall<_filefarm_file_DownloadFileRequest__Output, _filefarm_file_DownloadFileResponse>;
  
  UploadFile: grpc.handleUnaryCall<_filefarm_file_UploadFileRequest__Output, _filefarm_file_UploadFileResponse>;
  
}

export interface FileServiceDefinition extends grpc.ServiceDefinition {
  DownloadFile: MethodDefinition<_filefarm_file_DownloadFileRequest, _filefarm_file_DownloadFileResponse, _filefarm_file_DownloadFileRequest__Output, _filefarm_file_DownloadFileResponse__Output>
  UploadFile: MethodDefinition<_filefarm_file_UploadFileRequest, _filefarm_file_UploadFileResponse, _filefarm_file_UploadFileRequest__Output, _filefarm_file_UploadFileResponse__Output>
}
