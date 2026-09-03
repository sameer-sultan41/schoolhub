import type { SiteSettings } from "@schoolhub/types";
import { render, screen } from "@testing-library/react";
import { makeTenant } from "@/test-utils";
import { Navigation } from "./navigation";

function makeSettings(overrides: Partial<SiteSettings> = {}): SiteSettings {
  return {
    school_name: "City School Settings Name",
    navigation: { primary: [], footer: [] },
    ...overrides,
  };
}

describe("Navigation", () => {
  it("falls back to the tenant name when there are no settings", () => {
    render(<Navigation tenant={makeTenant({ name: "City School" })} settings={null} />);
    expect(screen.getByText("City School")).toBeInTheDocument();
  });

  it("prefers the CMS-configured school name over the tenant record", () => {
    render(<Navigation tenant={makeTenant({ name: "City School" })} settings={makeSettings()} />);
    expect(screen.getByText("City School Settings Name")).toBeInTheDocument();
  });

  it("renders the configured primary nav links", () => {
    render(
      <Navigation
        tenant={makeTenant()}
        settings={makeSettings({
          navigation: {
            primary: [
              { label: "About", href: "/about" },
              { label: "Admissions", href: "/admissions" },
            ],
            footer: [],
          },
        })}
      />,
    );

    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(screen.getByRole("link", { name: "Admissions" })).toHaveAttribute("href", "/admissions");
  });

  it("renders no logo when neither settings nor branding supply one", () => {
    const { container } = render(<Navigation tenant={makeTenant()} settings={null} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the CMS-configured logo when one is set", () => {
    // The logo is decorative (alt=""), so it has ARIA role "presentation", not "img" —
    // query the DOM directly rather than by role.
    const { container } = render(
      <Navigation
        tenant={makeTenant()}
        settings={makeSettings({ logo_url: "https://cdn.example.com/logo.png" })}
      />,
    );
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("falls back to the tenant's branding logo when settings has none", () => {
    const { container } = render(
      <Navigation
        tenant={makeTenant({ branding: { logo_url: "https://cdn.example.com/brand-logo.png" } })}
        settings={null}
      />,
    );
    expect(container.querySelector("img")).not.toBeNull();
  });
});
