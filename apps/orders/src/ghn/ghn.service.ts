import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { AxiosResponse } from "axios";
import { firstValueFrom } from "rxjs";
import { CircuitBreaker, CircuitOpenError } from "@app/common";
import { GHN_MESSAGE } from "libs/constant/response-message.constant";
import { Order } from "../entity/order.entity";
import {
  CacheEntry,
  GhnDetailResponse,
  GhnDistrict,
  GhnMasterDataResponse,
  GhnMutationResponse,
  GhnOrderDetail,
  GhnProvince,
  GhnReceiverUpdate,
  GhnResolvedAddress,
  GhnResponse,
  GhnShippingItem,
  GhnSwitchStatusResponse,
  GhnWard,
  ShippingFeePreview,
} from "./ghn.types";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value.trim();
}

/**
 * The GHN detail keys `GhnOrderDetail.raw` is allowed to carry.
 *
 * GHN answers `/shipping-order/detail` with ~123 keys, and forwarding that
 * verbatim put our merchant identity and GHN's internals on a browser-reachable
 * response: `shop_id`, `client_id`, every `*_warehouse_id`, `created_ip` /
 * `updated_ip`, `created_employee` / `updated_employee`, `created_client` /
 * `updated_client`, `_id`, `soc_id`, `transaction_ids`, `internal_process`,
 * `hub_designation_log`, `sort_code`, `seal_code`, `*_station_id`, the
 * `*_config_fee_id` / `*_extra_cost_id` pricing ids. None of it is actionable
 * for a shipping operator, and `shop_id` in particular is half of what an
 * attacker needs to talk to GHN as us.
 *
 * An allow-list rather than a deny-list on purpose: GHN adds fields without
 * notice, and a new one must not leak by default. Anything the console turns
 * out to need is one line here.
 */
const GHN_RAW_ALLOWED_KEYS: readonly string[] = [
  "order_code",
  "status",
  "content",
  "note",
  "required_note",
  "tag",
  // Money
  "cod_amount",
  "cod_collect_date",
  "cod_transfer_date",
  "cod_failed_amount",
  "cod_failed_collect_date",
  "insurance_value",
  "total_fee",
  "service_fee",
  "payment_type_id",
  "service_id",
  "service_type_id",
  "is_cod_collected",
  "is_cod_transferred",
  // Parcel
  "weight",
  "converted_weight",
  "length",
  "width",
  "height",
  // Timeline
  "order_date",
  "pickup_time",
  "leadtime",
  "finish_date",
  "created_date",
  "updated_date",
  // Receiver / sender / return, as GHN currently holds them
  "to_name",
  "to_phone",
  "to_address",
  "to_ward_code",
  "to_district_id",
  "from_name",
  "from_phone",
  "from_address",
  "from_ward_code",
  "from_district_id",
  "return_name",
  "return_phone",
  "return_address",
  "return_ward_code",
  "return_district_id",
];

/** Per-entry keys kept from `raw.log[]` (GHN's status timeline). */
const GHN_RAW_LOG_KEYS: readonly string[] = [
  "status",
  "updated_date",
  "trip_code",
  "payment_type_id",
];

/** Per-entry keys kept from `raw.items[]` — drops `current_warehouse_id`. */
const GHN_RAW_ITEM_KEYS: readonly string[] = [
  "name",
  "code",
  "quantity",
  "price",
  "category",
  "status",
  "item_order_code",
  "weight",
  "length",
  "width",
  "height",
];

function pickKeys(
  source: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in source) {
      picked[key] = source[key];
    }
  }
  return picked;
}

function pickFromEntries(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map((entry) =>
    typeof entry === "object" && entry !== null
      ? pickKeys(entry as Record<string, unknown>, allowed)
      : {},
  );
}

/**
 * Reduce a raw GHN detail payload to the allow-listed fields. Nested `log[]`
 * and `items[]` are rebuilt entry by entry — they carry warehouse ids of their
 * own, so copying either wholesale would defeat the top-level filter.
 */
export function sanitizeGhnRawDetail(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = pickKeys(data, GHN_RAW_ALLOWED_KEYS);
  const log = pickFromEntries(data.log, GHN_RAW_LOG_KEYS);
  if (log) {
    sanitized.log = log;
  }
  const items = pickFromEntries(data.items, GHN_RAW_ITEM_KEYS);
  if (items) {
    sanitized.items = items;
  }
  return sanitized;
}

