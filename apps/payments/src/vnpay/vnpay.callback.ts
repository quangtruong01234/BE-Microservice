import { Logger } from "@nestjs/common";
import { VNPayStrategy } from "./vnpay.service";
import { PaymentsService } from "../payments.service";

const logger = new Logger("VNPayCallback");

interface VNPayIpnBody {
  vnp_TxnRef: string;
  vnp_TransactionNo: string;
  [key: string]: string;
}

export async function handleVNPayCallback(
  body: VNPayIpnBody,
  vnpayStrategy: VNPayStrategy,
  paymentsService: PaymentsService,
): Promise<{ RspCode: string; Message: string }> {
  const { success } = await vnpayStrategy.verifyCallback(body);
  if (!success) {
    return { RspCode: "97", Message: "Checksum failed" };
  }

  try {
    await paymentsService.completeVNPayPayment(
      body.vnp_TxnRef,
      body.vnp_TransactionNo,
    );
    return { RspCode: "00", Message: "Confirm Success" };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      `[VNPay callback] DB update failed vnp_TxnRef=${body.vnp_TxnRef}: ${message}`,
    );
    return { RspCode: "01", Message: "Order not found or DB error" };
  }
}
