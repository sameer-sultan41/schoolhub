import type { PortalChild, PortalDashboard, PortalModules } from "@/services";

/** The portal screens' fixtures: the shell's and every portal screen's tests read them. */

export const AYESHA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const BILAL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export const ALL_MODULES_ON: PortalModules = {
  attendance: true,
  fees: true,
  examinations: true,
  communication: true,
  timetable: true,
};

export function portalChild(
  id: string,
  firstName: string,
  lastName: string,
  overrides: Partial<PortalChild> = {},
): PortalChild {
  return {
    student: {
      id,
      first_name: firstName,
      last_name: lastName,
      admission_number: "ADM-001",
      class_name: "Grade 5",
      section_name: "A",
    },
    attendance: {
      today: "present",
      month_percentage: "96.00",
      month_present_days: 12,
      month_counted_days: 13,
    },
    fees: { outstanding_total: "12000.00", outstanding_count: 1, next_due_date: "2026-11-30" },
    latest_result: {
      exam_name: "Mid-term",
      percentage: "81.50",
      grade: "A",
      published_at: "2026-10-20T09:00:00Z",
    },
    ...overrides,
  };
}

export function portalDashboard(overrides: Partial<PortalDashboard> = {}): PortalDashboard {
  return {
    children: [portalChild(AYESHA_ID, "Ayesha", "Khan"), portalChild(BILAL_ID, "Bilal", "Khan")],
    unread_notifications: 0,
    unread_threads: 0,
    modules: ALL_MODULES_ON,
    ...overrides,
  };
}
