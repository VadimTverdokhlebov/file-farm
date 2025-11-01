import { DataSource } from 'typeorm';
import { File } from './persistance/models/File';
import { DATABASE_URL } from './utils/secrets';
import logger from './utils/logger';

// Initialize TypeORM DataSource
export const AppDataSource = new DataSource({
    type: 'postgres',
    url: DATABASE_URL,
    entities: [File],
    synchronize: true, // Set to false in production and use migrations
    logging: process.env.NODE_ENV === 'development',
});

// Initialize database connection
export async function initializeDatabase(): Promise<void> {
    try {
        await AppDataSource.initialize();
        logger.info('Database connection established successfully');
        
        // Run migrations or sync schema
        if (AppDataSource.options.synchronize) {
            logger.info('Database schema synchronized');
        }
    } catch (error) {
        logger.error('Error during database initialization:', error);
        throw error;
    }
}

// Close database connection
export async function closeDatabase(): Promise<void> {
    try {
        await AppDataSource.destroy();
        logger.info('Database connection closed');
    } catch (error) {
        logger.error('Error closing database connection:', error);
        throw error;
    }
}

