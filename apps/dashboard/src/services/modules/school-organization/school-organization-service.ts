import { collectPages, fetchPage, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toSessionQueryParams, toStructureQueryParams } from "./school-organization-helper";
import type {
  AcademicSessionRecord,
  AcademicSessionSummary,
  CampusInput,
  CampusRecord,
  DepartmentInput,
  DepartmentRecord,
  HolidayCalendarRecord,
  HolidayCalendarUpdate,
  HouseInput,
  HouseRecord,
  SchoolOrganizationOption,
  SectionOption,
  SessionCloneInput,
  SessionInput,
  SessionPageQuery,
  StructurePageQuery,
  TermCreateInput,
  TermInput,
  TermRecord,
} from "./school-organization-type";

/**
 * The school-organization domain's reference-data calls. Every consumer reaches these
 * through `Services.schoolOrganization.*` (see `@/services`) — never by importing this
 * file directly and never by importing `@schoolhub/api-client` directly.
 */

/** One page of a reference-data list, narrowed by `is_active` only when `isActive` is given. */
async function fetchOptions(
  path: string,
  params: { isActive?: boolean } = {},
): Promise<SchoolOrganizationOption[]> {
  const { items } = await fetchPage<SchoolOrganizationOption>(apiClient, path, {
    query: {
      page_size: MAX_PAGE_SIZE,
      ...(params.isActive !== undefined ? { is_active: params.isActive } : {}),
    },
  });
  return items;
}

/** `GET /houses` — every house, for a reference-data select/filter. */
export async function fetchHouses(): Promise<SchoolOrganizationOption[]> {
  return fetchOptions(endpoints.schoolOrganization.houses);
}

/**
 * `GET /classes`. `isActive` is omitted for a directory-style filter (show every class
 * regardless of status — a past enrollment may reference a now-inactive one) and passed
 * `true` for an enroll/change-section/complete picker, which must only offer the live set.
 */
export async function fetchClasses(
  params: { isActive?: boolean } = {},
): Promise<SchoolOrganizationOption[]> {
  return fetchOptions(endpoints.schoolOrganization.classes, params);
}

/** `GET /subjects`. Same `isActive` convention as `fetchClasses` above: omitted to filter a
 * list by any subject, `true` for a picker that may only offer live ones. */
export async function fetchSubjects(
  params: { isActive?: boolean } = {},
): Promise<SchoolOrganizationOption[]> {
  return fetchOptions(endpoints.schoolOrganization.subjects, params);
}

/**
 * `GET /sections`, scoped by `classId` (required — a section always cascades off a chosen
 * class) and optionally `campusId`. Same `isActive` convention as `fetchClasses` above.
 */
