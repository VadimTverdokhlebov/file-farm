import { fileClient } from '../grpc';
import { base64ToUint8, uint8ToBase64 } from './codec';

const DEFAULT_MIME = 'application/octet-stream';

async function readFile(file: File): Promise<{ filename: string; content: string; mimetype: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    filename: file.name,
    content: uint8ToBase64(bytes),
    mimetype: file.type || DEFAULT_MIME,
  };
}

export async function uploadFile(file: File): Promise<string> {
  const response = await fileClient.uploadFile(await readFile(file));
  if (!response.response.success) {
    throw new Error(response.response.message || 'Upload failed');
  }
  return response.response.message || `Uploaded ${file.name}`;
}

export async function downloadFile(filename: string): Promise<Uint8Array> {
  const response = await fileClient.downloadFile({ filename });
  const content = response.response.content;
  if (!content) {
    throw new Error('File not found or empty');
  }
  return base64ToUint8(content);
}

export async function deleteFile(filename: string): Promise<string> {
  const response = await fileClient.deleteFile({ filename });
  if (!response.response.success) {
    throw new Error(response.response.message || 'Delete failed');
  }
  return response.response.message || `Deleted ${filename}`;
}

export async function compressFile(file: File): Promise<{ message: string; bytes: Uint8Array }> {
  const response = await fileClient.compressFile(await readFile(file));
  if (!response.response.success || !response.response.compressedContent) {
    throw new Error(response.response.message || 'Compress failed');
  }
  return {
    message: response.response.message || `Compressed ${file.name}`,
    bytes: base64ToUint8(response.response.compressedContent),
  };
}
