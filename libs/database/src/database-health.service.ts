import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

@Injectable()
export class DatabaseHealthService implements OnModuleInit {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    try {
      console.log("🔌 Testing database connection...");
      console.log("Database config:", {
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        database: process.env.MYSQL_DATABASE,
        user: process.env.MYSQL_USER,
      });

      await this.dataSource.query("SELECT 1 as test");
      console.log("✅ Database connection successful!");

      const tables =
        await this.dataSource.query<Record<string, unknown>[]>("SHOW TABLES");
      console.log(
        "📋 Existing tables:",
        tables.map((t) => Object.values(t)[0]),
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("❌ Database connection failed:", msg);
      console.error("Full error:", error);
    }
  }

  async checkTables(): Promise<unknown[]> {
    try {
      const result =
        await this.dataSource.query<Record<string, unknown>[]>("SHOW TABLES");
      return result.map((row) => Object.values(row)[0]);
    } catch (error) {
      console.error("Error checking tables:", error);
      return [];
    }
  }

  async createTablesIfNeeded() {
    try {
      const tables = await this.checkTables();

      if (!tables.includes("brands")) {
        console.log("📝 Creating brands table...");
        await this.dataSource.query(`
          CREATE TABLE brands (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
      }

      if (!tables.includes("categories")) {
        console.log("📝 Creating categories table...");
        await this.dataSource.query(`
          CREATE TABLE categories (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
      }

      console.log("✅ Tables checked/created successfully");
    } catch (error) {
      console.error("❌ Error creating tables:", error);
    }
  }
}
