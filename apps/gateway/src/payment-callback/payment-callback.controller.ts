import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { SkipResponseWrap } from "../common/decorators/skip-response-wrap.decorator";
import { PaymentCallbackService } from "./payment-callback.service";
import {
  VNPayCallbackPayload,
  VNPayCallbackResponse,
  ZaloPayCallbackBody,
  ZaloPayCallbackResponse,
} from "./payment-callback.types";

@ApiExcludeController()
@Controller()
@SkipResponseWrap()
export class PaymentCallbackController {
  constructor(
    private readonly paymentCallbackService: PaymentCallbackService,
  ) {}

  @Post("zalopay/callback")
  @HttpCode(HttpStatus.OK)
  @Public()
  @RateLimit({ limit: 300, ttl: 60 })
  async zaloPayCallback(
    @Body() body: ZaloPayCallbackBody,
  ): Promise<ZaloPayCallbackResponse> {
    if (!this.hasValidZaloPayShape(body)) {
      return { return_code: -1, return_message: "invalid callback payload" };
    }
    return this.paymentCallbackService.handleZaloPayCallback(body);
  }

  @Post("vnpay/callback")
  @HttpCode(HttpStatus.OK)
  @Public()
  @RateLimit({ limit: 300, ttl: 60 })
  async vnpayCallback(
    @Body() body: VNPayCallbackPayload,
  ): Promise<VNPayCallbackResponse> {
    if (!this.hasValidVNPayShape(body)) {
      return { RspCode: "99", Message: "Invalid callback payload" };
    }
    return this.paymentCallbackService.handleVNPayCallback(body);
  }

  @Get("vnpay/callback")
  @HttpCode(HttpStatus.OK)
  @Public()
  @RateLimit({ limit: 300, ttl: 60 })
  async vnpayIpnCallback(
    @Query() query: VNPayCallbackPayload,
  ): Promise<VNPayCallbackResponse> {
    if (!this.hasValidVNPayShape(query)) {
      return { RspCode: "99", Message: "Invalid callback payload" };
    }
    return this.paymentCallbackService.handleVNPayCallback(query);
  }

  private hasValidZaloPayShape(
    body: Partial<ZaloPayCallbackBody>,
  ): body is ZaloPayCallbackBody {
    return (
      this.hasNonEmptyString(body.data) && this.hasNonEmptyString(body.mac)
    );
  }

  private hasValidVNPayShape(
    payload: Partial<VNPayCallbackPayload>,
  ): payload is VNPayCallbackPayload {
    return (
      this.hasNonEmptyString(payload.vnp_TxnRef) &&
      this.hasNonEmptyString(payload.vnp_TransactionNo) &&
      this.hasNonEmptyString(payload.vnp_SecureHash)
    );
  }

  private hasNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }
}
