import { collectPages, fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import type {
  PromotionBatchRecord,
  TeacherLoadSummaryRow,
} from "@/features/academics/academics-types";
import { PENDING_PREVIEW_SIZE } from "@/features/dashboard/dashboard-constants";
import type { AcademicSessionSummary, CountableRecord } from "@/features/dashboard/dashboard-types";
import type { ClassOption, SectionOption } from "@/features/students/enrollment-types";
import type {
  MyTimetable,
  PeriodRecord,
  SubstitutionRecord,
} from "@/features/timetable/timetable-types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

/**
 * The dashboard home screen's API calls. Every panel reaches these through
 * `Services.dashboard.*` (see `@/services`) — never by importing this file directly and
 * never by importing `@schoolhub/api-client` or `@/lib/auth`'s `apiClient` directly.
 *
 * The type imports from `@/features/*` below are a deliberate, narrow exception to
 * "services/ doesn't reach back into features/": this app keeps domain wire types beside
 * the feature that owns them (`dashboard-types.ts`'s own header comment states the
 * convention), not in a shared package, and duplicating those types here to avoid the
 * import would just be the same shape drifting out of two places instead of one.
 * `PENDING_PREVIEW_SIZE` is imported for the same reason — it's dashboard-specific
 * config, not a generic transport concern.
 */

/**
 * Drains a bounded reference list to its full length — used for the six count tiles
 * `SchoolShapePanel` sizes by counting: classes, sections, subjects, rooms, houses,
 * campuses. `path` comes from that panel's own per-tile config, which reads it from
 * `endpoints.dashboard.*` — this stays generic over `path` because it's the fetch
 * *shape* (drain every page, count what came back) that's shared, not any one endpoint.
 */
export async function listCountable(path: string): Promise<CountableRecord[]> {
  return collectPages<CountableRecord>(apiClient, path);
}

/**
 * Reads one page carrying the server's own `total_count` — used for the two head-count
 * tiles (`/students`, `/staff`) that are too large to drain. Same generic-over-`path`
 * reasoning as `listCountable`.
 */
export async function fetchCountTotal(path: string): Promise<Page<CountableRecord>> {
  return fetchPage<CountableRecord>(apiClient, path, { query: { page_size: 1 } });
}

/** Every academic session — `TeacherLoadChart` resolves the current one from this list. */
export async function fetchAcademicSessions(): Promise<AcademicSessionSummary[]> {
  return collectPages<AcademicSessionSummary>(apiClient, endpoints.dashboard.academicSessions);
}

/**
 * Weekly teaching load per teacher for one academic session — a real server-side
 * aggregate, not assembled in the browser. `academicSessionId` stays nullable here,
 * matching the caller: `TeacherLoadChart` only enables this query once it has resolved a
 * session id, but the type isn't narrowed at the call site either, before or after this
 * move.
 */
export async function fetchTeacherLoadSummary(
  academicSessionId: string | null,
): Promise<TeacherLoadSummaryRow[]> {
  const { data } = await apiClient.get<TeacherLoadSummaryRow[]>(
    endpoints.dashboard.teacherLoadSummary,
    { query: { academic_session_id: academicSessionId } },
  );
  return data;
}

/** Every section, with its class and capacity — `CapacityChart` groups these by class. */
export async function fetchSections(): Promise<SectionOption[]> {
  return collectPages<SectionOption>(apiClient, endpoints.dashboard.sections);
}

/** Every class — `CapacityChart` names each bar from this list. */
export async function fetchClasses(): Promise<ClassOption[]> {
  return collectPages<ClassOption>(apiClient, endpoints.dashboard.classes);
}

/** Substitutions awaiting approval, previewed to the dashboard's own preview size. */
export async function fetchPendingSubstitutions(): Promise<Page<SubstitutionRecord>> {
  return fetchPage<SubstitutionRecord>(apiClient, endpoints.dashboard.teacherSubstitutions, {
    query: { status: "proposed", page_size: PENDING_PREVIEW_SIZE },
  });
}

/** Promotion batches awaiting approval, previewed to the dashboard's own preview size. */
export async function fetchPendingPromotions(): Promise<Page<PromotionBatchRecord>> {
  return fetchPage<PromotionBatchRecord>(apiClient, endpoints.dashboard.studentPromotions, {
    query: { status: "pending_approval", page_size: PENDING_PREVIEW_SIZE },
  });
}

/** The viewer's own timetable for one date — resolves confirmed substitutions for that date. */
export async function fetchMyTimetable(date: string): Promise<MyTimetable> {
  const { data } = await apiClient.get<MyTimetable>(endpoints.dashboard.myTimetable, {
    query: { date },
  });
  return data;
}

/** The bell schedule — every period, breaks included. */
export async function fetchPeriods(): Promise<PeriodRecord[]> {
  return collectPages<PeriodRecord>(apiClient, endpoints.dashboard.periods);
}
