export interface ZaloPayCallbackBody {
  data: string;
  mac: string;
}

export interface ZaloPayCallbackResponse {
  return_code: number;
  return_message: string;
}

export type VNPayCallbackPayload = Record<string, string>;

export interface VNPayCallbackResponse {
  RspCode: string;
  Message: string;
}
