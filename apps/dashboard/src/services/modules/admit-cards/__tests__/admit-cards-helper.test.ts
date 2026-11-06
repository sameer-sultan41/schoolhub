import {
  admitCardFilename,
  isCardDownloadable,
  isCardRevoked,
  isExamIssuable,
  renderedCount,
  sectionsOfSittings,
  statusFilterToStatus,
  toAdmitCardQueryParams,
} from "../admit-cards-helper";
import { createRevokeFormSchema } from "../admit-cards.schema";
import { sittingRecord } from "@/services/modules/exam-schedules/__tests__/exam-schedules-fixtures";
import { admitCardRecord, OTHER_SECTION_ID, SECTION_ID } from "./admit-cards-fixtures";

describe("toAdmitCardQueryParams", () => {
  it("maps each key to the API's own and leaves out what is unset", () => {
    expect(
      toAdmitCardQueryParams({
        examId: "e1",
        pageSize: 25,
        ordering: "admit_card_no",
        sectionId: SECTION_ID,
        status: "revoked",
        cursor: undefined,
      }),
    ).toEqual({
      page_size: 25,
      exam_id: "e1",
      ordering: "admit_card_no",
      section_id: SECTION_ID,
      status: "revoked",
    });
    expect(toAdmitCardQueryParams({ examId: "e1", sectionId: "" })).toEqual({
      page_size: undefined,
      exam_id: "e1",
    });
  });
});

describe("renderedCount", () => {
  it("reads the render job's own count of PDFs written", () => {
    expect(renderedCount({ rendered: 4, failed: [], cards: 4 })).toBe(4);
  });

  it("is null for a result without one", () => {
    expect(renderedCount(null)).toBeNull();
    expect(renderedCount({ rendered: "4" })).toBeNull();
  });
});

describe("card rules", () => {
  it("issues cards on any exam past draft, since they print the published schedule", () => {
    expect(isExamIssuable("draft")).toBe(false);
    expect(isExamIssuable("scheduled")).toBe(true);
    expect(isExamIssuable("marks_entry")).toBe(true);
  });

  it("offers a download only for a rendered card that is not revoked", () => {
    expect(isCardDownloadable(admitCardRecord())).toBe(true);
    expect(isCardDownloadable(admitCardRecord({ file_id: null, status: "generated" }))).toBe(false);
    expect(isCardDownloadable(admitCardRecord({ status: "revoked", revoked_reason: "Fees" }))).toBe(
      false,
    );
  });

  it("knows a revoked card", () => {
    expect(isCardRevoked(admitCardRecord({ status: "revoked" }))).toBe(true);
    expect(isCardRevoked(admitCardRecord())).toBe(false);
  });

  it("names the file after the card number", () => {
    expect(admitCardFilename(admitCardRecord())).toBe("admit-card-1A2B3C4D-ADM-001.pdf");
  });
});

describe("the revoke form schema", () => {
  const schema = createRevokeFormSchema({ required: "Required", tooLong: "Too long" });

  it("needs a reason that isn't only spaces", () => {
    expect(schema.safeParse({ reason: "   " }).error?.issues[0]?.message).toBe("Required");
    expect(schema.safeParse({ reason: "Fees outstanding" }).success).toBe(true);
  });

  it("caps the reason at the server's length", () => {
    expect(schema.safeParse({ reason: "x".repeat(256) }).error?.issues[0]?.message).toBe(
      "Too long",
    );
  });
});

describe("statusFilterToStatus", () => {
  it("passes a known status and drops all or anything else", () => {
    expect(statusFilterToStatus("revoked")).toBe("revoked");
    expect(statusFilterToStatus("all")).toBeUndefined();
    expect(statusFilterToStatus("lost")).toBeUndefined();
  });
});

describe("sectionsOfSittings", () => {
  it("lists each section the sittings name once, by class then section", () => {
    const sections = sectionsOfSittings([
      sittingRecord({ id: "a", section_id: OTHER_SECTION_ID, section_name: "B" }),
      sittingRecord({ id: "b", section_id: SECTION_ID, section_name: "A" }),
      sittingRecord({
        id: "c",
        section_id: SECTION_ID,
        section_name: "A",
        subject_name: "English",
      }),
    ]);

    expect(sections).toEqual([
      { id: SECTION_ID, className: "Grade 5", sectionName: "A" },
      { id: OTHER_SECTION_ID, className: "Grade 5", sectionName: "B" },
    ]);
  });
});
