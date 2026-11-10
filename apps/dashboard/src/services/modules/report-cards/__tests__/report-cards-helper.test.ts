import type { PermissionKey } from "@schoolhub/types";

import {
  areRemarksEditable,
  failedRenderCount,
  isReportCardDownloadable,
  reportCardFilename,
  reportCardStatusFilter,
  toRemarksBody,
  toReportCardQueryParams,
  writableRemarkFields,
} from "../report-cards-helper";
import { reportCardRecord } from "./report-cards-fixtures";

function holding(...keys: PermissionKey[]) {
  return (key: PermissionKey) => keys.includes(key);
}

describe("report-cards-helper", () => {
  it("maps the query to params, leaving out what isn't set", () => {
    expect(toReportCardQueryParams({ examId: "e1", pageSize: 25, status: undefined })).toEqual({
      page_size: 25,
      exam_id: "e1",
    });
  });

  it("reads a URL status filter as a known status, else no filter", () => {
    expect(reportCardStatusFilter("published")).toBe("published");
    expect(reportCardStatusFilter("all")).toBeUndefined();
  });

  it("offers each remark field only to the key that writes it", () => {
    expect(writableRemarkFields(holding("exams.report-card.create"))).toEqual([
      "class_teacher_remarks",
    ]);
    expect(writableRemarkFields(holding("exams.report-card.publish"))).toEqual([
      "principal_remarks",
    ]);
    expect(
      writableRemarkFields(holding("exams.report-card.create", "exams.report-card.publish")),
    ).toEqual(["class_teacher_remarks", "principal_remarks"]);
    expect(writableRemarkFields(holding("exams.report-card.view"))).toEqual([]);
  });

  it("edits remarks until publication and downloads once a file exists", () => {
    expect(areRemarksEditable(reportCardRecord())).toBe(true);
    expect(areRemarksEditable(reportCardRecord({ status: "published" }))).toBe(false);
    expect(isReportCardDownloadable(reportCardRecord())).toBe(true);
    expect(isReportCardDownloadable(reportCardRecord({ file_id: null }))).toBe(false);
    expect(reportCardFilename(reportCardRecord({ version: 2 }))).toBe("report-card-ADM-001-v2.pdf");
  });

  it("sends only the writable fields, trimmed, a blank one cleared", () => {
    const values = { class_teacher_remarks: "  Keen.  ", principal_remarks: "Ignored" };
    expect(toRemarksBody(values, ["class_teacher_remarks"])).toEqual({
      class_teacher_remarks: "Keen.",
    });
    expect(toRemarksBody({ principal_remarks: "  " }, ["principal_remarks"])).toEqual({
      principal_remarks: null,
    });
  });

  it("counts the cards a generation job failed to render", () => {
    expect(failedRenderCount({ rendered: 1, failed: [{ student_id: "s1" }], cards: 2 })).toBe(1);
    expect(failedRenderCount({ rendered: 2, failed: [], cards: 2 })).toBe(0);
    expect(failedRenderCount(null)).toBe(0);
  });
});
