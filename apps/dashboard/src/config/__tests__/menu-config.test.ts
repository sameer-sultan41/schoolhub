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

  it("shows it_admin every section its seeded keys open", () => {
    // `it_admin`: `PAGE_READERS`, `SITE_ADMINS` and `DOMAIN_ADMINS` (`website_cms/permissions.py`).
    const user = buildUser([
      "website.page.view",
      "website.navigation.update",
      "website.settings.update",
      "website.seo.update",
      "website.custom-domain.create",
      "website.custom-domain.update",
      "website.custom-domain.delete",
    ]);
    const group = websiteGroup(filterMenuByAccess(MENU_SIDEBAR, user));

    expect(group?.children?.map((child) => [child.title, child.path])).toEqual([
      ["Overview", Paths.WEBSITE],
      ["Pages", Paths.WEBSITE_PAGES],
      ["News", Paths.WEBSITE_NEWS],
      ["Events", Paths.WEBSITE_EVENTS],
      ["Gallery", Paths.WEBSITE_GALLERY],
      ["Navigation", Paths.WEBSITE_NAVIGATION],
      ["Settings", Paths.WEBSITE_SETTINGS],
      ["SEO", Paths.WEBSITE_SEO],
      ["Domains", Paths.WEBSITE_DOMAINS],
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

  it("shows a reception user only the contact inbox", () => {
    // `reception` holds only the inbox keys (`website_cms/permissions.py`: `INBOX_STAFF`).
    const user = buildUser([
      "website.contact-submission.view",
      "website.contact-submission.update",
    ]);
    const group = websiteGroup(filterMenuByAccess(MENU_SIDEBAR, user));

    expect(group?.children?.map((child) => [child.title, child.path])).toEqual([
      ["Contact inbox", Paths.WEBSITE_INBOX],
    ]);
  });

  it("shows a school owner only Domains", () => {
    // `school_owner` holds only the domain keys (`DOMAIN_ADMINS`); §4 has no view key for them.
    const user = buildUser([
      "website.custom-domain.create",
      "website.custom-domain.update",
      "website.custom-domain.delete",
    ]);
    const group = websiteGroup(filterMenuByAccess(MENU_SIDEBAR, user));

    expect(group?.children?.map((child) => [child.title, child.path])).toEqual([
      ["Domains", Paths.WEBSITE_DOMAINS],
    ]);
  });

  it("opens Domains with either key the list reads under, and not with delete alone", () => {
    const withUpdate = buildUser(["website.custom-domain.update"]);
    const deleteOnly = buildUser(["website.custom-domain.delete"]);

    expect(
      websiteGroup(filterMenuByAccess(MENU_SIDEBAR, withUpdate))?.children?.map(
        (child) => child.title,
      ),
    ).toEqual(["Domains"]);
    expect(websiteGroup(filterMenuByAccess(MENU_SIDEBAR, deleteOnly))).toBeUndefined();
  });
});
