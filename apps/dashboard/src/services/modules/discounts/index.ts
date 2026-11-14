import { createDiscount, listDiscounts, revokeDiscount, updateDiscount } from "./discounts-service";

export const DiscountsService = { listDiscounts, createDiscount, updateDiscount, revokeDiscount };
export type {
  DiscountInput,
  DiscountRecord,
  DiscountsQuery,
  DiscountStatus,
  DiscountType,
} from "./discounts-type";
