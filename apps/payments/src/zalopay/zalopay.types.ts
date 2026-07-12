export interface ZaloPayCreateOrderResponse {
  return_code: number;
  return_message: string;
  order_url?: string;
  zp_trans_token?: string;
}

export interface ZaloPayReturnQuery {
  appid: string;
  apptransid: string;
  pmcid: string;
  bankcode: string;
  amount: string;
  discountamount: string;
  status: string;
  checksum: string;
}
