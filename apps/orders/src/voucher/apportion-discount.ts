/**
 * Split a whole-VND `amount` across keys in proportion to their weights, using
 * the largest-remainder method so the shares always sum to exactly `amount`
 * (VOUCHER-SHOP-01 phase 2 — one platform discount spread over the sub-orders
 * of a multi-shop checkout).
 *
 * The caller caps `amount` at the weight total. Under that cap no share can
 * exceed its own weight, so no sub-order is ever discounted below zero: a share
 * is `floor(amount * weight / total)` plus at most the one leftover VND, and the
 * floor is strictly below the weight whenever `amount < total`.
 *
 * Ties on the leftover go to the lower key, so the split is deterministic.
 */
export function apportionByWeight(
  amount: number,
  weightByKey: Map<number, number>,
): Map<number, number> {
  const entries = [...weightByKey.entries()]
    .map(([key, weight]): [number, number] => [key, Math.max(weight, 0)])
    .sort(([leftKey], [rightKey]) => leftKey - rightKey);
  const weightTotal = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const shareByKey = new Map<number, number>(entries.map(([key]) => [key, 0]));
  const target = Math.min(Math.max(Math.round(amount), 0), weightTotal);
  if (target === 0 || weightTotal === 0) {
    return shareByKey;
  }

  const fractions: Array<{ key: number; fraction: number }> = [];
  let allocated = 0;
  for (const [key, weight] of entries) {
    const exactShare = (target * weight) / weightTotal;
    const flooredShare = Math.floor(exactShare);
    shareByKey.set(key, flooredShare);
    allocated += flooredShare;
    fractions.push({ key, fraction: exactShare - flooredShare });
  }
  fractions.sort((left, right) => right.fraction - left.fraction);
  for (let index = 0; allocated < target; index++) {
    const { key } = fractions[index % fractions.length];
    shareByKey.set(key, (shareByKey.get(key) ?? 0) + 1);
    allocated++;
  }
  return shareByKey;
}
