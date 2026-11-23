import { render, screen } from "@testing-library/react";
import { getPreviewToken } from "@/lib/preview";
import { PreviewBanner } from "../preview-banner";

jest.mock("@/lib/preview", () => ({ getPreviewToken: jest.fn() }));

const mockGetPreviewToken = getPreviewToken as jest.MockedFunction<typeof getPreviewToken>;

describe("PreviewBanner", () => {
  it("renders nothing without a preview cookie", async () => {
    mockGetPreviewToken.mockResolvedValue(null);
    await expect(PreviewBanner()).resolves.toBeNull();
  });

  it("labels the preview while the cookie is held, and posts to the exit route", async () => {
    mockGetPreviewToken.mockResolvedValue("tok-1");
    const { container } = render(await PreviewBanner());

    expect(screen.getByRole("status")).toHaveTextContent("Preview");
    expect(screen.getByText("You are viewing unpublished content.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit preview" })).toBeInTheDocument();
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("action", "/api/preview/exit");
    expect(form).toHaveAttribute("method", "post");
  });
});
