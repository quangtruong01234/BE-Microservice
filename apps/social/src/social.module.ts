import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";
import { CachedModule } from "@app/cached";
import { RmqModule } from "@app/common";
import { SocialController } from "./social.controller";
import { SocialService } from "./social.service";
import { Post } from "./entities/post.entity";
import { PostLike } from "./entities/post-like.entity";
import { Like } from "./entities/like.entity";
import { Comment } from "./entities/comment.entity";

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
      entities: [Post, PostLike, Like, Comment],
      synchronize: false,
    }),
    TypeOrmModule.forFeature([Post, PostLike, Comment]),
    ScheduleModule.forRoot(),
    CachedModule,
    RmqModule,
    RmqModule.registerDirectPublisher(),
  ],
  controllers: [SocialController],
  providers: [SocialService],
})
export class SocialModule {}
