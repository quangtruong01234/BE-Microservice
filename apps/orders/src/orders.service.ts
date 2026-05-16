import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Order } from "./entity/order.entity";
import { HttpService } from "@nestjs/axios";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom } from "rxjs";
import { OrderItem } from "./entity/order_item.entity";
import { EVENT } from "@app/common/constants/event";
import { EXCHANGE } from "@app/common/constants/exchange";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
import { Channel } from "amqplib";

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL)
    private readonly fanoutChannel: Channel,
    private readonly httpService: HttpService,
    @Inject("INVENTORY_SERVICE") private readonly inventoryClient: ClientProxy,
    // @Inject("PAYMENTS_SERVICE") private readonly paymentClient: ClientProxy,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
  ) {}

  async onModuleInit() {
    await this.inventoryClient.connect();
  }

  async placeOrder(
    userId: number,
    items: Array<{ product_id: number; quantity: number; price: number }>,
  ): Promise<Order> {
    //1. check stock in inventory
    for (const item of items) {
      const result = await firstValueFrom(
        this.inventoryClient.send<{
          available: boolean;
          availableStock: number;
        }>(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK, {
          productId: item.product_id,
          quantity: item.quantity,
        }),
      );
      if (!result.available) {
        throw new BadRequestException(
          `Insufficient stock for product ${item.product_id}: requested ${item.quantity}, available ${result.availableStock}`,
        );
      }
    }
    const total = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    // Tạo order trước
    const order = await this.orderRepository.save(
      this.orderRepository.create({ user_id: userId, total }),
    );
    // Tạo order_items với order_id vừa tạo
    const orderItems = items.map((item) =>
      this.orderItemRepository.create({ ...item, order_id: order.id }),
    );
    await this.orderItemRepository.save(orderItems);
    // Gán items vào order để trả về
    order.items = orderItems;

    //push to rabbitmq to notify other service
    // this.inventoryClient.emit(EVENT.ORDER_CREATED_EVENT, order);
    // this.paymentClient.emit(EVENT.ORDER_CREATED_EVENT, order);

    // Publish event to EVENT BUS via FANOUT exchange
    const exchangeName = EXCHANGE.ORDERS_EXCHANGE;
    const routingKey = EVENT.ORDER_CREATED_EVENT;

    const eventPayload = {
      data: order,
      pattern: routingKey,
    };

    this.fanoutChannel.publish(
      exchangeName,
      routingKey,
      Buffer.from(JSON.stringify(eventPayload)),
    );

    return order;
  }

  async getOrdersByUser(userId: number): Promise<Order[]> {
    const orders = await this.orderRepository.find({
      where: { user_id: userId },
      relations: ["items"],
    });
    return orders;
  }
}
