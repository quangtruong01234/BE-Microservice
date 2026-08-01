import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Channel } from "amqplib";
import { Payment, PaymentStatus } from "./entity/payment.entity";
import { PaymentMethod } from "./entity/payment-method.entity";
import { PaymentMethod as PaymentMethodEnum } from "@app/common";
import { PaymentGatewayFactory } from "./payment-gateway.factory";
import { EXCHANGE } from "@app/common/constants/exchange";
import { EVENT } from "@app/common/constants/event";
import { ZaloPayReturnQuery } from "./zalopay/zalopay.types";
import { getZaloPayConfig } from "./zalopay/zalopay.config";
import { PAYMENT_MESSAGE } from "libs/constant/response-message.constant";
import { generateMac } from "./zalopay/zalopay.helper";

const DEFAULT_FRONTEND_URL = "http://localhost:5173";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(PaymentMethod)
    private readonly paymentMethodRepository: Repository<PaymentMethod>,
    private readonly factory: PaymentGatewayFactory,
    @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL)
    private readonly fanoutChannel: Channel,
  ) {}

  async processPayment(
    orderId: string,
    amount: number,
    description: string,
    paymentMethod: PaymentMethodEnum,
  ): Promise<{
    paymentUrl: string;
    transactionId: string;
    appTransId: string;
  }> {
    void description;
    this.logger.log(`[PAYMENTS] Processing payment for order ${orderId}...`);

    try {
      const existing = await this.paymentRepository.findOne({
        where: { orderId: Number(orderId) },
      });
      if (existing) {
        if (existing.orderUrl) {
          this.logger.warn(
            `[PAYMENTS] Duplicate orderId ${orderId} detected, skipping`,
          );
          return {
            paymentUrl: existing.orderUrl,
            transactionId: existing.transactionId ?? "",
            appTransId: existing.appTransId ?? "",
          };
        }
        // The row exists but the gateway URL was never persisted (a previous
        // attempt threw between save and update). Retry instead of returning an
        // empty URL, which would leave the order permanently unpayable.
        this.logger.warn(
          `[PAYMENTS] Duplicate orderId ${orderId} without an order URL — regenerating`,
        );
        return this.issueGatewayPaymentUrl(orderId, amount, paymentMethod);
      }

      const payment = this.paymentRepository.create({
        orderId: Number(orderId),
        amount,
        status: PaymentStatus.PENDING,
      });
      await this.paymentRepository.save(payment);
      this.logger.log("[PAYMENTS] payment record saved");

      return await this.issueGatewayPaymentUrl(orderId, amount, paymentMethod);
    } catch (err: unknown) {
      this.logger.error("[PAYMENTS] processPayment failed", err);
      throw err;
    }
  }

  /**
   * Builds the gateway checkout URL for an already-persisted payment row and
   * stores it. Split out of processPayment so the same recovery path can be
   * replayed when an earlier attempt failed after the row was saved.
   */
  private async issueGatewayPaymentUrl(
    orderId: string,
    amount: number,
    paymentMethod: PaymentMethodEnum,
  ): Promise<{
    paymentUrl: string;
    transactionId: string;
    appTransId: string;
  }> {
    const { paymentUrl, transactionId, appTransId } = await this.factory
      .getStrategy(paymentMethod)
      .createPayment({
        id: orderId,
        total: amount,
        returnUrl: this.buildFrontendPaymentResultUrl(paymentMethod, orderId),
      });
    this.logger.log("[PAYMENTS] createPayment done, appTransId=" + appTransId);

    const updateResult = await this.paymentRepository.update(
      { orderId: Number(orderId) },
      { orderUrl: paymentUrl, transactionId, appTransId },
    );
    this.logger.log("[PAYMENTS] payment record updated with appTransId");
    if (updateResult.affected === 0) {
      throw new InternalServerErrorException(
        PAYMENT_MESSAGE.PERSIST_APP_TRANS_ID_FAILED,
      );
    }

    return { paymentUrl, transactionId, appTransId };
  }

  async processMultiOrderPayment(
    orderIds: number[],
    totalAmount: number,
    paymentMethod: PaymentMethodEnum,
  ): Promise<{
    paymentUrl: string;
    transactionId: string;
    appTransId: string;
  }> {
    this.logger.log(
      `[PAYMENTS] Processing multi-order payment for orders [${orderIds.join(",")}]`,
    );

    try {
      const payment = this.paymentRepository.create({
        orderId: null,
        orderIds,
        amount: totalAmount,
        status: PaymentStatus.PENDING,
      });
      await this.paymentRepository.save(payment);
      this.logger.log(
        `[PAYMENTS] multi-order payment record saved id=${payment.id}`,
      );

      const { paymentUrl, transactionId, appTransId } = await this.factory
        .getStrategy(paymentMethod)
        .createPayment({
          id: String(payment.id),
          total: totalAmount,
          returnUrl: this.buildFrontendPaymentResultUrl(paymentMethod),
        });
      this.logger.log(
        "[PAYMENTS] createPayment done, appTransId=" + appTransId,
      );

      const updateResult = await this.paymentRepository.update(
        { id: payment.id },
        { orderUrl: paymentUrl, transactionId, appTransId },
      );
      if (updateResult.affected === 0) {
        throw new InternalServerErrorException(
          PAYMENT_MESSAGE.PERSIST_APP_TRANS_ID_MULTI_ORDER_FAILED,
        );
      }

      return { paymentUrl, transactionId, appTransId };
    } catch (err: unknown) {
      this.logger.error("[PAYMENTS] processMultiOrderPayment failed", err);
      throw err;
    }
  }

  private emitPaymentCompleted(orderId: number, amount: number): void {
    const eventPayload = {
      data: { orderId, amount },
      pattern: EVENT.PAYMENT_COMPLETED_EVENT,
    };
    this.fanoutChannel.publish(
      EXCHANGE.PAYMENTS_EXCHANGE,
      EVENT.PAYMENT_COMPLETED_EVENT,
      Buffer.from(JSON.stringify(eventPayload)),
    );
  }

  async completeZaloPayPayment(
    appTransId: string,
    zpTransId: string,
  ): Promise<Payment> {
    return this.completePayment(appTransId, zpTransId, "ZaloPay");
  }

  async completeZaloPayReturn(
    appTransId: string,
    transactionId: string,
  ): Promise<Payment> {
    return this.completePayment(appTransId, transactionId, "ZaloPay");
  }

  verifyZaloPayReturn(query: ZaloPayReturnQuery): boolean {
    const hmacInput = [
      query.appid,
      query.apptransid,
      query.pmcid,
      query.bankcode,
      query.amount,
      query.discountamount,
      query.status,
    ].join("|");
    return generateMac(hmacInput, getZaloPayConfig().key2) === query.checksum;
  }

  async completeVNPayPayment(
    vnpTxnRef: string,
    vnpTransactionNo: string,
  ): Promise<Payment> {
    return this.completePayment(vnpTxnRef, vnpTransactionNo, "VNPay");
  }

  private async completePayment(
    appTransId: string,
    transactionId: string,
    gateway: "ZaloPay" | "VNPay",
  ): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { appTransId },
    });
    if (!payment) {
      throw new NotFoundException(PAYMENT_MESSAGE.NOT_FOUND(appTransId));
    }
    if (payment.status === PaymentStatus.COMPLETED) {
      if (payment.transactionId !== transactionId) {
        await this.paymentRepository.update(
          { id: payment.id },
          { transactionId },
        );
      }
      this.logger.log(
        `[PAYMENTS] Duplicate ${gateway} callback ignored appTransId=${appTransId}`,
      );
      return payment;
    }

    const updateResult = await this.paymentRepository.update(
      { id: payment.id, status: PaymentStatus.PENDING },
      { status: PaymentStatus.COMPLETED, transactionId },
    );
    if (updateResult.affected !== 1) {
      const current = await this.paymentRepository.findOne({
        where: { id: payment.id },
      });
      if (current?.status === PaymentStatus.COMPLETED) {
        this.logger.log(
          `[PAYMENTS] Concurrent ${gateway} callback ignored appTransId=${appTransId}`,
        );
        return current;
      }
      throw new InternalServerErrorException(PAYMENT_MESSAGE.COMPLETION_FAILED);
    }

    const updated = await this.paymentRepository.findOne({
      where: { id: payment.id },
    });
    if (!updated) {
      throw new InternalServerErrorException(PAYMENT_MESSAGE.UPDATE_FAILED);
    }

    const orderIdList =
      updated.orderIds ?? (updated.orderId !== null ? [updated.orderId] : []);
    for (const orderId of orderIdList) {
      this.emitPaymentCompleted(orderId, updated.amount);
    }

    this.logger.log(
      `[PAYMENTS] ${gateway} payment completed appTransId=${appTransId} orderIds=[${orderIdList.join(",")}]`,
    );
    return updated;
  }

  async getPaymentUrl(
    orderId: number,
    paymentMethod?: PaymentMethodEnum,
  ): Promise<{ orderUrl: string | null; status: string | null }> {
    let payment = await this.paymentRepository.findOne({
      where: { orderId },
    });
    if (payment && !payment.orderUrl && paymentMethod) {
      // A pending row with no gateway URL means the creation attempt failed
      // after the row was saved; the RabbitMQ redelivery cannot recover it
      // because the duplicate guard short-circuits. Retry on read so the buyer
      // gets a payable URL, and let the failure surface to the caller.
      if (payment.status === PaymentStatus.PENDING) {
        this.logger.warn(
          `[PAYMENTS] Order ${orderId} has no payment URL — regenerating on read`,
        );
        const { paymentUrl } = await this.issueGatewayPaymentUrl(
          String(orderId),
          Number(payment.amount),
          paymentMethod,
        );
        return { orderUrl: paymentUrl, status: payment.status };
      }
    }
    if (!payment) {
      // Multi-order payments store order_id = NULL and the IDs in order_ids (JSONB)
      payment = await this.paymentRepository
        .createQueryBuilder("payment")
        .where("payment.order_ids @> CAST(:ids AS jsonb)", {
          ids: JSON.stringify([orderId]),
        })
        .orderBy("payment.created_at", "DESC")
        .getOne();
    }
    return {
      orderUrl: payment?.orderUrl ?? null,
      status: payment?.status ?? null,
    };
  }

  async getPaymentOptions(): Promise<
    Array<{ id: string; name: string; description: string }>
  > {
    const methods = await this.paymentMethodRepository.find({
      where: { isActive: true },
      order: { id: "ASC" },
    });
    return methods.map((m) => ({
      id: m.key,
      name: m.name,
      description: m.description,
    }));
  }

  private buildFrontendPaymentResultUrl(
    paymentMethod: PaymentMethodEnum,
    orderId?: string,
  ): string {
    const configuredOrigin = (process.env.FRONTEND_URL ?? "")
      .split(",")[0]
      .trim()
      .replace(/\/+$/, "");
    if (!configuredOrigin) {
      // An unset FRONTEND_URL used to fall through to the localhost default
      // silently, so a misconfigured deployment issued gateway URLs whose
      // return URL the provider rejects while the logs stayed clean.
      this.logger.warn(
        `[PAYMENTS] FRONTEND_URL is not set — payment return URL falls back to ${DEFAULT_FRONTEND_URL}`,
      );
    }
    let url: URL;
    try {
      url = new URL(
        "/payment-result",
        configuredOrigin || DEFAULT_FRONTEND_URL,
      );
    } catch {
      // An empty or scheme-less FRONTEND_URL must not abort payment creation:
      // it would leave the order saved but permanently without a gateway URL.
      this.logger.warn(
        `[PAYMENTS] FRONTEND_URL is not a valid origin ("${configuredOrigin}") — falling back to ${DEFAULT_FRONTEND_URL}`,
      );
      url = new URL("/payment-result", DEFAULT_FRONTEND_URL);
    }
    if (orderId) {
      url.searchParams.set("order", orderId);
    }
    url.searchParams.set("method", paymentMethod);
    return url.toString();
  }
}
