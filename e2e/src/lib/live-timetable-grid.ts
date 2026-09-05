import type { ApiClient } from "@schoolhub/api-client";
import {
  buildLiveAcademicSession,
  buildLiveCampus,
  buildLiveClass,
  buildLiveRoom,
  buildLiveSection,
  buildLiveSubject,
} from "@/data/live-factories";
import { E2E_BASELINE_TEACHER_EMPLOYEE_NUMBER } from "@/lib/seed-constants";

/**
 * The preconditions a timetable grid needs, through the real API.
 *
 * Shared by `tests/live/api/timetable.spec.ts` and the browser journey rather than
 * duplicated, the same way `live-promotion-batch.ts` is — and, like that file,
 * deliberately built on run-unique rows rather than on `seed_e2e_data`'s baseline
 * section. Publishing is *destructive to the previous version*: it end-dates every
 * currently published slot of that section and promotes the drafts in their place, so a
 * spec that published into the seeded section would supersede the seeded week and leave
 * the next spec — and the next run — reading a grid the seed no longer describes.
 *
 * Two things it does reuse from the seed, because both are genuinely shared
 * infrastructure rather than per-test data:
 *
 * - **the bell schedule**, which is seeded tenant-wide so a section on any campus can
 *   use it (see `seed-constants.ts`). Periods are not free to duplicate per test:
 *   `assert_period_does_not_overlap` compares a new period against every tenant-wide
 *   row, so a per-test morning schedule would refuse itself.
 * - **the teaching staff member**, found by employee number, since `Staff` ids are
 *   generated per seed run.
 *
 * The two subjects are the point of the whole fixture. `conflicts._unallocated_teachers`
 * is a *hard* finding, and it is the one hard conflict a user can both create and undo
 * from the grid alone — so one subject is allocated to the teacher and one deliberately
 * is not, which is what lets a spec walk a clash forward to a clean publish instead of
 * only bouncing off it.
 */

interface Identified {
  id: string;
}

/** The subset of `PeriodSerializer` this file reads. */
export interface SeededPeriod {
  id: string;
  campus_id: string | null;
  name: string;
  sequence: number;
  is_break: boolean;
  weekdays: number[] | null;
}

export interface TimetableScaffold {
  campusId: string;
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
  sessionId: string;
  sessionName: string;
  /** Both dates, because a substitution's must fall inside the session (§11) and
   * `farFutureSessionWindow()` puts every generated session years from today. */
  sessionStartDate: string;
  sessionEndDate: string;
  /** The seeded tenant-wide, schedulable periods, in the order the day runs. */
  periods: SeededPeriod[];
}

export interface TimetableGrid extends TimetableScaffold {
  teacherId: string;
  roomId: string;
  /** A subject the seeded teacher **is** allocated to teach this section. */
  allocatedSubjectId: string;
  allocatedSubjectName: string;
  /** A subject nobody is allocated to — the `teacher_not_allocated` lever. */
  unallocatedSubjectId: string;
  unallocatedSubjectName: string;
}

/** Weekly periods on the curriculum row the allocation hangs off. */
const CURRICULUM_WEEKLY_PERIODS = 4;

/** A seeded staff member, by the one attribute that survives a re-seed. */
export async function findSeededStaff(
  client: ApiClient,
  employeeNumber: string,
): Promise<Identified> {
  const staff = await client.get<{ id: string; employee_number: string }[]>("/staff", {
    query: { search: employeeNumber },
  });
  const found = staff.data.find((row) => row.employee_number === employeeNumber);
  if (!found) {
    throw new Error(`no seeded staff ${employeeNumber} — run manage.py seed_e2e_data`);
  }
  return found;
}

