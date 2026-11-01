import { EXAM_STATUS_ORDER, EXAM_STATUSES, EXAMS_URL_FILTERS } from "../exams-constant";
import {
  buildExamInput,
  defaultExamFormValues,
  filterToValue,
  isExamConfigurable,
  isExamDeletable,
  recordToExamFormValues,
  stepState,
  toExamBody,
  toExamQueryParams,
} from "../exams-helper";
import type { ExamStatus } from "../exams-type";
import { examRecord, SESSION_ID } from "./exams-fixtures";

const ALL_STATUSES: ExamStatus[] = [
  "draft",
  "scheduled",
  "ongoing",
  "marks_entry",
  "processing",
  "approved",
  "published",
  "archived",
];

describe("exam status order", () => {
  it("places all eight generated statuses, once each, in lifecycle order", () => {
    expect(Object.keys(EXAM_STATUS_ORDER).sort()).toEqual([...ALL_STATUSES].sort());
    expect(EXAM_STATUSES).toEqual(ALL_STATUSES);
  });

  it("is configurable up to scheduled, and deletable as a draft only", () => {
    expect(ALL_STATUSES.filter(isExamConfigurable)).toEqual(["draft", "scheduled"]);
    expect(ALL_STATUSES.filter(isExamDeletable)).toEqual(["draft"]);
  });

  it("draws every status in some state for every current status", () => {
    for (const current of ALL_STATUSES) {
      const states = ALL_STATUSES.map((step) => stepState(step, current));
      expect(states.filter((state) => state === "current")).toHaveLength(1);
    }
  });

  it("shows ongoing as skipped, not done, once the exam is past it, and upcoming before", () => {
    expect(stepState("ongoing", "draft")).toBe("upcoming");
    expect(stepState("ongoing", "ongoing")).toBe("current");
    expect(stepState("ongoing", "marks_entry")).toBe("skipped");
    expect(stepState("scheduled", "marks_entry")).toBe("done");
  });

  it("treats archived as the last step: current once reached, upcoming from nowhere else after it", () => {
    expect(stepState("archived", "archived")).toBe("current");
    expect(stepState("published", "archived")).toBe("done");
    expect(ALL_STATUSES.filter((step) => stepState(step, "archived") === "upcoming")).toEqual([]);
  });
});

describe("exam filters and body", () => {
  it("takes a session or term as `all` or a uuid, a status or type from its set", () => {
    expect(EXAMS_URL_FILTERS.session.isValid("all")).toBe(true);
    expect(EXAMS_URL_FILTERS.session.isValid(SESSION_ID)).toBe(true);
    expect(EXAMS_URL_FILTERS.session.isValid("nope")).toBe(false);
    expect(EXAMS_URL_FILTERS.status.isValid("marks_entry")).toBe(true);
    expect(EXAMS_URL_FILTERS.status.isValid("done")).toBe(false);
    expect(EXAMS_URL_FILTERS.type.isValid("final")).toBe(true);
  });

  it("maps all to no filter", () => {
    expect(filterToValue("all")).toBeUndefined();
    expect(filterToValue("draft")).toBe("draft");
  });

  it("sends only the filters that are set, under the API's names", () => {
    expect(
      toExamQueryParams({ page: 2, pageSize: 10, status: "draft", academicSessionId: SESSION_ID }),
    ).toEqual({ page: 2, page_size: 10, status: "draft", academic_session_id: SESSION_ID });
  });

  it("builds the body in snake_case and leaves the scale out when none is named", () => {
    const input = buildExamInput({ ...recordToExamFormValues(examRecord()), grading_scale_id: "" });

    const body = toExamBody(input);

    expect(body).toMatchObject({
      name: "Term 1 Midterm",
      academic_session_id: SESSION_ID,
      exam_type: "midterm",
      weightage_percent: "40.00",
      starts_on: "2026-10-05",
    });
    expect(body).not.toHaveProperty("grading_scale_id");
  });

  it("clears an optional value with null, and starts a new exam on the given session", () => {
    const values = { ...defaultExamFormValues(SESSION_ID), name: " Final " };

    expect(buildExamInput(values)).toMatchObject({
      name: "Final",
      academicSessionId: SESSION_ID,
      termId: null,
      startsOn: null,
      description: null,
    });
  });
});
