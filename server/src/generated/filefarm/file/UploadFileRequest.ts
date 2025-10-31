// Original file: src/protos/file.proto


export interface UploadFileRequest {
  'filename'?: (string);
  'content'?: (Buffer | Uint8Array | string);
  'mimetype'?: (string);
}

export interface UploadFileRequest__Output {
  'filename'?: (string);
  'content'?: (Buffer);
  'mimetype'?: (string);
}
