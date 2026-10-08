import { id } from "@/data/factories";
import { fail, ok, pagedList } from "../envelope";
import type { MockModule } from "../router";

/** The generated wire shape, trimmed to what the directory table and dialogs read. */
export interface Student {
  id: string;
  admission_number: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  date_of_birth: string;
  gender: "male" | "female" | "other" | "unspecified";
  photo_file_id: string | null;
  photo_url: string | null;
  campus_id: string;
  campus_name: string;
  house_id: string | null;
  house_name: string | null;
  status: "active" | "suspended" | "transferred" | "withdrawn" | "graduated";
  admission_date: string;
  blood_group: string | null;
  nationality: string | null;
  religion: string | null;
  previous_school: string | null;
  medical_notes: string | null;
  address: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export function buildStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: id("student"),
    admission_number: "2026-0001",
    user_id: null,
    first_name: "Ayesha",
    last_name: "Khan",
    preferred_name: null,
    date_of_birth: "2012-05-01",
    gender: "female",
    photo_file_id: null,
    photo_url: null,
    campus_id: "campus-0001",
    campus_name: "Main Campus",
    house_id: null,
    house_name: null,
    status: "active",
    admission_date: "2026-01-10",
    blood_group: null,
    nationality: null,
    religion: null,
    previous_school: null,
    medical_notes: null,
    address: null,
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-01-10T00:00:00Z",
    ...overrides,
  };
}

/** The `StudentEnrollmentSerializer`-shaped record `:enroll`/`:change-section` return. */
export interface MockEnrollmentResult {
  id: string;
  student_id: string;
  academic_session_id: string;
  class_id: string;
  section_id: string;
  roll_number: string | null;
  enrollment_date: string;
  end_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface StudentOptions {
  students?: Student[];
  /** Called after a mocked `:enroll`/`:change-section` succeeds. `enrollmentModule` owns
   * `GET /students/{id}/history` as its own, separate module with no shared state — a spec
   * that registers both and wants a just-created enrollment to show up in the history
   * timeline wires this callback to push a matching event into the same object it passed to
   * `enrollmentModule`. */
  onEnrollmentAction?: (
    action: "enroll" | "change-section",
    enrollment: MockEnrollmentResult,
  ) => void;
}

/**
 * `/students` and friends — the directory list/detail/create/update, plus the
 * colon-action withdraw (`POST /students/{id}:withdraw`, the real registered route;
 * see `apps/dashboard/src/services/endpoints.ts`).
 *
 * A spec opts in with `mockApi.use(studentsModule({ students }))`.
 */
export function studentsModule(options: StudentOptions = {}): MockModule {
  return (api) => {
    const students = [...(options.students ?? [])];

    api.get("/students", (request) => {
      const matching = filterAndOrder(students, request.searchParams);
      const pageSize = Number(request.searchParams.get("page_size") ?? matching.length) || 1;
      const page = Number(request.searchParams.get("page") ?? 1) || 1;
      const start = (page - 1) * pageSize;
      return pagedList(matching.slice(start, start + pageSize), {
        page,
        page_size: pageSize,
        total_count: matching.length,
      });
    });

    api.get("/students/:studentId", (request) => {
      const match = students.find((s) => s.id === request.params["studentId"]);
      // Cross-tenant and non-existent rows are indistinguishable by design: the API
      // returns 404, never 403.
      return match ? ok(match) : fail(404, "Not found.");
    });

    api.post("/students", (request) => {
      const body = (request.json() as Partial<Student> | null) ?? {};
      const missing = (
        [
          "first_name",
          "last_name",
          "date_of_birth",
          "gender",
          "campus_id",
          "admission_date",
        ] as const
      ).filter((field) => !body[field]);
      if (missing.length > 0) {
        return fail(400, "Validation failed.", {
          details: missing.map((field) => ({ field, issue: "This field is required." })),
        });
      }
      // id last: the server assigns it, so a client-supplied one must not win.
      const created = buildStudent({
        ...body,
        id: id("student"),
        admission_number: `2026-${String(students.length + 1).padStart(4, "0")}`,
      });
      students.push(created);
      return ok(created, { status: 201 });
    });

    api.patch("/students/:studentId", (request) => {
      const match = students.find((s) => s.id === request.params["studentId"]);
      if (!match) return fail(404, "Not found.");
      Object.assign(match, (request.json() as Partial<Student> | null) ?? {}, {
        updated_at: "2026-09-02T00:00:00Z",
      });
      return ok(match);
    });

    api.post("/students/:studentAction", (request) => {
      const [studentId, action] = (request.params["studentAction"] ?? "").split(":");
      const match = students.find((s) => s.id === studentId);
      if (!match) return fail(404, "Not found.");

      if (action === "withdraw") {
        if (match.status !== "active") {
          return fail(422, `Student is ${match.status}, not active.`, {
            code: "domain_rule_violation",
            details: [{ field: "non_field", issue: `Student is ${match.status}, not active.` }],
          });
        }
        Object.assign(match, { status: "withdrawn", updated_at: "2026-09-02T00:00:00Z" });
        return ok(match);
      }

      // `enroll`/`change-section` both return the enrollment record
      // (`StudentEnrollmentSerializer`), not the student — this mock's job is proving the
      // dashboard's own request/response wiring, not re-implementing enroll_student's
      // real validation (capacity, prerequisites, etc. — that belongs to the live lane).
      if (action === "enroll" || action === "change-section") {
        const body = (request.json() as Record<string, string> | null) ?? {};
        const enrollment: MockEnrollmentResult = {
          id: id("enrollment"),
          student_id: match.id,
          academic_session_id: body["academic_session_id"] ?? "session-e2e",
          class_id: body["class_id"] ?? "class-e2e",
          section_id: body["section_id"] ?? "section-e2e",
          roll_number: body["roll_number"] ?? null,
          enrollment_date: body["enrollment_date"] ?? "2026-04-05",
          end_date: null,
          status: "active",
          created_at: "2026-04-05T00:00:00Z",
          updated_at: "2026-04-05T00:00:00Z",
        };
        options.onEnrollmentAction?.(action, enrollment);
        return ok(enrollment, { status: action === "enroll" ? 201 : 200 });
      }

      return fail(404, "Not found.");
    });
  };
}

function filterAndOrder(students: Student[], params: URLSearchParams): Student[] {
  const status = params.get("status");
  const campusId = params.get("campus_id");
  const houseId = params.get("house_id");
  const search = params.get("search")?.toLowerCase();
  const ordering = params.get("ordering");

  const matching = students.filter(
    (s) =>
      (!status || s.status === status) &&
      (!campusId || s.campus_id === campusId) &&
      (!houseId || s.house_id === houseId) &&
      (!search ||
        `${s.first_name} ${s.last_name}`.toLowerCase().includes(search) ||
        s.admission_number.toLowerCase().includes(search)),
  );
  if (!ordering) return matching;
  const descending = ordering.startsWith("-");
  const field = (descending ? ordering.slice(1) : ordering) as keyof Student;
  const sortKey = (s: Student) => {
    const value = s[field];
    return typeof value === "string" ? value : "";
  };
  return [...matching].sort((a, b) => (descending ? -1 : 1) * sortKey(a).localeCompare(sortKey(b)));
}
