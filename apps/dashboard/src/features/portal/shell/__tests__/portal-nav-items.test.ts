import { ALL_MODULES_ON, AYESHA_ID, BILAL_ID } from "@/test-fixtures/portal";

import { portalNavItems, switchChildPath } from "../portal-nav-items";

const labels = (items: ReturnType<typeof portalNavItems>) => items.map((item) => item.labelKey);

describe("portalNavItems", () => {
  it("offers every tab when every module is on", () => {
    expect(labels(portalNavItems(ALL_MODULES_ON, AYESHA_ID))).toEqual([
      "overview",
      "attendance",
      "fees",
      "results",
      "timetable",
      "messages",
      "notices",
      "notifications",
      "settings",
    ]);
  });

  it("drops a module's tab when its flag is off, keeping the inbox and settings", () => {
    const modules = {
      attendance: false,
      fees: false,
      examinations: false,
      communication: false,
      timetable: false,
    };

    expect(labels(portalNavItems(modules, AYESHA_ID))).toEqual([
      "overview",
      "notifications",
      "settings",
    ]);
  });

  it("offers only the child-free tabs when there is no child", () => {
    expect(labels(portalNavItems(ALL_MODULES_ON, undefined))).toEqual([
      "messages",
      "notices",
      "notifications",
      "settings",
    ]);
  });

  it("links a child's tabs under their own id", () => {
    const fees = portalNavItems(ALL_MODULES_ON, AYESHA_ID).find((item) => item.labelKey === "fees");

    expect(fees?.href).toBe(`/portal/${AYESHA_ID}/fees`);
  });
});

describe("switchChildPath", () => {
  it("keeps the section when moving between children", () => {
    expect(switchChildPath(`/portal/${AYESHA_ID}/fees`, AYESHA_ID, BILAL_ID)).toBe(
      `/portal/${BILAL_ID}/fees`,
    );
  });

  it("opens the child's overview from a page that is not one child's", () => {
    expect(switchChildPath("/portal/notices", AYESHA_ID, BILAL_ID)).toBe(`/portal/${BILAL_ID}`);
    expect(switchChildPath("/portal", undefined, BILAL_ID)).toBe(`/portal/${BILAL_ID}`);
  });
});
