import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { DataTable } from "./data-table";

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [
  { id: "1", name: "Ayesha" },
  { id: "2", name: "Bilal" },
];

const columns = [{ id: "name", header: "Name", cell: (row: Row) => row.name }];

describe("DataTable", () => {
  it("renders one row per item, keyed by getRowId", () => {
    render(
      <DataTable columns={columns} rows={rows} getRowId={(row) => row.id} emptyState="Empty" />,
    );

    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByText("Ayesha")).toBeInTheDocument();
    expect(screen.getByText("Bilal")).toBeInTheDocument();
  });

  it("shows the caller-supplied empty state, never a hardcoded fallback, when rows is empty", () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        getRowId={(row) => row.id}
        emptyState="Koi record nahi mila."
      />,
    );
    expect(screen.getByText("Koi record nahi mila.")).toBeInTheDocument();
  });

  it("activates a row on Enter, matching the keyboard-only requirement for the same click handler", async () => {
    const onRowClick = jest.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        emptyState="Empty"
        onRowClick={onRowClick}
      />,
    );

    const row = screen.getByText("Ayesha").closest("tr");
    if (!row) throw new Error("Expected the row to render as a <tr>.");
    row.focus();
    await userEvent.keyboard("{Enter}");

    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        emptyState="Empty"
        caption="People"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
