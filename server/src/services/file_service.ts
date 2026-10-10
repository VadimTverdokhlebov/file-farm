import { ServerUnaryCall, sendUnaryData, status } from '@grpc/grpc-js';
import { promises as fs } from 'fs';
import path from 'path';
import * as zlib from 'zlib';
import { constants } from 'zlib';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { config } from '../utils/secrets';
import { UploadFileRequest__Output } from '../generated/filefarm/file/UploadFileRequest';
import { UploadFileResponse } from '../generated/filefarm/file/UploadFileResponse';
import { DownloadFileRequest__Output } from '../generated/filefarm/file/DownloadFileRequest';
import { DownloadFileResponse } from '../generated/filefarm/file/DownloadFileResponse';
import { fileRepository } from '../persistance/query/FileRepository';
import { recordGrpcRequestEnd, recordGrpcRequestStart } from '../utils/metrics';
import { CompressFileRequest__Output } from '../generated/filefarm/file/CompressFileRequest';
import { CompressFileResponse } from '../generated/filefarm/file/CompressFileResponse';
import { DeleteFileRequest__Output } from '../generated/filefarm/file/DeleteFileRequest';
import { DeleteFileResponse } from '../generated/filefarm/file/DeleteFileResponse';

const gzipAsync = promisify(zlib.gzip);

// Ensure uploads directory exists
async function ensureUploadsDir(): Promise<void> {
    try {
        await fs.access(config.files.dir);
    } catch {
        await fs.mkdir(config.files.dir, { recursive: true });
        logger.info(`Created uploads directory: ${config.files.dir}`);
    }
}

// Get absolute path for file storage
function getFilePath(filename: string): string {
    const isAbsolute = path.isAbsolute(config.files.dir);
    return isAbsolute ? path.join(config.files.dir, filename) : path.resolve(config.files.dir, filename);
}

export async function UploadFile(
    call: ServerUnaryCall<UploadFileRequest__Output, UploadFileResponse>,
    callback: sendUnaryData<UploadFileResponse>
) {
    const request: UploadFileRequest__Output = call.request;
    const startedAt = recordGrpcRequestStart();
    
    try {
        if (!request.content || request.content.length === 0) {
            throw new Error('File content is empty');
        }

        if (!request.filename) {
            throw new Error('Filename is required');
        }

        const originalFilename = request.filename;
        const mimetype = request.mimetype || 'application/octet-stream';

        // Decode base64 content to Buffer
        const base64Content = request.content;
        const fileBuffer = Buffer.from(base64Content, 'base64');
        const fileSize = fileBuffer.length;

        // Ensure uploads directory exists
        await ensureUploadsDir();

        // Generate unique filename to avoid conflicts
        const fileExtension = path.extname(originalFilename);
        const baseName = path.basename(originalFilename, fileExtension);
        const uniqueFilename = `${baseName}_${uuidv4()}${fileExtension}`;
        const filePath = getFilePath(uniqueFilename);

        // Save file to filesystem
        await fs.writeFile(filePath, fileBuffer as Uint8Array);
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

        recordGrpcRequestEnd('UploadFile', 'ok', startedAt);
        callback(null, response);
    } catch (error) {
        logger.error('Error uploading file:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to upload file';
        
        recordGrpcRequestEnd('UploadFile', 'error', startedAt);
        callback({
            code: status.INTERNAL,
            details: errorMessage
        }, null);
    }
}

export async function DownloadFile(
    call: ServerUnaryCall<DownloadFileRequest__Output, DownloadFileResponse>,
    callback: sendUnaryData<DownloadFileResponse>
) {
    const request: DownloadFileRequest__Output = call.request;
    const startedAt = recordGrpcRequestStart();
    
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

        // Encode file content to base64
        const base64Content = fileContent.toString('base64');

        const response: DownloadFileResponse = {
            content: base64Content,
            mimetype: file.mimetype
        };

        recordGrpcRequestEnd('DownloadFile', 'ok', startedAt);
        callback(null, response);
    } catch (error) {
        logger.error('Error downloading file:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to download file';
        
        // Return empty response on error
        recordGrpcRequestEnd('DownloadFile', 'error', startedAt);
        callback({
            code: status.INTERNAL,
            details: errorMessage
        }, null);
    }
}

export async function CompressFile(
    call: ServerUnaryCall<CompressFileRequest__Output, CompressFileResponse>,
    callback: sendUnaryData<CompressFileResponse>
) {
    const request: CompressFileRequest__Output = call.request;
    const startedAt = recordGrpcRequestStart(); // ваша функция метрик
    
    try {
        if (!request.content || request.content.length === 0) {
            throw new Error('File content is empty');
        }

        if (!request.filename) {
            throw new Error('Filename is required');
        }

        logger.info('==============================================');
        logger.info(`Compressing file: ${request.filename}`);
        logger.info('==============================================');

        const originalFilename = request.filename;

        const base64Content = request.content;
        const fileBuffer = Buffer.from(base64Content, 'base64');
        const originalSize = fileBuffer.length;

        const compressedBuffer = await gzipAsync(new Uint8Array(fileBuffer), {
            level: constants.Z_BEST_COMPRESSION
        });
        const compressedSize = compressedBuffer.length;

        const compressedContent = compressedBuffer.toString('base64');

        logger.info(`File ${originalFilename} compressed: ${originalSize} bytes -> ${compressedSize} bytes (Saved ${(100 - (compressedSize/originalSize)*100).toFixed(2)}%)`);

        const response: CompressFileResponse = {
            message: `File successfully compressed. Size reduced from ${originalSize} to ${compressedSize} bytes.`,
            compressedContent: compressedContent,
            success: true
        };

        recordGrpcRequestEnd('CompressFile', 'ok', startedAt);
        callback(null, response);
    } catch (error) {
        logger.error('Error compressing file:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to compress file';
        recordGrpcRequestEnd('CompressFile', 'error', startedAt);
        callback({
            code: status.INTERNAL,
            details: errorMessage
        }, null);
    }
}

export async function DeleteFile(
    call: ServerUnaryCall<DeleteFileRequest__Output, DeleteFileResponse>,
    callback: sendUnaryData<DeleteFileResponse>
) {
    const request: DeleteFileRequest__Output = call.request;
    const startedAt = recordGrpcRequestStart();

    try {
        if (!request.filename) {
            throw new Error('Filename is required');
        }

        let file = await fileRepository.findByOriginalFilename(request.filename);
        if (!file) {
            file = await fileRepository.findByFilename(request.filename);
        }

        if (!file) {
            throw new Error(`File ${request.filename} not found`);
        }

        try {
            await fs.unlink(file.filePath);
            logger.info(`File deleted from filesystem: ${file.filePath}`);
        } catch (e) {
            logger.warn(`Could not delete file from filesystem: ${e}`);
        }

        await fileRepository.delete(file.id);
        logger.info(`File ${file.originalFilename} deleted from database`);

        const response: DeleteFileResponse = {
            message: `File ${request.filename} successfully deleted`,
            success: true
        };

        recordGrpcRequestEnd('DeleteFile', 'ok', startedAt);
        callback(null, response);
    } catch (error) {
        logger.error('Error deleting file:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to delete file';
        
        recordGrpcRequestEnd('DeleteFile', 'error', startedAt);
        callback({
            code: status.INTERNAL,
            details: errorMessage
        }, null);
    }
}
