export interface PaymentOrder {
  id: string | number;
  total: number;
}

export interface CallbackPayload {
  data: string;
  mac: string;
}

export interface IPaymentStrategy {
  createPayment(
    order: PaymentOrder,
  ): Promise<{ paymentUrl: string; transactionId: string }>;
  verifyCallback(
    payload: CallbackPayload,
  ): Promise<{ orderId: string; success: boolean }>;
}
