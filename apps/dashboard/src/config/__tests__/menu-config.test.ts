import type { MenuConfig } from "@schoolhub/ui";

import { filterMenuByAccess } from "@/app/(app)/shell/menu-access";
import { Paths } from "@/config/paths";
import { buildUser } from "@/test-utils";

import { MENU_SIDEBAR } from "../menu-config";

function websiteGroup(menu: MenuConfig) {
  return menu.find((item) => item.title === "Website");
}

describe("MENU_SIDEBAR's Website group", () => {
  it("shows every content section to a user who can read website content", () => {
    const group = websiteGroup(filterMenuByAccess(MENU_SIDEBAR, buildUser(["website.page.view"])));

    expect(group?.children?.map((child) => [child.title, child.path])).toEqual([
      ["Overview", Paths.WEBSITE],
      ["Pages", Paths.WEBSITE_PAGES],
      ["News", Paths.WEBSITE_NEWS],
      ["Events", Paths.WEBSITE_EVENTS],
    ]);
  });

  it("shows no Website group to a user with no website key", () => {
    const menu = filterMenuByAccess(
      MENU_SIDEBAR,
      buildUser(["communication.thread.view", "fees.invoice.view"]),
    );

    expect(websiteGroup(menu)).toBeUndefined();
  });

  it("shows no Website group while the user is still loading", () => {
    expect(websiteGroup(filterMenuByAccess(MENU_SIDEBAR, undefined))).toBeUndefined();
  });

  it("drops the group when a website key reaches no shipped section", () => {
    // A key for a section that ships later (the contact inbox) must not leave an empty group.
    const user = buildUser(["website.contact-submission.view"]);

    expect(websiteGroup(filterMenuByAccess(MENU_SIDEBAR, user))).toBeUndefined();
  });
});
