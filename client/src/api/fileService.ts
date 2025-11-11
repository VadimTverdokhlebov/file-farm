import { fileClient } from '../grpc';

export const handleDownloadFile = async (filename: string): Promise<Uint8Array> => {
  const response = await fileClient.downloadFile({ filename });
  const base64Content = response.response.content as unknown as string;
  if (!base64Content || base64Content.length === 0) {
    throw new Error('File not found or empty');
  }
  
  // Decode base64 to Uint8Array
  const binaryString = atob(base64Content);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

export const handleUploadFile = async (filename: string, content: Uint8Array, mimetype: string) => {
  // Encode Uint8Array to base64
  // Convert Uint8Array to binary string in chunks to avoid stack overflow
  let binaryString = '';
  const chunkSize = 8192;
  for (let i = 0; i < content.length; i += chunkSize) {
    const chunk = content.slice(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j++) {
      binaryString += String.fromCharCode(chunk[j]);
    }
  }
  const base64Content = btoa(binaryString);
  console.log({ 
    filename, 
    content: base64Content, 
    mimetype 
  });
  
  const response = await fileClient.uploadFile({ 
    filename, 
    content: base64Content, 
    mimetype 
  });

  if (!response.response.success) {
    throw new Error(response.response.message || 'Upload failed');
  }
  return response.response;
};