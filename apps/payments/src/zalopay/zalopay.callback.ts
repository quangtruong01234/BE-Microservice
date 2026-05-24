import { generateMac } from "./zalopay.helper";
import { zaloPayConfig } from "./zalopay.config";

interface ZaloPayCallbackData {
  app_trans_id: string;
  amount: number;
  app_time: number;
  embed_data: string;
}

export function handleZaloPayCallback(body: { data: string; mac: string }): {
  return_code: number;
  return_message: string;
} {
  const expectedMac = generateMac(body.data, zaloPayConfig.key2);
  if (body.mac !== expectedMac) {
    return { return_code: -1, return_message: "mac not equal" };
  }

  const callbackData: ZaloPayCallbackData = JSON.parse(body.data);
  const embedData: { orderId: string } = JSON.parse(callbackData.embed_data);
  const { orderId } = embedData;

  console.log(
    `[ZaloPay callback] orderId=${orderId} amount=${callbackData.amount} transId=${callbackData.app_trans_id}`,
  );

  return { return_code: 1, return_message: "success" };
}
