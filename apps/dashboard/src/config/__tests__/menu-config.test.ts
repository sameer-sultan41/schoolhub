import type { MenuConfig } from "@schoolhub/ui";

import { filterMenuByAccess } from "@/app/(app)/shell/menu-access";
import { Paths } from "@/config/paths";
import { buildUser } from "@/test-utils";

import { MENU_SIDEBAR } from "../menu-config";

function websiteGroup(menu: MenuConfig) {
  return menu.find((item) => item.title === "Website");
}

describe("MENU_SIDEBAR's Website group", () => {
  it("shows every content section, and no site section, to a content reader", () => {
    const group = websiteGroup(filterMenuByAccess(MENU_SIDEBAR, buildUser(["website.page.view"])));

    expect(group?.children?.map((child) => [child.title, child.path])).toEqual([
      ["Overview", Paths.WEBSITE],
      ["Pages", Paths.WEBSITE_PAGES],
      ["News", Paths.WEBSITE_NEWS],
      ["Events", Paths.WEBSITE_EVENTS],
      ["Gallery", Paths.WEBSITE_GALLERY],
    ]);
  });

  it("shows a site admin's sections, each on its own key, to an it_admin-like user", () => {
    // Settings, navigation and SEO only: no `website.page.view`, so no content section.
    const user = buildUser([
      "website.settings.update",
      "website.navigation.update",
      "website.seo.update",
    ]);
    const group = websiteGroup(filterMenuByAccess(MENU_SIDEBAR, user));

    expect(group?.children?.map((child) => [child.title, child.path])).toEqual([
      ["Navigation", Paths.WEBSITE_NAVIGATION],
      ["Settings", Paths.WEBSITE_SETTINGS],
      ["SEO", Paths.WEBSITE_SEO],
    ]);
  });

  it("shows only the section a single site key opens", () => {
    const group = websiteGroup(filterMenuByAccess(MENU_SIDEBAR, buildUser(["website.seo.update"])));

    expect(group?.children?.map((child) => child.title)).toEqual(["SEO"]);
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
