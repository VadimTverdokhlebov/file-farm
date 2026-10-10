import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { CompressFileRequest as _filefarm_file_CompressFileRequest, CompressFileRequest__Output as _filefarm_file_CompressFileRequest__Output } from './filefarm/file/CompressFileRequest';
import type { CompressFileResponse as _filefarm_file_CompressFileResponse, CompressFileResponse__Output as _filefarm_file_CompressFileResponse__Output } from './filefarm/file/CompressFileResponse';
import type { DeleteFileRequest as _filefarm_file_DeleteFileRequest, DeleteFileRequest__Output as _filefarm_file_DeleteFileRequest__Output } from './filefarm/file/DeleteFileRequest';
import type { DeleteFileResponse as _filefarm_file_DeleteFileResponse, DeleteFileResponse__Output as _filefarm_file_DeleteFileResponse__Output } from './filefarm/file/DeleteFileResponse';
import type { DownloadFileRequest as _filefarm_file_DownloadFileRequest, DownloadFileRequest__Output as _filefarm_file_DownloadFileRequest__Output } from './filefarm/file/DownloadFileRequest';
import type { DownloadFileResponse as _filefarm_file_DownloadFileResponse, DownloadFileResponse__Output as _filefarm_file_DownloadFileResponse__Output } from './filefarm/file/DownloadFileResponse';
import type { FileServiceClient as _filefarm_file_FileServiceClient, FileServiceDefinition as _filefarm_file_FileServiceDefinition } from './filefarm/file/FileService';
import type { UploadFileRequest as _filefarm_file_UploadFileRequest, UploadFileRequest__Output as _filefarm_file_UploadFileRequest__Output } from './filefarm/file/UploadFileRequest';
import type { UploadFileResponse as _filefarm_file_UploadFileResponse, UploadFileResponse__Output as _filefarm_file_UploadFileResponse__Output } from './filefarm/file/UploadFileResponse';
import type { CreateUserRequest as _filefarm_user_CreateUserRequest, CreateUserRequest__Output as _filefarm_user_CreateUserRequest__Output } from './filefarm/user/CreateUserRequest';
import type { CreateUserResponse as _filefarm_user_CreateUserResponse, CreateUserResponse__Output as _filefarm_user_CreateUserResponse__Output } from './filefarm/user/CreateUserResponse';
import type { GetUserRequest as _filefarm_user_GetUserRequest, GetUserRequest__Output as _filefarm_user_GetUserRequest__Output } from './filefarm/user/GetUserRequest';
import type { GetUserResponse as _filefarm_user_GetUserResponse, GetUserResponse__Output as _filefarm_user_GetUserResponse__Output } from './filefarm/user/GetUserResponse';
import type { UserServiceClient as _filefarm_user_UserServiceClient, UserServiceDefinition as _filefarm_user_UserServiceDefinition } from './filefarm/user/UserService';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  filefarm: {
    file: {
      CompressFileRequest: MessageTypeDefinition<_filefarm_file_CompressFileRequest, _filefarm_file_CompressFileRequest__Output>
      CompressFileResponse: MessageTypeDefinition<_filefarm_file_CompressFileResponse, _filefarm_file_CompressFileResponse__Output>
      DeleteFileRequest: MessageTypeDefinition<_filefarm_file_DeleteFileRequest, _filefarm_file_DeleteFileRequest__Output>
      DeleteFileResponse: MessageTypeDefinition<_filefarm_file_DeleteFileResponse, _filefarm_file_DeleteFileResponse__Output>
      DownloadFileRequest: MessageTypeDefinition<_filefarm_file_DownloadFileRequest, _filefarm_file_DownloadFileRequest__Output>
      DownloadFileResponse: MessageTypeDefinition<_filefarm_file_DownloadFileResponse, _filefarm_file_DownloadFileResponse__Output>
      FileService: SubtypeConstructor<typeof grpc.Client, _filefarm_file_FileServiceClient> & { service: _filefarm_file_FileServiceDefinition }
      UploadFileRequest: MessageTypeDefinition<_filefarm_file_UploadFileRequest, _filefarm_file_UploadFileRequest__Output>
      UploadFileResponse: MessageTypeDefinition<_filefarm_file_UploadFileResponse, _filefarm_file_UploadFileResponse__Output>
    }
    user: {
      CreateUserRequest: MessageTypeDefinition<_filefarm_user_CreateUserRequest, _filefarm_user_CreateUserRequest__Output>
      CreateUserResponse: MessageTypeDefinition<_filefarm_user_CreateUserResponse, _filefarm_user_CreateUserResponse__Output>
      GetUserRequest: MessageTypeDefinition<_filefarm_user_GetUserRequest, _filefarm_user_GetUserRequest__Output>
      GetUserResponse: MessageTypeDefinition<_filefarm_user_GetUserResponse, _filefarm_user_GetUserResponse__Output>
      UserService: SubtypeConstructor<typeof grpc.Client, _filefarm_user_UserServiceClient> & { service: _filefarm_user_UserServiceDefinition }
    }
  }
}

