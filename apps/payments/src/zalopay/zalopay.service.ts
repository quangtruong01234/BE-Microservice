import { zaloPayConfig } from './zalopay.config';
import { generateTransId, generateMac } from './zalopay.helper';

interface ZaloPayCreateOrderResponse {
  return_code: number;
  return_message: string;
  order_url?: string;
  zp_trans_token?: string;
}

export class ZaloPayService {
  async createOrder(
    orderId: string,
    amount: number,
    description: string,
  ): Promise<ZaloPayCreateOrderResponse> {
    const appTransId = generateTransId(zaloPayConfig.appId);
    const appTime = Date.now();
    const embedData = JSON.stringify({
      redirecturl: process.env.ZALOPAY_REDIRECT_URL || 'http://localhost:3000/api/gateway/payment-result',
      orderId,
    });
    const item = '[]';

    const body = {
      app_id: zaloPayConfig.appId,
      app_trans_id: appTransId,
      app_user: 'trybuy_user',
      app_time: appTime,
      amount,
      description,
      bank_code: '',
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
    ].join('|');

    const mac = generateMac(hmacInput, zaloPayConfig.key1);

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

    const response = await fetch(`${zaloPayConfig.endpoint}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    return response.json() as Promise<ZaloPayCreateOrderResponse>;
  }
}