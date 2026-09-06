import messages from "../../messages/en.json";
import { NAV_ITEMS } from "@/lib/nav-items";
import { PALETTE_QUICK_ACTIONS, QUICK_ACTIONS, type QuickActionKey } from "@/lib/quick-actions";

function action(key: QuickActionKey) {
  const found = QUICK_ACTIONS.find((entry) => entry.key === key);
  if (!found) throw new Error(`no quick action named ${key}`);
  return found;
}

function navIcon(key: string) {
  return NAV_ITEMS.find((item) => item.key === key)?.icon;
}

describe("QUICK_ACTIONS", () => {
  it("has a unique key and href per entry", () => {
    expect(new Set(QUICK_ACTIONS.map((entry) => entry.key)).size).toBe(QUICK_ACTIONS.length);
    expect(new Set(QUICK_ACTIONS.map((entry) => entry.href)).size).toBe(QUICK_ACTIONS.length);
  });

  it("gives every entry an icon", () => {
    // Both surfaces render `action.icon` unconditionally; an entry without one is a
    // crash, not a missing decoration.
    for (const entry of QUICK_ACTIONS) {
      expect(entry.icon).toBeDefined();
    }
  });

  it("marks each subject with the icon the sidebar already uses for it", () => {
    // The regression this exists for: the palette and the panel each kept a copy of this
    // list and drifted, to the point where `GraduationCap` — students, everywhere else in
    // the app — was the mark on "New staff member" in one of them.
    expect(action("newStudent").icon).toBe(navIcon("students"));
    expect(action("newStaff").icon).toBe(navIcon("staff"));
    expect(action("newStudent").icon).not.toBe(action("newStaff").icon);
  });

  it("names a permission that finishes the action, not one that only opens the screen", () => {
    expect(action("newStudent").permission).toBe("students.student.create");
    expect(action("newStaff").permission).toBe("staff.staff.create");
    expect(action("importStudents").permission).toBe("students.student.import");
    expect(action("buildTimetable").permission).toBe("timetable.slot.create");
    expect(action("reviewPromotions").permission).toBe("academics.promotion.view");
  });

  it("has a panel label for every entry", () => {
    const labels: Record<string, string> = messages.dashboard.actions;
    for (const entry of QUICK_ACTIONS) {
      expect(labels[entry.key]).toBeDefined();
    }
  });
});

describe("PALETTE_QUICK_ACTIONS", () => {
  it("offers the same entries the panel does, not copies of them", () => {
    for (const entry of PALETTE_QUICK_ACTIONS) {
      expect(QUICK_ACTIONS).toContain(entry);
    }
  });

  it("carries a palette label for every entry it offers", () => {
    // The subset is an i18n fact: `nav.command.action` names three of the five, and a
    // fourth row would render its raw message key into the dialog.
    const labels: Record<string, string> = messages.nav.command.action;
    for (const entry of PALETTE_QUICK_ACTIONS) {
      expect(labels[entry.key]).toBeDefined();
    }
    expect(PALETTE_QUICK_ACTIONS).toHaveLength(Object.keys(labels).length);
  });
});
