import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { Order } from "../entity/order.entity";

interface GhnResponseData {
  order_code?: string;
}

interface GhnResponse {
  data?: GhnResponseData;
  message?: string;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value.trim();
}

@Injectable()
export class GhnService {
  private readonly logger = new Logger(GhnService.name);

  constructor(private readonly httpService: HttpService) {}

  async createShippingOrder(order: Order): Promise<string> {
    const apiUrl = requireEnv("GHN_API_URL");
    const apiToken = requireEnv("GHN_API_TOKEN");
    const shopId = requireEnv("GHN_SHOP_ID");

    const [
      to_name,
      to_phone,
      to_address,
      to_ward_name,
      to_district_name,
      to_province_name,
    ] = order.shipping_address.split("|");

    const body = {
      to_name,
      to_phone,
      to_address,
      to_ward_name,
      to_district_name,
      to_province_name,
      cod_amount: order.cod_amount ?? 0,
      weight: 500,
      service_type_id: 2,
      payment_type_id: 2,
      required_note: "CHOXEMHANGKHONGTHU",
      items: order.items.map((i) => ({
        name: i.product_name,
        quantity: i.quantity,
        price: Math.round(Number(i.price)),
      })),
    };

    const response = await firstValueFrom(
      this.httpService.post<GhnResponse>(
        `${apiUrl}/v2/shipping-order/create`,
        body,
        {
          headers: {
            Token: apiToken,
            ShopId: shopId,
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const orderCode = response.data?.data?.order_code;
    if (orderCode) {
      return orderCode;
    }

    throw new InternalServerErrorException(
      `GHN error: ${response.data?.message ?? "Unknown error"}`,
    );
  }
}
