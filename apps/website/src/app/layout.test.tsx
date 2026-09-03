import { render, screen } from "@testing-library/react";
import { resolveTenant } from "@/lib/tenant";
import { makeTenant } from "@/test-utils";
import RootLayout from "./layout";

jest.mock("@/lib/tenant", () => ({ resolveTenant: jest.fn() }));

const mockResolveTenant = resolveTenant as jest.MockedFunction<typeof resolveTenant>;

// React 19 treats <html> as a "singleton" host component: rendering one attaches
// attributes to the REAL document.documentElement rather than creating a nested
// element inside RTL's container div. Assert against the real document, not the
// container — a container query for "html" returns null.
describe("RootLayout", () => {
  beforeEach(() => mockResolveTenant.mockReset());

  it("defaults to English/LTR for an unknown host", async () => {
    mockResolveTenant.mockResolvedValue({ status: "unknown" });
    const ui = await RootLayout({ children: <span>content</span> });
    render(ui);

    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("uses the tenant's own locale and direction", async () => {
    mockResolveTenant.mockResolvedValue({
      status: "active",
      tenant: makeTenant({
        locale: {
          default_locale: "ur",
          enabled_locales: ["ur"],
          timezone: "Asia/Karachi",
          direction: "rtl",
        },
      }),
    });

    const ui = await RootLayout({ children: <span>content</span> });
    render(ui);

    expect(document.documentElement).toHaveAttribute("lang", "ur");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
  });
});