@Injectable()
export class GhnService {
  private readonly logger = new Logger(GhnService.name);

  // GHN master data (province/district/ward) is large and effectively static,
  // so cache it in-memory per process for a day to avoid an extra 3 GHN round
  // trips on every order create / fee preview. A restart picks up rare changes.
  private static readonly MASTER_DATA_TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly MASTER_DATA_TIMEOUT_MS = 10000;
  private provincesCache: CacheEntry<GhnProvince[]> | null = null;
  private readonly districtsByProvince = new Map<
    number,
    CacheEntry<GhnDistrict[]>
  >();
  private readonly wardsByDistrict = new Map<number, CacheEntry<GhnWard[]>>();

  // Every outbound GHN call goes through one breaker. GHN's sandbox regularly
  // answers "context deadline exceeded" or stops responding entirely; without a
  // breaker each of those burns a full HTTP timeout while holding an orders-TCP
  // worker, and the gateway's own timeout then reports an opaque 502. Only
  // outages count toward tripping it — see isGhnOutage.
  private readonly breaker = new CircuitBreaker({
    name: "ghn",
    failureThreshold: 5,
    openDurationMs: 30_000,
    isFailure: (error: unknown): boolean => GhnService.isGhnOutage(error),
  });

  constructor(private readonly httpService: HttpService) {}

  // Statuses that mean "the problem is on our side of the integration, and the
  // caller retrying with different input cannot fix it": a broken/expired token
  // and GHN rate-limiting us are operational faults, not this seller's bad
  // address, so they are treated like an outage — reported as 503 and counted
  // toward the circuit so we stop hammering GHN with calls that cannot succeed.
  private static readonly OPERATIONAL_FAULT_STATUSES = new Set([
    401, 403, 408, 429,
  ]);

  // GHN reports "I do not serve this destination" through two very different
  // strings: a retired ward is named plainly, but a ward its hub mapping cannot
  // resolve comes back as "Lỗi hệ thống - không lấy được thông tin kho", which
  // the buyer reads as OUR system failing. Both are deterministic refusals of
  // the ADDRESS, so they are matched on substring — GHN prefixes and reworks the
  // surrounding text, and there is no error code to key on. Kept as narrow as
  // the observed wording allows: this runs for waybill actions too, and a bare
  // "không còn hoạt động" would also swallow an order-state refusal.
  private static readonly UNSERVICEABLE_DESTINATION_SIGNATURES = [
    "không lấy được thông tin kho",
    "người nhận không còn hoạt động",
  ];

  // An outage is "GHN did not answer" (timeout / DNS / connection refused), or
  // answered 5xx / an operational fault. Any other 4xx is GHN rejecting THIS
  // request — a bad address, a waybill in the wrong state — which says nothing
  // about GHN's health, so it must not open the circuit for every other seller.
  private static isGhnOutage(error: unknown): boolean {
    if (error instanceof HttpException) {
      return false;
    }
    const response = (error as { response?: { status?: number } } | null)
      ?.response;
    if (response == null) {
      return true;
    }
    if (typeof response.status !== "number") {
      return true;
    }
    return (
      response.status >= 500 ||
      GhnService.OPERATIONAL_FAULT_STATUSES.has(response.status)
    );
  }

