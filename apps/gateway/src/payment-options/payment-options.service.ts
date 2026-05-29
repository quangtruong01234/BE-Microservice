import { Inject, Injectable } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, Observable, timeout } from "rxjs";
import { PAYMENT_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";

interface PaymentOption {
  id: string;
  name: string;
  description: string;
}

@Injectable()
export class PaymentOptionsService {
  constructor(
    @Inject(NAME_SERVICE_TCP.PAYMENT_SERVICE)
    private readonly paymentsClient: ClientProxy,
  ) {}

  async getOptions(): Promise<{ options: PaymentOption[] }> {
    try {
      const options = await firstValueFrom(
        this.paymentsClient
          .send(PAYMENT_MESSAGE_PATTERN.GET_PAYMENT_OPTIONS, {})
          .pipe(timeout(10000)) as Observable<PaymentOption[]>,
      );
      return { options };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get payment options",
        "Payments Service",
      );
    }
  }
}
