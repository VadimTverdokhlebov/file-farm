import { fileClient } from '../grpc';


export const handleDownloadFile = async (filename: string) => {
  const response = await fileClient.downloadFile({ filename });
  if (!response.response.content || response.response.content.length === 0) {
    throw new Error('File not found or empty');
  }
  return response.response.content;
};

export const handleUploadFile = async (filename: string, content: Uint8Array, mimetype: string) => {
  const response = await fileClient.uploadFile({ filename, content, mimetype });
  if (!response.response.success) {
    throw new Error(response.response.message || 'Upload failed');
  }
  return response.response;
};