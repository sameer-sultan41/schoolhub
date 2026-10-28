import { ApiError } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { EmptyState } from "@schoolhub/ui";
import { Users } from "lucide-react";

import { CursorDataGridCard } from "@/features/attendance/cursor-data-grid-card";
import { useCursorList } from "@/features/attendance/use-cursor-list";
import { renderWithClient } from "@/test-utils";

interface Item {
  id: string;
  name: string;
}

const FILTERS = "the screen's filters";
const LOAD_ERROR = "The things couldn't be loaded.";

const columns: ColumnDef<Item>[] = [
  {
    id: "name",
    header: () => "Name",
    cell: ({ row }) => row.original.name,
    meta: { headerTitle: "Name" },
  },
];

function page(names: string[], next: string | null = null): Page<Item> {
  return {
    items: names.map((name) => ({ id: name, name })),
    pagination: { next_cursor: next, previous_cursor: null, page_size: 25 },
  };
}

const failure = () =>
  new ApiError({
    code: "validation_error",
    message: "Invalid cursor",
    status: 400,
    url: "/things",
    details: [],
  });

/** A screen built on the shared pieces: `filterKey` stands for its filters and sort. */
function Things({
  filterKey,
  fetch,
  onRowClick,
}: {
  filterKey: string;
  fetch: (cursor: string | undefined) => Promise<Page<Item>>;
  onRowClick?: (item: Item) => void;
}) {
  const list = useCursorList<Item>({
    resetKey: filterKey,
    queryKey: (cursor) => ["things", filterKey, cursor ?? ""],
    queryFn: fetch,
  });
  const table = useReactTable({
    data: list.rows,
    columns,
    manualPagination: true,
    getRowId: (item) => item.id,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <CursorDataGridCard
      list={list}
      table={table}
      caption="Things"
      paginationLabel="Thing pages"
      loadErrorMessage={LOAD_ERROR}
      filters={<p>{FILTERS}</p>}
      onRowClick={onRowClick}
      emptyState={<EmptyState icon={Users} title="No things" description="Add a thing." />}
    />
  );
}

/** Page one is Apple and Pear (`next: c2`), page two Plum. */
const twoPages = jest.fn((cursor: string | undefined) =>
  Promise.resolve(cursor === "c2" ? page(["Plum"]) : page(["Apple", "Pear"], "c2")),
);

const previous = () => screen.getByRole("button", { name: "Previous" });
const next = () => screen.getByRole("button", { name: "Next" });

describe("CursorDataGridCard with useCursorList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("pages by cursor with Previous and Next, under the screen's filters", async () => {
    const user = userEvent.setup();
    renderWithClient(<Things filterKey="a" fetch={twoPages} />);

    expect(await screen.findByText("Apple")).toBeInTheDocument();
    expect(screen.getByText(FILTERS)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Thing pages" })).toBeInTheDocument();
    expect(previous()).toBeDisabled();

    await user.click(next());
    expect(await screen.findByText("Plum")).toBeInTheDocument();
    expect(twoPages).toHaveBeenLastCalledWith("c2");
    expect(next()).toBeDisabled();

    await user.click(previous());
    expect(await screen.findByText("Apple")).toBeInTheDocument();
    expect(previous()).toBeDisabled();
  });

  it("holds both arrows while the next page loads, showing the old rows", async () => {
    const user = userEvent.setup();
    let release: (value: Page<Item>) => void = () => undefined;
    const slow = jest.fn((cursor: string | undefined) =>
      cursor === "c2"
        ? new Promise<Page<Item>>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(page(["Apple"], "c2")),
    );
    renderWithClient(<Things filterKey="a" fetch={slow} />);
    await screen.findByText("Apple");

    await user.click(next());

    // Page one's rows stay while page two loads, and neither arrow may move.
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(previous()).toBeDisabled();
    expect(next()).toBeDisabled();

    release(page(["Plum"]));
    expect(await screen.findByText("Plum")).toBeInTheDocument();
    expect(previous()).toBeEnabled();
  });

  it("starts over from page one when the screen's filters change", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithClient(<Things filterKey="a" fetch={twoPages} />);
    await screen.findByText("Apple");
    await user.click(next());
    await screen.findByText("Plum");

    rerender(<Things filterKey="b" fetch={twoPages} />);

    expect(await screen.findByText("Apple")).toBeInTheDocument();
    expect(twoPages).toHaveBeenLastCalledWith(undefined);
    expect(previous()).toBeDisabled();
  });

  it("keeps the filters on a failure, and Try again on page one reads it again", async () => {
    const user = userEvent.setup();
    const flaky = jest
      .fn<Promise<Page<Item>>, [string | undefined]>()
      .mockRejectedValueOnce(failure())
      .mockResolvedValue(page(["Apple"]));
    renderWithClient(<Things filterKey="a" fetch={flaky} />);

    const tryAgain = await screen.findByRole("button", { name: "Try again" });
    // The filters stay beside the failure, so one that caused it can be changed.
    expect(screen.getByText(FILTERS)).toBeInTheDocument();
    await user.click(tryAgain);

    expect(await screen.findByText("Apple")).toBeInTheDocument();
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(flaky).toHaveBeenLastCalledWith(undefined);
  });

  it("goes back to page one when a later page fails, rather than retrying its cursor", async () => {
    const user = userEvent.setup();
    const laterFails = jest.fn((cursor: string | undefined) =>
      cursor === "c2" ? Promise.reject(failure()) : Promise.resolve(page(["Apple"], "c2")),
    );
    renderWithClient(<Things filterKey="a" fetch={laterFails} />);
    await screen.findByText("Apple");

    await user.click(next());
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Apple")).toBeInTheDocument();
    expect(previous()).toBeDisabled();
    expect(laterFails.mock.calls.filter(([cursor]) => cursor === "c2")).toHaveLength(1);
  });

  it("says the screen's own sentence for a failure that isn't an API error", async () => {
    renderWithClient(
      <Things filterKey="a" fetch={() => Promise.reject(new Error("network down"))} />,
    );

    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument();
  });

  it("shows the screen's empty state, and hands a clicked row to the screen", async () => {
    const user = userEvent.setup();
    const onRowClick = jest.fn();
    const { rerender } = renderWithClient(
      <Things filterKey="empty" fetch={() => Promise.resolve(page([]))} />,
    );

    expect(await screen.findByText("No things")).toBeInTheDocument();

    rerender(<Things filterKey="a" fetch={twoPages} onRowClick={onRowClick} />);
    await user.click(await screen.findByText("Pear"));

    await waitFor(() => {
      expect(onRowClick).toHaveBeenCalledWith({ id: "Pear", name: "Pear" });
    });
  });
});
