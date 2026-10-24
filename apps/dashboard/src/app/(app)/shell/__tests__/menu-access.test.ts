import type { MenuConfig, MenuItem } from "@schoolhub/ui";

import { buildUser } from "@/test-utils";

import { filterMenuByAccess } from "../menu-access";

const CURRICULUM: MenuItem = {
  title: "Curriculum",
  path: "/academics/curriculum",
  permission: "academics.curriculum.view",
};
const ALLOCATIONS: MenuItem = {
  title: "Allocations",
  path: "/academics/allocations",
  permission: "academics.teacher-allocation.view",
};

const MENU: MenuConfig = [
  { heading: "School" },
  { title: "Staff", path: "/staff", module: "staff" },
  { title: "Academics", module: "academics", children: [CURRICULUM, ALLOCATIONS] },
  { title: "Demo", children: [{ title: "Leaf", path: "/demo/leaf" }] },
];

function titles(menu: MenuConfig): (string | undefined)[] {
  return menu.map((item) => item.title ?? item.heading);
}

function childTitles(menu: MenuConfig, parent: string): (string | undefined)[] {
  const item = menu.find((candidate) => candidate.title === parent);
  return titles(item?.children ?? []);
}

describe("filterMenuByAccess", () => {
  it("keeps items with neither a module nor a permission, even before the user loads", () => {
    const visible = filterMenuByAccess(MENU, undefined);

    expect(titles(visible)).toEqual(["School", "Demo"]);
    expect(childTitles(visible, "Demo")).toEqual(["Leaf"]);
  });

  it("hides a module item the user holds no key under", () => {
    const visible = filterMenuByAccess(MENU, buildUser(["fees.invoice.view"]));

    expect(titles(visible)).not.toContain("Staff");
    expect(titles(visible)).not.toContain("Academics");
  });

  it("hides a child whose own key is missing while its sibling stays", () => {
    const visible = filterMenuByAccess(MENU, buildUser(["academics.curriculum.view"]));

    expect(childTitles(visible, "Academics")).toEqual(["Curriculum"]);
  });

  it("shows every child the user holds the key for", () => {
    const user = buildUser(["academics.curriculum.view", "academics.teacher-allocation.view"]);

    expect(childTitles(filterMenuByAccess(MENU, user), "Academics")).toEqual([
      "Curriculum",
      "Allocations",
    ]);
  });

  it("hides the parent when the user holds the module's keys but none for its children", () => {
    const visible = filterMenuByAccess(MENU, buildUser(["academics.promotion.create"]));

    expect(titles(visible)).not.toContain("Academics");
  });

  it("hides a nested group whose children all drop out, at any depth", () => {
    const nested: MenuConfig = [
      { title: "Outer", children: [{ title: "Inner", children: [CURRICULUM] }] },
    ];

    expect(filterMenuByAccess(nested, buildUser(["staff.staff.view"]))).toEqual([]);

    const visible = filterMenuByAccess(nested, buildUser(["academics.curriculum.view"]));
    expect(titles(visible)).toEqual(["Outer"]);
  });

  it("does not mutate the menu it is given", () => {
    filterMenuByAccess(MENU, buildUser(["academics.curriculum.view"]));

    expect(childTitles(MENU, "Academics")).toEqual(["Curriculum", "Allocations"]);
  });

  it("keeps an item gated on a list of keys for a holder of any one of them", () => {
    const menu: MenuConfig = [
      {
        title: "Substitutions",
        path: "/timetable/substitutions",
        permission: ["timetable.substitution.create", "timetable.substitution.approve"],
      },
    ];

    expect(titles(filterMenuByAccess(menu, buildUser(["timetable.substitution.approve"])))).toEqual(
      ["Substitutions"],
    );
    expect(filterMenuByAccess(menu, buildUser(["timetable.timetable.view"]))).toEqual([]);
  });
});
