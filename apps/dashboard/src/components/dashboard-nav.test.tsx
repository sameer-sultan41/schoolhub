import { SidebarProvider } from "@schoolhub/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LayoutDashboard, Users } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { DashboardNav } from "./dashboard-nav";
import type { NavGroup } from "@/lib/nav-items";

const messages = {
  nav: {
    primary: "Primary navigation",
    groups: { overview: "Overview", people: "People" },
    dashboard: "Dashboard",
    staff: "Staff",
    admissions: "Admissions",
    planned: "Soon",
    plannedHint: "{module} is coming soon",
  },
};

const groups: NavGroup[] = [
  {
    key: "overview",
    items: [
      { key: "dashboard", href: "/dashboard", module: "", icon: LayoutDashboard, status: "ready" },
    ],
  },
  {
    key: "people",
    items: [
      { key: "staff", href: "/staff", module: "staff", icon: Users, status: "ready" },
      {
        key: "admissions",
        href: "/admissions",
        module: "admissions",
        icon: Users,
        status: "planned",
      },
    ],
  },
];

function renderNav(pathname: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SidebarProvider>
        <DashboardNav groups={groups} pathname={pathname} />
      </SidebarProvider>
    </NextIntlClientProvider>,
  );
}

describe("DashboardNav", () => {
  it("renders exactly one navigation landmark for every group combined", () => {
    renderNav("/dashboard");
    expect(screen.getAllByRole("navigation", { name: "Primary navigation" })).toHaveLength(1);
  });

  it("marks the active link with aria-current and no others", () => {
    renderNav("/staff");
    expect(screen.getByRole("link", { name: "Staff" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("matches active state for a nested path, not just an exact match", () => {
    renderNav("/staff/123");
    expect(screen.getByRole("link", { name: "Staff" })).toHaveAttribute("aria-current", "page");
  });

  it("renders a planned item as a disabled, tab-reachable, badge-described control — not a link", () => {
    renderNav("/dashboard");
    const item = screen.getByRole("button", { name: "Admissions" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).not.toBeDisabled();
    const describedBy = item.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent("Soon");
    expect(screen.queryByRole("link", { name: "Admissions" })).not.toBeInTheDocument();
  });

  it("closes the mobile drawer on navigation without throwing", async () => {
    const user = userEvent.setup();
    renderNav("/dashboard");
    // Real e2e coverage of the drawer-close behavior lives in
    // e2e/tests/dashboard/layout.spec.ts's "mobile navigation drawer" spec; this only
    // confirms the click handler runs cleanly against a real SidebarProvider.
    await user.click(screen.getByRole("link", { name: "Dashboard" }));
  });
});
