import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
} from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout } from "rxjs";

import { ApiTags } from "@nestjs/swagger";
import { Public } from "./common/decorators/public.decorator";
import { PAYMENT_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { PAYMENT_MESSAGE } from "libs/constant/response-message.constant";
import { MicroserviceErrorHandler } from "./common/exception/microservice-error.handler";
import {
  PAYMENT_RESULT_MAX_QUERY_KEYS,
  PAYMENT_RESULT_MAX_VALUE_LENGTH,
} from "./gateway.constants";

@ApiTags("Gateway")
@Controller("gateway")
export class GatewayController {
  constructor(
    @Inject(NAME_SERVICE_TCP.PAYMENT_SERVICE)
    private readonly paymentsClient: ClientProxy,
  ) {}

  @Get("payment-result")
  @Public()
  async paymentResult(@Query() query: Record<string, string>): Promise<{
    gateway: string;
    status: string;
    transId: string;
    amount: string;
  }> {
    this.assertBoundedPaymentQuery(query);
    let gateway: string;
    let transId: string;
    let verifiedZaloPayStatus: "success" | "failed" | null = null;
    let verifiedVNPayStatus: "success" | "failed" | null = null;

    if (query["apptransid"]) {
      gateway = "zalopay";
      transId = query["apptransid"];
      verifiedZaloPayStatus = await this.completeZaloPayReturn(query);
    } else if (query["vnp_TxnRef"]) {
      gateway = "vnpay";
      transId = query["vnp_TxnRef"];
      verifiedVNPayStatus = await this.completeVNPayReturn(query);
    } else {
      throw new BadRequestException(PAYMENT_MESSAGE.MISSING_TRANSACTION_REF);
    }

    let status: string;
    let amount: string;
    if (gateway === "zalopay") {
      status = verifiedZaloPayStatus ?? "failed";
      amount = query["amount"];
    } else {
      status = verifiedVNPayStatus ?? "failed";
      amount = query["vnp_Amount"];
    }
    return { gateway, status, transId, amount };
  }

  private assertBoundedPaymentQuery(query: Record<string, string>): void {
    const queryKeys = Object.keys(query);
    if (queryKeys.length > PAYMENT_RESULT_MAX_QUERY_KEYS) {
      throw new BadRequestException(PAYMENT_MESSAGE.TOO_MANY_QUERY_PARAMS);
    }
    for (const key of queryKeys) {
      const value = query[key];
      if (typeof value !== "string") {
        throw new BadRequestException(PAYMENT_MESSAGE.INVALID_QUERY_PARAM(key));
      }
      if (value.length > PAYMENT_RESULT_MAX_VALUE_LENGTH) {
        throw new BadRequestException(
          PAYMENT_MESSAGE.QUERY_PARAM_TOO_LONG(key),
        );
      }
    }
  }

  private async completeZaloPayReturn(
    query: Record<string, string>,
  ): Promise<"success" | "failed"> {
    try {
      const result = await firstValueFrom(
        this.paymentsClient
          .send<{ status: "success" | "failed" }>(
            PAYMENT_MESSAGE_PATTERN.COMPLETE_ZALOPAY_RETURN,
            {
              appid: query["appid"],
              apptransid: query["apptransid"],
              pmcid: query["pmcid"],
              bankcode: query["bankcode"] ?? "",
              amount: query["amount"],
              discountamount: query["discountamount"],
              status: query["status"],
              checksum: query["checksum"],
            },
          )
          .pipe(timeout(10000)),
      );
      return result.status;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "complete ZaloPay return",
        "Payments Service",
      );
    }
  }

  private async completeVNPayReturn(
    query: Record<string, string>,
  ): Promise<"success" | "failed"> {
    try {
      const result = await firstValueFrom(
        this.paymentsClient
          .send<{
            status: "success" | "failed";
          }>(PAYMENT_MESSAGE_PATTERN.COMPLETE_VNPAY_RETURN, query)
          .pipe(timeout(10000)),
      );
      return result.status;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "complete VNPay return",
        "Payments Service",
      );
    }
  }
}
