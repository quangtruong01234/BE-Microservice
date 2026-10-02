import { Module } from "@nestjs/common";
import { DeadLetterController } from "./dead-letter.controller";
import { DeadLetterService } from "./dead-letter.service";

@Module({
  controllers: [DeadLetterController],
  providers: [DeadLetterService],
})
export class DeadLetterModule {}
