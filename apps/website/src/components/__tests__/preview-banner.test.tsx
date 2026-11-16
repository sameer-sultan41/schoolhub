import { render, screen } from "@testing-library/react";
import { draftMode } from "next/headers";
import { PreviewBanner } from "../preview-banner";

jest.mock("next/headers", () => ({ draftMode: jest.fn() }));

const mockDraftMode = draftMode as jest.MockedFunction<typeof draftMode>;

function setDraft(isEnabled: boolean) {
  mockDraftMode.mockResolvedValue({ isEnabled } as Awaited<ReturnType<typeof draftMode>>);
}

describe("PreviewBanner", () => {
  it("renders nothing outside Draft Mode", async () => {
    setDraft(false);
    await expect(PreviewBanner()).resolves.toBeNull();
  });

  it("labels the preview and posts to the exit route", async () => {
    setDraft(true);
    const ui = await PreviewBanner();
    const { container } = render(ui);

    expect(screen.getByRole("status")).toHaveTextContent("Preview");
    expect(screen.getByRole("button", { name: "Exit preview" })).toBeInTheDocument();
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("action", "/api/preview/exit");
    expect(form).toHaveAttribute("method", "post");
  });
});
