import { Global, Module } from '@nestjs/common';
import { createPool, Pool } from 'mysql2/promise';

@Global()
@Module({
  providers: [
    {
      provide: 'MYSQL_POOL',
      useFactory: async () => {
        const pool: Pool = createPool({
          host: process.env.MYSQL_HOST,
          port: Number(process.env.MYSQL_PORT),
          user: process.env.MYSQL_USER,
          password: process.env.MYSQL_PASSWORD,
          database: process.env.MYSQL_DATABASE,
          waitForConnections: true,
          connectionLimit: Number(process.env.MYSQL_POOL_SIZE) || 10,
        });

        return pool;
      },
    },
  ],
  exports: ['MYSQL_POOL'],
})
export class MysqlModule {}
