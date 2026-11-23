import { render, screen } from "@testing-library/react";
import { isPreviewServed } from "@/lib/preview";
import { PreviewBanner } from "../preview-banner";

jest.mock("@/lib/preview", () => ({ isPreviewServed: jest.fn() }));

const mockIsPreviewServed = isPreviewServed as jest.MockedFunction<typeof isPreviewServed>;

describe("PreviewBanner", () => {
  it("renders nothing when the page was not served as a preview (junk cookie or fallback)", () => {
    mockIsPreviewServed.mockReturnValue(false);
    expect(PreviewBanner()).toBeNull();
  });

  it("labels the preview when the page was served as one, and posts to the exit route", () => {
    mockIsPreviewServed.mockReturnValue(true);
    const { container } = render(PreviewBanner());

    expect(screen.getByRole("status")).toHaveTextContent("Preview");
    expect(screen.getByText("You are viewing unpublished content.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit preview" })).toBeInTheDocument();
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("action", "/api/preview/exit");
    expect(form).toHaveAttribute("method", "post");
  });
});
