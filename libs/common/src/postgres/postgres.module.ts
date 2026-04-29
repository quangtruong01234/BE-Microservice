import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';

@Global()
@Module({
  providers: [
    {
      provide: 'PG_POOL',
      useFactory: () => {
        const pool = new Pool({
          host: process.env.PG_HOST || '127.0.0.1',
          port: Number(process.env.PG_PORT) || 5432,
          database: process.env.PG_DATABASE || 'inventory_db',
          user: process.env.PG_USERNAME || 'root',
          password: process.env.PG_PASSWORD || 'root1234',
          ssl: { rejectUnauthorized: false },
          max: Number(process.env.PG_POOL_SIZE) || 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 3000,
        });

        return pool;
      },
    },
  ],
  exports: ['PG_POOL'],
})
export class PostgresModule {}
