import { DataSource } from 'typeorm';
import { File } from './persistance/models/File';
import { config } from './utils/secrets';
import logger from './utils/logger';

export const AppDataSource = new DataSource({
    type: 'postgres',
    host: config.postgres.host,
    port: config.postgres.port,
    username: config.postgres.user,
    password: config.postgres.password,
    database: config.postgres.database,
    synchronize: true,
    logging: false,
    entities: [File],
});

export async function initializeDatabase(): Promise<void> {
    try {
        await AppDataSource.initialize();
        logger.info('Database connection established successfully');
        
        if (AppDataSource.options.synchronize) {
            logger.info('Database schema synchronized');
        }
    } catch (error) {
        logger.error('Error during database initialization:', error);
        throw error;
    }
}

export async function closeDatabase(): Promise<void> {
    try {
        await AppDataSource.destroy();
        logger.info('Database connection closed');
    } catch (error) {
        logger.error('Error closing database connection:', error);
        throw error;
    }
}
