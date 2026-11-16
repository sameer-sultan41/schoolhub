import { render, screen } from "@testing-library/react";
import { makeContact, makeSite, makeTenant } from "@/test-utils";
import { Footer } from "../footer";

const LINK = (label: string, href: string) => ({ label, href, children: [] });

describe("Footer", () => {
  it("renders the school name and current-year copyright", () => {
    render(<Footer tenant={makeTenant({ name: "City School" })} site={null} />);
    const year = new Date().getFullYear().toString();
    expect(screen.getAllByText("City School").length).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(year))).toBeInTheDocument();
  });

  it("renders the school's published address", () => {
    render(
      <Footer
        tenant={makeTenant({ contact: makeContact({ address: "12 School Road" }) })}
        site={null}
      />,
    );
    expect(screen.getByText("12 School Road")).toBeInTheDocument();
  });

  it("renders the footer menus only when links are configured", () => {
    const { rerender } = render(<Footer tenant={makeTenant()} site={makeSite()} />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();

    rerender(
      <Footer
        tenant={makeTenant()}
        site={makeSite({
          navigation: {
            header: [],
            footer_primary: [LINK("Contact", "/contact")],
            footer_secondary: [LINK("Privacy", "/privacy")],
          },
        })}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Footer" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/contact");
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  });

  it("renders social links in a new tab without an opener", () => {
    render(
      <Footer
        tenant={makeTenant()}
        site={makeSite({
          social_links: [{ platform: "facebook", url: "https://facebook.com/cityschool" }],
        })}
      />,
    );
    const link = screen.getByRole("link", { name: "facebook" });
    expect(link).toHaveAttribute("href", "https://facebook.com/cityschool");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
