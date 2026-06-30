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
import { MicroserviceErrorHandler } from "./common/exception/microservice-error.handler";

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
      throw new BadRequestException("Missing transaction reference");
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
