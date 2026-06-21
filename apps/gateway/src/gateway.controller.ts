import { BadRequestException, Controller, Get, Query } from "@nestjs/common";

import { ApiTags } from "@nestjs/swagger";
import { Public } from "./common/decorators/public.decorator";

@ApiTags("Gateway")
@Controller("gateway")
export class GatewayController {
  @Get("payment-result")
  @Public()
  paymentResult(@Query() query: Record<string, string>): {
    gateway: string;
    status: string;
    transId: string;
    amount: string;
  } {
    let gateway: string;
    let transId: string;

    if (query["apptransid"]) {
      gateway = "zalopay";
      transId = query["apptransid"];
    } else if (query["vnp_TxnRef"]) {
      gateway = "vnpay";
      transId = query["vnp_TxnRef"];
    } else {
      throw new BadRequestException("Missing transaction reference");
    }

    let status: string;
    let amount: string;
    if (gateway === "zalopay") {
      status = query["status"] === "1" ? "success" : "failed";
      amount = query["amount"];
    } else {
      status = query["vnp_ResponseCode"] === "00" ? "success" : "failed";
      amount = query["vnp_Amount"];
    }
    return { gateway, status, transId, amount };
  }
}
