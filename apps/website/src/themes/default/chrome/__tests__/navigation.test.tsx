import { render, screen } from "@testing-library/react";
import { makeBranding, makeSite, makeTenant } from "@/test-utils";
import { Navigation } from "../navigation";

describe("Navigation", () => {
  it("shows the school's name and no menu without a site", () => {
    render(<Navigation tenant={makeTenant({ name: "City School" })} site={null} />);
    expect(screen.getByText("City School")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  });

  it("renders the header menu with its children", () => {
    render(
      <Navigation
        tenant={makeTenant()}
        site={makeSite({
          navigation: {
            header: [
              {
                label: "About",
                href: "/about",
                children: [{ label: "History", href: "/about/history" }],
              },
              { label: "Admissions", href: "/admissions", children: [] },
            ],
            footer_primary: [],
            footer_secondary: [],
          },
        })}
      />,
    );

    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("href", "/about/history");
    expect(screen.getByRole("link", { name: "Admissions" })).toHaveAttribute("href", "/admissions");
  });

  it("renders no logo when the branding has none", () => {
    const { container } = render(<Navigation tenant={makeTenant()} site={null} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the branding logo", () => {
    // The logo is decorative (alt=""), so it has ARIA role "presentation", not "img" —
    // query the DOM directly rather than by role.
    const { container } = render(
      <Navigation
        tenant={makeTenant({
          branding: makeBranding({ logo_url: "https://cdn.example.com/brand-logo.png" }),
        })}
        site={null}
      />,
    );
    expect(container.querySelector("img")).not.toBeNull();
  });
});
