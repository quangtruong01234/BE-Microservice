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
  total_fee?: number;
  expected_delivery_time?: string;
}

interface GhnResponse {
  data?: GhnResponseData;
  message?: string;
}

interface GhnCancelResult {
  order_code?: string;
  result?: boolean;
  message?: string;
}

interface GhnCancelResponse {
  data?: GhnCancelResult[];
  message?: string;
}

export interface GhnShippingItem {
  productName: string;
  quantity: number;
  price: number;
  weight?: number;
}

export interface ShippingFeePreview {
  shippingFee: number;
  expectedDeliveryTime: string | null;
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

  private buildHeaders(): Record<string, string> {
    return {
      Token: requireEnv("GHN_API_TOKEN"),
      ShopId: requireEnv("GHN_SHOP_ID"),
      "Content-Type": "application/json",
    };
  }

  private buildShippingOrderBody(
    shippingAddress: string,
    codAmount: number,
    items: GhnShippingItem[],
  ): Record<string, unknown> {
    const [
      to_name,
      to_phone,
      to_address,
      to_ward_name,
      to_district_name,
      to_province_name,
    ] = shippingAddress.split("|");

    return {
      to_name,
      to_phone,
      to_address,
      to_ward_name,
      to_district_name,
      to_province_name,
      cod_amount: Math.round(Number(codAmount ?? 0)),
      weight: Math.round(
        items.reduce((sum, i) => sum + (i.weight ?? 500) * i.quantity, 0),
      ),
      service_type_id: 2,
      payment_type_id: 2,
      required_note: "CHOXEMHANGKHONGTHU",
      items: items.map((i) => ({
        name: i.productName,
        quantity: i.quantity,
        price: Math.round(Number(i.price)),
      })),
    };
  }

  async createShippingOrder(order: Order): Promise<string> {
    const apiUrl = requireEnv("GHN_API_URL");
    const body = this.buildShippingOrderBody(
      order.shippingAddress,
      Number(order.codAmount ?? 0),
      order.items.map((i) => ({
        productName: i.productName,
        quantity: i.quantity,
        price: Number(i.price),
        weight: i.weight ?? undefined,
      })),
    );

    const response = await firstValueFrom(
      this.httpService.post<GhnResponse>(
        `${apiUrl}/v2/shipping-order/create`,
        body,
        { headers: this.buildHeaders() },
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

  async previewShippingFee(
    shippingAddress: string,
    codAmount: number,
    items: GhnShippingItem[],
  ): Promise<ShippingFeePreview> {
    const apiUrl = requireEnv("GHN_API_URL");
    const body = this.buildShippingOrderBody(shippingAddress, codAmount, items);

    const response = await firstValueFrom(
      this.httpService.post<GhnResponse>(
        `${apiUrl}/v2/shipping-order/preview`,
        body,
        { headers: this.buildHeaders() },
      ),
    );

    const data = response.data?.data;
    if (data && typeof data.total_fee === "number") {
      return {
        shippingFee: data.total_fee,
        expectedDeliveryTime: data.expected_delivery_time ?? null,
      };
    }

    throw new InternalServerErrorException(
      `GHN preview error: ${response.data?.message ?? "Unknown error"}`,
    );
  }

  async cancelShippingOrder(ghnOrderCode: string): Promise<boolean> {
    const apiUrl = requireEnv("GHN_API_URL");

    const response = await firstValueFrom(
      this.httpService.post<GhnCancelResponse>(
        `${apiUrl}/v2/switch-status/cancel`,
        { order_codes: [ghnOrderCode] },
        { headers: this.buildHeaders() },
      ),
    );

    const result = response.data?.data?.find(
      (r) => r.order_code === ghnOrderCode,
    );
    if (result?.result) {
      return true;
    }

    throw new InternalServerErrorException(
      `GHN cancel error: ${result?.message ?? response.data?.message ?? "Unknown error"}`,
    );
  }
}
