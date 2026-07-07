import {
  Controller,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { ShippingService, ShippingLocation } from "./shipping.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

@ApiTags("Shipping")
@ApiBearerAuth("bearer")
@Controller("shipping")
@UseGuards(JwtAuthGuard)
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get("provinces")
  @ApiOperation({
    summary: "List GHN provinces for the checkout address dropdown",
  })
  @ApiResponse({
    status: 200,
    description: "Array of { id (ProvinceID), name }.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async getProvinces(): Promise<ShippingLocation[]> {
    return this.shippingService.listProvinces();
  }

  @Get("districts")
  @ApiOperation({
    summary: "List GHN districts within a province",
  })
  @ApiQuery({ name: "provinceId", type: Number, required: true })
  @ApiResponse({
    status: 200,
    description: "Array of { id (DistrictID), name }.",
  })
  @ApiResponse({ status: 400, description: "Invalid provinceId." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async getDistricts(
    @Query("provinceId", ParseIntPipe) provinceId: number,
  ): Promise<ShippingLocation[]> {
    return this.shippingService.listDistricts(provinceId);
  }

  @Get("wards")
  @ApiOperation({
    summary: "List GHN wards within a district",
  })
  @ApiQuery({ name: "districtId", type: Number, required: true })
  @ApiResponse({
    status: 200,
    description: "Array of { id (WardCode), name }.",
  })
  @ApiResponse({ status: 400, description: "Invalid districtId." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async getWards(
    @Query("districtId", ParseIntPipe) districtId: number,
  ): Promise<ShippingLocation[]> {
    return this.shippingService.listWards(districtId);
  }
}
