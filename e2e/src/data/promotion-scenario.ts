import {
  ACADEMICS_PROMOTION_PERMISSIONS,
  buildUser,
  ORG_IDS,
  SCHOOL_ADMIN_PERMISSIONS,
  uuid,
} from "@/data/factories";
import {
  academicsPromotionsModule,
  type AcademicsPromotionsOptions,
  buildAcademicSession,
  buildPromotionBatch,
  buildSchoolClass,
  buildSection,
  type MockApi,
  type PromotionBatch,
  type PromotionBatchOverrides,
  type PromotionDecision,
  type PromotionStudent,
  schoolOrganizationModule,
  type Section,
} from "@/mocks";

/**
 * The world the promotion specs share (`academics-promotions.spec.ts`, the list and its create
 * dialog, and `academics-promotion-review.spec.ts`, a batch's screen): the sessions, classes and
 * students, the three viewers, and the builders and stub that put them behind a `MockApi`.
 */

export const closedSession = buildAcademicSession({
  name: "2025-26",
  status: "closed",
  is_current: false,
});
export const currentSession = buildAcademicSession({
  id: ORG_IDS.currentSession,
  name: "2026-27",
});
export const nextSession = buildAcademicSession({
  name: "2027-28",
  status: "planned",
  is_current: false,
});
const sessions = [closedSession, currentSession, nextSession];

export const grade1 = buildSchoolClass({ id: ORG_IDS.grade1, name: "Grade 1" });
export const grade2 = buildSchoolClass({ name: "Grade 2" });
// Ladder order: a created batch proposes the next class up.
const classes = [grade1, grade2];
export const grade2SectionA = buildSection({
  name: "A",
  class_id: grade2.id,
  campus_id: ORG_IDS.mainCampus,
});
export const grade2SectionB = buildSection({
  name: "B",
  class_id: grade2.id,
  campus_id: ORG_IDS.mainCampus,
});
const sections = [grade2SectionA, grade2SectionB];

export const hamza: PromotionStudent = {
  id: uuid(),
  name: "Hamza Khan",
  admission_number: "ADM-0001",
};
export const bilal: PromotionStudent = {
  id: uuid(),
  name: "Bilal Ahmed",
  admission_number: "ADM-0002",
};
export const zainab: PromotionStudent = {
  id: uuid(),
  name: "Zainab Ali",
  admission_number: "ADM-0003",
};

// The preparer holds every key (a `school_owner`'s set). The approver holds the one a
// `principal` approves with, and neither edits nor executes.
export const preparer = buildUser({
  permissions: [...SCHOOL_ADMIN_PERMISSIONS, ...ACADEMICS_PROMOTION_PERMISSIONS],
});
export const approver = buildUser({
  permissions: [
    ...SCHOOL_ADMIN_PERMISSIONS,
    "academics.promotion.view",
    "academics.promotion.approve",
  ],
});
export const viewOnlyUser = buildUser({
  permissions: [...SCHOOL_ADMIN_PERMISSIONS, "academics.promotion.view"],
});

/** A student's row, moving on to Grade 2 as the server proposes (with a section, or none). */
export function toGrade2(student: PromotionStudent, section?: Section): Partial<PromotionDecision> {
  return {
    student_id: student.id,
    student_name: student.name,
    admission_number: student.admission_number,
    to_class_id: grade2.id,
    to_class_name: grade2.name,
    to_section_id: section?.id ?? null,
    to_section_name: section?.name ?? null,
  };
}

/** A Grade 1 batch from the current session into the next, in draft with the three students
 * going to Grade 2: Bilal has a section and the other two none. Every row is as proposed, so
 * none needs an override reason. */
export function buildBatch(overrides: PromotionBatchOverrides = {}): PromotionBatch {
  return buildPromotionBatch({
    from_academic_session_id: currentSession.id,
    from_academic_session_name: "2026-27",
    to_academic_session_id: nextSession.id,
    to_academic_session_name: "2027-28",
    from_class_id: grade1.id,
    from_class_name: "Grade 1",
    decisions: [toGrade2(hamza), toGrade2(bilal, grade2SectionA), toGrade2(zainab)],
    ...overrides,
  });
}

/** Stubs what the screens read: the reference lists and the batches. Fresh batches per test:
 * every transition and edit mutates what the stub holds. */
export function stubPromotionsApi(
  mockApi: MockApi,
  batches: PromotionBatch[],
  options: AcademicsPromotionsOptions = {},
) {
  mockApi.use(
    schoolOrganizationModule({ classes, sections, academicSessions: sessions }),
    academicsPromotionsModule({
      batches,
      students: { [grade1.id]: [hamza, bilal, zainab] },
      sessions,
      classes,
      sections,
      ...options,
    }),
  );
}
