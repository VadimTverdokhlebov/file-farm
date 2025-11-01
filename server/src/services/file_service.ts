import { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { FILES_DIR } from '../utils/secrets';
import { UploadFileRequest__Output } from '../generated/filefarm/file/UploadFileRequest';
import { UploadFileResponse } from '../generated/filefarm/file/UploadFileResponse';
import { DownloadFileRequest__Output } from '../generated/filefarm/file/DownloadFileRequest';
import { DownloadFileResponse } from '../generated/filefarm/file/DownloadFileResponse';
import { fileRepository } from '../persistance/query/FileRepository';

// Ensure uploads directory exists
async function ensureUploadsDir(): Promise<void> {
    try {
        await fs.access(FILES_DIR);
    } catch {
        await fs.mkdir(FILES_DIR, { recursive: true });
        logger.info(`Created uploads directory: ${FILES_DIR}`);
    }
}

export async function UploadFile(
    call: ServerUnaryCall<UploadFileRequest__Output, UploadFileResponse>,
    callback: sendUnaryData<UploadFileResponse>
) {
    const request: UploadFileRequest__Output = call.request;
    
    try {
        if (!request.content || request.content.length === 0) {
            throw new Error('File content is empty');
        }

        if (!request.filename) {
            throw new Error('Filename is required');
        }

        const fileSize = request.content.length;
        const originalFilename = request.filename;
        const mimetype = request.mimetype || 'application/octet-stream';

        // Ensure uploads directory exists
        await ensureUploadsDir();

        // Generate unique filename to avoid conflicts
        const fileExtension = path.extname(originalFilename);
        const baseName = path.basename(originalFilename, fileExtension);
        const uniqueFilename = `${baseName}_${uuidv4()}${fileExtension}`;
        const filePath = path.join(FILES_DIR, uniqueFilename);

        logger.info('==============================================');
        logger.info('Uploading file:', originalFilename);
        logger.info('File type:', mimetype);
        logger.info('File Size (bytes):', fileSize);
        logger.info('File size (KB):', (fileSize / 1024).toFixed(2));
        logger.info('File size (MB):', (fileSize / (1024 * 1024)).toFixed(2));
        logger.info('Storing as:', uniqueFilename);
        logger.info('==============================================');

        // Save file to filesystem
        // fs.promises.writeFile accepts Buffer or Uint8Array
        await fs.writeFile(filePath, request.content as Buffer);
        logger.info(`File saved to filesystem: ${filePath}`);

        // Save file metadata to database
        const savedFile = await fileRepository.create({
            filename: uniqueFilename,
            originalFilename: originalFilename,
            mimetype: mimetype,
            size: fileSize,
            filePath: filePath
        });

        logger.info(`File ${originalFilename} successfully uploaded, ID: ${savedFile.id}, size: ${fileSize} bytes`);

        const response: UploadFileResponse = {
            message: `File ${originalFilename} successfully uploaded`,
            fileSize: fileSize,
            success: true
        };

        callback(null, response);
    } catch (error) {
        logger.error('Error uploading file:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to upload file';
        
        const response: UploadFileResponse = {
            message: `Error: ${errorMessage}`,
            fileSize: 0,
            success: false
        };

        callback(null, response);
    }
}

export async function DownloadFile(
    call: ServerUnaryCall<DownloadFileRequest__Output, DownloadFileResponse>,
    callback: sendUnaryData<DownloadFileResponse>
) {
    const request: DownloadFileRequest__Output = call.request;
    
    try {
        if (!request.filename) {
            throw new Error('Filename is required');
        }

        logger.info('==============================================');
        logger.info('Downloading file:', request.filename);
        logger.info('==============================================');

        // Try to find file by original filename first, then by unique filename
        let file = await fileRepository.findByOriginalFilename(request.filename);
        if (!file) {
            file = await fileRepository.findByFilename(request.filename);
        }

        if (!file) {
            throw new Error(`File ${request.filename} not found`);
        }

        // Read file from filesystem
        const fileContent = await fs.readFile(file.filePath);
        
        logger.info(`File ${file.originalFilename} found, size: ${file.size} bytes`);
        logger.info(`Reading from: ${file.filePath}`);

        const response: DownloadFileResponse = {
            content: new Uint8Array(fileContent.buffer, fileContent.byteOffset, fileContent.length),
            mimetype: file.mimetype
        };

        callback(null, response);
    } catch (error) {
        logger.error('Error downloading file:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to download file';
        
        // Return empty response on error
        const response: DownloadFileResponse = {
            content: new Uint8Array(0),
            mimetype: 'application/octet-stream'
        };

        callback(null, response);
    }
}
