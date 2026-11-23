import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PermissionKey } from "@schoolhub/types";
import { toast } from "sonner";

import {
  Services,
  type ThemeRecord,
  type WebsitePageDetail,
  type WebsiteSettingsRecord,
} from "@/services";
import { websitePagePath } from "@/config/paths";
import { mocked } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { STAMP, violation } from "@/features/website/shared/__tests__/content-fixtures";
import { SiteSettings } from "../site-settings";

// The screen renders the shell toolbar, which reads the path (`usePathname`).
jest.mock("next/navigation", () =>
  jest
    .requireActual<{ createNavigationMock: () => unknown }>("@/test-utils")
    .createNavigationMock(),
);

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{
      siteServicesMock: () => unknown;
    }>("../../shared/__tests__/site-services-mock")
    .siteServicesMock(),
);

const fetchSettings = mocked(Services.websiteSettings.fetchWebsiteSettings);
const updateSettings = mocked(Services.websiteSettings.updateWebsiteSettings);
const fetchThemes = mocked(Services.themes.fetchThemes);
const fetchPage = mocked(Services.websitePages.fetchWebsitePage);

const THEME_ID = "9b4a2e5c-6f7d-4a8b-9c3d-4e5f60718293";
const HOME_ID = "6e1d9b2f-3c4a-4d5e-9f0a-1b2c3d4e5f60";

/** A theme with one required setting, as `GET /themes` sends it. */
const THEME: ThemeRecord = {
  id: THEME_ID,
  code: "default",
  name: "Default",
  version: "1.0.0",
  description: "A clean school website.",
  config_schema: {
    type: "object",
    properties: { tagline: { type: "string", maxLength: 80, "x-widget": "text" } },
    required: ["tagline"],
  },
  section_types: {},
};

const CLASSIC_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

/** A second theme whose settings share no key with the first: a required motto and an accent. */
const CLASSIC: ThemeRecord = {
  id: CLASSIC_ID,
  code: "classic",
  name: "Classic",
  version: "2.0.0",
  description: "",
  config_schema: {
    type: "object",
    properties: {
      // Required with a minimum length, as every required text in a shipped theme is: JSON
      // Schema's `required` alone accepts "", and the form mirrors the server (`schema-zod.ts`).
      motto: { type: "string", minLength: 1, maxLength: 60, "x-widget": "text" },
      accent: { type: "string", enum: ["blue", "green"] },
    },
    required: ["motto"],
  },
  section_types: {},
};

function settingsRecord(overrides: Partial<WebsiteSettingsRecord> = {}): WebsiteSettingsRecord {
  return {
    exists: true,
    theme_id: THEME_ID,
    theme_code: "default",
    theme_version: "1.0.0",
    theme_config: { tagline: "Learning together" },
    homepage_page_id: HOME_ID,
    is_published: true,
    maintenance_mode: false,
    header_config: {},
    footer_config: {},
    social_links: [],
    analytics_id: "",
    default_locale: "",
    updated_at: STAMP,
    ...overrides,
  };
}

const HOME_PAGE: WebsitePageDetail = {
  id: HOME_ID,
  title: "Welcome",
  slug: "home",
  page_type: "home",
  status: "published",
  published_at: STAMP,
  locale: "",
  show_in_search: true,
  created_at: STAMP,
  updated_at: STAMP,
  sections: [],
};

/** Every settings key a site admin holds (module doc §4). */
const ADMIN_KEYS: PermissionKey[] = ["website.page.view", "website.settings.update"];

function asUser(keys: PermissionKey[] = ADMIN_KEYS) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser(keys));
}

async function renderScreen() {
  renderWithProviders(
    <>
      <UserLoaded />
      <SiteSettings />
    </>,
  );
  await screen.findByText(USER_LOADED);
  await screen.findByDisplayValue("Learning together");
  return userEvent.setup();
}

/** Queries within the form item of the input labelled `label`: its message lands there. */
function fieldOf(label: string) {
  const item = screen.getByLabelText(label).closest<HTMLElement>("[data-slot='form-item']");
  if (!item) throw new Error(`no form item for ${label}`);
  return within(item);
}

/** The settings as the server holds them: a PATCH changes what the next GET reads. */
let current: WebsiteSettingsRecord;

beforeEach(() => {
  jest.clearAllMocks();
  setUrl("/website/settings");
  asUser();
  current = settingsRecord();
  fetchSettings.mockImplementation(() => Promise.resolve(current));
  fetchThemes.mockResolvedValue([THEME, CLASSIC]);
  fetchPage.mockResolvedValue(HOME_PAGE);
  updateSettings.mockImplementation((input) => {
    current = { ...current, ...input, exists: true };
    return Promise.resolve(current);
  });
});

