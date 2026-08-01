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
  const { isVerified, isSuccess } = await vnpayStrategy.verifyCallback(body);
  if (!isVerified) {
    return { RspCode: "97", Message: "Checksum failed" };
  }

  // The signature is valid but the transaction was declined/cancelled at the
  // provider. VNPay treats any non-"00" RspCode as "not delivered" and retries,
  // so acknowledge the callback instead of reporting a checksum failure. The
  // order stays PENDING and is released by the stale-reservation sweeper.
  if (!isSuccess) {
    logger.warn(
      `[VNPay callback] declined transaction vnp_TxnRef=${body.vnp_TxnRef} ` +
        `vnp_ResponseCode=${body.vnp_ResponseCode ?? "unknown"}`,
    );
    return { RspCode: "00", Message: "Confirm Success" };
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
