import { Injectable } from "@nestjs/common";
import { getZaloPayConfig } from "./zalopay.config";
import { generateTransId, generateMac } from "./zalopay.helper";
import {
  IPaymentStrategy,
  PaymentOrder,
  CallbackPayload,
} from "../payment-strategy.interface";

interface ZaloPayCreateOrderResponse {
  return_code: number;
  return_message: string;
  order_url?: string;
  zp_trans_token?: string;
}

export interface ZaloPayReturnQuery {
  appid: string;
  apptransid: string;
  pmcid: string;
  bankcode: string;
  amount: string;
  discountamount: string;
  status: string;
  checksum: string;
}

@Injectable()
export class ZaloPayService implements IPaymentStrategy {
  async createPayment(order: PaymentOrder): Promise<{
    paymentUrl: string;
    transactionId: string;
    appTransId: string;
  }> {
    const config = getZaloPayConfig();
    const appTransId = generateTransId(config.appId);
    const result = await this.createOrder(
      String(order.id),
      order.total,
      `Payment for order ${order.id}`,
      appTransId,
      order.returnUrl,
    );
    if (result.return_code !== 1) {
      throw new Error(result.return_message);
    }
    return {
      paymentUrl: result.order_url ?? "",
      transactionId: result.zp_trans_token ?? "",
      appTransId,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async verifyCallback(
    payload: CallbackPayload,
  ): Promise<{ orderId: string; success: boolean }> {
    const config = getZaloPayConfig();
    const expectedMac = generateMac(payload.data, config.key2);
    if (payload.mac !== expectedMac) {
      return { orderId: "", success: false };
    }
    const callbackData = JSON.parse(payload.data) as {
      app_trans_id: string;
      amount: number;
      app_time: number;
      embed_data: string;
    };
    const embedData = JSON.parse(callbackData.embed_data) as {
      orderId: string;
    };
    return { orderId: embedData.orderId, success: true };
  }

  async createOrder(
    orderId: string,
    amount: number,
    description: string,
    transId?: string,
    returnUrl?: string,
  ): Promise<ZaloPayCreateOrderResponse> {
    const config = getZaloPayConfig();
    const appTransId = transId ?? generateTransId(config.appId);
    const appTime = Date.now();
    const embedData = JSON.stringify({
      redirecturl: returnUrl ?? config.redirectUrl,
      orderId,
    });
    const item = "[]";

    const body = {
      app_id: config.appId,
      app_trans_id: appTransId,
      app_user: "trybuy_user",
      app_time: appTime,
      amount,
      description,
      bank_code: "",
      item,
      embed_data: embedData,
    };

    const hmacInput = [
      body.app_id,
      body.app_trans_id,
      body.app_user,
      body.amount,
      body.app_time,
      body.embed_data,
      body.item,
    ].join("|");

    const mac = generateMac(hmacInput, config.key1);

    const params = new URLSearchParams({
      app_id: String(body.app_id),
      app_trans_id: body.app_trans_id,
      app_user: body.app_user,
      app_time: String(body.app_time),
      amount: String(body.amount),
      description: body.description,
      bank_code: body.bank_code,
      item: body.item,
      embed_data: body.embed_data,
      mac,
    });

    const response = await fetch(`${config.endpoint}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    return response.json() as Promise<ZaloPayCreateOrderResponse>;
  }
}
