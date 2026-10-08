export interface PaymentOrder {
  id: string | number;
  total: number;
  returnUrl?: string;
  // The opaque `ord_` id. Absent for a multi-order payment, whose `id` is the
  // payment row's own PK.
  publicId?: string | null;
}

/**
 * The description the provider prints on its hosted checkout page. Only the
 * public id may appear there (PUBID-01): `order.id` is an internal PK, so a
 * payment without a public id gets a description with no id at all.
 */
export function buildPaymentDescription(order: PaymentOrder): string {
  return order.publicId
    ? `Payment for order ${order.publicId}`
    : "Payment for TryBuy order";
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
