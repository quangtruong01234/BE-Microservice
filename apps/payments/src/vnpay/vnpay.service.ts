import { Injectable, Logger } from "@nestjs/common";
import {
  VNPay,
  ignoreLogger,
  VnpLocale,
  ProductCode,
  ReturnQueryFromVNPay,
} from "vnpay";
import { IPaymentStrategy } from "../payment-strategy.interface";
import { getVNPayConfig } from "./vnpay.config";
import { PaymentOrder } from "../payment-strategy.interface";

@Injectable()
export class VNPayStrategy implements IPaymentStrategy {
  private readonly logger = new Logger(VNPayStrategy.name);
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

  createPayment(order: PaymentOrder): Promise<{
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
      vnp_ReturnUrl: order.returnUrl ?? config.returnUrl,
      vnp_Locale: VnpLocale.VN,
    });

    return Promise.resolve({
      paymentUrl,
      transactionId: vnp_TxnRef,
      appTransId: vnp_TxnRef,
    });
  }

  // `isVerified` (the secure hash matches) and `isSuccess` (the transaction
  // itself succeeded) are reported separately: only a hash mismatch may answer
  // VNPay with "97 Checksum failed". A correctly signed callback for a declined
  // transaction is a valid callback and must be acknowledged, otherwise VNPay
  // keeps retrying it.
  verifyCallback(payload: unknown): Promise<{
    orderId: string;
    success: boolean;
    isVerified: boolean;
    isSuccess: boolean;
  }> {
    // The SDK throws when the payload is malformed (missing or garbled vnp_*
    // fields). A provider callback must always answer with a response code, so
    // an unparseable payload is reported as a failed verification instead of
    // propagating as a 5xx to VNPay.
    try {
      const result = this.vnpay.verifyIpnCall(payload as ReturnQueryFromVNPay);
      return Promise.resolve({
        orderId: String(result.vnp_TxnRef),
        success: result.isVerified && result.isSuccess,
        isVerified: result.isVerified,
        isSuccess: result.isSuccess,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.warn(`VNPay callback payload rejected: ${message}`);
      return Promise.resolve({
        orderId: "",
        success: false,
        isVerified: false,
        isSuccess: false,
      });
    }
  }
}