describe("site settings: status", () => {
  it("asks before maintenance mode goes on, and saves only that switch once confirmed", async () => {
    const user = await renderScreen();
    const maintenance = screen.getByRole("switch", { name: "Maintenance mode" });

    await user.click(maintenance);
    let dialog = await screen.findByRole("alertdialog", { name: "Turn on maintenance mode?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(updateSettings).not.toHaveBeenCalled();
    expect(maintenance).not.toBeChecked();

    await user.click(maintenance);
    dialog = await screen.findByRole("alertdialog", { name: "Turn on maintenance mode?" });
    await user.click(within(dialog).getByRole("button", { name: "Turn on" }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({ maintenance_mode: true });
    });
    expect(toast.success).toHaveBeenCalledWith("Maintenance mode is on.");
    expect(await screen.findByText("Maintenance")).toBeVisible();
    expect(screen.getByRole("switch", { name: "Maintenance mode" })).toBeChecked();
  });

  it("reads an unpublished site as offline, whatever maintenance mode says", async () => {
    // The server's order (`hosts.py::website_status`): unpublished first, then maintenance.
    current = settingsRecord({ is_published: false, maintenance_mode: true });
    const user = await renderScreen();

    expect(screen.getByText("Offline")).toBeVisible();
    expect(screen.queryByText("Maintenance")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Maintenance mode" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Turn off maintenance mode?" });
    expect(
      within(dialog).getByText(/no visible effect while the website is unpublished/),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Turn off" }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({ maintenance_mode: false });
    });
    expect(screen.getByText("Offline")).toBeVisible();
  });

  it("asks before taking the site offline", async () => {
    const user = await renderScreen();

    await user.click(screen.getByRole("switch", { name: "Published" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Take the website offline?" });
    await user.click(within(dialog).getByRole("button", { name: "Take offline" }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({ is_published: false });
    });
    expect(toast.success).toHaveBeenCalledWith("The website is offline.");
  });

  it("keeps the confirm open with the server's refusal", async () => {
    updateSettings.mockRejectedValue(
      violation("homepage_page_id", "home_missing", "a site must keep a home page."),
    );
    const user = await renderScreen();

    await user.click(screen.getByRole("switch", { name: "Maintenance mode" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Turn on maintenance mode?" });
    await user.click(within(dialog).getByRole("button", { name: "Turn on" }));

    expect(await within(dialog).findByText("A site must keep a home page.")).toBeVisible();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("shows the home page, linking to its editor", async () => {
    await renderScreen();

    expect(await screen.findByRole("link", { name: "Welcome" })).toHaveAttribute(
      "href",
      websitePagePath(HOME_ID),
    );
  });

  it("is read-only without website.settings.update", async () => {
    asUser(["website.page.view"]);
    await renderScreen();

    expect(screen.getByRole("switch", { name: "Published" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Maintenance mode" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});

describe("site settings: form", () => {
  it("saves the theme, its settings, the social links and the analytics id", async () => {
    const user = await renderScreen();

    await user.click(screen.getByRole("button", { name: "Add a social link" }));
    await user.type(screen.getByLabelText("Platform"), "Facebook");
    await user.type(screen.getByLabelText("Link"), "https://facebook.com/gvs");
    await user.type(screen.getByLabelText("Analytics ID"), " G-123 ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({
        theme_id: THEME_ID,
        theme_config: { tagline: "Learning together" },
        social_links: [{ platform: "Facebook", url: "https://facebook.com/gvs" }],
        analytics_id: "G-123",
      });
    });
    expect(toast.success).toHaveBeenCalledWith("Site settings saved.");
  });

  it("refuses an unsafe social link before sending", async () => {
    const user = await renderScreen();

    await user.click(screen.getByRole("button", { name: "Add a social link" }));
    await user.type(screen.getByLabelText("Platform"), "Blog");
    await user.type(screen.getByLabelText("Link"), "javascript:alert(1)");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await fieldOf("Link").findByText(
        "Use an https:// link, or a path on this site starting with /.",
      ),
    ).toBeVisible();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("starts another theme's settings afresh: its required one blocks Save, and only its keys are sent", async () => {
    const user = await renderScreen();

    await user.click(screen.getByRole("combobox", { name: "Theme" }));
    await user.click(await screen.findByRole("option", { name: "Classic (2.0.0)" }));
    expect(screen.queryByLabelText("Tagline")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await fieldOf("Motto").findByText("This field is required.")).toBeVisible();
    expect(updateSettings).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Motto"), "Onward");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ theme_id: CLASSIC_ID, theme_config: { motto: "Onward" } }),
      );
    });
  });

  it("restores the saved settings when the saved theme is chosen again", async () => {
    const user = await renderScreen();

    await user.click(screen.getByRole("combobox", { name: "Theme" }));
    await user.click(await screen.findByRole("option", { name: "Classic (2.0.0)" }));
    await user.type(await screen.findByLabelText("Motto"), "Onward");
    await user.click(screen.getByRole("combobox", { name: "Theme" }));
    await user.click(await screen.findByRole("option", { name: "Default (1.0.0)" }));

    expect(await screen.findByLabelText("Tagline")).toHaveValue("Learning together");
    expect(screen.queryByLabelText("Motto")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          theme_id: THEME_ID,
          theme_config: { tagline: "Learning together" },
        }),
      );
    });
  });

  it("puts a theme setting's server error under that setting", async () => {
    updateSettings.mockRejectedValue(
      violation("theme_config.tagline", "invalid", "too long for this theme."),
    );
    const user = await renderScreen();

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await fieldOf("Tagline").findByText("Too long for this theme.")).toBeVisible();
  });

  it("before the site exists, says so, and the first save creates it", async () => {
    current = settingsRecord({ exists: false, homepage_page_id: null, is_published: false });
    const user = await renderScreen();

    expect(screen.getByText(/The website hasn't been created yet/)).toBeVisible();
    expect(screen.getByText("Created with the website.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Create the website" }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledTimes(1);
    });
    expect(toast.success).toHaveBeenCalledWith(
      "The website was created, with its standard pages as drafts.",
    );
  });
});
