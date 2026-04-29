
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: './local/nodeB/.env',
        }),
        TypeOrmModule.forRoot({
            type: 'postgres',
            host: process.env.PG_HOST || 'localhost',
            port: parseInt(process.env.PG_PORT || '5432', 10),
            username: process.env.PG_USERNAME || 'postgres',
            password: process.env.PG_PASSWORD || 'postgres',
            database: process.env.PG_DATABASE || 'inventory',
            ssl: { rejectUnauthorized: false },
            autoLoadEntities: true,
            synchronize: true, // Re-enabled after fixing entity issues
            logging: false
        }),
    ],
    exports: [TypeOrmModule],
})
export class PostgresDatabaseModule { }