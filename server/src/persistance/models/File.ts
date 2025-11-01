import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('files')
export class File {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'varchar', length: 255 })
    filename!: string;

    @Column({ type: 'varchar', length: 500 })
    originalFilename!: string;

    @Column({ type: 'varchar', length: 255 })
    mimetype!: string;

    @Column({ type: 'bigint' })
    size!: number;

    @Column({ type: 'varchar', length: 1000 })
    filePath!: string;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}

