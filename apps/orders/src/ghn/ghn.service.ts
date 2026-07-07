import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { AxiosResponse } from "axios";
import { firstValueFrom } from "rxjs";
import { Order } from "../entity/order.entity";

interface GhnResponseData {
  order_code?: string;
  total_fee?: number;
  expected_delivery_time?: string;
}

interface GhnResponse {
  data?: GhnResponseData;
  message?: string;
}

interface GhnSwitchStatusResult {
  order_code?: string;
  result?: boolean;
  message?: string;
}

interface GhnSwitchStatusResponse {
  data?: GhnSwitchStatusResult[];
  message?: string;
}

interface GhnDetailResponse {
  data?: Record<string, unknown>;
  message?: string;
}

interface GhnMutationResponse {
  code?: number;
  message?: string;
  data?: unknown;
}

export interface GhnReceiverUpdate {
  toName?: string;
  toPhone?: string;
  toAddress?: string;
}

interface GhnMasterDataResponse<T> {
  code?: number;
  message?: string;
  data?: T[];
}

interface GhnProvince {
  ProvinceID: number;
  ProvinceName: string;
  NameExtension?: string[];
}

interface GhnDistrict {
  DistrictID: number;
  ProvinceID: number;
  DistrictName: string;
  NameExtension?: string[];
}

interface GhnWard {
  WardCode: string;
  DistrictID: number;
  WardName: string;
  NameExtension?: string[];
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface GhnShippingItem {
  productName: string;
  quantity: number;
  price: number;
  weight?: number;
}

export interface ShippingFeePreview {
  shippingFee: number;
  expectedDeliveryTime: string | null;
}

export interface GhnOrderDetail {
  orderCode: string;
  status: string | null;
  codAmount: number | null;
  totalFee: number | null;
  expectedDeliveryTime: string | null;
  leadtime: string | null;
  toName: string | null;
  toPhone: string | null;
  toAddress: string | null;
  fromName: string | null;
  fromPhone: string | null;
  raw: Record<string, unknown>;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value.trim();
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

  constructor(private readonly httpService: HttpService) {}

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
  ): Promise<Record<string, unknown>> {
    const [
      to_name,
      to_phone,
      to_address,
      to_ward_name,
      to_district_name,
      to_province_name,
    ] = shippingAddress.split("|").map((part) => (part ?? "").trim());

    if (!to_ward_name || !to_district_name || !to_province_name) {
      throw new BadRequestException(
        "Shipping address is missing the ward/district/province parts required by GHN",
      );
    }

    // GHN's create/preview endpoints require the numeric to_district_id +
    // to_ward_code; the checkout only stores free-text names, so resolve them
    // against GHN master data here (robust to diacritics / prefix variants).
    const { districtId, wardCode } = await this.resolveAddressToGhnIds(
      to_province_name,
      to_district_name,
      to_ward_name,
    );

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
    );

    const response = await firstValueFrom(
      this.httpService.post<GhnResponse>(
        `${apiUrl}/v2/shipping-order/create`,
        body,
        { headers: this.buildHeaders() },
      ),
    );

    const orderCode = response.data?.data?.order_code;
    if (orderCode) {
      return orderCode;
    }

