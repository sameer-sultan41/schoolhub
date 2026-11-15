import { uuid } from "@/data/factories";
import { fail, ok, type MockResponse } from "../envelope";
import type { MockApi } from "../router";
import type {
  AcademicSession,
  Campus,
  SchoolClass,
  Section,
  Subject,
  Term,
} from "./school-organization";
import { referenced, removeRow, requireName, validation } from "./school-setup";

/**
 * The School module's sessions, terms, classes, sections and subjects writes, registered by
 * `schoolOrganizationModule` over the same lists its reads serve. Each refusal copies the
 * server's sentence (L5): `assert_no_session_overlap`, `assert_term_window`,
 * `activate_session` and `session_completeness_errors`, `ClassSerializer.validate_level`,
 * `SectionSerializer.validate` and `assert_deletable`.
 */

export interface SchoolStructureState {
  campuses: Campus[];
  classes: SchoolClass[];
  sections: Section[];
  subjects: Subject[];
  academicSessions: AcademicSession[];
  terms: Term[];
}

/** A `DomainRuleViolation` with one sentence: a 422 whose message is that sentence. */
function domainRule(message: string): MockResponse {
  return fail(422, message, {
    code: "domain_rule_violation",
    details: [{ field: "non_field", issue: message }],
  });
}

function dateRange(row: { start_date: string; end_date: string }): string {
  return `(${row.start_date} – ${row.end_date})`;
}

function overlaps(
  a: { start_date: string; end_date: string },
  b: { start_date: string; end_date: string },
): boolean {
  return a.start_date <= b.end_date && b.start_date <= a.end_date;
}

/** `assert_no_session_overlap`: two live school years would make enrollment ambiguous. */
function sessionOverlap(
  sessions: AcademicSession[],
  candidate: AcademicSession,
): MockResponse | undefined {
  const clash = sessions.find((row) => row.id !== candidate.id && overlaps(row, candidate));
  return clash
    ? domainRule(`Dates overlap academic session '${clash.name}' ${dateRange(clash)}.`)
    : undefined;
}

/** `assert_term_window`: inside the session, off its siblings. */
function termWindow(
  { academicSessions, terms }: SchoolStructureState,
  candidate: Term,
): MockResponse | undefined {
  const session = academicSessions.find((row) => row.id === candidate.academic_session_id);
  if (!session) {
    const issue = `Invalid pk "${candidate.academic_session_id}" - object does not exist.`;
    return validation("academic_session_id", issue);
  }
  if (candidate.start_date < session.start_date || candidate.end_date > session.end_date) {
    return domainRule(`Term dates must fall inside the session window ${dateRange(session)}.`);
  }
  const sibling = terms.find(
    (row) =>
      row.id !== candidate.id &&
      row.academic_session_id === candidate.academic_session_id &&
      overlaps(row, candidate),
  );
  return sibling ? domainRule(`Term dates overlap term '${sibling.name}'.`) : undefined;
}

/** `session_completeness_errors`, in its order. */
function completenessErrors(state: SchoolStructureState, session: AcademicSession): string[] {
  const errors: string[] = [];
  if (!state.campuses.some((campus) => campus.is_active)) {
    errors.push("At least one active campus is required.");
  }
  const sectioned = state.classes.some(
    (row) =>
      row.is_active &&
      state.sections.some((section) => section.class_id === row.id && section.is_active),
  );
  if (!sectioned) errors.push("At least one active class with an active section is required.");
  const terms = state.terms
    .filter((term) => term.academic_session_id === session.id)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const first = terms[0];
  const last = terms[terms.length - 1];
  if (!first || !last) {
    errors.push("At least one term is required.");
  } else if (first.start_date > session.start_date || last.end_date < session.end_date) {
    errors.push("Term dates must cover the whole session window.");
  }
  return errors;
}

/** `activate_session`: the completeness check, then this one is the only current session. */
function activate(state: SchoolStructureState, session: AcademicSession): MockResponse {
  if (session.status === "closed" || session.status === "archived") {
    return fail(409, `A ${session.status} session cannot be activated.`);
  }
  if (session.status === "active" && session.is_current) {
    return fail(409, `Session '${session.name}' is already active.`);
  }
  const errors = completenessErrors(state, session);
  if (errors.length > 0) {
    // More than one detail: the envelope's message is the status's code, not a sentence.
    return fail(422, errors.length === 1 ? (errors[0] ?? "") : "unprocessable", {
      code: "domain_rule_violation",
      details: errors.map((issue) => ({ field: "structure", issue })),
    });
  }
  for (const row of state.academicSessions) row.is_current = false;
  session.status = "active";
  session.is_current = true;
  return ok(session);
}