export async function fetchSections(params: {
  classId: string;
  campusId?: string;
  isActive?: boolean;
}): Promise<SectionOption[]> {
  const { items } = await fetchPage<SectionOption>(
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
export async function fetchAcademicSessions(): Promise<AcademicSessionSummary[]> {
  return collectPages<AcademicSessionSummary>(
    apiClient,
    endpoints.schoolOrganization.academicSessions,
  );
}

/** `GET /terms` — one session's terms, in their order within it. */
export async function fetchTerms(academicSessionId: string): Promise<TermRecord[]> {
  const terms = await collectPages<TermRecord>(apiClient, endpoints.schoolOrganization.terms, {
    query: { academic_session_id: academicSessionId, page_size: MAX_PAGE_SIZE },
  });
  return terms.sort((a, b) => a.sequence - b.sequence);
}

// --- The School module's structure screens: one paged list and its writes per resource ------

export async function fetchCampusPage(query: StructurePageQuery): Promise<Page<CampusRecord>> {
  return fetchPage<CampusRecord>(apiClient, endpoints.schoolOrganization.campuses, {
    query: toStructureQueryParams(query),
  });
}

export async function createCampus(input: CampusInput): Promise<CampusRecord> {
  const { data } = await apiClient.post<CampusRecord>(endpoints.schoolOrganization.campuses, input);
  return data;
}

export async function updateCampus(id: string, input: CampusInput): Promise<CampusRecord> {
  const { data } = await apiClient.patch<CampusRecord>(
    endpoints.schoolOrganization.campus(id),
    input,
  );
  return data;
}

export async function deleteCampus(id: string): Promise<void> {
  await apiClient.delete(endpoints.schoolOrganization.campus(id));
}

export async function fetchDepartmentPage(
  query: StructurePageQuery,
): Promise<Page<DepartmentRecord>> {
  return fetchPage<DepartmentRecord>(apiClient, endpoints.schoolOrganization.departments, {
    query: toStructureQueryParams(query),
  });
}

export async function createDepartment(input: DepartmentInput): Promise<DepartmentRecord> {
  const { data } = await apiClient.post<DepartmentRecord>(
    endpoints.schoolOrganization.departments,
    input,
  );
  return data;
}

export async function updateDepartment(
  id: string,
  input: DepartmentInput,
): Promise<DepartmentRecord> {
  const { data } = await apiClient.patch<DepartmentRecord>(
    endpoints.schoolOrganization.department(id),
    input,
  );
  return data;
}

export async function deleteDepartment(id: string): Promise<void> {
  await apiClient.delete(endpoints.schoolOrganization.department(id));
}

export async function fetchHousePage(query: StructurePageQuery): Promise<Page<HouseRecord>> {
  return fetchPage<HouseRecord>(apiClient, endpoints.schoolOrganization.houses, {
    query: toStructureQueryParams(query),
  });
}

export async function createHouse(input: HouseInput): Promise<HouseRecord> {
  const { data } = await apiClient.post<HouseRecord>(endpoints.schoolOrganization.houses, input);
  return data;
}

export async function updateHouse(id: string, input: HouseInput): Promise<HouseRecord> {
  const { data } = await apiClient.patch<HouseRecord>(
    endpoints.schoolOrganization.house(id),
    input,
  );
  return data;
}

export async function deleteHouse(id: string): Promise<void> {
  await apiClient.delete(endpoints.schoolOrganization.house(id));
}

// --- Academic sessions (cursor paged) and their terms ---------------------------------------

export async function fetchSessionPage(
  query: SessionPageQuery,
): Promise<Page<AcademicSessionRecord>> {
  return fetchPage<AcademicSessionRecord>(
    apiClient,
    endpoints.schoolOrganization.academicSessions,
    {
      query: toSessionQueryParams(query),
    },
  );
}

export async function createSession(input: SessionInput): Promise<AcademicSessionRecord> {
  const { data } = await apiClient.post<AcademicSessionRecord>(
    endpoints.schoolOrganization.academicSessions,
    input,
  );
  return data;
}

export async function updateSession(
  id: string,
  input: SessionInput,
): Promise<AcademicSessionRecord> {
  const { data } = await apiClient.patch<AcademicSessionRecord>(
    endpoints.schoolOrganization.academicSession(id),
    input,
  );
  return data;
}

/** `:activate`: refused with a 422 `{structure: [...]}` listing every gap at once. */
export async function activateSession(id: string): Promise<AcademicSessionRecord> {
  const { data } = await apiClient.post<AcademicSessionRecord>(
    endpoints.schoolOrganization.academicSessionAction(id, "activate"),
  );
  return data;
}

export async function closeSession(id: string): Promise<AcademicSessionRecord> {
  const { data } = await apiClient.post<AcademicSessionRecord>(
    endpoints.schoolOrganization.academicSessionAction(id, "close"),
  );
  return data;
}

/** `:clone`: a new planned session with the source's curriculum; its terms are not copied. */
export async function cloneSession(
  id: string,
  input: SessionCloneInput,
): Promise<AcademicSessionRecord> {
  const { data } = await apiClient.post<AcademicSessionRecord>(
    endpoints.schoolOrganization.academicSessionAction(id, "clone"),
    input,
  );
  return data;
}

export async function createTerm(input: TermCreateInput): Promise<TermRecord> {
  const { data } = await apiClient.post<TermRecord>(endpoints.schoolOrganization.terms, input);
  return data;
}

export async function updateTerm(id: string, input: TermInput): Promise<TermRecord> {
  const { data } = await apiClient.patch<TermRecord>(endpoints.schoolOrganization.term(id), input);
  return data;
}

/** `GET /holiday-calendar`: the effective working week (Monday to Friday when nothing is
 * configured) and the holidays. */
export async function fetchHolidayCalendar(): Promise<HolidayCalendarRecord> {
  const { data } = await apiClient.get<HolidayCalendarUpdate>(
    endpoints.schoolOrganization.holidayCalendar,
  );
  return { working_days: data.working_days ?? [], holidays: data.holidays ?? [] };
}

/** `PUT /holiday-calendar`: each list named replaces the stored one wholesale, so removing a
 * holiday is sending the list without it. */
export async function updateHolidayCalendar(
  body: HolidayCalendarUpdate,
): Promise<HolidayCalendarRecord> {
  const { data } = await apiClient.put<HolidayCalendarUpdate>(
    endpoints.schoolOrganization.holidayCalendar,
    body,
  );
  return { working_days: data.working_days ?? [], holidays: data.holidays ?? [] };
}
