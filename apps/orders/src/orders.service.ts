import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Order } from "./entity/order.entity";
import { HttpService } from "@nestjs/axios";
import { ClientProxy } from "@nestjs/microservices";
import { OrderItem } from "./entity/order_item.entity";

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    // @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL) private readonly fanoutChannel: Channel,
    private readonly httpService: HttpService,
    @Inject("INVENTORY_SERVICE") private readonly inventoryClient: ClientProxy,
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
