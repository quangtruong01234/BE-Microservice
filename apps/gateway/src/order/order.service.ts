import { Inject, Injectable, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { CachedService } from "@app/cached";
import { firstValueFrom, timeout, catchError } from "rxjs";
import { throwError } from "rxjs";
import {
  ORDER_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";

export abstract class BaseAggregatorService {
  protected logger = new Logger(BaseAggregatorService.name);

  protected async aggregate<T>(tasks: Array<Promise<T>>): Promise<T[]> {
    return Promise.all(tasks);
  }

  protected handleError(err: any, serviceName: string) {
    MicroserviceErrorHandler.handleError(
      err,
      "service communication",
      serviceName,
    );
  }
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  constructor(
    @Inject(NAME_SERVICE_TCP.ORDERS_SERVICE)
    private readonly ordersClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    @Inject(CachedService) private readonly redisService: CachedService,
  ) {}

  async getOrderByUser(userId: string) {
    const cacheKey = `order_user:${userId}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    const uid = Number(userId);
    if (isNaN(uid)) {
      throw new Error("Invalid userId");
    }
    // // Gọi order service lấy orders
    // const orders = await firstValueFrom(
    // 	this.ordersClient.send(ORDER_MESSAGE_PATTERN.GET_ORDERS_BY_USER, uid).pipe(
    // 		timeout(5000),
    // 		catchError(err => { throw new Error('Orders service unavailable'); }),
    // 	),
    // );
    // // Gọi user service lấy user info
    // const user = await firstValueFrom(
    // 	this.userClient.send({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, uid).pipe(
    // 		timeout(5000),
    // 		catchError(err => { throw new Error('User service unavailable'); }),
    // 	),
    // );
    // const result = { user, orders };
    // await this.redisService.set(cacheKey, JSON.stringify(result), 300);
    // return result;

    // Aggregator: gọi các service con và tổng hợp kết quả
    const [orders, user] = await Promise.all([
      firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GET_ORDERS_BY_USER, uid)
          .pipe(
            timeout(5000),
            catchError(() => {
              throw new Error("Orders service unavailable");
            }),
          ),
      ),
      firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, uid)
          .pipe(
            timeout(5000),
            catchError(() => {
              throw new Error("User service unavailable");
            }),
          ),
      ),
    ]);

    const result = { user, orders };
    await this.redisService.set(cacheKey, JSON.stringify(result), 300);
    return result;
  }
}
