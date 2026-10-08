import { collectPages, fetchPage, MAX_PAGE_SIZE, type ApiSchemas } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

/**
 * The school-organization domain's reference-data calls. Every consumer reaches these
 * through `Services.schoolOrganization.*` (see `@/services`) — never by importing this
 * file directly and never by importing `@schoolhub/api-client` directly.
 */

/** The slice of the generated `House` schema a reference-data select/filter reads — derived
 * from the contract, not hand-written, per ADR-0017. */
export type SchoolOrganizationOption = Pick<ApiSchemas["House"], "id" | "name">;

/** `GET /houses` — every house, for a reference-data select/filter. */
export async function fetchHouses(): Promise<SchoolOrganizationOption[]> {
  const { items } = await fetchPage<SchoolOrganizationOption>(
    apiClient,
    endpoints.schoolOrganization.houses,
    { query: { page_size: MAX_PAGE_SIZE } },
  );
  return items;
}

/**
 * `GET /classes`. `isActive` is omitted for a directory-style filter (show every class
 * regardless of status — a past enrollment may reference a now-inactive one) and passed
 * `true` for an enroll/change-section/complete picker, which must only offer the live set.
 */
export async function fetchClasses(
  params: { isActive?: boolean } = {},
): Promise<SchoolOrganizationOption[]> {
  const { items } = await fetchPage<SchoolOrganizationOption>(
    apiClient,
    endpoints.schoolOrganization.classes,
    {
      query: {
        page_size: MAX_PAGE_SIZE,
        ...(params.isActive !== undefined ? { is_active: params.isActive } : {}),
      },
    },
  );
  return items;
}

/**
 * `GET /sections`, scoped by `classId` (required — a section always cascades off a chosen
 * class) and optionally `campusId`. Same `isActive` convention as `fetchClasses` above.
 */
export async function fetchSections(params: {
  classId: string;
  campusId?: string;
  isActive?: boolean;
}): Promise<SchoolOrganizationOption[]> {
  const { items } = await fetchPage<SchoolOrganizationOption>(
    apiClient,
    endpoints.schoolOrganization.sections,
    {
      query: {
        page_size: MAX_PAGE_SIZE,
        class_id: params.classId,
        ...(params.campusId ? { campus_id: params.campusId } : {}),
        ...(params.isActive !== undefined ? { is_active: params.isActive } : {}),
      },
    },
  );
  return items;
}

/** Every academic session — moved here from `Services.dashboard` (its reference-data
 * fetchers belong in this domain, not the dashboard-home screen's own service file; see
 * Phase 1's Roadmap, which already queues moving `fetchCampuses` out of there for the same
 * reason). `earnings-chart.tsx` is the one existing consumer, updated in the same change. */
export interface AcademicSessionSummary {
  id: string;
  name: string;
  status: string;
  is_current: boolean;
}

export async function fetchAcademicSessions(): Promise<AcademicSessionSummary[]> {
  return collectPages<AcademicSessionSummary>(
    apiClient,
    endpoints.schoolOrganization.academicSessions,
  );
}