    throw new InternalServerErrorException(
      `GHN error: ${response.data?.message ?? "Unknown error"}`,
    );
  }

  async previewShippingFee(
    shippingAddress: string,
    codAmount: number,
    items: GhnShippingItem[],
  ): Promise<ShippingFeePreview> {
    const apiUrl = requireEnv("GHN_API_URL");
    const body = await this.buildShippingOrderBody(
      shippingAddress,
      codAmount,
      items,
    );

    const response = await firstValueFrom(
      this.httpService.post<GhnResponse>(
        `${apiUrl}/v2/shipping-order/preview`,
        body,
        { headers: this.buildHeaders() },
      ),
    );

    const data = response.data?.data;
    if (data && typeof data.total_fee === "number") {
      return {
        shippingFee: data.total_fee,
        expectedDeliveryTime: data.expected_delivery_time ?? null,
      };
    }

    throw new InternalServerErrorException(
      `GHN preview error: ${response.data?.message ?? "Unknown error"}`,
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
    return wards.map((ward) => ({
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

    const response = await firstValueFrom(
      this.httpService.post<GhnSwitchStatusResponse>(
        `${apiUrl}/v2/switch-status/${action}`,
        { order_codes: [ghnOrderCode] },
        { headers: this.buildHeaders() },
      ),
    );

    const result = response.data?.data?.find(
      (r) => r.order_code === ghnOrderCode,
    );
    if (result?.result) {
      return true;
    }

    throw new InternalServerErrorException(
      `GHN ${action} error: ${result?.message ?? response.data?.message ?? "Unknown error"}`,
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
  // and re-thrown so the caller surfaces a meaningful error to the operator.
  private async postOrderMutation(
    path: string,
    body: Record<string, unknown>,
    action: string,
  ): Promise<void> {
    const apiUrl = requireEnv("GHN_API_URL");
    try {
      const response = await firstValueFrom(
        this.httpService.post<GhnMutationResponse>(`${apiUrl}${path}`, body, {
          headers: this.buildHeaders(),
        }),
      );
      const code = response.data?.code;
      if (code !== undefined && code !== 200) {
        throw new InternalServerErrorException(
          `GHN ${action} error: ${response.data?.message ?? "Unknown error"}`,
        );
      }
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `GHN ${action} error: ${this.extractGhnErrorMessage(error)}`,
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
      response = await firstValueFrom(
        this.httpService.post<GhnDetailResponse>(
          `${apiUrl}/v2/shipping-order/detail`,
          { order_code: ghnOrderCode },
          { headers: this.buildHeaders() },
        ),
      );
    } catch (error) {
      // GHN replied with a non-2xx (e.g. 400 "order not found"): the waybill is
      // no longer resolvable on GHN's side. Surface a domain 404 so the gateway
      // returns an actionable status instead of an opaque 502.
      if (this.isGhnHttpRejection(error)) {
        throw new NotFoundException(
          `GHN order ${ghnOrderCode} not found: ${this.extractGhnErrorMessage(error)}`,
        );
      }
      // No HTTP response (timeout / DNS / connection refused): GHN is transiently
      // unreachable. Surface 503 so the operator can distinguish infra from a
      // genuinely missing waybill and retry.
      throw new ServiceUnavailableException(
        `GHN detail request failed: ${this.extractGhnErrorMessage(error)}`,
      );
    }

    const data = response.data?.data;
    if (!data) {
      // GHN can also report a missing order via HTTP 200 + empty data.
      throw new NotFoundException(
        `GHN order ${ghnOrderCode} not found: ${response.data?.message ?? "Unknown error"}`,
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
      raw: data,
    };
  }

  private async getProvinces(): Promise<GhnProvince[]> {
    if (this.provincesCache && this.provincesCache.expiresAt > Date.now()) {
      return this.provincesCache.value;
    }
    const apiUrl = requireEnv("GHN_API_URL");
    const response = await firstValueFrom(
      this.httpService.get<GhnMasterDataResponse<GhnProvince>>(
        `${apiUrl}/master-data/province`,
        {
          headers: this.buildHeaders(),
          timeout: GhnService.MASTER_DATA_TIMEOUT_MS,
        },
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
    const response = await firstValueFrom(
      this.httpService.get<GhnMasterDataResponse<GhnDistrict>>(
        `${apiUrl}/master-data/district`,
        {
          headers: this.buildHeaders(),
          params: { province_id: provinceId },
          timeout: GhnService.MASTER_DATA_TIMEOUT_MS,
        },
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
    const response = await firstValueFrom(
      this.httpService.get<GhnMasterDataResponse<GhnWard>>(
        `${apiUrl}/master-data/ward`,
        {
          headers: this.buildHeaders(),
          params: { district_id: districtId },
          timeout: GhnService.MASTER_DATA_TIMEOUT_MS,
        },
      ),
    );
    const wards = response.data?.data ?? [];
    this.wardsByDistrict.set(districtId, {
      value: wards,
      expiresAt: Date.now() + GhnService.MASTER_DATA_TTL_MS,
    });
    return wards;
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
        `Cannot resolve province "${provinceName}" to a GHN province`,
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
        const [ward] = this.rankMasterDataMatches(
          wards,
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
      `Cannot resolve shipping address "${wardName}, ${districtName}, ${provinceName}" to a GHN district/ward`,
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
