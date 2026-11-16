import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { ApiError } from "@schoolhub/api-client";
import { renderWithProviders, stubObjectUrls } from "@/test-utils";

import { PageEditor } from "../page-editor";
import {
  asUser,
  deletePage,
  FAQ_ID,
  fetchCurrentUser,
  fetchPage,
  HERO_ID,
  IMAGE_ID,
  PAGE_ID,
  PAGE_KEYS,
  pageDetail,
  previewPage,
  publishPage,
  refusal,
  replaceSections,
  sectionRecord,
  stubPagesServices,
  uploadFile,
} from "./pages-test-support";

jest.mock("next/navigation", () =>
  jest
    .requireActual<{ createNavigationMock: () => unknown }>("@/test-utils")
    .createNavigationMock(),
);

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock("@/services", () =>
  jest
    .requireActual<{ pagesServicesMock: () => unknown }>("./pages-services-mock")
    .pagesServicesMock(),
);

const HERO = { id: HERO_ID, section_type: "hero", is_visible: true };
const FAQ = { id: FAQ_ID, section_type: "faq", is_visible: true };

async function renderEditor() {
  renderWithProviders(<PageEditor pageId={PAGE_ID} />);
  await screen.findByRole("heading", { name: "Admissions 2027" });
  return userEvent.setup();
}

/** The list's rows, by their accessible names, in order. */
function sectionRows() {
  const list = screen.getByRole("list", { name: "Sections" });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("aria-label"));
}