function registerSessionWrites(api: MockApi, state: SchoolStructureState) {
  const { academicSessions, terms } = state;

  api.post("/academic-sessions", (request) => {
    const body = request.json() as Partial<AcademicSession> | null;
    const refusal = requireName(body);
    if (refusal) return refusal;
    const created: AcademicSession = {
      name: "",
      start_date: "",
      end_date: "",
      ...body,
      // Read only: a new session is planned until it is activated.
      status: "planned",
      is_current: false,
      id: uuid(),
    };
    const clash = sessionOverlap(academicSessions, created);
    if (clash) return clash;
    academicSessions.push(created);
    return ok(created, { status: 201 });
  });

  api.patch("/academic-sessions/:rowId", (request) => {
    const match = academicSessions.find((row) => row.id === request.params["rowId"]);
    if (!match) return fail(404, "Not found.");
    // `status` and `is_current` are read only: they move through `:activate` and `:close`.
    const next = {
      ...match,
      ...(request.json() as Partial<AcademicSession> | null),
      id: match.id,
      status: match.status,
      is_current: match.is_current,
    };
    const clash = sessionOverlap(academicSessions, next);
    if (clash) return clash;
    Object.assign(match, next);
    return ok(match);
  });

  // `:target` captures "<id>:activate" whole (router params stop only at `/`).
  api.post("/academic-sessions/:target", (request) => {
    const [rowId, action] = (request.params["target"] ?? "").split(":");
    const session = academicSessions.find((row) => row.id === rowId);
    if (!session || action !== "activate") return fail(404, "Not found.");
    return activate(state, session);
  });

  api.post("/terms", (request) => {
    const created: Term = {
      academic_session_id: "",
      name: "",
      sequence: 1,
      start_date: "",
      end_date: "",
      ...(request.json() as Partial<Term> | null),
      id: uuid(),
    };
    const refusal = requireName(created) ?? termWindow(state, created);
    if (refusal) return refusal;
    terms.push(created);
    return ok(created, { status: 201 });
  });

  api.patch("/terms/:rowId", (request) => {
    const match = terms.find((row) => row.id === request.params["rowId"]);
    if (!match) return fail(404, "Not found.");
    const next = { ...match, ...(request.json() as Partial<Term> | null), id: match.id };
    const refusal = termWindow(state, next);
    if (refusal) return refusal;
    Object.assign(match, next);
    return ok(match);
  });
}

/** `ClassSerializer.validate_level`: a level belongs to one live class. */
function levelTaken(classes: SchoolClass[], candidate: SchoolClass): MockResponse | undefined {
  const clash = classes.find((row) => row.id !== candidate.id && row.level === candidate.level);
  return clash
    ? validation(
        "level",
        `Level ${String(candidate.level)} is already used by class '${clash.name}'.`,
      )
    : undefined;
}

function registerClassWrites(api: MockApi, { classes, sections }: SchoolStructureState) {
  api.post("/classes", (request) => {
    const created: SchoolClass = {
      name: "",
      code: null,
      level: 0,
      is_active: true,
      ...(request.json() as Partial<SchoolClass> | null),
      id: uuid(),
    };
    const refusal = requireName(created) ?? levelTaken(classes, created);
    if (refusal) return refusal;
    classes.push(created);
    return ok(created, { status: 201 });
  });

  api.patch("/classes/:rowId", (request) => {
    const match = classes.find((row) => row.id === request.params["rowId"]);
    if (!match) return fail(404, "Not found.");
    const next = { ...match, ...(request.json() as Partial<SchoolClass> | null), id: match.id };
    const refusal = levelTaken(classes, next);
    if (refusal) return refusal;
    Object.assign(match, next);
    return ok(match);
  });

  api.delete("/classes/:rowId", (request) => {
    const rowId = request.params["rowId"];
    if (sections.some((row) => row.class_id === rowId)) return referenced(["sections"]);
    return removeRow(classes, rowId);
  });
}

/** `SectionSerializer.validate`: the class and the campus must both be active. */
function inactiveParent(
  { classes, campuses }: SchoolStructureState,
  candidate: Section,
): MockResponse | undefined {
  const parentClass = classes.find((row) => row.id === candidate.class_id);
  if (parentClass && !parentClass.is_active) {
    return validation("class_id", `Class '${parentClass.name}' is inactive.`);
  }
  const campus = campuses.find((row) => row.id === candidate.campus_id);
  if (campus && !campus.is_active) {
    return validation("campus_id", `Campus '${campus.name}' is inactive.`);
  }
  return undefined;
}

function registerSectionWrites(api: MockApi, state: SchoolStructureState) {
  const { sections } = state;

  api.post("/sections", (request) => {
    const created: Section = {
      class_id: "",
      campus_id: "",
      name: "",
      capacity: null,
      is_active: true,
      ...(request.json() as Partial<Section> | null),
      id: uuid(),
    };
    const refusal = requireName(created) ?? inactiveParent(state, created);
    if (refusal) return refusal;
    sections.push(created);
    return ok(created, { status: 201 });
  });

  api.patch("/sections/:rowId", (request) => {
    const match = sections.find((row) => row.id === request.params["rowId"]);
    if (!match) return fail(404, "Not found.");
    const next = { ...match, ...(request.json() as Partial<Section> | null), id: match.id };
    const refusal = inactiveParent(state, next);
    if (refusal) return refusal;
    Object.assign(match, next);
    return ok(match);
  });

  api.delete("/sections/:rowId", (request) => removeRow(sections, request.params["rowId"]));
}

function registerSubjectWrites(api: MockApi, { subjects }: SchoolStructureState) {
  api.post("/subjects", (request) => {
    const body = request.json() as Partial<Subject> | null;
    const refusal = requireName(body);
    if (refusal) return refusal;
    const created: Subject = {
      name: "",
      code: "",
      subject_type: "core",
      department_id: null,
      description: null,
      is_active: true,
      ...body,
      id: uuid(),
    };
    subjects.push(created);
    return ok(created, { status: 201 });
  });

  api.patch("/subjects/:rowId", (request) => {
    const match = subjects.find((row) => row.id === request.params["rowId"]);
    if (!match) return fail(404, "Not found.");
    Object.assign(match, request.json() as Partial<Subject>, { id: match.id });
    return ok(match);
  });

  api.delete("/subjects/:rowId", (request) => removeRow(subjects, request.params["rowId"]));
}

export function registerSchoolStructure(api: MockApi, state: SchoolStructureState) {
  registerSessionWrites(api, state);
  registerClassWrites(api, state);
  registerSectionWrites(api, state);
  registerSubjectWrites(api, state);
}
