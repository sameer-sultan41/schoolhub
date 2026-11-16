import { render, screen } from "@testing-library/react";
import { draftMode } from "next/headers";
import { getPreviewToken } from "@/lib/preview";
import { PreviewBanner } from "../preview-banner";

jest.mock("next/headers", () => ({ draftMode: jest.fn() }));
jest.mock("@/lib/preview", () => ({ getPreviewToken: jest.fn() }));

const mockDraftMode = draftMode as jest.MockedFunction<typeof draftMode>;
const mockGetPreviewToken = getPreviewToken as jest.MockedFunction<typeof getPreviewToken>;

function setDraft(isEnabled: boolean, token: string | null = null) {
  mockDraftMode.mockResolvedValue({ isEnabled } as Awaited<ReturnType<typeof draftMode>>);
  mockGetPreviewToken.mockResolvedValue(token);
}

describe("PreviewBanner", () => {
  it("renders nothing outside Draft Mode", async () => {
    setDraft(false);
    await expect(PreviewBanner()).resolves.toBeNull();
  });

  it("labels the preview while the token is held, and posts to the exit route", async () => {
    setDraft(true, "tok-1");
    const { container } = render(await PreviewBanner());

    expect(screen.getByRole("status")).toHaveTextContent("Preview");
    expect(screen.getByText("You are viewing unpublished content.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit preview" })).toBeInTheDocument();
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("action", "/api/preview/exit");
    expect(form).toHaveAttribute("method", "post");
  });

  it("keeps only the exit control once the token cookie has expired", async () => {
    setDraft(true, null);
    render(await PreviewBanner());

    expect(screen.queryByText("You are viewing unpublished content.")).toBeNull();
    expect(screen.queryByText("Preview")).toBeNull();
    expect(screen.getByRole("button", { name: "Exit preview" })).toBeInTheDocument();
  });
});