describe("page editor", () => {
  beforeEach(() => {
    stubPagesServices(`/website/pages/${PAGE_ID}`);
    asUser(...PAGE_KEYS);
  });

  it("shows the sections in order and edits the first through its theme schema", async () => {
    await renderEditor();

    expect(sectionRows()).toEqual(["Section 1: Hero", "Section 2: FAQ"]);
    expect(screen.getByText("/admissions-2027 · Standard page")).toBeInTheDocument();
    expect(screen.getByLabelText("Heading")).toHaveValue("Welcome");
    expect(screen.getByRole("button", { name: "1. Hero" })).toHaveAttribute("aria-pressed", "true");
  });

  it("sends the new order when a section is moved", async () => {
    replaceSections.mockResolvedValue([
      sectionRecord({ id: FAQ_ID, section_type: "faq", position: 0, content: {} }),
      sectionRecord({ position: 1 }),
    ]);
    const user = await renderEditor();

    await user.click(screen.getByRole("button", { name: "Move section 1 down" }));
    expect(sectionRows()).toEqual(["Section 1: FAQ", "Section 2: Hero"]);
    await user.click(screen.getByRole("button", { name: "Save sections" }));

    await waitFor(() => {
      expect(replaceSections).toHaveBeenCalledWith(PAGE_ID, [
        expect.objectContaining(FAQ),
        expect.objectContaining({ ...HERO, content: { heading: "Welcome" } }),
      ]);
    });
    expect(toast.success).toHaveBeenCalledWith("Sections saved.");
  });

  it("adds a section from the theme's catalogue and sends it without an id", async () => {
    replaceSections.mockResolvedValue([]);
    const user = await renderEditor();

    await user.click(screen.getByRole("button", { name: "Add section" }));
    await user.click(await screen.findByRole("menuitem", { name: "News" }));
    expect(sectionRows()).toEqual(["Section 1: Hero", "Section 2: FAQ", "Section 3: News"]);
    expect(screen.getByRole("button", { name: "3. News" })).toHaveAttribute("aria-pressed", "true");
    await user.type(screen.getByLabelText("How many to show"), "3");
    await user.click(screen.getByRole("button", { name: "Save sections" }));

    await waitFor(() => {
      expect(replaceSections).toHaveBeenCalled();
    });
    const sent = replaceSections.mock.calls[0]?.[1] ?? [];
    expect(sent[2]).toEqual({ section_type: "news_list", is_visible: true, content: { limit: 3 } });
  });

  it("holds the save, and selects the section, when a section fails its schema", async () => {
    const user = await renderEditor();

    await user.clear(screen.getByLabelText("Heading"));
    await user.click(screen.getByRole("button", { name: "2. FAQ" }));
    await user.click(screen.getByRole("button", { name: "Save sections" }));

    expect(
      await screen.findByText("Some sections need attention; they are marked in the list."),
    ).toBeInTheDocument();
    expect(replaceSections).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^1\. Hero/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Heading")).toHaveAccessibleDescription("This field is required.");
  });

  it("puts a 422 under the input its JSON path names, and shows the page's own error", async () => {
    replaceSections.mockRejectedValue(
      refusal([
        { field: "sections.1.items.0.answer", issue: "'' is too short" },
        { field: "file_id", issue: "This file is not available." },
      ]),
    );
    const user = await renderEditor();

    await user.click(screen.getByRole("button", { name: "Save sections" }));

    expect(await screen.findByText("This file is not available.")).toBeInTheDocument();
    // The FAQ is selected and flagged; its first answer carries the server's message.
    const faq = screen.getByRole("button", { name: /^2\. FAQ/ });
    expect(faq).toHaveAttribute("aria-pressed", "true");
    expect(within(faq).getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByLabelText("Answer")).toHaveAccessibleDescription("'' is too short");
  });

  it("keeps the edited section while its image uploads, so the upload is saved", async () => {
    const restoreUrls = stubObjectUrls("blob:hero");
    let finish: (id: string) => void = () => undefined;
    uploadFile.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    replaceSections.mockResolvedValue([]);
    const user = await renderEditor();

    await user.upload(
      screen.getByLabelText("Image"),
      new File(["x"], "hero.png", { type: "image/png" }),
    );
    // Leaving the hero now would unmount its image field and drop the upload.
    const faq = screen.getByRole("button", { name: "2. FAQ" });
    expect(faq).toBeDisabled();
    await user.click(faq);
    expect(screen.getByRole("button", { name: "1. Hero" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Save sections" })).toBeDisabled();

    finish(IMAGE_ID);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "2. FAQ" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "Save sections" }));

    await waitFor(() => {
      expect(replaceSections).toHaveBeenCalled();
    });
    expect(replaceSections.mock.calls[0]?.[1][0]).toEqual(
      expect.objectContaining({ content: { heading: "Welcome", image_file_id: IMAGE_ID } }),
    );
    restoreUrls();
  });

  it("puts a 422 for a moved section on that section's input", async () => {
    replaceSections.mockRejectedValue(
      refusal([{ field: "sections.0.items.0.answer", issue: "'' is too short" }]),
    );
    const user = await renderEditor();

    await user.click(screen.getByRole("button", { name: "Move section 2 up" }));
    await user.click(screen.getByRole("button", { name: "Save sections" }));

    const faq = await screen.findByRole("button", { name: /^1\. FAQ/ });
    expect(faq).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByLabelText("Answer")).toHaveAccessibleDescription("'' is too short");
  });

  it("enables Publish from the saved sections as soon as they are saved", async () => {
    // The refetch the save starts never answers: only the cache the save seeds can move Publish.
    fetchPage
      .mockResolvedValueOnce(pageDetail({ sections: [sectionRecord({ is_visible: false })] }))
      .mockReturnValue(new Promise(() => undefined));
    replaceSections.mockResolvedValue([sectionRecord({ is_visible: true })]);
    const user = await renderEditor();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();

    await user.click(screen.getByRole("switch", { name: "Show this section on the page" }));
    expect(screen.getByText("Preview shows the last saved version.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save sections" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
    });
    expect(screen.queryByText("Preview shows the last saved version.")).not.toBeInTheDocument();
  });

  it("offers a retry when the viewer can't be loaded", async () => {
    fetchCurrentUser.mockRejectedValue(
      new ApiError({ code: "server_error", message: "Down.", status: 500, url: "/auth/me" }),
    );
    renderWithProviders(<PageEditor pageId={PAGE_ID} />);

    expect(
      await screen.findByText("Your permissions couldn't be loaded.", { exact: false }),
    ).toBeInTheDocument();
  });

  it("shows a refusal about a whole section on that section, and selects it", async () => {
    replaceSections.mockRejectedValue(
      refusal([{ field: "sections.0.section_type", issue: "Unknown section type 'video'." }]),
    );
    const user = await renderEditor();

    await user.click(screen.getByRole("button", { name: "2. FAQ" }));
    await user.click(screen.getByRole("button", { name: "Save sections" }));

    expect(await screen.findByText("Unknown section type 'video'.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^1\. Hero/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("holds Publish on a page with no visible section, and says why", async () => {
    fetchPage.mockResolvedValue(pageDetail({ sections: [sectionRecord({ is_visible: false })] }));
    await renderEditor();

    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(
      screen.getByText("Add a visible section and save it before publishing."),
    ).toBeInTheDocument();
    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("holds Publish while the sections have unsaved changes", async () => {
    const user = await renderEditor();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();

    await user.click(screen.getByRole("switch", { name: "Show this section on the page" }));

    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByText("Save your changes before publishing.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
    expect(publishPage).not.toHaveBeenCalled();
  });

  it("shows a refused delete's reason, translated", async () => {
    deletePage.mockRejectedValue(
      refusal([
        {
          field: "page",
          issue:
            "page_in_use: this page cannot be removed because it is linked from the footer menu.",
        },
      ]),
    );
    const user = await renderEditor();

    await user.click(screen.getByRole("button", { name: "Delete page" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete page" }));

    expect(
      await within(dialog).findByText(
        "This page can't be removed: it is the home page, or a menu links to it. Take it out of the menus first.",
      ),
    ).toBeInTheDocument();
  });

  it("opens the returned preview URL in a new tab cut off from this one", async () => {
    const url = "https://greenfield.schoolhub.test/api/preview?token=signed";
    previewPage.mockResolvedValue({ url, expires_in: 600 });
    const tab = { opener: window as unknown, location: { replace: jest.fn() }, close: jest.fn() };
    const open = jest.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const user = await renderEditor();

    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(tab.location.replace).toHaveBeenCalledWith(url);
    });
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    expect(previewPage).toHaveBeenCalledWith(PAGE_ID);
    open.mockRestore();
  });

  it("asks for pop-ups to be allowed when the browser gives no tab, and asks the API nothing", async () => {
    const open = jest.spyOn(window, "open").mockReturnValue(null);
    const user = await renderEditor();

    await user.click(screen.getByRole("button", { name: "Preview" }));

    expect(toast.error).toHaveBeenCalledWith(
      "Your browser blocked the preview tab. Allow pop-ups for this site, then try again.",
    );
    expect(previewPage).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("closes the blank tab and shows the reason when the preview is refused", async () => {
    previewPage.mockRejectedValue(refusal([{ field: "non_field", issue: "Not available." }]));
    const tab = { opener: null, location: { replace: jest.fn() }, close: jest.fn() };
    const open = jest.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const user = await renderEditor();

    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(tab.close).toHaveBeenCalled();
    });
    expect(toast.error).toHaveBeenCalledWith("Not available.");
    expect(tab.location.replace).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("is read-only for a viewer without the update key", async () => {
    asUser();
    await renderEditor();

    expect(
      screen.getByText("You can view this page's sections but not change them."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save sections" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add section" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move section 1 down" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Heading")).toBeDisabled();
  });

  it("says so when the page doesn't exist", async () => {
    fetchPage.mockRejectedValue(
      new ApiError({ code: "not_found", message: "Not found.", status: 404, url: "/x" }),
    );
    renderWithProviders(<PageEditor pageId={PAGE_ID} />);

    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });
});
