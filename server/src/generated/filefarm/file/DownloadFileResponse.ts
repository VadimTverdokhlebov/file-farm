// Original file: ../protos/file.proto


export interface DownloadFileResponse {
  'content'?: (Buffer | Uint8Array | string);
  'mimetype'?: (string);
}

export interface DownloadFileResponse__Output {
  'content'?: (Buffer);
  'mimetype'?: (string);
}
