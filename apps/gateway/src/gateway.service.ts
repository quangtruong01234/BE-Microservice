import { CMD } from "@app/common/constants/cmd";
import { TCP } from "@app/common/constants/TCP";
import { Injectable, Inject, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom } from "rxjs";

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);
  private readonly startTime = Date.now();
  constructor(
    @Inject(TCP.ORDERS_SERVICE) private readonly ordersClient: ClientProxy,
  ) {}

  async createOrder(payload: any) {
    // Dùng .send() để thực hiện RPC - gửi request và đợi response
    const resultObservable = this.ordersClient.send(
      { cmd: CMD.CREATE_ORDER },
      payload,
    );
    // Chuyển Observable thành Promise để có thể await
    const result = await firstValueFrom(resultObservable);
    this.logger.log(
      `[GATEWAY] Received response from Orders Service: ${JSON.stringify(result)}`,
    );
    return result;
  }

  getHeath() {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const memUsage = process.memoryUsage();

    return {
      status: "UP",
      timestamp: new Date().toISOString(),
      uptime,
      memory: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024), //MB
        total: Math.round(memUsage.heapTotal / 1024 / 1024), //MB
      },
      services: {
        orders: "UP",
        inventory: "UP",
        user: "UP",
        product: "UP",
      },
    };
  }
}
