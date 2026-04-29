import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'mysql2/promise';

@Injectable()
export class MysqlService {
    private readonly logger = new Logger(MysqlService.name);
    constructor(@Inject('MYSQL_POOL') private readonly pool: Pool) { }

    async query(sql: string, params?: any[]) {
        const [rows] = await this.pool.query(sql, params);
        return rows;
    }

    // async onModuleInit() {
    //     this.logger.log('MySQL Service initialized', await this.checkConnection());
    // }
    // /**
    //  * Checks if the MySQL connection is successful.
    //  * Returns true if connected, false otherwise.
    //  * Usage:
    //  *   const isConnected = await mysqlService.checkConnection();
    //  */
    // async checkConnection(): Promise<boolean> {
    //     try {
    //         const connection = await this.pool.getConnection();
    //         await connection.ping();
    //         connection.release();
    //         return true;
    //     } catch (error) {
    //         // Optionally log error
    //         return false;
    //     }
    // }
}
