export interface PaymentOrder {
  id: string | number;
  total: number;
  returnUrl?: string;
}

export interface CallbackPayload {
  data: string;
  mac: string;
}

export interface IPaymentStrategy {
  createPayment(
    order: PaymentOrder,
  ): Promise<{ paymentUrl: string; transactionId: string; appTransId: string }>;
  verifyCallback(
    payload: CallbackPayload,
  ): Promise<{ orderId: string; success: boolean }>;
}
