import {
  BadRequestException,
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
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { PaymentMethod } from "@app/common";
import { CreateOrderDto } from "./dto/create-order.dto";
import { SellerOrdersQueryDto } from "./dto/seller-orders-query.dto";
import { ShippingFeeDto } from "./dto/shipping-fee.dto";

interface OrderResponse {
  id: number;
  userId: number;
  status: string;
  total: number;
  items: unknown[];
  createdAt: string;
  updatedAt: string;
}

interface ProductPriceResponse {
  id: number;
  userId: number;
  price: number | null;
  isActive: boolean;
}

interface SkuPriceResponse {
  id: number;
  productId: number;
  price: number;
  stockQuantity: number;
  isActive: boolean;
  tierIdx?: number[];
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

interface BuyerInfo {
  id: number;
  username: string;
  email: string;
  name: string | null;
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  constructor(
    @Inject(NAME_SERVICE_TCP.ORDERS_SERVICE)
    private readonly ordersClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.PAYMENT_SERVICE)
    private readonly paymentsClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.PRODUCT_SERVICE)
    private readonly productClient: ClientProxy,
  ) {}

  async createOrder(userId: number, dto: CreateOrderDto): Promise<unknown> {
    // Fetch authoritative prices and sellerId from product service
    const enrichedItems = await Promise.all(
      dto.items.map(async (item) => {
        let price: number;
        let tierIdx: number[] | undefined;
        let sellerId: number;

        if (item.skuId) {
          const sku = await firstValueFrom(
            this.productClient
              .send<SkuPriceResponse>(
                PRODUCT_MESSAGE_PATTERNS.SKU_FIND_BY_ID,
                item.skuId,
              )
              .pipe(timeout(10000)),
          ).catch((err: unknown) =>
            MicroserviceErrorHandler.handleError(
              err,
              `fetch SKU ${item.skuId}`,
              "Product Service",
            ),
          );
          if (!sku.isActive) {
            throw new BadRequestException(`SKU ${item.skuId} is not available`);
          }
          if (Number(sku.productId) !== item.productId) {
            throw new BadRequestException(
              `SKU ${item.skuId} does not belong to product ${item.productId}`,
            );
          }
          if (sku.stockQuantity < item.quantity) {
            throw new BadRequestException(
              `Insufficient stock for SKU ${item.skuId}: requested ${item.quantity}, available ${sku.stockQuantity}`,
            );
          }
          price = Number(sku.price);
          tierIdx = Array.isArray(sku.tierIdx) ? sku.tierIdx : undefined;

          // Fetch product to get sellerId (sku response has productId but not userId)
          const product = await firstValueFrom(
            this.productClient
              .send<ProductPriceResponse>(
                PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID,
                item.productId,
              )
              .pipe(timeout(10000)),
          ).catch((err: unknown) =>
            MicroserviceErrorHandler.handleError(
              err,
              `fetch product ${item.productId}`,
              "Product Service",
            ),
          );
          sellerId = Number(product.userId);
        } else {
          const product = await firstValueFrom(
            this.productClient
              .send<ProductPriceResponse>(
                PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID,
                item.productId,
              )
              .pipe(timeout(10000)),
          ).catch((err: unknown) =>
            MicroserviceErrorHandler.handleError(
              err,
              `fetch product ${item.productId}`,
              "Product Service",
            ),
          );
          if (!product.isActive) {
            throw new BadRequestException(
              `Product ${item.productId} is not available`,
            );
          }
          if (product.price === null) {
            throw new BadRequestException(
              `Product ${item.productId} requires a skuId — it has no base price`,
            );
          }
          price = Number(product.price);
          sellerId = Number(product.userId);
        }

        return { ...item, price, skuId: item.skuId ?? null, tierIdx, sellerId };
      }),
    );

    const uniqueSellerIds = new Set(enrichedItems.map((i) => i.sellerId));
    const isMultiSeller = uniqueSellerIds.size > 1;

    try {
      if (isMultiSeller) {
        const orders = (await firstValueFrom(
          this.ordersClient
            .send(ORDER_MESSAGE_PATTERN.CREATE_MULTI_SELLER_ORDER, {
              userId,
              paymentMethod: dto.paymentMethod,
              shippingAddress: dto.shippingAddress,
              items: enrichedItems,
            })
            .pipe(
              timeout(10000),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        )) as OrderResponse[];

        if (dto.paymentMethod === PaymentMethod.COD) {
          return { orders, paymentUrl: null };
        }

        const orderIds = orders.map((o) => o.id);
        const totalAmount = orders.reduce((sum, o) => sum + Number(o.total), 0);
        const { paymentUrl } = (await firstValueFrom(
          this.paymentsClient
            .send(PAYMENT_MESSAGE_PATTERN.INITIATE_MULTI_ORDER_PAYMENT, {
              orderIds,
              totalAmount,
              paymentMethod: dto.paymentMethod,
            })
            .pipe(
              timeout(10000),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        )) as { paymentUrl: string; transactionId: string; appTransId: string };

        return { orders, paymentUrl };
      }

      return (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.CREATE_ORDER, {
            userId,
            paymentMethod: dto.paymentMethod,
            shippingAddress: dto.shippingAddress,
            items: enrichedItems,
          })
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

  async calculateShippingFee(dto: ShippingFeeDto): Promise<{
    shippingFee: number;
    expectedDeliveryTime: string | null;
  }> {
    try {
      return (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.CALCULATE_SHIPPING_FEE, {
            shippingAddress: dto.shippingAddress,
            items: dto.items,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as { shippingFee: number; expectedDeliveryTime: string | null };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "calculate shipping fee",
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

    if (callerRole !== "admin" && Number(order.userId) !== callerId) {
      throw new ForbiddenException("You do not have access to this order");
    }

    return order;
  }

  async getOrderByUser(
    userId: string,
    page: number,
    limit: number,
    callerId: number,
    callerRole: string,
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
    if (callerRole !== "admin" && uid !== callerId) {
      throw new ForbiddenException("You cannot access another user's orders");
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

  async cancelOrder(
    orderId: number,
    callerId: number,
    callerRole: string,
  ): Promise<OrderResponse> {
    try {
      return (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.CANCEL_ORDER, {
            orderId,
            callerId,
            callerRole,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as OrderResponse;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "cancel order",
        "Orders Service",
      );
    }
  }

  async getOrderInvoice(
    orderId: number,
    requestingUserId: number,
  ): Promise<Buffer> {
    try {
      const result = await firstValueFrom(
        this.ordersClient
          .send<{
            type: string;
            data: number[];
          }>(ORDER_MESSAGE_PATTERN.GET_ORDER_INVOICE, {
            orderId,
            requestingUserId,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
      return Buffer.from(result.data);
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get order invoice",
        "Orders Service",
      );
    }
  }

  async getPaymentUrl(
    orderId: number,
    callerId: number,
    callerRole: string,
  ): Promise<{ orderUrl: string | null; status: string | null }> {
    await this.getOrderById(String(orderId), callerId, callerRole);
    try {
      return (await firstValueFrom(
        this.paymentsClient
          .send(PAYMENT_MESSAGE_PATTERN.GET_PAYMENT_URL, { orderId })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as { orderUrl: string | null; status: string | null };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get payment url",
        "Payments Service",
      );
    }
  }

  async getAdminOrders(
    page: number,
    limit: number,
  ): Promise<{
    data: (OrderResponse & { buyer: BuyerInfo | null })[];
    total: number;
    page: number;
    limit: number;
  }> {
    const result = (await firstValueFrom(
      this.ordersClient
        .send(ORDER_MESSAGE_PATTERN.GET_ALL_ORDERS, { page, limit })
        .pipe(
          timeout(10000),
          catchError((err: unknown) => {
            throw err;
          }),
        ),
    )) as { data: OrderResponse[]; total: number; page: number; limit: number };

    const userIds = [...new Set(result.data.map((o) => Number(o.userId)))];

    let buyers: BuyerInfo[] = [];
    if (userIds.length > 0) {
      try {
        buyers = (await firstValueFrom(
          this.userClient
            .send({ cmd: USER_MESSAGE_PATTERN.GET_USERS_BY_IDS }, userIds)
            .pipe(
              timeout(10000),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        )) as BuyerInfo[];
      } catch (error) {
        MicroserviceErrorHandler.handleError(
          error,
          "get users by ids",
          "User Service",
        );
      }
    }

    const buyerMap = new Map<number, BuyerInfo>(buyers.map((b) => [b.id, b]));

    const data = result.data.map((order) => ({
      ...order,
      buyer: buyerMap.get(Number(order.userId)) ?? null,
    }));

    return {
      data,
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  async getSellerOrders(
    sellerId: number,
    query: SellerOrdersQueryDto,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GET_ORDERS_BY_SELLER, {
            sellerId,
            page: query.page ?? 1,
            limit: query.limit ?? 20,
            status: query.status,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get seller orders",
        "Orders Service",
      );
    }
  }

  async confirmOrder(orderId: number, sellerId: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.CONFIRM_ORDER, { orderId, sellerId })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "confirm order",
        "Orders Service",
      );
    }
  }

  async readyToShip(orderId: number, sellerId: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.READY_TO_SHIP, { orderId, sellerId })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "ready to ship",
        "Orders Service",
      );
    }
  }
}
