import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PermissionKey } from "@schoolhub/types";
import { toast } from "sonner";

import { Services, type SeoSettingRecord } from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders, stubObjectUrls } from "@/test-utils";

import {
  FILE_ID,
  POST_ID,
  STAMP,
  violation,
} from "@/features/website/shared/__tests__/content-fixtures";
import { SeoButton } from "../seo-button";
import { SeoForm } from "../seo-form";

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

const fetchSeo = mocked(Services.seoSettings.fetchSeoSetting);
const updateSeo = mocked(Services.seoSettings.updateSeoSetting);
const uploadFile = mocked(Services.files.uploadFile);

function seoRecord(overrides: Partial<SeoSettingRecord> = {}): SeoSettingRecord {
  return {
    exists: true,
    target_type: "site",
    target_id: null,
    meta_title: "Green Valley School",
    meta_description: "",
    og_image_file_id: null,
    canonical_url: "",
    robots: "",
    structured_data: null,
    updated_at: STAMP,
    ...overrides,
  };
}

function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
    buildUser(["website.page.view", ...keys]),
  );
}

/** Queries within the form item of the input labelled `label`: its message lands there. */
function fieldOf(label: string) {
  const item = screen.getByLabelText(label).closest<HTMLElement>("[data-slot='form-item']");
  if (!item) throw new Error(`no form item for ${label}`);
  return within(item);
}

async function renderSiteForm(canUpdate = true) {
  renderWithProviders(<SeoForm target={{ targetType: "site" }} canUpdate={canUpdate} />);
  await screen.findByDisplayValue("Green Valley School");
  return userEvent.setup();
}

beforeEach(() => {
  jest.clearAllMocks();
  asUser("website.seo.update");
  fetchSeo.mockResolvedValue(seoRecord());
  updateSeo.mockImplementation((_target, input) => Promise.resolve(seoRecord({ ...input })));
});

describe("SeoForm", () => {
  it("loads the site's row and saves every field, an empty image as null", async () => {
    const user = await renderSiteForm();
    const title = screen.getByLabelText("Search title");

    await user.clear(title);
    await user.type(title, "Green Valley High");
    await user.type(screen.getByLabelText("Robots"), "noindex");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateSeo).toHaveBeenCalledWith(
        { targetType: "site" },
        {
          meta_title: "Green Valley High",
          meta_description: "",
          og_image_file_id: null,
          canonical_url: "",
          robots: "noindex",
        },
      );
    });
    expect(fetchSeo).toHaveBeenCalledWith({ targetType: "site" });
    expect(toast.success).toHaveBeenCalledWith("SEO settings saved.");
  });

  it("checks the server's bounds and the safe-link rule before sending", async () => {
    const user = await renderSiteForm();

    await user.click(screen.getByLabelText("Search title"));
    await user.paste("x".repeat(60));
    await user.type(screen.getByLabelText("Canonical link"), "javascript:alert(1)");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Keep this to 70 characters or fewer.")).toBeVisible();
    expect(
      screen.getByText("Use an https:// link, or a path on this site starting with /."),
    ).toBeVisible();
    expect(updateSeo).not.toHaveBeenCalled();
  });

  it("shows the server's refusal of the canonical link under it, in the viewer's language", async () => {
    updateSeo.mockRejectedValue(
      violation("canonical_url", "invalid_url", "must be an https URL or a relative path."),
    );
    const user = await renderSiteForm();

    await user.type(screen.getByLabelText("Canonical link"), "/about");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await fieldOf("Canonical link").findByText(
        "Use an https:// link, or a path on this site starting with /.",
      ),
    ).toBeVisible();
  });

  it("shows a refusal about the target itself as the form's message", async () => {
    updateSeo.mockRejectedValue(
      violation("target_id", "invalid_target", "this target does not exist."),
    );
    const user = await renderSiteForm();

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("This item no longer exists. Close this and reload the page."),
    ).toBeVisible();
  });

  it("saves a share image by its uploaded file id", async () => {
    const restoreUrls = stubObjectUrls("blob:share");
    uploadFile.mockResolvedValue(FILE_ID);
    const user = await renderSiteForm();

    await user.upload(
      screen.getByLabelText("Share image"),
      new File(["x"], "share.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(uploadFile).toHaveBeenCalledWith(expect.any(File), "website.media");
    await waitFor(() => {
      expect(updateSeo).toHaveBeenCalledWith(
        { targetType: "site" },
        expect.objectContaining({ og_image_file_id: FILE_ID }),
      );
    });
    // Unmount first: the image field revokes its preview URL on unmount, through the stub.
    cleanup();
    restoreUrls();
  });

  it("is read-only without the SEO key", async () => {
    await renderSiteForm(false);

    expect(screen.getByLabelText("Search title")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});

describe("SeoButton", () => {
  const target = { targetType: "news_post", targetId: POST_ID } as const;

  it("is not offered without website.seo.update", async () => {
    asUser("website.news-post.update");
    renderWithProviders(
      <>
        <UserLoaded />
        <SeoButton target={target} title="Sports day" />
      </>,
    );
    await screen.findByText(USER_LOADED);

    expect(screen.queryByRole("button", { name: "SEO" })).not.toBeInTheDocument();
  });

  it("opens the record's own SEO in a dialog, saves it and closes", async () => {
    fetchSeo.mockResolvedValue(
      seoRecord({ target_type: "news_post", target_id: POST_ID, meta_title: "" }),
    );
    renderWithProviders(<SeoButton target={target} title="Sports day" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "SEO" }));
    // The form mounts once the row is in; the dialog around it is then the form's own.
    const title = await screen.findByLabelText("Search title");
    const dialog = screen.getByRole("dialog", { name: "SEO: Sports day" });
    await user.type(title, "Sports day 2026");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateSeo).toHaveBeenCalledWith(
        target,
        expect.objectContaining({ meta_title: "Sports day 2026" }),
      );
    });
    expect(fetchSeo).toHaveBeenCalledWith(target);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
