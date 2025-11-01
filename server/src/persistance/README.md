# Persistence Layer

This directory contains the data persistence layer for the application using TypeORM and PostgreSQL.

## Structure

```
persistance/
├── models/          # TypeORM entity models
│   └── File.ts     # File entity model
└── query/          # Repository/query layer
    └── FileRepository.ts  # File repository with CRUD operations
```

## Models

### File Entity

The `File` entity represents metadata about uploaded files:

- `id` - UUID primary key
- `filename` - Unique filename on filesystem (with UUID)
- `originalFilename` - Original filename from user
- `mimetype` - MIME type of the file
- `size` - File size in bytes
- `filePath` - Full path to file on filesystem
- `createdAt` - Creation timestamp
- `updatedAt` - Last update timestamp

## Repositories

### FileRepository

Provides methods for file operations:

- `create(fileData)` - Create a new file record
- `findById(id)` - Find file by UUID
- `findByFilename(filename)` - Find by unique filename
- `findByOriginalFilename(originalFilename)` - Find by original filename
- `findAll(limit, offset)` - Get all files with pagination
- `delete(id)` - Delete file record
- `count()` - Get total file count

## Database Connection

Database connection is initialized in `db.ts` using TypeORM DataSource:

- Connection string from `DATABASE_URL` environment variable
- Automatic schema synchronization (development only)
- Entities are registered automatically

## Usage Example

```typescript
import { fileRepository } from './persistance/query/FileRepository';

// Create file record
const file = await fileRepository.create({
    filename: 'unique_filename.pdf',
    originalFilename: 'document.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    filePath: '/uploads/unique_filename.pdf'
});

// Find file by original name
const foundFile = await fileRepository.findByOriginalFilename('document.pdf');
```

## Notes

- Files are stored on the filesystem in the `uploads/` directory
- Database stores only metadata about files
- Unique filenames prevent conflicts when multiple users upload files with the same name

