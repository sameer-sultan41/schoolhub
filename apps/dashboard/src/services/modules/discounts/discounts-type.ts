import type { ApiSchemas } from "@schoolhub/api-client";

/** Discounts (`/discounts`, `fees.discount.*`): a student-level reduction, a percent or a fixed amount. The generated wire shape (ADR-0017). */
export type DiscountRecord = ApiSchemas["Discount"];
export type DiscountStatus = DiscountRecord["status"];
export type DiscountType = DiscountRecord["discount_type"];

export interface DiscountsQuery {
  studentId?: string;
  academicSessionId?: string;
  feeHeadId?: string;
  discountType?: DiscountType;
  status?: DiscountStatus;
  search?: string;
  ordering?: string;
  cursor?: string;
  pageSize?: number;
}

/** A create sends the required fields; an update sends only the fields given (a PATCH). `feeHeadId: null` applies the discount to every head. */
export interface DiscountInput {
  studentId: string;
  academicSessionId: string;
  name: string;
  discountType: DiscountType;
  value: string;
  feeHeadId?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  reason?: string | null;
}
