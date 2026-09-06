import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserCheck } from "lucide-react";
import { useState } from "react";
import type { DataTableColumn } from "./data-table";
import { DataTableColumnsMenu } from "./data-table-columns-menu";

interface Student {
  id: string;
  name: string;
}

/**
 * English here only because a test has to supply SOME string — the point of these being
 * props at all is that this package supplies none of its own.
 */
const labels = { triggerLabel: "Columns", title: "Toggle columns" };

const columns: DataTableColumn<Student>[] = [
  { id: "name", header: "Name", cell: (row) => row.name },
  { id: "guardian", header: "Guardian", cell: () => "Nadia" },
  // An icon header: the glyph is the entire heading, so the menu has nothing to print
  // for this column unless srLabel steps in.
  {
    id: "attendance",
    header: <UserCheck aria-hidden="true" />,
    srLabel: "Attendance",
    cell: () => "92%",
  },
  // The two a reader must never lose.
  { id: "select", header: "", srLabel: "Select", alwaysVisible: true, cell: () => null },
  { id: "actions", header: "", srLabel: "Actions", alwaysVisible: true, cell: () => null },
];

/**
 * The hidden set lives in the caller — it goes in the URL beside the filters — so the
 * menu is only ever as correct as the re-render it gets back. A stateful host is the only
 * way a second toggle can act on the result of the first.
 */
function ColumnsMenuHost({
  onChange,
  initialHidden = [],
}: {
  onChange: (hidden: string[]) => void;
  initialHidden?: string[];
}) {
  const [hidden, setHidden] = useState(initialHidden);

  return (
    <DataTableColumnsMenu
      columns={columns}
      visibility={{
        hidden,
        onChange: (next) => {
          setHidden(next);
          onChange(next);
        },
        ...labels,
      }}
    />
  );
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Columns" }));
  return screen.getByRole("menu");
}

describe("DataTableColumnsMenu", () => {
  it("offers one row per column a reader may hide, ticked while the column is showing", async () => {
    render(<ColumnsMenuHost onChange={jest.fn()} />);
    const menu = await openMenu();

    expect(within(menu).getByText("Toggle columns")).toBeInTheDocument();
    expect(
      within(menu)
        .getAllByRole("menuitemcheckbox")
        .map((row) => row.textContent),
    ).toEqual(["Name", "Guardian", "Attendance"]);
    for (const row of within(menu).getAllByRole("menuitemcheckbox")) {
      expect(row).toHaveAttribute("aria-checked", "true");
    }
  });

  it("never offers the columns a reader must not lose", async () => {
    render(<ColumnsMenuHost onChange={jest.fn()} />);
    const menu = await openMenu();

    // Hiding the selection or the actions column leaves rows that can be looked at and
    // not acted on, with the menu that hid them as the only way back.
    expect(
      within(menu).queryByRole("menuitemcheckbox", { name: "Select" }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole("menuitemcheckbox", { name: "Actions" }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing at all when every column is pinned", () => {
    const { container } = render(
      <DataTableColumnsMenu
        columns={columns.filter((column) => column.alwaysVisible)}
        visibility={{ hidden: [], onChange: jest.fn(), ...labels }}
      />,
    );

    // Not even the trigger: a menu whose every row is unavailable is a button that opens
    // an empty box.
    expect(container).toBeEmptyDOMElement();
  });

  it("hides a column when its row is unticked and brings it back when it is re-ticked", async () => {
    const onChange = jest.fn();
    render(<ColumnsMenuHost onChange={onChange} />);
    const menu = await openMenu();

    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Guardian" }));

    expect(onChange).toHaveBeenLastCalledWith(["guardian"]);
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Guardian" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Guardian" }));

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("stays open across several toggles, because choosing columns is a comparison", async () => {
    const onChange = jest.fn();
    render(<ColumnsMenuHost onChange={onChange} />);
    const menu = await openMenu();

    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Guardian" }));
    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Attendance" }));

    // Reopening the menu between each tick is the friction that stops people using the
    // feature at all — hence the preventDefault on onSelect. Both rows are still here to
    // be read, and both toggles landed.
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(
      within(menu)
        .getAllByRole("menuitemcheckbox", { checked: false })
        .map((row) => row.textContent),
    ).toEqual(["Guardian", "Attendance"]);
    expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining(["guardian", "attendance"]));
  });

  it("names an icon-headed column's row from srLabel, which would otherwise be blank", async () => {
    render(<ColumnsMenuHost onChange={jest.fn()} />);
    const menu = await openMenu();

    expect(within(menu).getByRole("menuitemcheckbox", { name: "Attendance" })).toHaveTextContent(
      "Attendance",
    );
  });
});