/**
 * The seeded bell schedule's schedulable periods.
 *
 * `ordering=sequence`, not the list's default: `CursorPagination.ordering` is
 * `-created_at`, so an un-ordered read of a long-lived dev database would return the
 * hundred *most recent* periods — every one of them created by earlier spec runs, with
 * the seeded rows (the oldest in the table) off the end of the page. Ascending sequence
 * puts them first regardless of how old the database is, because `buildLivePeriod`
 * numbers spec-created periods from 90.
 *
 * The remaining two filters cannot be expressed server-side: `PeriodFilterSet` has no
 * "campus is null" form, and `weekdays` is not filterable at all. Both matter —
 * a campus-bound period would be `period_wrong_campus` against a section on another
 * campus, and a weekday-limited one would be `period_not_on_weekday` on the days it does
 * not run. Both are hard.
 */
export async function schedulablePeriods(client: ApiClient): Promise<SeededPeriod[]> {
  const listed = await client.get<SeededPeriod[]>("/periods", {
    query: { is_break: false, ordering: "sequence", page_size: 100 },
  });
  const usable = listed.data.filter((row) => row.campus_id === null && row.weekdays === null);
  if (usable.length < 2) {
    throw new Error(
      "the seeded tenant-wide bell schedule is missing — run manage.py seed_e2e_data",
    );
  }
  return usable;
}

/** Campus, class, section and session — everything a slot's cell is addressed by. */
export async function seedTimetableScaffold(client: ApiClient): Promise<TimetableScaffold> {
  const campusPayload = buildLiveCampus();
  const sessionPayload = buildLiveAcademicSession();
  const classPayload = buildLiveClass();
  const sectionPayload = buildLiveSection();

  const [campus, session, schoolClass, periods] = await Promise.all([
    client.post("/campuses", campusPayload).then((r) => r.data as Identified),
    client.post("/academic-sessions", sessionPayload).then((r) => r.data as Identified),
    client.post("/classes", classPayload).then((r) => r.data as Identified),
    schedulablePeriods(client),
  ]);

  const section = (
    await client.post("/sections", {
      ...sectionPayload,
      class_id: schoolClass.id,
      campus_id: campus.id,
    })
  ).data as Identified;

  return {
    campusId: campus.id,
    classId: schoolClass.id,
    className: classPayload.name,
    sectionId: section.id,
    sectionName: sectionPayload.name,
    sessionId: session.id,
    sessionName: sessionPayload.name,
    sessionStartDate: sessionPayload.start_date,
    sessionEndDate: sessionPayload.end_date,
    periods,
  };
}

/** The scaffold, plus the teacher, room and the allocated/unallocated subject pair. */
export async function seedTimetableGrid(client: ApiClient): Promise<TimetableGrid> {
  const scaffold = await seedTimetableScaffold(client);

  const allocatedPayload = buildLiveSubject();
  const unallocatedPayload = buildLiveSubject();

  const [teacher, allocated, unallocated, room] = await Promise.all([
    findSeededStaff(client, E2E_BASELINE_TEACHER_EMPLOYEE_NUMBER),
    client.post("/subjects", allocatedPayload).then((r) => r.data as Identified),
    client.post("/subjects", unallocatedPayload).then((r) => r.data as Identified),
    client
      .post("/rooms", { ...buildLiveRoom(), campus_id: scaffold.campusId })
      .then((r) => r.data as Identified),
  ]);

  // Only the allocated subject needs a curriculum row: `assert_subject_in_class_curriculum`
  // guards the *allocation*, not the slot — timetable does not re-police academics'
  // curriculum, it reports the missing allocation as a conflict (§11, and
  // `SubjectlessGridTests` in the Django suite pins exactly that).
  await client.post("/class-subjects", {
    academic_session_id: scaffold.sessionId,
    class_id: scaffold.classId,
    subject_id: allocated.id,
    weekly_periods: CURRICULUM_WEEKLY_PERIODS,
  });

  await client.post("/teacher-subject-allocations", {
    academic_session_id: scaffold.sessionId,
    section_id: scaffold.sectionId,
    subject_id: allocated.id,
    staff_id: teacher.id,
  });

  return {
    ...scaffold,
    teacherId: teacher.id,
    roomId: room.id,
    allocatedSubjectId: allocated.id,
    allocatedSubjectName: allocatedPayload.name,
    unallocatedSubjectId: unallocated.id,
    unallocatedSubjectName: unallocatedPayload.name,
  };
}
