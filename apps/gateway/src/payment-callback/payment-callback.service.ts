import { Inject, Injectable } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout } from "rxjs";
import { PAYMENT_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import {
  VNPayCallbackPayload,
  VNPayCallbackResponse,
  ZaloPayCallbackBody,
  ZaloPayCallbackResponse,
} from "./payment-callback.types";
import { TCP_TIMEOUT_MS } from "libs/constant/tcp-timeout.constant";

@Injectable()
export class PaymentCallbackService {
  constructor(
    @Inject(NAME_SERVICE_TCP.PAYMENT_SERVICE)
    private readonly paymentsClient: ClientProxy,
  ) {}

  async handleZaloPayCallback(
    body: ZaloPayCallbackBody,
  ): Promise<ZaloPayCallbackResponse> {
    try {
      return await firstValueFrom(
        this.paymentsClient
          .send<ZaloPayCallbackResponse>(
            PAYMENT_MESSAGE_PATTERN.ZALOPAY_CALLBACK,
            body,
          )
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "handle ZaloPay callback",
        "Payments Service",
      );
    }
  }

  async handleVNPayCallback(
    payload: VNPayCallbackPayload,
  ): Promise<VNPayCallbackResponse> {
    try {
      return await firstValueFrom(
        this.paymentsClient
          .send<VNPayCallbackResponse>(
            PAYMENT_MESSAGE_PATTERN.VNPAY_CALLBACK,
            payload,
          )
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "handle VNPay callback",
        "Payments Service",
      );
    }
  }
}
