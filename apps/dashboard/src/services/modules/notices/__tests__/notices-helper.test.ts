import type { NoticeRecord, PortalNoticeRecord } from "../notices-type";
import { isPortalNotice } from "../notices-helper";

const portal: PortalNoticeRecord = {
  id: "n1",
  notice_no: "N-1",
  title: "Sports day",
  body: "Friday",
  notice_type: "event",
  published_at: "2026-11-01T08:00:00Z",
  requires_acknowledgment: false,
  acknowledged_at: null,
};

describe("isPortalNotice", () => {
  it("is true for the portal shape, which has no status", () => {
    expect(isPortalNotice(portal)).toBe(true);
  });

  it("is false for the staff shape, which carries status", () => {
    const staff = { ...portal, status: "published" } as unknown as NoticeRecord;
    expect(isPortalNotice(staff)).toBe(false);
  });
});
