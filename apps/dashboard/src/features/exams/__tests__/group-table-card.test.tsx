import { render, screen } from "@testing-library/react";
import { TableCell, TableRow } from "@schoolhub/ui";

import { GroupTableCard } from "../group-table-card";

const COLUMNS = [
  { key: "subject", label: "Subject" },
  { key: "room", label: "Room" },
];

function renderCard(hasActions: boolean) {
  return render(
    <GroupTableCard title="Grade 5" columns={COLUMNS} hasActions={hasActions}>
      <TableRow>
        <TableCell>Mathematics</TableCell>
        <TableCell>Hall A</TableCell>
        {hasActions && <TableCell>Edit</TableCell>}
      </TableRow>
    </GroupTableCard>,
  );
}

describe("GroupTableCard", () => {
  it("titles the card with the group and heads the table with each column, then the rows", () => {
    renderCard(false);

    expect(screen.getByText("Grade 5")).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual(["Subject", "Room"]);
    expect(screen.getByRole("row", { name: /Mathematics/ })).toBeInTheDocument();
  });

  it("adds an empty trailing header for the row actions only when asked", () => {
    renderCard(true);

    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(3);
    expect(headers[2]).toBeEmptyDOMElement();
  });
});
