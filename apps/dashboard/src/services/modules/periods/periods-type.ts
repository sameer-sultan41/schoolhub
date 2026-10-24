import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shape (ADR-0017). */
export type PeriodRecord = ApiSchemas["Period"];

export interface PeriodPageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
  /** The periods that run at this campus: its own plus the tenant-wide ones. */
  forCampusId?: string;
  isBreak?: boolean;
}

/** A null `campusId` is "every campus"; a null `weekdays` is the tenant's working days. */
export interface PeriodInput {
  campusId: string | null;
  name: string;
  sequence: number;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  weekdays: number[] | null;
}
