import {
  isProcessor,
  mayWithholdResult,
  processedCount,
  resultOutcomeFilter,
  resultStatusFilter,
  toResultQueryParams,
} from "../exam-results-helper";
import { CURRENT_USER_ID, OTHER_USER_ID, resultRecord } from "./exam-results-fixtures";

describe("exam-results-helper", () => {
  it("maps the query to params, leaving out what isn't set", () => {
    expect(toResultQueryParams({ examId: "e1", pageSize: 25, sectionId: "" })).toEqual({
      page_size: 25,
      exam_id: "e1",
    });
  });

  it("reads a URL filter as a known status or outcome, else no filter", () => {
    expect(resultStatusFilter("approved")).toBe("approved");
    expect(resultStatusFilter("all")).toBeUndefined();
    expect(resultOutcomeFilter("withheld")).toBe("withheld");
    expect(resultOutcomeFilter("bogus")).toBeUndefined();
  });

  it("withholds only a result neither published nor already withheld", () => {
    expect(mayWithholdResult(resultRecord())).toBe(true);
    expect(mayWithholdResult(resultRecord({ status: "published" }))).toBe(false);
    expect(mayWithholdResult(resultRecord({ outcome: "withheld" }))).toBe(false);
  });

  it("names the latest processor, and nobody before the user or a result is known", () => {
    expect(isProcessor(OTHER_USER_ID, resultRecord())).toBe(true);
    expect(isProcessor(CURRENT_USER_ID, resultRecord())).toBe(false);
    expect(isProcessor(undefined, resultRecord())).toBe(false);
    expect(isProcessor(OTHER_USER_ID, undefined)).toBe(false);
  });

  it("reads the processing job's student count", () => {
    expect(processedCount({ created: 3, updated: 0, students: 3 })).toBe(3);
    expect(processedCount(null)).toBeNull();
  });
});
