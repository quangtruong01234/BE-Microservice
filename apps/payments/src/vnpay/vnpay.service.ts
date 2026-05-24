import { Injectable } from "@nestjs/common";
import {
  VNPay,
  ignoreLogger,
  VnpLocale,
  ProductCode,
  ReturnQueryFromVNPay,
} from "vnpay";
import { IPaymentStrategy } from "../payment-strategy.interface";
import { getVNPayConfig } from "./vnpay.config";

interface VNPayOrder {
  id: string | number;
  total: number;
}

@Injectable()
export class VNPayStrategy implements IPaymentStrategy {
  private readonly vnpay: VNPay;

  constructor() {
    const config = getVNPayConfig();
    this.vnpay = new VNPay({
      tmnCode: config.tmnCode,
      secureSecret: config.hashSecret,
      vnpayHost: "https://sandbox.vnpayment.vn",
      testMode: true,
      loggerFn: ignoreLogger,
    });
  }

  createPayment(order: VNPayOrder): Promise<{
    paymentUrl: string;
    transactionId: string;
    appTransId: string;
  }> {
    const config = getVNPayConfig();
    const vnp_TxnRef = `${Date.now()}${order.id}`;

    const paymentUrl = this.vnpay.buildPaymentUrl({
      vnp_Amount: order.total,
      vnp_IpAddr: "127.0.0.1",
      vnp_TxnRef,
      vnp_OrderInfo: `Payment for order ${order.id}`,
      vnp_OrderType: ProductCode.Other,
      vnp_ReturnUrl: config.returnUrl,
      vnp_Locale: VnpLocale.VN,
    });

    return Promise.resolve({
      paymentUrl,
      transactionId: vnp_TxnRef,
      appTransId: vnp_TxnRef,
    });
  }

  verifyCallback(
    payload: unknown,
  ): Promise<{ orderId: string; success: boolean }> {
    const result = this.vnpay.verifyReturnUrl(payload as ReturnQueryFromVNPay);
    return Promise.resolve({
      orderId: String(result.vnp_TxnRef),
      success: result.isVerified && result.isSuccess,
    });
  }
}