  // Run one GHN HTTP call under the breaker. Wrap ONLY the transport call, never
  // the response validation that follows it: a domain rejection we raise
  // ourselves is not a GHN failure and must not count toward the threshold.
  private async callGhn<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await this.breaker.execute(operation);
    } catch (error: unknown) {
      if (error instanceof CircuitOpenError) {
        throw new ServiceUnavailableException(
          GHN_MESSAGE.CIRCUIT_OPEN(Math.ceil(error.retryAfterMs / 1000)),
        );
      }
      throw error;
    }
  }

  // Map a failed GHN call onto an actionable domain exception. GHN puts the real
  // reason ("Trạng thái đơn hàng không hợp lệ", "context deadline exceeded") in
  // response.data.message; before this, the AxiosError escaped uncaught and the
  // seller only ever saw "Internal server error".
  private static isUnserviceableDestination(ghnMessage: string): boolean {
    const normalized = ghnMessage.toLowerCase();
    return GhnService.UNSERVICEABLE_DESTINATION_SIGNATURES.some((signature) =>
      normalized.includes(signature),
    );
  }

  private toGhnDomainError(
    error: unknown,
    buildMessage: (message: string) => string,
  ): Error {
    if (error instanceof HttpException) {
      return error;
    }
    const ghnMessage = this.extractGhnErrorMessage(error);
    if (GhnService.isGhnOutage(error)) {
      return new ServiceUnavailableException(buildMessage(ghnMessage));
    }
    // Only after the outage check: an unreachable GHN must stay a 503 no matter
    // what text it echoed back, otherwise an outage would masquerade as a bad
    // address and the buyer would be sent to edit an address that is fine.
    if (GhnService.isUnserviceableDestination(ghnMessage)) {
      // The raw wording is the only clue to WHICH destination rule GHN applied,
      // so keep it in the log even though the response no longer carries it.
      this.logger.warn(
        `[GHN] Unserviceable destination, GHN said: ${ghnMessage}`,
      );
      return new BadRequestException(GHN_MESSAGE.DESTINATION_NOT_SERVICEABLE);
    }
    return new BadRequestException(buildMessage(ghnMessage));
  }

  private buildHeaders(): Record<string, string> {
    return {
      Token: requireEnv("GHN_API_TOKEN"),
      ShopId: requireEnv("GHN_SHOP_ID"),
      "Content-Type": "application/json",
    };
  }

  private async buildShippingOrderBody(
    shippingAddress: string,
    codAmount: number,
    items: GhnShippingItem[],
    resolvedIds?: GhnResolvedAddress,
  ): Promise<Record<string, unknown>> {
    const [
      to_name,
      to_phone,
      to_address,
      to_ward_name,
      to_district_name,
      to_province_name,
    ] = shippingAddress.split("|").map((part) => (part ?? "").trim());

    // GHN's create/preview endpoints require the numeric to_district_id +
    // to_ward_code. Prefer the exact ids captured at checkout (from the FE GHN
    // address dropdowns); only fall back to resolving the free-text names against
    // master data when the checkout did not supply them.
    let districtId: number;
    let wardCode: string;
    if (resolvedIds) {
      districtId = resolvedIds.districtId;
      wardCode = resolvedIds.wardCode;
      await this.assertLocationExists(districtId, wardCode);
    } else {
      if (!to_ward_name || !to_district_name || !to_province_name) {
        throw new BadRequestException(GHN_MESSAGE.ADDRESS_MISSING_PARTS);
      }
      ({ districtId, wardCode } = await this.resolveAddressToGhnIds(
        to_province_name,
        to_district_name,
        to_ward_name,
      ));
    }

    return {
      to_name,
      to_phone,
      to_address,
      to_ward_code: wardCode,
      to_district_id: districtId,
      cod_amount: Math.round(Number(codAmount ?? 0)),
      weight: Math.round(
        items.reduce((sum, i) => sum + (i.weight ?? 500) * i.quantity, 0),
      ),
      service_type_id: 2,
      payment_type_id: 2,
      required_note: "CHOXEMHANGKHONGTHU",
      items: items.map((i) => ({
        name: i.productName,
        quantity: i.quantity,
        price: Math.round(Number(i.price)),
      })),
    };
  }

  async createShippingOrder(order: Order): Promise<string> {
    const apiUrl = requireEnv("GHN_API_URL");
    const body = await this.buildShippingOrderBody(
      order.shippingAddress,
      Number(order.codAmount ?? 0),
      order.items.map((i) => ({
        productName: i.productName,
        quantity: i.quantity,
        price: Number(i.price),
        weight: i.weight ?? undefined,
      })),
      this.toResolvedAddress(order.toDistrictId, order.toWardCode),
    );

    let response: AxiosResponse<GhnResponse>;
    try {
      response = await this.callGhn(() =>
        firstValueFrom(
          this.httpService.post<GhnResponse>(
            `${apiUrl}/v2/shipping-order/create`,
            body,
            { headers: this.buildHeaders() },
          ),
        ),
      );
    } catch (error: unknown) {
      throw this.toGhnDomainError(error, GHN_MESSAGE.CREATE_ERROR);
    }

    const orderCode = response.data?.data?.order_code;
    if (orderCode) {
      return orderCode;
    }

    throw new InternalServerErrorException(
      GHN_MESSAGE.CREATE_ERROR(response.data?.message ?? "Unknown error"),
    );
  }

  async previewShippingFee(
    shippingAddress: string,
    codAmount: number,
    items: GhnShippingItem[],
    resolvedIds?: GhnResolvedAddress,
  ): Promise<ShippingFeePreview> {
    const apiUrl = requireEnv("GHN_API_URL");
    const body = await this.buildShippingOrderBody(
      shippingAddress,
      codAmount,
      items,
      resolvedIds,
    );

    let response: AxiosResponse<GhnResponse>;
    try {
      response = await this.callGhn(() =>
        firstValueFrom(
          this.httpService.post<GhnResponse>(
            `${apiUrl}/v2/shipping-order/preview`,
            body,
            { headers: this.buildHeaders() },
          ),
        ),
      );
    } catch (error: unknown) {
      throw this.toGhnDomainError(error, GHN_MESSAGE.PREVIEW_ERROR);
    }

    const data = response.data?.data;
    if (data && typeof data.total_fee === "number") {
      return {
        shippingFee: data.total_fee,
        expectedDeliveryTime: data.expected_delivery_time ?? null,
      };
    }

    throw new InternalServerErrorException(
      GHN_MESSAGE.PREVIEW_ERROR(response.data?.message ?? "Unknown error"),
    );
  }

  // Public master-data proxies for the storefront checkout address dropdowns.
  // The FE must not hold the GHN token, so the gateway proxies these reads and
  // returns just the { id, name } the FE needs — id is the GHN code the fee
  // preview / waybill create later consumes (ProvinceID / DistrictID number,
  // WardCode string). All three reuse the 24h in-memory master-data cache.
  async listProvinces(): Promise<{ id: number; name: string }[]> {
    const provinces = await this.getProvinces();
    return provinces.map((province) => ({
      id: province.ProvinceID,
      name: province.ProvinceName,
    }));
  }

  async listDistricts(
    provinceId: number,
  ): Promise<{ id: number; name: string }[]> {
    const districts = await this.getDistricts(provinceId);
    return districts.map((district) => ({
      id: district.DistrictID,
      name: district.DistrictName,
    }));
  }

  async listWards(districtId: number): Promise<{ id: string; name: string }[]> {
    const wards = await this.getWards(districtId);
    // Never offer a ward GHN will refuse at checkout — see isDeliverableWard().
    return wards
      .filter((ward) => this.isDeliverableWard(ward))
      .map((ward) => ({
        id: ward.WardCode,
        name: ward.WardName,
      }));
  }

  async cancelShippingOrder(ghnOrderCode: string): Promise<boolean> {
    return this.switchOrderStatus(ghnOrderCode, "cancel");
  }

  async returnShippingOrder(ghnOrderCode: string): Promise<boolean> {
    return this.switchOrderStatus(ghnOrderCode, "return");
  }

  // Drive a GHN shop-callable switch-status transition for a single waybill.
  // cancel + return share the same request/response shape:
  // POST /v2/switch-status/<action> { order_codes:[code] }
  //   → { data:[{ order_code, result, message }] }
  // Throws if GHN reports the per-order result as false (e.g. order not in a
  // cancelable/returnable state) so the caller can leave the local order intact.
  private async switchOrderStatus(
    ghnOrderCode: string,
    action: "cancel" | "return",
  ): Promise<boolean> {
    const apiUrl = requireEnv("GHN_API_URL");

    let response: AxiosResponse<GhnSwitchStatusResponse>;
    try {
      response = await this.callGhn(() =>
        firstValueFrom(
          this.httpService.post<GhnSwitchStatusResponse>(
            `${apiUrl}/v2/switch-status/${action}`,
            { order_codes: [ghnOrderCode] },
            { headers: this.buildHeaders() },
          ),
        ),
      );
    } catch (error: unknown) {
      throw this.toGhnDomainError(error, (message) =>
        GHN_MESSAGE.ACTION_ERROR(action, message),
      );
    }

    const result = response.data?.data?.find(
      (r) => r.order_code === ghnOrderCode,
    );
    if (result?.result) {
      return true;
    }

    throw new InternalServerErrorException(
      GHN_MESSAGE.ACTION_ERROR(
        action,
        result?.message ?? response.data?.message ?? "Unknown error",
      ),
    );
  }

  // Update the COD amount of an existing GHN waybill.
  // POST /v2/shipping-order/updateCOD { order_code, cod_amount }
  // Shop-callable on the dev gateway (probed). GHN locks the edit once the
  // parcel is in active delivery; in that case it rejects with HTTP 400 and the
  // message is surfaced to the caller so the local order can be left intact.
  async updateOrderCod(ghnOrderCode: string, codAmount: number): Promise<void> {
    await this.postOrderMutation(
      "/v2/shipping-order/updateCOD",
      {
        order_code: ghnOrderCode,
        cod_amount: Math.round(Number(codAmount ?? 0)),
      },
      "update COD",
    );
  }

  // Update the receiver (name / phone / address) of an existing GHN waybill.
  // POST /v2/shipping-order/update { order_code, to_name?, to_phone?, to_address? }
  // Only the provided fields are sent; ward/district stay as originally resolved.
  async updateOrderReceiver(
    ghnOrderCode: string,
    receiver: GhnReceiverUpdate,
  ): Promise<void> {
    const body: Record<string, unknown> = { order_code: ghnOrderCode };
    if (receiver.toName !== undefined) body.to_name = receiver.toName;
    if (receiver.toPhone !== undefined) body.to_phone = receiver.toPhone;
    if (receiver.toAddress !== undefined) body.to_address = receiver.toAddress;
    await this.postOrderMutation(
      "/v2/shipping-order/update",
      body,
      "update receiver",
    );
  }

  // Shared driver for GHN order-mutation endpoints (updateCOD / update). GHN
  // returns HTTP 200 + { code: 200 } on success and HTTP 400 + { code, message }
  // on rejection (axios throws). Either way the GHN-supplied message is extracted
  // and re-thrown so the caller surfaces a meaningful error to the operator — a
  // GHN refusal as 400, a GHN outage as 503.
  private async postOrderMutation(
    path: string,
    body: Record<string, unknown>,
    action: string,
  ): Promise<void> {
    const apiUrl = requireEnv("GHN_API_URL");

    let response: AxiosResponse<GhnMutationResponse>;
    try {
      response = await this.callGhn(() =>
        firstValueFrom(
          this.httpService.post<GhnMutationResponse>(`${apiUrl}${path}`, body, {
            headers: this.buildHeaders(),
          }),
        ),
      );
    } catch (error: unknown) {
      throw this.toGhnDomainError(error, (message) =>
        GHN_MESSAGE.ACTION_ERROR(action, message),
      );
    }

    const code = response.data?.code;
    if (code !== undefined && code !== 200) {
      throw new InternalServerErrorException(
        GHN_MESSAGE.ACTION_ERROR(
          action,
          response.data?.message ?? "Unknown error",
        ),
      );
    }
  }

  // True when the error carries an HTTP response from GHN (axios rejected on a
  // non-2xx status) — i.e. GHN was reached and refused, as opposed to a network
  // failure where no response is present.
  private isGhnHttpRejection(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      (error as { response?: unknown }).response != null
    );
  }

  // Pull the GHN-supplied message out of an axios error body when present,
  // falling back to the generic error message. Avoids importing axios types.
  private extractGhnErrorMessage(error: unknown): string {
    if (typeof error === "object" && error !== null) {
      const response = (
        error as { response?: { data?: { message?: unknown } } }
      ).response;
      const message = response?.data?.message;
      if (typeof message === "string" && message.length > 0) {
        return message;
      }
      const fallback = (error as { message?: unknown }).message;
      if (typeof fallback === "string" && fallback.length > 0) {
        return fallback;
      }
    }
    return "Unknown error";
  }

  async getOrderDetail(ghnOrderCode: string): Promise<GhnOrderDetail> {
    const apiUrl = requireEnv("GHN_API_URL");

    let response: AxiosResponse<GhnDetailResponse>;
    try {
      response = await this.callGhn(() =>
        firstValueFrom(
          this.httpService.post<GhnDetailResponse>(
            `${apiUrl}/v2/shipping-order/detail`,
            { order_code: ghnOrderCode },
            { headers: this.buildHeaders() },
          ),
        ),
      );
    } catch (error) {
      // The circuit is open: GHN is already known to be down, so keep that
      // reason rather than reporting this waybill as missing.
      if (error instanceof HttpException) {
        throw error;
      }
      // GHN replied with a non-2xx (e.g. 400 "order not found"): the waybill is
      // no longer resolvable on GHN's side. Surface a domain 404 so the gateway
      // returns an actionable status instead of an opaque 502.
      if (this.isGhnHttpRejection(error)) {
        throw new NotFoundException(
          GHN_MESSAGE.ORDER_NOT_FOUND(
            ghnOrderCode,
            this.extractGhnErrorMessage(error),
          ),
        );
      }
      // No HTTP response (timeout / DNS / connection refused): GHN is transiently
      // unreachable. Surface 503 so the operator can distinguish infra from a
      // genuinely missing waybill and retry.
      throw new ServiceUnavailableException(
        GHN_MESSAGE.DETAIL_REQUEST_FAILED(this.extractGhnErrorMessage(error)),
      );
    }

    const data = response.data?.data;
    if (!data) {
      // GHN can also report a missing order via HTTP 200 + empty data.
      throw new NotFoundException(
        GHN_MESSAGE.ORDER_NOT_FOUND(
          ghnOrderCode,
          response.data?.message ?? "Unknown error",
        ),
      );
    }

    return {
      orderCode: this.readString(data, "order_code") ?? ghnOrderCode,
      status: this.readString(data, "status"),
      codAmount: this.readNumber(data, "cod_amount"),
      totalFee: this.readNumber(data, "total_fee"),
      expectedDeliveryTime: this.readString(data, "expected_delivery_time"),
      leadtime: this.readString(data, "leadtime"),
      toName: this.readString(data, "to_name"),
      toPhone: this.readString(data, "to_phone"),
      toAddress: this.readString(data, "to_address"),
      fromName: this.readString(data, "from_name"),
      fromPhone: this.readString(data, "from_phone"),
      // Allow-listed, not the verbatim GHN body — see sanitizeGhnRawDetail.
      raw: sanitizeGhnRawDetail(data),
    };
  }

  // Master-data reads back the public /api/shipping/* address dropdowns, so an
  // unmapped axios rejection here surfaces to the storefront as an opaque 500.
  // Same breaker as the waybill calls — one GHN outage, one circuit.
  private async callMasterData<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await this.callGhn(operation);
    } catch (error: unknown) {
      throw this.toGhnDomainError(error, GHN_MESSAGE.MASTER_DATA_ERROR);
    }
  }

  private async getProvinces(): Promise<GhnProvince[]> {
    if (this.provincesCache && this.provincesCache.expiresAt > Date.now()) {
      return this.provincesCache.value;
    }
    const apiUrl = requireEnv("GHN_API_URL");
    const response = await this.callMasterData(() =>
      firstValueFrom(
        this.httpService.get<GhnMasterDataResponse<GhnProvince>>(
          `${apiUrl}/master-data/province`,
          {
            headers: this.buildHeaders(),
            timeout: GhnService.MASTER_DATA_TIMEOUT_MS,
          },
        ),
      ),
    );
    const provinces = response.data?.data ?? [];
    this.provincesCache = {
      value: provinces,
      expiresAt: Date.now() + GhnService.MASTER_DATA_TTL_MS,
    };
    return provinces;
  }

  private async getDistricts(provinceId: number): Promise<GhnDistrict[]> {
    const cached = this.districtsByProvince.get(provinceId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const apiUrl = requireEnv("GHN_API_URL");
    const response = await this.callMasterData(() =>
      firstValueFrom(
        this.httpService.get<GhnMasterDataResponse<GhnDistrict>>(
          `${apiUrl}/master-data/district`,
          {
            headers: this.buildHeaders(),
            params: { province_id: provinceId },
            timeout: GhnService.MASTER_DATA_TIMEOUT_MS,
          },
        ),
      ),
    );
    const districts = response.data?.data ?? [];
    this.districtsByProvince.set(provinceId, {
      value: districts,
      expiresAt: Date.now() + GhnService.MASTER_DATA_TTL_MS,
    });
    return districts;
  }

  private async getWards(districtId: number): Promise<GhnWard[]> {
    const cached = this.wardsByDistrict.get(districtId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const apiUrl = requireEnv("GHN_API_URL");
    const response = await this.callMasterData(() =>
      firstValueFrom(
        this.httpService.get<GhnMasterDataResponse<GhnWard>>(
          `${apiUrl}/master-data/ward`,
          {
            headers: this.buildHeaders(),
            params: { district_id: districtId },
            timeout: GhnService.MASTER_DATA_TIMEOUT_MS,
          },
        ),
      ),
    );
    const wards = response.data?.data ?? [];
    this.wardsByDistrict.set(districtId, {
      value: wards,
      expiresAt: Date.now() + GhnService.MASTER_DATA_TTL_MS,
    });
    return wards;
  }

  /**
   * GHN's ward master data includes wards GHN itself refuses to deliver to.
   * Vietnam's 2025 ward merger is the live example: district 1450 (Quận 8)
   * lists the three merged wards 910374/910375/910376 alongside the legacy
   * ones, and quoting a fee for any of them comes back
   * `400 "phường/xã người nhận không còn hoạt động"`. They are distinguishable
   * in the payload — a deliverable ward carries `Status: 1`, a dead one
   * `Status: 3` — so filter them out instead of letting a buyer pick one from
   * the dropdown and hit the refusal at checkout.
   *
   * Fail-open on a missing field: if GHN ever stops sending `Status`, keep
   * every ward rather than emptying the dropdown.
   */
  private isDeliverableWard(ward: GhnWard): boolean {
    return (
      ward.Status === undefined || ward.Status === null || ward.Status === 1
    );
  }

  // Normalize a Vietnamese address part for tolerant matching: strip diacritics,
  // lowercase, drop administrative-unit prefixes (TP., Tỉnh, Quận, Phường, ...),
  // then remove every non-alphanumeric character. e.g. "TP. Hồ Chí Minh" and
  // "Thành phố Hồ Chí Minh" both collapse to "hochiminh"; "Quận 1" -> "1".
  private normalizeAddressPart(text: string): string {
    return text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/đ/g, "d")
      .replace(
        /\b(tp|thanh pho|tinh|quan|huyen|thi xa|thi tran|phuong|xa)\b\.?/g,
        "",
      )
      .replace(/[^a-z0-9]/g, "");
  }

  // Rank GHN master-data candidates against a free-text address part, trying the
  // canonical name and every NameExtension alias. Exact normalized matches come
  // first (in source order); containment matches follow, closest length first.
  // Returns a ranked list (not a single pick) so the resolver can fall through
  // to the next candidate when the best match is an unusable stub — GHN's dev
  // sandbox carries padded duplicates (e.g. "Hà Nội 02" with zero districts).
  private rankMasterDataMatches<T>(
    candidates: T[],
    freeText: string,
    getName: (candidate: T) => string,
    getAliases: (candidate: T) => string[] | undefined,
  ): T[] {
    const target = this.normalizeAddressPart(freeText);
    if (!target) {
      return [];
    }
    const namesOf = (candidate: T): string[] =>
      [getName(candidate), ...(getAliases(candidate) ?? [])]
        .map((name) => this.normalizeAddressPart(name))
        .filter((name) => name.length > 0);

    const exactMatches: T[] = [];
    const partialMatches: { candidate: T; score: number }[] = [];
    for (const candidate of candidates) {
      const names = namesOf(candidate);
      if (names.some((name) => name === target)) {
        exactMatches.push(candidate);
        continue;
      }
      let bestScore = Number.POSITIVE_INFINITY;
      for (const name of names) {
        if (name.includes(target) || target.includes(name)) {
          bestScore = Math.min(
            bestScore,
            Math.abs(name.length - target.length),
          );
        }
      }
      if (bestScore !== Number.POSITIVE_INFINITY) {
        partialMatches.push({ candidate, score: bestScore });
      }
    }
    partialMatches.sort((a, b) => a.score - b.score);
    return [...exactMatches, ...partialMatches.map((match) => match.candidate)];
  }

  // Build a GhnResolvedAddress only when both the district id and ward code are
  // present. A partial pair is treated as "not supplied" so the caller falls
  // back to free-text resolution rather than sending GHN an incomplete location.
  private toResolvedAddress(
    districtId: number | null | undefined,
    wardCode: string | null | undefined,
  ): GhnResolvedAddress | undefined {
    if (typeof districtId === "number" && districtId > 0 && wardCode) {
      return { districtId, wardCode };
    }
    return undefined;
  }

  /**
   * GHN-DIST-01 — verify a caller-supplied `toDistrictId` + `toWardCode` really
   * exist before quoting a fee or cutting a waybill for them.
   *
   * GHN's own `/shipping-order/preview` does NOT validate this: it answers
   * `200 { total_fee: 0 }` for `to_district_id: 999999`, so an address nobody
   * can ship to reads to the storefront as "quoted successfully, free" and the
   * failure only surfaces later at waybill create. The master-data endpoint is
   * strict where preview is lax (`400 "District ID khong ton tai"`), so one
   * cached ward lookup turns that silent 0 into an actionable 400.
   *
   * Deliberately fail-open on anything that is not an explicit GHN rejection:
   * this is an input check, not a health gate, and a GHN outage must not start
   * blocking addresses that were fine yesterday.
   */
  private async assertLocationExists(
    districtId: number,
    wardCode: string,
  ): Promise<void> {
    let wards: GhnWard[];
    try {
      wards = await this.getWards(districtId);
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw new BadRequestException(
          GHN_MESSAGE.DISTRICT_NOT_FOUND(districtId),
        );
      }
      this.logger.warn(
        `[GHN] District ${districtId} could not be validated, proceeding unvalidated: ${String(error)}`,
      );
      return;
    }

    // An empty list is "GHN has no data for this district", not "this id is
    // wrong" — GHN already answers 400 for a wrong id. Do not reject on it.
    if (wards.length === 0) {
      this.logger.warn(
        `[GHN] District ${districtId} returned no wards — ward ${wardCode} left unvalidated`,
      );
      return;
    }

    const target = wardCode.trim();
    const selected = wards.find((ward) => ward.WardCode?.trim() === target);
    if (!selected) {
      throw new BadRequestException(
        GHN_MESSAGE.WARD_NOT_IN_DISTRICT(target, districtId),
      );
    }

    // The ward belongs to the district but GHN has retired it. Saying so beats
    // the alternatives: WARD_NOT_IN_DISTRICT would be a lie, and letting it
    // through only defers the failure to GHN's own Vietnamese refusal.
    // Reachable via an address saved before the ward was retired, since the
    // dropdown no longer offers one.
    if (!this.isDeliverableWard(selected)) {
      throw new BadRequestException(GHN_MESSAGE.WARD_INACTIVE(target));
    }
  }

  private async resolveAddressToGhnIds(
    provinceName: string,
    districtName: string,
    wardName: string,
  ): Promise<{ districtId: number; wardCode: string }> {
    const provinces = await this.getProvinces();
    const provinceCandidates = this.rankMasterDataMatches(
      provinces,
      provinceName,
      (p) => p.ProvinceName,
      (p) => p.NameExtension,
    );
    if (provinceCandidates.length === 0) {
      throw new BadRequestException(
        GHN_MESSAGE.PROVINCE_UNRESOLVED(provinceName),
      );
    }

    // Walk province → district → ward, trying ranked candidates at each level
    // and falling through until a full triple resolves. This skips stub
    // provinces/districts that match by name but carry no usable children.
    for (const province of provinceCandidates) {
      const districts = await this.getDistricts(province.ProvinceID);
      const districtCandidates = this.rankMasterDataMatches(
        districts,
        districtName,
        (d) => d.DistrictName,
        (d) => d.NameExtension,
      );
      for (const district of districtCandidates) {
        const wards = await this.getWards(district.DistrictID);
        // Resolving free text onto a retired ward would hand the caller an id
        // that only fails later, so those are not candidates at all — a merged
        // ward's name usually still matches a live sibling in the same district.
        const [ward] = this.rankMasterDataMatches(
          wards.filter((candidate) => this.isDeliverableWard(candidate)),
          wardName,
          (w) => w.WardName,
          (w) => w.NameExtension,
        );
        if (ward) {
          return { districtId: district.DistrictID, wardCode: ward.WardCode };
        }
      }
    }

    throw new BadRequestException(
      GHN_MESSAGE.ADDRESS_UNRESOLVED(wardName, districtName, provinceName),
    );
  }

  private readString(
    data: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = data[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private readNumber(
    data: Record<string, unknown>,
    key: string,
  ): number | null {
    const value = data[key];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
}
