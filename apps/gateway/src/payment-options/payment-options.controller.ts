import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator";
import { PaymentOptionsService } from "./payment-options.service";

@ApiTags("Payment Options")
@Controller("payment")
export class PaymentOptionsController {
  constructor(private readonly paymentOptionsService: PaymentOptionsService) {}

  @Public()
  @Get("options")
  @ApiOperation({ summary: "Get available payment options" })
  async getOptions(): Promise<{
    options: { id: string; name: string; description: string }[];
  }> {
    return this.paymentOptionsService.getOptions();
  }
}
