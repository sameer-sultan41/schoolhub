import type { SiteSettings } from "@schoolhub/types";
import { render, screen } from "@testing-library/react";
import { makeTenant } from "@/test-utils";
import { Footer } from "./footer";

function makeSettings(overrides: Partial<SiteSettings> = {}): SiteSettings {
  return {
    school_name: "City School",
    navigation: { primary: [], footer: [] },
    ...overrides,
  };
}

describe("Footer", () => {
  it("renders the school name and current-year copyright", () => {
    render(<Footer tenant={makeTenant({ name: "City School" })} settings={null} />);
    const year = new Date().getFullYear().toString();
    expect(screen.getAllByText("City School").length).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(year))).toBeInTheDocument();
  });

  it("renders the tenant's published address", () => {
    render(
      <Footer tenant={makeTenant({ contact: { address: "12 School Road" } })} settings={null} />,
    );
    expect(screen.getByText("12 School Road")).toBeInTheDocument();
  });

  it("renders the footer nav only when links are configured", () => {
    const { rerender } = render(<Footer tenant={makeTenant()} settings={null} />);
    expect(screen.queryByRole("navigation", { name: "Footer" })).not.toBeInTheDocument();

    rerender(
      <Footer
        tenant={makeTenant()}
        settings={makeSettings({
          navigation: { primary: [], footer: [{ label: "Privacy", href: "/privacy" }] },
        })}
      />,
    );
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  });
});
