import { Inject, Injectable, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { CachedService } from "@app/cached";
import { firstValueFrom, timeout, catchError } from "rxjs";
import {
  ORDER_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { CMD } from "@app/common/constants/cmd";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { CreateOrderDto } from "./dto/create-order.dto";

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

  async createOrder(userId: number, dto: CreateOrderDto): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.ordersClient
          .send({ cmd: CMD.CREATE_ORDER }, { userId, items: dto.items })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create order",
        "Orders Service",
      );
    }
  }

  async getOrderByUser(userId: string): Promise<unknown> {
    const cacheKey = `order_user:${userId}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as unknown;
    }
    const uid = Number(userId);
    if (isNaN(uid)) {
      throw new Error("Invalid userId");
    }

    // Aggregator: gọi các service con và tổng hợp kết quả
    const results = await Promise.all([
      (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GET_ORDERS_BY_USER, uid)
          .pipe(
            timeout(5000),
            catchError(() => {
              throw new Error("Orders service unavailable");
            }),
          ),
      )) as unknown,
      (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, uid)
          .pipe(
            timeout(5000),
            catchError(() => {
              throw new Error("User service unavailable");
            }),
          ),
      )) as unknown,
    ]);

    const result = { orders: results[0], user: results[1] };
    await this.redisService.set(cacheKey, JSON.stringify(result), 300);
    return result;
  }
}
