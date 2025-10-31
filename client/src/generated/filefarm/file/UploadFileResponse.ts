// Original file: src/protos/file.proto

import type { Long } from '@grpc/proto-loader';

export interface UploadFileResponse {
  'message'?: (string);
  'fileSize'?: (number | string | Long);
  'success'?: (boolean);
}

export interface UploadFileResponse__Output {
  'message'?: (string);
  'fileSize'?: (Long);
  'success'?: (boolean);
}
