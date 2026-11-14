import type { PermissionKey } from "@schoolhub/types";

import { Services } from "@/services";
import type { DiscountRecord, FineRecord, ScholarshipRecord } from "@/services";

import {
  cursorPage,
  HEAD_ID,
  mocked,
  SESSION_ID,
  STUDENT_ID,
  stubFeesServices,
} from "./fees-test-support";

/** Shared setup for the Grants tests; each file keeps its own `jest.mock` calls. */

export const listDiscounts = mocked(Services.discounts.listDiscounts);
export const createDiscount = mocked(Services.discounts.createDiscount);
export const revokeDiscount = mocked(Services.discounts.revokeDiscount);
export const listScholarships = mocked(Services.scholarships.listScholarships);
export const createScholarship = mocked(Services.scholarships.createScholarship);
export const updateScholarship = mocked(Services.scholarships.updateScholarship);
export const listFines = mocked(Services.fines.listFines);
export const createFine = mocked(Services.fines.createFine);
export const waiveFine = mocked(Services.fines.waiveFine);

export const DISCOUNT_ID = "d0000000-0000-4000-8000-000000000001";
export const SCHOLARSHIP_ID = "d0000000-0000-4000-8000-000000000002";
export const FINE_ID = "d0000000-0000-4000-8000-000000000003";
const APPROVER_ID = "d0000000-0000-4000-8000-0000000000aa";
const STAMP = "2026-10-01T00:00:00Z";

/** What the seeded `accountant` holds for grants, plus the reads the create forms' pickers make. */
export const GRANTS_PERMISSIONS: PermissionKey[] = [
  "fees.discount.view",
  "fees.discount.create",
  "fees.discount.waive",
  "fees.scholarship.create",
  "fees.fine.view",
  "fees.fine.create",
  "fees.fine.waive",
  "fees.fee-structure.view",
  "school.academic-session.view",
  "students.student.view",
];

/** An active 10% discount on every head. */
export function discountRecord(overrides: Partial<DiscountRecord> = {}): DiscountRecord {
  return {
    id: DISCOUNT_ID,
    student: STUDENT_ID,
    student_name: "Ayesha Khan",
    academic_session: SESSION_ID,
    name: "Sibling discount",
    discount_type: "percent",
    value: "10.00",
    fee_head: null,
    valid_from: null,
    valid_to: null,
    status: "active",
    reason: null,
    approved_by: APPROVER_ID,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

/** An approved 50% merit award. */
export function scholarshipRecord(overrides: Partial<ScholarshipRecord> = {}): ScholarshipRecord {
  return {
    id: SCHOLARSHIP_ID,
    student: STUDENT_ID,
    student_name: "Ayesha Khan",
    academic_session: SESSION_ID,
    name: "Merit award",
    scholarship_type: "merit",
    coverage_type: "percent",
    value: "50.00",
    sponsor: "Alumni trust",
    status: "approved",
    approved_by: APPROVER_ID,
    notes: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

/** A pending library fine of 250.00. */
export function fineRecord(overrides: Partial<FineRecord> = {}): FineRecord {
  return {
    id: FINE_ID,
    student: STUDENT_ID,
    student_name: "Ayesha Khan",
    fee_head: HEAD_ID,
    fine_type: "library",
    amount: "250.00",
    reason: "Overdue library book",
    source_module: null,
    source_reference: null,
    status: "pending",
    waived_by: null,
    waived_reason: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

/** The `beforeEach` of every Grants test: the fees stub, plus one record in each grant list. */
export function stubGrantsServices(url = "/fees/grants") {
  stubFeesServices(url);
  listDiscounts.mockResolvedValue(cursorPage([discountRecord()]));
  listScholarships.mockResolvedValue(cursorPage([scholarshipRecord()]));
  listFines.mockResolvedValue(cursorPage([fineRecord()]));
}
