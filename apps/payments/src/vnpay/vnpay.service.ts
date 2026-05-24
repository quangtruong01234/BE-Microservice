import { Injectable } from "@nestjs/common";
import { createHmac } from "node:crypto";
import {
  IPaymentStrategy,
  CallbackPayload,
} from "../payment-strategy.interface";
import { vnpayConfig } from "./vnpay.config";

interface VNPayCallbackPayload {
  vnp_SecureHash: string;
  vnp_TxnRef: string;
  vnp_ResponseCode: string;
  [key: string]: string;
}

interface VNPayOrder {
  id: string | number;
  total: number;
}

@Injectable()
export class VNPayStrategy implements IPaymentStrategy {
  createPayment(
    order: VNPayOrder,
  ): Promise<{ paymentUrl: string; transactionId: string }> {
    const vnp_TxnRef = String(order.id);
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    const createDate =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const params: Record<string, string> = {
      vnp_Version: "2.1.0",
      vnp_Command: "pay",
      vnp_TmnCode: vnpayConfig.tmnCode,
      vnp_Amount: String(Math.round(order.total * 100)),
      vnp_CreateDate: createDate,
      vnp_CurrCode: "VND",
      vnp_IpAddr: "127.0.0.1",
      vnp_Locale: "vn",
      vnp_OrderInfo: `Payment for order ${vnp_TxnRef}`,
      vnp_OrderType: "other",
      vnp_ReturnUrl: vnpayConfig.returnUrl,
      vnp_TxnRef,
    };

    const sortedKeys = Object.keys(params).sort();
    const signData = sortedKeys.map((k) => `${k}=${params[k]}`).join("&");
    const secureHash = createHmac("sha512", vnpayConfig.hashSecret)
      .update(signData)
      .digest("hex");

    const query = sortedKeys
      .map((k) => `${k}=${encodeURIComponent(params[k])}`)
      .join("&");
    const paymentUrl = `${vnpayConfig.url}?${query}&vnp_SecureHash=${secureHash}`;

    return Promise.resolve({ paymentUrl, transactionId: vnp_TxnRef });
  }

  verifyCallback(
    payload: unknown,
  ): Promise<{ orderId: string; success: boolean }> {
    const p = payload as VNPayCallbackPayload;
    const { vnp_SecureHash, vnp_TxnRef, vnp_ResponseCode, ...rest } = p;

    const sortedKeys = Object.keys(rest).sort();
    const signData = sortedKeys.map((k) => `${k}=${rest[k]}`).join("&");
    const expectedHash = createHmac("sha512", vnpayConfig.hashSecret)
      .update(signData)
      .digest("hex");

    const success =
      vnp_SecureHash === expectedHash && vnp_ResponseCode === "00";
    return Promise.resolve({ orderId: vnp_TxnRef, success });
  }
}
