import { BadRequestException, Injectable } from "@nestjs/common";
import { PaymentMethod } from "@app/common";
import { IPaymentStrategy } from "./payment-strategy.interface";
import { ZaloPayService } from "./zalopay/zalopay.service";
import { VNPayStrategy } from "./vnpay/vnpay.service";
import { PAYMENT_MESSAGE } from "libs/constant/response-message.constant";

@Injectable()
export class PaymentGatewayFactory {
  constructor(
    private readonly zaloPayService: ZaloPayService,
    private readonly vnPayStrategy: VNPayStrategy,
  ) {}

  getStrategy(method: PaymentMethod): IPaymentStrategy {
    if (method === PaymentMethod.ZALOPAY) return this.zaloPayService;
    if (method === PaymentMethod.VNPAY) return this.vnPayStrategy;
    throw new BadRequestException(
      PAYMENT_MESSAGE.UNSUPPORTED_METHOD(String(method)),
    );
  }
}
