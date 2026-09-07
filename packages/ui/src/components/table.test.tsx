import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

/**
 * The scroll container `Table` wraps every table in. The frame — or the deliberate
 * absence of one — lives here rather than on the `<table>`, so `frame` has to be read
 * off the wrapper and not off the element the role queries return.
 */
function frameOf(table: HTMLElement): HTMLElement {
  const wrapper = table.parentElement;
  if (!wrapper) throw new Error("Expected Table to wrap its <table> in a scroll container.");
  return wrapper;
}

function renderTable(frame?: "bordered" | "none") {
  return render(
    <Table frame={frame}>
      <TableCaption>Rooms</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Room</TableHead>
          <TableHead>Capacity</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Lab 1</TableCell>
          <TableCell>32</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
}

describe("Table", () => {
  it("frames itself by default, because a standalone table is its own object on the page", () => {
    const { unmount } = renderTable();
    const byDefault = frameOf(screen.getByRole("table")).className;
    unmount();

    renderTable("bordered");

    expect(frameOf(screen.getByRole("table")).className).toBe(byDefault);
    expect(byDefault).toContain("border-border");
    // The radius is the tenant's, never a literal — a rebrand re-rounds this too.
    expect(byDefault).toContain("rounded-[var(--sh-radius)]");
  });

  it("drops the frame when the caller already draws one, so nothing is boxed twice", () => {
    renderTable("none");

    // DataTable's card draws its border 1px outside this element; a second border there
    // reads as a mistake rather than as structure.
    const frame = frameOf(screen.getByRole("table")).className;
    expect(frame).not.toMatch(/\bborder\b/);
    expect(frame).not.toMatch(/\brounded-/);
  });

  it("keeps the horizontal scroll container either way — the frame is the only difference", () => {
    const { unmount } = renderTable("bordered");
    const bordered = frameOf(screen.getByRole("table")).className;
    unmount();

    renderTable("none");
    const unframed = frameOf(screen.getByRole("table")).className;

    // A wide table still has to be reachable inside a card, so losing the frame must not
    // cost the reader the ability to scroll to the last column.
    for (const className of [bordered, unframed]) {
      expect(className).toContain("overflow-x-auto");
      expect(className).toContain("w-full");
    }
  });

  it("puts the caller's className on the table itself, not on the frame around it", () => {
    render(
      <Table className="text-xs">
        <TableBody>
          <TableRow>
            <TableCell>Lab 1</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const table = screen.getByRole("table");

    expect(table.className).toContain("text-xs");
    expect(frameOf(table).className).not.toContain("text-xs");
  });

  it("names the table from its caption", () => {
    renderTable();
    expect(screen.getByRole("table", { name: "Rooms" })).toBeInTheDocument();
  });

  it("marks a header cell as its column's header and ranges it to the start, not the left", () => {
    renderTable();
    const header = screen.getByRole("columnheader", { name: "Room" });

    expect(header).toHaveAttribute("scope", "col");
    // Logical, so the header mirrors under Urdu with no second rule to remember.
    expect(header.className).toContain("text-start");
    expect(header.className).not.toMatch(/\btext-(?:left|right)\b/);
  });

  it("has no detectable accessibility violations in either frame", async () => {
    const bordered = renderTable("bordered");
    expect(await axe(bordered.container)).toHaveNoViolations();
    bordered.unmount();

    const unframed = renderTable("none");
    expect(await axe(unframed.container)).toHaveNoViolations();
  });
});
