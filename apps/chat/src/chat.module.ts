import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";
import { Conversation } from "./entity/conversation.entity";
import { Message } from "./entity/message.entity";
import { ChatService } from "./chat.service";
import { ChatController } from "./chat.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "./local/nodeA/.env",
    }),
    TypeOrmModule.forRoot({
      type: "mysql",
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT),
      username: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      entities: [Conversation, Message],
      synchronize: false,
      timezone: "Z",
      extra: {
        connectionLimit: Number(process.env.MYSQL_POOL_SIZE) || 10,
      },
    }),
    TypeOrmModule.forFeature([Conversation, Message]),
    ScheduleModule.forRoot(),
  ],
  providers: [ChatService],
  controllers: [ChatController],
})
export class ChatModule {}
