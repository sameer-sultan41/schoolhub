import { render, screen } from "@testing-library/react";
import PlatformLandingPage, { metadata } from "./page";

describe("PlatformLandingPage", () => {
  it("renders a generic, non-tenant notice", () => {
    render(<PlatformLandingPage />);
    expect(screen.getByRole("heading", { name: "SchoolHub" })).toBeInTheDocument();
    expect(
      screen.getByText("No school website is configured for this address."),
    ).toBeInTheDocument();
  });

  it("is never indexed", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
