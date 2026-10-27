import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

import {
  decisionActionsColumn,
  type DecisionAction,
} from "@/features/attendance/decision-actions-column";

interface Thing {
  id: string;
  name: string;
  pending: boolean;
}

const AMNA: Thing = { id: "1", name: "Amna Raza", pending: true };
const SARA: Thing = { id: "2", name: "Sara Ali", pending: false };
const HEADER = "Actions";

/** A bare table over the one column, so the test reads what a queue's grid would render. */
function Things({
  rows,
  onDecide,
}: {
  rows: Thing[];
  onDecide: (thing: Thing, action: DecisionAction) => void;
}) {
  const table = useReactTable({
    data: rows,
    columns: [
      decisionActionsColumn<Thing>({
        id: "actions",
        header: HEADER,
        canDecide: (thing) => thing.pending,
        labels: (thing) => ({ approve: `Approve ${thing.name}`, reject: `Reject ${thing.name}` }),
        onDecide,
      }),
    ],
    getRowId: (thing) => thing.id,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <table>
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <th key={header.id}>
                {flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

describe("decisionActionsColumn", () => {
  it("offers Approve and Reject, named for the row, only on a row the viewer may decide", () => {
    render(<Things rows={[AMNA, SARA]} onDecide={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Approve Amna Raza" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject Amna Raza" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sara Ali/ })).not.toBeInTheDocument();
  });

  it("hands the row and the action to onDecide", async () => {
    const onDecide = jest.fn();
    const user = userEvent.setup();
    render(<Things rows={[AMNA]} onDecide={onDecide} />);

    await user.click(screen.getByRole("button", { name: "Approve Amna Raza" }));
    expect(onDecide).toHaveBeenLastCalledWith(AMNA, "approve");

    await user.click(screen.getByRole("button", { name: "Reject Amna Raza" }));
    expect(onDecide).toHaveBeenLastCalledWith(AMNA, "reject");
    expect(onDecide).toHaveBeenCalledTimes(2);
  });

  it("labels the column for screen readers only and can't be sorted or hidden", () => {
    const column = decisionActionsColumn<Thing>({
      id: "actions",
      header: HEADER,
      canDecide: () => true,
      labels: () => ({ approve: "", reject: "" }),
      onDecide: jest.fn(),
    });
    render(<Things rows={[]} onDecide={jest.fn()} />);

    expect(screen.getByText(HEADER)).toHaveClass("sr-only");
    expect(column.enableSorting).toBe(false);
    expect(column.enableHiding).toBe(false);
  });
});
