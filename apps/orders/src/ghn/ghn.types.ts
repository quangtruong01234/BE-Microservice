export interface GhnResponseData {
  order_code?: string;
  total_fee?: number;
  expected_delivery_time?: string;
}

export interface GhnResponse {
  data?: GhnResponseData;
  message?: string;
}

export interface GhnSwitchStatusResult {
  order_code?: string;
  result?: boolean;
  message?: string;
}

export interface GhnSwitchStatusResponse {
  data?: GhnSwitchStatusResult[];
  message?: string;
}

export interface GhnDetailResponse {
  data?: Record<string, unknown>;
  message?: string;
}

export interface GhnMutationResponse {
  code?: number;
  message?: string;
  data?: unknown;
}

export interface GhnReceiverUpdate {
  toName?: string;
  toPhone?: string;
  toAddress?: string;
}

export interface GhnMasterDataResponse<T> {
  code?: number;
  message?: string;
  data?: T[];
}

export interface GhnProvince {
  ProvinceID: number;
  ProvinceName: string;
  NameExtension?: string[];
}

export interface GhnDistrict {
  DistrictID: number;
  ProvinceID: number;
  DistrictName: string;
  NameExtension?: string[];
}

export interface GhnWard {
  WardCode: string;
  DistrictID: number;
  WardName: string;
  NameExtension?: string[];
}

export interface CacheEntry<T> {
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
