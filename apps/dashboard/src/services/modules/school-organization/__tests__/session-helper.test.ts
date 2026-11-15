import { ApiError } from "@schoolhub/api-client";

import { termRecord } from "@/test-fixtures/academics";

import {
  buildSessionInput,
  buildTermInput,
  defaultTermFormValues,
  nextTermSequence,
  recordToSessionFormValues,
  recordToTermFormValues,
  sessionStatusFilter,
  sessionStructureIssues,
} from "../school-organization-helper";
import {
  sessionFormSchema,
  STRUCTURE_FORM_MESSAGE_KEYS,
  termFormSchema,
} from "../school-organization.schema";
import { sessionRecord } from "./structure-fixtures";

function refusal(details: { field: string; issue: string }[]) {
  return new ApiError({
    code: "domain_rule_violation",
    message: "unprocessable",
    status: 422,
    url: "/academic-sessions/s-1:activate",
    details,
  });
}

describe("session and term helpers", () => {
  it("maps the status filter, with all (or anything unknown) as no filter", () => {
    expect(sessionStatusFilter("planned")).toBe("planned");
    expect(sessionStatusFilter("archived")).toBe("archived");
    expect(sessionStatusFilter("all")).toBeUndefined();
    expect(sessionStatusFilter("draft")).toBeUndefined();
  });

  it("round-trips a session through the form, trimming the name", () => {
    const values = recordToSessionFormValues(sessionRecord());
    expect(values).toEqual({ name: "2026-27", start_date: "2026-04-01", end_date: "2027-03-31" });
    expect(buildSessionInput({ ...values, name: "  2026-27  " })).toEqual(values);
  });

  it("orders a new term after the session's last, and sends the order as a number", () => {
    expect(nextTermSequence([])).toBe(1);
    expect(
      nextTermSequence([termRecord({ sequence: 3 }), termRecord({ id: "t-2", sequence: 1 })]),
    ).toBe(4);
    expect(defaultTermFormValues(2)).toEqual({
      name: "",
      sequence: "2",
      start_date: "",
      end_date: "",
    });
    expect(buildTermInput(recordToTermFormValues(termRecord()))).toEqual({
      name: "Term 1",
      sequence: 1,
      start_date: "2026-04-01",
      end_date: "2026-09-30",
    });
  });

  it("reads the activation gaps from the structure details only", () => {
    expect(
      sessionStructureIssues(
        refusal([
          { field: "structure", issue: "At least one active campus is required." },
          { field: "structure", issue: "At least one term is required." },
        ]),
      ),
    ).toEqual(["At least one active campus is required.", "At least one term is required."]);
    expect(
      sessionStructureIssues(refusal([{ field: "non_field", issue: "Already active." }])),
    ).toEqual([]);
    expect(sessionStructureIssues(new Error("offline"))).toEqual([]);
    expect(sessionStructureIssues(null)).toEqual([]);
  });

  it("needs a session's end after its start, as the model does", () => {
    const sameDay = sessionFormSchema.safeParse({
      name: "2027-28",
      start_date: "2027-04-01",
      end_date: "2027-04-01",
    });
    expect(sameDay.success).toBe(false);
    expect(sameDay.error?.issues[0]).toMatchObject({
      path: ["end_date"],
      message: STRUCTURE_FORM_MESSAGE_KEYS.endNotAfterStart,
    });
  });

  it("needs a term's order to be a whole number from 1", () => {
    const term = { name: "Term 1", start_date: "2026-04-01", end_date: "2026-09-30" };
    expect(termFormSchema.safeParse({ ...term, sequence: "1" }).success).toBe(true);
    for (const sequence of ["0", "1.5", "-1", ""]) {
      expect(termFormSchema.safeParse({ ...term, sequence }).success).toBe(false);
    }
  });
});
