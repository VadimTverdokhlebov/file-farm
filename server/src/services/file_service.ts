import { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import logger from '../utils/logger';
import { UploadFileRequest__Output } from '../generated/filefarm/file/UploadFileRequest';
import { UploadFileResponse } from '../generated/filefarm/file/UploadFileResponse';
import { DownloadFileRequest__Output } from '../generated/filefarm/file/DownloadFileRequest';
import { DownloadFileResponse } from '../generated/filefarm/file/DownloadFileResponse';

export function UploadFile(
    call: ServerUnaryCall<UploadFileRequest__Output, UploadFileResponse>,
    callback: sendUnaryData<UploadFileResponse>
) {
    const request: UploadFileRequest__Output = call.request;
    
    const fileSize = request.content?.length || 0;
    
    logger.info('==============================================');
    logger.info('File received:', request.filename);
    logger.info ('File type:', request.mimetype);
    logger.info('File Size (bytes):', fileSize);
    logger.info('File size (KB):', (fileSize / 1024).toFixed(2));
    logger.info('File size (MB):', (fileSize / (1024 *1024)).toFixed(2));
    logger.info('==============================================');
    
    logger.info(`File ${request.filename} successfully uploaded, size: ${fileSize} bytes`);
    
    const response: UploadFileResponse = {
        message: `File ${request.filename} successfully uploaded`,
        fileSize: fileSize,
        success: true
    };
    
    callback(null, response);
}

export function DownloadFile(
    call: ServerUnaryCall<DownloadFileRequest__Output, DownloadFileResponse>,
    callback: sendUnaryData<DownloadFileResponse>
) {
    const request: DownloadFileRequest__Output = call.request;
    
    const file = request.filename;

    logger.info('==============================================');
    logger.info('File received:', file);
    logger.info('==============================================');
    
    const response: DownloadFileResponse = {
        content: file,
        mimetype: 'text/plain'
    };

    callback(null, response);
}

