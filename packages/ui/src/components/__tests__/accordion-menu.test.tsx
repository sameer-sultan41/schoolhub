import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AccordionMenu,
  AccordionMenuGroup,
  AccordionMenuItem,
  AccordionMenuSub,
  AccordionMenuSubContent,
  AccordionMenuSubTrigger,
} from "../accordion-menu";

describe("AccordionMenu", () => {
  it("renders no menu/group/presentation roles — this is a nav tree, not an ARIA menu widget", () => {
    render(
      <nav aria-label="Primary">
        <AccordionMenu type="single" collapsible matchPath={() => false}>
          <AccordionMenuGroup>
            <AccordionMenuItem value="dashboard" asChild>
              <a href="/dashboard">Dashboard</a>
            </AccordionMenuItem>
          </AccordionMenuGroup>
        </AccordionMenu>
      </nav>,
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("renders a single real link for an asChild leaf item — no nested interactive elements", () => {
    render(
      <AccordionMenu type="single" collapsible matchPath={() => false}>
        <AccordionMenuGroup>
          <AccordionMenuItem value="dashboard" asChild>
            <a href="/dashboard">Dashboard</a>
          </AccordionMenuItem>
        </AccordionMenuGroup>
      </AccordionMenu>,
    );
    const link = screen.getByRole("link", { name: "Dashboard" });
    expect(link).toHaveAttribute("href", "/dashboard");
    // No button wraps it — the anchor itself is the whole trigger element.
    expect(link.closest("button")).toBeNull();
  });

  it("does not preventDefault on an asChild link click, so real navigation is not swallowed", async () => {
    const user = userEvent.setup();
    const onClick = jest.fn((e: React.MouseEvent) => {
      expect(e.defaultPrevented).toBe(false);
    });
    render(
      <AccordionMenu type="single" collapsible matchPath={() => false}>
        <AccordionMenuGroup>
          <AccordionMenuItem value="dashboard" asChild>
            <a href="/dashboard" onClick={onClick}>
              Dashboard
            </a>
          </AccordionMenuItem>
        </AccordionMenuGroup>
      </AccordionMenu>,
    );
    await user.click(screen.getByRole("link", { name: "Dashboard" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("expands a submenu on trigger click and keeps items keyboard-reachable", async () => {
    const user = userEvent.setup();
    render(
      <AccordionMenu type="single" collapsible matchPath={() => false}>
        <AccordionMenuGroup>
          <AccordionMenuSub value="people">
            <AccordionMenuSubTrigger>People</AccordionMenuSubTrigger>
            <AccordionMenuSubContent type="single" collapsible parentValue="people">
              <AccordionMenuItem value="students" asChild>
                <a href="/students">Students</a>
              </AccordionMenuItem>
            </AccordionMenuSubContent>
          </AccordionMenuSub>
        </AccordionMenuGroup>
      </AccordionMenu>,
    );
    expect(screen.queryByRole("link", { name: "Students" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "People" }));
    expect(screen.getByRole("link", { name: "Students" })).toBeInTheDocument();
  });

  it("auto-expands the ancestor chain for the active path via matchPath", () => {
    render(
      <AccordionMenu type="single" collapsible matchPath={(href) => href === "students"}>
        <AccordionMenuGroup>
          <AccordionMenuSub value="people">
            <AccordionMenuSubTrigger>People</AccordionMenuSubTrigger>
            <AccordionMenuSubContent type="single" collapsible parentValue="people">
              <AccordionMenuItem value="students" asChild>
                <a href="/students">Students</a>
              </AccordionMenuItem>
            </AccordionMenuSubContent>
          </AccordionMenuSub>
        </AccordionMenuGroup>
      </AccordionMenu>,
    );
    expect(screen.getByRole("link", { name: "Students" })).toBeInTheDocument();
  });

  it("renders a planned/disabled item as aria-disabled and tab-reachable, not removed from the tab order", () => {
    render(
      <AccordionMenu type="single" collapsible matchPath={() => false}>
        <AccordionMenuGroup>
          <AccordionMenuItem
            value="admissions"
            aria-disabled="true"
            aria-describedby="nav-planned-admissions"
            title="Admissions is coming soon"
          >
            Admissions
          </AccordionMenuItem>
        </AccordionMenuGroup>
      </AccordionMenu>,
    );
    const item = screen.getByRole("button", { name: "Admissions" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAttribute("aria-describedby", "nav-planned-admissions");
    expect(item).not.toBeDisabled();
  });
});
