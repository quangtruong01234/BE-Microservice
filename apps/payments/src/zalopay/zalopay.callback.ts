import { Logger } from "@nestjs/common";
import { generateMac } from "./zalopay.helper";
import { getZaloPayConfig } from "./zalopay.config";
import { PaymentsService } from "../payments.service";

const logger = new Logger("ZaloPayCallback");

interface ZaloPayCallbackData {
  app_trans_id: string;
  amount: number;
  app_time: number;
  embed_data: string;
  zp_trans_id: string;
}

export async function handleZaloPayCallback(
  body: { data: string; mac: string },
  paymentsService: PaymentsService,
): Promise<{ return_code: number; return_message: string }> {
  const expectedMac = generateMac(body.data, getZaloPayConfig().key2);
  if (body.mac !== expectedMac) {
    return { return_code: -1, return_message: "mac not matched" };
  }

  const callbackData = JSON.parse(body.data) as ZaloPayCallbackData;
  const embedData = JSON.parse(callbackData.embed_data) as { orderId: string };

  try {
    await paymentsService.completeZaloPayPayment(
      callbackData.app_trans_id,
      String(callbackData.zp_trans_id),
    );
    return { return_code: 1, return_message: "success" };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      `[ZaloPay callback] DB update failed orderId=${embedData.orderId} appTransId=${callbackData.app_trans_id}: ${message}`,
    );
    return { return_code: 0, return_message: "failed" };
  }
}
