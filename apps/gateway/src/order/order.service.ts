import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout, catchError } from "rxjs";
import {
  ORDER_MESSAGE_PATTERN,
  PAYMENT_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { CMD } from "@app/common/constants/cmd";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { CreateOrderDto } from "./dto/create-order.dto";

interface OrderResponse {
  id: number;
  user_id: number;
  status: string;
  total: number;
  items: unknown[];
  created_at: string;
  updated_at: string;
}

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
    @Inject(NAME_SERVICE_TCP.PAYMENT_SERVICE)
    private readonly paymentsClient: ClientProxy,
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

  async getOrderById(
    orderId: string,
    callerId: number,
    callerRole: string,
  ): Promise<OrderResponse> {
    const id = Number(orderId);
    if (isNaN(id)) {
      MicroserviceErrorHandler.handleError(
        new Error("Invalid orderId"),
        "get order by id",
        "Orders Service",
      );
    }
    const order = (await firstValueFrom(
      this.ordersClient.send(ORDER_MESSAGE_PATTERN.GET_ORDER_BY_ID, id).pipe(
        timeout(10000),
        catchError((err: unknown) => {
          throw err;
        }),
      ),
    )) as OrderResponse | null;

    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    if (callerRole !== "admin" && order.user_id !== callerId) {
      throw new ForbiddenException("You do not have access to this order");
    }

    return order;
  }

  async getOrderByUser(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{
    data: unknown[];
    total: number;
    page: number;
    limit: number;
  }> {
    const uid = Number(userId);
    if (isNaN(uid)) {
      MicroserviceErrorHandler.handleError(
        new Error("Invalid userId"),
        "get orders by user",
        "Orders Service",
      );
    }
    return (await firstValueFrom(
      this.ordersClient
        .send(ORDER_MESSAGE_PATTERN.GET_ORDERS_BY_USER, {
          userId: uid,
          page,
          limit,
        })
        .pipe(
          timeout(10000),
          catchError((err: unknown) => {
            throw err;
          }),
        ),
    )) as { data: unknown[]; total: number; page: number; limit: number };
  }

  async getPaymentUrl(
    orderId: number,
  ): Promise<{ order_url: string | null; status: string | null }> {
    return (await firstValueFrom(
      this.paymentsClient
        .send(PAYMENT_MESSAGE_PATTERN.GET_PAYMENT_URL, { orderId })
        .pipe(
          timeout(10000),
          catchError((err: unknown) => {
            throw err;
          }),
        ),
    )) as { order_url: string | null; status: string | null };
  }
}
