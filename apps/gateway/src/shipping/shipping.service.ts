import { Inject, Injectable } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout, catchError } from "rxjs";
import { ORDER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";

export interface ShippingLocation {
  id: number | string;
  name: string;
}

/**
 * Proxies GHN master-data (province/district/ward) through the orders service so
 * the storefront can build cascading address dropdowns without holding the GHN
 * token. Each item's `id` is the GHN code the fee preview / waybill later
 * consume (ProvinceID / DistrictID number, WardCode string).
 */
@Injectable()
export class ShippingService {
  constructor(
    @Inject(NAME_SERVICE_TCP.ORDERS_SERVICE)
    private readonly ordersClient: ClientProxy,
  ) {}

  async listProvinces(): Promise<ShippingLocation[]> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send<
            ShippingLocation[]
          >(ORDER_MESSAGE_PATTERN.SHIPPING_PROVINCES, {})
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "list shipping provinces",
        "Orders Service",
      );
    }
  }

  async listDistricts(provinceId: number): Promise<ShippingLocation[]> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send<ShippingLocation[]>(ORDER_MESSAGE_PATTERN.SHIPPING_DISTRICTS, {
            provinceId,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "list shipping districts",
        "Orders Service",
      );
    }
  }

  async listWards(districtId: number): Promise<ShippingLocation[]> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send<ShippingLocation[]>(ORDER_MESSAGE_PATTERN.SHIPPING_WARDS, {
            districtId,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "list shipping wards",
        "Orders Service",
      );
    }
  }
}
