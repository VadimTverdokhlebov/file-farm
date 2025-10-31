import { GRPC_SERVER_URL } from './config';
import type {
  UploadFileRequest,
} from '../generated/filefarm/file/UploadFileRequest';
import type {
  UploadFileResponse__Output,
} from '../generated/filefarm/file/UploadFileResponse';
import type {
  DownloadFileRequest,
} from '../generated/filefarm/file/DownloadFileRequest';
import type {
  DownloadFileResponse__Output,
} from '../generated/filefarm/file/DownloadFileResponse';
import protobuf from 'protobufjs';

// Import proto file as text
import fileProtoText from '../protos/file.proto?raw';

// Load proto file asynchronously - cache the root
let protoRootPromise: Promise<protobuf.Root> | null = null;

const getProtoRoot = async (): Promise<protobuf.Root> => {
  if (!protoRootPromise) {
    protoRootPromise = new Promise((resolve, reject) => {
      try {
        // Clean up the proto text - remove any potential artifacts from import
        const cleanedProto = fileProtoText.trim();
        
        // Parse proto file
        const result = protobuf.parse(cleanedProto, {
          keepCase: true,
          alternateCommentMode: false,
        });
        
        if (!result.root) {
          throw new Error('Failed to parse proto file: root is null');
        }
        
        resolve(result.root);
      } catch (error) {
        console.error('Proto parsing error:', error);
        console.error('Proto content:', fileProtoText.substring(0, 200));
        reject(error);
      }
    });
  }
  return protoRootPromise;
};

interface UploadFileRequestInput {
  filename: string;
  content: Uint8Array;
  mimetype: string;
}

interface UploadFileResponseOutput {
  message: string;
  fileSize: number;
  success: boolean;
}

interface DownloadFileRequestInput {
  filename: string;
}

interface DownloadFileResponseOutput {
  content: Uint8Array;
  mimetype: string;
}

// File Service API using gRPC with generated types
export const fileService = {
  async uploadFile(request: UploadFileRequestInput): Promise<UploadFileResponseOutput> {
    const root = await getProtoRoot();
    
    // Get message types
    const UploadFileRequestType = root.lookupType('filefarm.file.UploadFileRequest');
    const UploadFileResponseType = root.lookupType('filefarm.file.UploadFileResponse');
    
    // Create request message using generated type interface
    const requestMessage: UploadFileRequest = {
      filename: request.filename,
      content: request.content,
      mimetype: request.mimetype,
    };

    // Encode using protobufjs
    const message = UploadFileRequestType.create(requestMessage);
    const buffer = UploadFileRequestType.encode(message).finish();

    // Send gRPC-Web request
    const response = await fetch(`${GRPC_SERVER_URL}/filefarm.file.FileService/UploadFile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc-web+proto',
        'X-Grpc-Web': '1',
      },
      body: new Uint8Array(buffer),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload file: ${response.statusText} - ${errorText}`);
    }

    const responseBuffer = await response.arrayBuffer();
    const responseData = UploadFileResponseType.decode(
      new Uint8Array(responseBuffer)
    ) as unknown as UploadFileResponse__Output;
    
    return {
      message: responseData.message || '',
      fileSize: typeof responseData.fileSize === 'string' 
        ? parseInt(responseData.fileSize, 10) 
        : typeof responseData.fileSize === 'object' && responseData.fileSize
        ? Number(responseData.fileSize)
        : Number(responseData.fileSize || 0),
      success: responseData.success || false,
    };
  },

  async downloadFile(request: DownloadFileRequestInput): Promise<DownloadFileResponseOutput> {
    const root = await getProtoRoot();
    
    // Get message types
    const DownloadFileRequestType = root.lookupType('filefarm.file.DownloadFileRequest');
    const DownloadFileResponseType = root.lookupType('filefarm.file.DownloadFileResponse');
    
    // Create request message using generated type interface
    const requestMessage: DownloadFileRequest = {
      filename: request.filename,
    };

    // Encode using protobufjs
    const message = DownloadFileRequestType.create(requestMessage);
    const buffer = DownloadFileRequestType.encode(message).finish();

    // Send gRPC-Web request
    const response = await fetch(`${GRPC_SERVER_URL}/filefarm.file.FileService/DownloadFile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc-web+proto',
        'X-Grpc-Web': '1',
      },
      body: new Uint8Array(buffer),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to download file: ${response.statusText} - ${errorText}`);
    }

    const responseBuffer = await response.arrayBuffer();
    const responseData = DownloadFileResponseType.decode(
      new Uint8Array(responseBuffer)
    ) as unknown as DownloadFileResponse__Output;

    let content: Uint8Array;
    if (responseData.content instanceof Uint8Array) {
      content = responseData.content;
    } else if (typeof responseData.content === 'string') {
      content = new TextEncoder().encode(responseData.content);
    } else if (responseData.content && typeof responseData.content === 'object' && 'buffer' in responseData.content) {
      // Handle Buffer-like object
      const bufferLike = responseData.content as { buffer: ArrayBuffer };
      content = new Uint8Array(bufferLike.buffer);
    } else {
      content = new Uint8Array();
    }

    return {
      content,
      mimetype: responseData.mimetype || 'application/octet-stream',
    };
  },
};
