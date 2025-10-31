import { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import logger from '../utils/logger';
import { UploadFileRequest__Output } from '../generated/filefarm/file/UploadFileRequest';
import { UploadFileResponse } from '../generated/filefarm/file/UploadFileResponse';

export function UploadFile(
    call: ServerUnaryCall<UploadFileRequest__Output, UploadFileResponse>,
    callback: sendUnaryData<UploadFileResponse>
) {
    const request: UploadFileRequest__Output = call.request;
    
    const fileSize = request.content?.length || 0;
    
    // Выводим объем файла в консоль
    console.log('==============================================');
    console.log('Получен файл:', request.filename);
    console.log('Тип файла:', request.mimetype);
    console.log('Объем файла (байт):', fileSize);
    console.log('Объем файла (КБ):', (fileSize / 1024).toFixed(2));
    console.log('Объем файла (МБ):', (fileSize / (1024 * 1024)).toFixed(2));
    console.log('==============================================');
    
    logger.info(`Загружен файл: ${request.filename}, размер: ${fileSize} байт`);
    
    const response: UploadFileResponse = {
        message: `Файл ${request.filename} успешно загружен`,
        fileSize: fileSize,
        success: true
    };
    
    callback(null, response);
}

