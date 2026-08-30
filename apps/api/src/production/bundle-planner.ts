import { BadRequestException } from '@nestjs/common';

export interface BundleLinePlanInput {
  orderItemId: string;
  plannedQty: number;
  allocatedQty: number;
  overproductionLimit: number;
  standardBundleQty: number;
  quantityToAllocate: number | null;
  allowTailBundle: boolean;
  authorizedOverproductionQty: number;
  overproductionReason: string | null;
}

export interface PlannedBundle {
  orderItemId: string;
  bundleSeq: number;
  plannedQty: number;
  isTail: boolean;
}

export function planBundles(lines: BundleLinePlanInput[], startingSequence = 1): PlannedBundle[] {
  const plans: PlannedBundle[] = [];
  let sequence = startingSequence;

  for (const line of lines) {
    if (line.standardBundleQty < 1) throw new BadRequestException('standardBundleQty must be positive');
    if (line.allocatedQty < 0 || line.plannedQty < 1) throw new BadRequestException('Invalid allocated quantity');
    if (line.authorizedOverproductionQty > line.overproductionLimit) {
      throw new BadRequestException('authorizedOverproductionQty exceeds the order item limit');
    }
    if (line.authorizedOverproductionQty > 0 && !line.overproductionReason) {
      throw new BadRequestException('overproductionReason is required for overproduction');
    }

    const ordinaryRemaining = Math.max(line.plannedQty - line.allocatedQty, 0);
    const requested = line.quantityToAllocate ?? ordinaryRemaining;
    const maximumRemaining = Math.max(
      line.plannedQty + line.authorizedOverproductionQty - line.allocatedQty,
      0,
    );
    if (requested < 1) throw new BadRequestException('No quantity remains to allocate');
    if (requested > maximumRemaining) {
      throw new BadRequestException('quantityToAllocate exceeds the authorized remaining quantity');
    }

    const fullBundles = Math.floor(requested / line.standardBundleQty);
    const remainder = requested % line.standardBundleQty;
    if (remainder > 0 && !line.allowTailBundle) {
      throw new BadRequestException('Tail bundle is required but allowTailBundle is false');
    }
    for (let index = 0; index < fullBundles; index += 1) {
      plans.push({
        orderItemId: line.orderItemId,
        bundleSeq: sequence++,
        plannedQty: line.standardBundleQty,
        isTail: false,
      });
    }
    if (remainder > 0) {
      plans.push({
        orderItemId: line.orderItemId,
        bundleSeq: sequence++,
        plannedQty: remainder,
        isTail: true,
      });
    }
  }

  if (plans.length > 1_000) throw new BadRequestException('A maximum of 1000 bundles may be generated');
  return plans;
}
