import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { GhnService } from "./ghn.service";

@Module({
  imports: [HttpModule],
  providers: [GhnService],
  exports: [GhnService],
})
export class GhnModule {}
