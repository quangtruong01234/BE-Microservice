import { Injectable } from "@nestjs/common";
import { IPaymentStrategy } from "./payment-strategy.interface";
import { ZaloPayService } from "./zalopay/zalopay.service";
import { VNPayStrategy } from "./vnpay/vnpay.service";

@Injectable()
export class PaymentGatewayFactory {
  constructor(
    private readonly zaloPayService: ZaloPayService,
    private readonly vnPayStrategy: VNPayStrategy,
  ) {}

  getStrategy(): IPaymentStrategy {
    const gateway = process.env.PAYMENT_GATEWAY;
    if (gateway === "zalopay") return this.zaloPayService;
    if (gateway === "vnpay") return this.vnPayStrategy;
    throw new Error("Invalid PAYMENT_GATEWAY env");
  }
}
