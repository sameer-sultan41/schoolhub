import { render, screen } from "@testing-library/react";
import { permanentRedirect } from "next/navigation";
import { customDomainRedirectTarget, resolveTenant } from "@/lib/tenant";
import { makeTenant } from "@/test-utils";
import RootLayout from "../layout";

jest.mock("@/lib/tenant", () => ({
  resolveTenant: jest.fn(),
  customDomainRedirectTarget: jest.fn(),
}));
// The real permanentRedirect() never returns (type "never"); the mock throws the same way.
jest.mock("next/navigation", () => ({
  permanentRedirect: jest.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const mockResolveTenant = resolveTenant as jest.MockedFunction<typeof resolveTenant>;
const mockRedirectTarget = customDomainRedirectTarget as jest.MockedFunction<
  typeof customDomainRedirectTarget
>;
const mockPermanentRedirect = permanentRedirect as jest.MockedFunction<typeof permanentRedirect>;

const HOST = "cityschool.schoolhub.pk";

// React 19 treats <html> as a "singleton" host component: rendering one attaches
// attributes to the REAL document.documentElement rather than creating a nested
// element inside RTL's container div. Assert against the real document, not the
// container — a container query for "html" returns null.
describe("RootLayout", () => {
  beforeEach(() => {
    mockResolveTenant.mockReset();
    mockRedirectTarget.mockReset().mockResolvedValue(null);
    mockPermanentRedirect.mockClear();
  });

  it("defaults to English/LTR for an unknown host", async () => {
    mockResolveTenant.mockResolvedValue({ status: "unknown" });
    const ui = await RootLayout({ children: <span>content</span> });
    render(ui);

    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(mockPermanentRedirect).not.toHaveBeenCalled();
  });

  it("uses the tenant's own locale and direction", async () => {
    mockResolveTenant.mockResolvedValue({
      status: "active",
      host: HOST,
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

  it("permanently redirects a subdomain request to the school's custom domain", async () => {
    const resolution = {
      status: "active" as const,
      host: HOST,
      tenant: makeTenant({ custom_domain: "www.cityschool.edu.pk" }),
    };
    mockResolveTenant.mockResolvedValue(resolution);
    mockRedirectTarget.mockResolvedValue("https://www.cityschool.edu.pk/about");

    await expect(RootLayout({ children: <span>content</span> })).rejects.toThrow("NEXT_REDIRECT");

    // Decided after the cached tenant lookup, from that same resolution.
    expect(mockRedirectTarget).toHaveBeenCalledWith(resolution);
    expect(mockPermanentRedirect).toHaveBeenCalledWith("https://www.cityschool.edu.pk/about");
  });
});
