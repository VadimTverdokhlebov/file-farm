import { AppDataSource } from '../../db';
import { File } from '../models/File';
import logger from '../../utils/logger';

export class FileRepository {
    private repository = AppDataSource.getRepository(File);

    async create(fileData: {
        filename: string;
        originalFilename: string;
        mimetype: string;
        size: number;
        filePath: string;
    }): Promise<File> {
        try {
            const file = this.repository.create(fileData);
            const savedFile = await this.repository.save(file);
            logger.info(`File saved to database: ${savedFile.id} - ${savedFile.filename}`);
            return savedFile;
        } catch (error) {
            logger.error('Error creating file in database:', error);
            throw error;
        }
    }

    async findById(id: string): Promise<File | null> {
        try {
            return await this.repository.findOne({ where: { id } });
        } catch (error) {
            logger.error(`Error finding file by id ${id}:`, error);
            throw error;
        }
    }

    async findByFilename(filename: string): Promise<File | null> {
        try {
            return await this.repository.findOne({ where: { filename } });
        } catch (error) {
            logger.error(`Error finding file by filename ${filename}:`, error);
            throw error;
        }
    }

    async findByOriginalFilename(originalFilename: string): Promise<File | null> {
        try {
            return await this.repository.findOne({ 
                where: { originalFilename },
                order: { createdAt: 'DESC' }
            });
        } catch (error) {
            logger.error(`Error finding file by original filename ${originalFilename}:`, error);
            throw error;
        }
    }

    async findAll(limit: number = 100, offset: number = 0): Promise<File[]> {
        try {
            return await this.repository.find({
                take: limit,
                skip: offset,
                order: { createdAt: 'DESC' }
            });
        } catch (error) {
            logger.error('Error finding all files:', error);
            throw error;
        }
    }

    async delete(id: string): Promise<boolean> {
        try {
            const result = await this.repository.delete(id);
            return (result.affected ?? 0) > 0;
        } catch (error) {
            logger.error(`Error deleting file ${id}:`, error);
            throw error;
        }
    }

    async count(): Promise<number> {
        try {
            return await this.repository.count();
        } catch (error) {
            logger.error('Error counting files:', error);
            throw error;
        }
    }
}

export const fileRepository = new FileRepository();

