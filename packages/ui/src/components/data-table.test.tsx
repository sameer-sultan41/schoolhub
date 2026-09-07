import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { UserCheck } from "lucide-react";
import { useState } from "react";
import {
  DataTable,
  type DataTableColumn,
  type DataTablePagePagination,
  type DataTableProps,
  type DataTableSort,
} from "./data-table";

interface Student {
  id: string;
  name: string;
  guardian: string;
  admissionNumber: string;
}

const students: Student[] = [
  { id: "1", name: "Ayesha", guardian: "Nadia", admissionNumber: "2024-001" },
  { id: "2", name: "Bilal", guardian: "Imran", admissionNumber: "2024-002" },
];

const columns: DataTableColumn<Student>[] = [
  { id: "name", header: "Name", sortKey: "full_name", cell: (row) => row.name },
  { id: "guardian", header: "Guardian", cell: (row) => row.guardian },
  {
    id: "admission",
    header: "Admission no.",
    numeric: "identifier",
    cell: (row) => row.admissionNumber,
  },
];

/** Pinned, and headed by nothing a reader can see — the shape every list screen uses. */
const actionsColumn: DataTableColumn<Student> = {
  id: "actions",
  header: "",
  srLabel: "Actions",
  alwaysVisible: true,
  cell: () => <button type="button">Edit</button>,
};

/**
 * Urdu, deliberately: `packages/ui` has no i18n, so every string a reader sees arrives as
 * a prop. A hardcoded English fallback anywhere in the component would show up here as an
 * English sentence this test never supplied.
 */
const emptyState = <span>Koi record nahi mila.</span>;

const searchBox = <input type="search" aria-label="Search students" />;

function renderTable(props: Partial<DataTableProps<Student>> = {}) {
  return render(
    <DataTable
      columns={columns}
      rows={students}
      getRowId={(row) => row.id}
      emptyState={emptyState}
      {...props}
    />,
  );
}

function pagesPagination(
  overrides: Partial<DataTablePagePagination> = {},
): DataTablePagePagination {
  return {
    mode: "pages",
    page: 2,
    totalPages: 8,
    onPageChange: jest.fn(),
    label: "Pagination",
    previousLabel: "Previous",
    nextLabel: "Next",
    goToPageLabel: (page) => `Go to page ${page}`,
    morePagesLabel: "More pages",
    ...overrides,
  };
}

function sortProps(overrides: Partial<DataTableSort> = {}): DataTableSort {
  return {
    activeKey: null,
    direction: "asc",
    onChange: jest.fn(),
    sortAscendingLabel: (column) => `Sort by ${column}, ascending`,
    sortDescendingLabel: (column) => `Sort by ${column}, descending`,
    ...overrides,
  };
}

/** The single card DataTable draws around everything it renders. */
function cardOf(container: HTMLElement): HTMLElement {
  const card = container.firstElementChild;
  if (!(card instanceof HTMLElement)) throw new Error("Expected DataTable to render a card.");
  return card;
}

/** The card's own sections, in the order a reader meets them. */
function sectionsOf(card: HTMLElement): HTMLElement[] {
  return Array.from(card.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
}

/** The section a given piece of the table ended up in. */
function sectionWith(card: HTMLElement, node: Element): HTMLElement {
  const section = sectionsOf(card).find((candidate) => candidate.contains(node));
  if (!section) throw new Error("Expected the node to sit in one of the card's sections.");
  return section;
}

describe("DataTable", () => {
  it("renders one row per item, keyed by getRowId", () => {
    renderTable();

    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByText("Ayesha")).toBeInTheDocument();
    expect(screen.getByText("Bilal")).toBeInTheDocument();
  });

  it("shows the caller-supplied empty state, never a hardcoded fallback, when rows is empty", () => {
    renderTable({ rows: [] });
    expect(screen.getByText("Koi record nahi mila.")).toBeInTheDocument();
  });

  it("activates a row on Enter, matching the keyboard-only requirement for the same click handler", async () => {
    const onRowClick = jest.fn();
    renderTable({ onRowClick });

    const row = screen.getByText("Ayesha").closest("tr");
    if (!row) throw new Error("Expected the row to render as a <tr>.");
    row.focus();
    await userEvent.keyboard("{Enter}");

    expect(onRowClick).toHaveBeenCalledWith(students[0]);
  });

  describe("the card it draws", () => {
    it("holds the filter row, the table and the pager in one frame, divided rather than detached", () => {
      const { container } = renderTable({ toolbar: searchBox, pagination: pagesPagination() });
      const card = cardOf(container);
      const sections = sectionsOf(card);

      const filterRow = sectionWith(
        card,
        screen.getByRole("searchbox", { name: "Search students" }),
      );
      const tableFrame = sectionWith(card, screen.getByRole("table"));
      const footer = sectionWith(card, screen.getByRole("navigation", { name: "Pagination" }));

      // A reader narrows the list and then looks at the list: filters above the header,
      // pager below the rows, the whole thing one object.
      expect(sections).toHaveLength(3);
      expect(sections.indexOf(filterRow)).toBeLessThan(sections.indexOf(tableFrame));
      expect(sections.indexOf(tableFrame)).toBeLessThan(sections.indexOf(footer));

      // One border around the lot, rules between the parts.
      expect(card.className).toContain("border-border");
      expect(filterRow.className).toContain("border-b");
      expect(footer.className).toContain("border-t");
    });

    it("keeps the border to itself, so the table inside is not boxed a second time", () => {
      renderTable({ toolbar: searchBox });

      // `Table frame="none"`: a second border 1px inside the card's own reads as a
      // mistake rather than as structure.
      const tableFrame = screen.getByRole("table").parentElement;
      if (!tableFrame) throw new Error("Expected the table to sit in a scroll container.");
      expect(tableFrame.className).not.toMatch(/\bborder\b/);
    });

    it("renders no filter row at all when there is nothing to put in one", () => {
      const { container } = renderTable();
      const card = cardOf(container);

      // A bar above the header with nothing in it is a rule dividing nothing.
      expect(sectionsOf(card)).toHaveLength(1);
      expect(sectionWith(card, screen.getByRole("table"))).toBe(card.firstElementChild);
    });

    it("renders no filter row when the toolbar slot itself renders nothing", () => {
      // What a permission gate hands over for a reader who holds none of the keys. The
      // prop was passed; there is still nothing to divide off.
      const { container } = renderTable({ toolbar: null });

      expect(sectionsOf(cardOf(container))).toHaveLength(1);
    });

    it("renders no filter row when every column is pinned", () => {
      // The menu itself already declines to offer a checkbox that cannot be unticked;
      // without this the card drew the bar around it anyway.
      const { container } = renderTable({
        columns: [actionsColumn],
        columnVisibility: {
          hidden: [],
          onChange: jest.fn(),
          triggerLabel: "Columns",
          title: "Toggle columns",
        },
      });

      expect(screen.queryByRole("button", { name: "Columns" })).not.toBeInTheDocument();
      expect(sectionsOf(cardOf(container))).toHaveLength(1);
    });

    it("keeps the pager when the page came back empty, so a stray ?page= is not a dead end", async () => {
      // An empty result is not always an empty list: page 9 of a list that just shrank
      // to 3 pages renders no rows and still has somewhere to go. Hiding the pager here
      // leaves the reader on a dead end whose only exit is the URL bar.
      const onPageChange = jest.fn();
      renderTable({
        rows: [],
        pagination: pagesPagination({ page: 9, totalPages: 3, onPageChange }),
      });

      await userEvent.click(screen.getByRole("button", { name: "Go to page 1" }));

      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it("puts the empty state under the header rather than instead of the table", () => {
      const { container } = renderTable({ rows: [], pagination: pagesPagination() });
      const card = cardOf(container);
      const sections = sectionsOf(card);

      const tableFrame = sectionWith(card, screen.getByRole("table"));
      const empty = sectionWith(card, screen.getByText("Koi record nahi mila."));

      // The column headers stay: they say what the list would have held, and the row
      // above them stays available to widen the filter that emptied it.
      expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
      expect(sections.indexOf(tableFrame)).toBeLessThan(sections.indexOf(empty));
      expect(empty.className).toContain("border-t");
    });

    it("shows a failed request between the filters and the header, and does not call it empty", () => {
      const { container } = renderTable({
        rows: [],
        toolbar: searchBox,
        error: <div role="alert">Students could not be loaded.</div>,
      });
      const card = cardOf(container);
      const sections = sectionsOf(card);

      const filterRow = sectionWith(
        card,
        screen.getByRole("searchbox", { name: "Search students" }),
      );
      const failure = sectionWith(card, screen.getByRole("alert"));
      const tableFrame = sectionWith(card, screen.getByRole("table"));

      // Inside the card, above the header: a request that failed under a narrow filter
      // can be widened without a reload.
      expect(sections.indexOf(filterRow)).toBeLessThan(sections.indexOf(failure));
      expect(sections.indexOf(failure)).toBeLessThan(sections.indexOf(tableFrame));
      // An error and an empty result are not the same thing — "no students found" here
      // would be telling the reader something untrue about their own school.
      expect(screen.queryByText("Koi record nahi mila.")).not.toBeInTheDocument();
    });
  });

  describe("sorting", () => {
    it("turns a sortable header into a control that says what pressing it will do", async () => {
      const onChange = jest.fn();
      renderTable({ sort: sortProps({ onChange }) });

      const control = screen.getByRole("button", { name: "Sort by Name, ascending" });
      // The state lives on the cell, where a screen reader meets it on the way in.
      expect(control.closest("th")).toHaveAttribute("aria-sort", "none");

      await userEvent.click(control);

      expect(onChange).toHaveBeenCalledWith("full_name", "asc");
    });

    it("flips the column that is already sorted rather than restarting it", async () => {
      const onChange = jest.fn();
      renderTable({ sort: sortProps({ activeKey: "full_name", direction: "asc", onChange }) });

      const control = screen.getByRole("button", { name: "Sort by Name, descending" });
      expect(control.closest("th")).toHaveAttribute("aria-sort", "ascending");

      await userEvent.click(control);

      expect(onChange).toHaveBeenCalledWith("full_name", "desc");
    });

    it("leaves a column the endpoint cannot order as plain text", () => {
      renderTable({ sort: sortProps() });
      const guardian = screen.getByRole("columnheader", { name: "Guardian" });

      // Sorting is server-side by necessity, so a column with no sortKey must not offer
      // an order the endpoint will ignore.
      expect(within(guardian).queryByRole("button")).not.toBeInTheDocument();
      expect(guardian).not.toHaveAttribute("aria-sort");
    });

    it("gives an icon-headed column a real sort control, named from srLabel", async () => {
      // The regression: the sr-only branch used to be reached first, so a column with
      // both an icon header and a sortKey silently rendered no control at all.
      const onChange = jest.fn();
      renderTable({
        columns: [
          ...columns,
          {
            id: "attendance",
            header: <UserCheck aria-hidden="true" />,
            srLabel: "Attendance",
            sortKey: "attendance_rate",
            cell: () => "92%",
          },
        ],
        sort: sortProps({ onChange }),
      });

      const control = screen.getByRole("button", { name: "Sort by Attendance, ascending" });
      expect(control.closest("th")).toHaveAttribute("aria-sort", "none");

      await userEvent.click(control);

      expect(onChange).toHaveBeenCalledWith("attendance_rate", "asc");
    });

    it("still announces an icon-headed column that cannot be sorted", () => {
      renderTable({ columns: [...columns, actionsColumn], sort: sortProps() });
      const actions = screen.getByRole("columnheader", { name: "Actions" });

      expect(within(actions).queryByRole("button")).not.toBeInTheDocument();
    });
  });

  describe("column visibility", () => {
    /** The hidden set belongs to the caller — it travels in the URL beside the filters. */
    function StudentsTable({ initialHidden = [] }: { initialHidden?: string[] }) {
      const [hidden, setHidden] = useState(initialHidden);

      return (
        <DataTable
          columns={[...columns, actionsColumn]}
          rows={students}
          getRowId={(row) => row.id}
          emptyState={emptyState}
          columnVisibility={{
            hidden,
            onChange: setHidden,
            triggerLabel: "Columns",
            title: "Toggle columns",
          }}
        />
      );
    }

    it("drops both the header and the cells of a column the reader unticks", async () => {
      render(<StudentsTable />);

      await userEvent.click(screen.getByRole("button", { name: "Columns" }));
      await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Guardian" }));
      // The open menu hides the rest of the page from assistive tech, so close it before
      // reading the table back.
      await userEvent.keyboard("{Escape}");

      expect(screen.queryByRole("columnheader", { name: "Guardian" })).not.toBeInTheDocument();
      expect(screen.queryByText("Nadia")).not.toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
      expect(screen.getByText("Ayesha")).toBeInTheDocument();
    });

    it("keeps a pinned column even when the hidden set names it", async () => {
      // A hand-edited URL, or a layout saved before the column was pinned. Losing the
      // actions column leaves rows a reader can see and not act on.
      render(<StudentsTable initialHidden={["actions"]} />);

      expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Columns" }));
      const menu = screen.getByRole("menu");

      expect(
        within(menu).queryByRole("menuitemcheckbox", { name: "Actions" }),
      ).not.toBeInTheDocument();
      expect(
        within(menu)
          .getAllByRole("menuitemcheckbox")
          .map((row) => row.textContent),
      ).toEqual(["Name", "Guardian", "Admission no."]);
    });

    it("offers no columns menu at all when the caller does not ask for one", () => {
      renderTable({ toolbar: searchBox });
      expect(screen.queryByRole("button", { name: "Columns" })).not.toBeInTheDocument();
    });
  });

  describe("paging", () => {
    it("marks where the reader is and moves them where they press", async () => {
      const onPageChange = jest.fn();
      renderTable({
        pagination: pagesPagination({
          page: 2,
          totalPages: 8,
          onPageChange,
          summary: <span>11 - 20 of 79</span>,
        }),
      });

      const pager = screen.getByRole("navigation", { name: "Pagination" });
      expect(within(pager).getByRole("button", { name: "Go to page 2" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(screen.getByText("11 - 20 of 79")).toBeInTheDocument();

      await userEvent.click(within(pager).getByRole("button", { name: "Go to page 4" }));

      expect(onPageChange).toHaveBeenCalledWith(4);
    });

    it("renders no pager while the count is still unknown", () => {
      // totalPages is 0 until the first response lands; a one-page pager that grows the
      // moment the count arrives reads as a glitch.
      renderTable({ pagination: pagesPagination({ page: 1, totalPages: 0 }) });

      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    });

    it("reports a new page size as a number, not as the string the select holds", async () => {
      const onChange = jest.fn();
      renderTable({
        pagination: pagesPagination({
          pageSize: { value: 25, options: [25, 50, 100], onChange, label: "Rows per page" },
        }),
      });

      await userEvent.selectOptions(screen.getByLabelText("Rows per page"), "50");

      expect(onChange).toHaveBeenCalledWith(50);
    });

    it("keeps the two arrows when the endpoint cannot count", async () => {
      const onNext = jest.fn();
      renderTable({
        pagination: {
          hasNext: true,
          hasPrevious: false,
          onNext,
          onPrevious: jest.fn(),
          nextLabel: "Next",
          previousLabel: "Previous",
          summary: <span>284 students</span>,
        },
      });

      // A cursor knows what comes next, never where it is, so there are no page numbers
      // to offer.
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

      await userEvent.click(screen.getByRole("button", { name: "Next" }));

      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it("stops both cursor arrows while a page is in flight", () => {
      renderTable({
        isLoading: true,
        pagination: {
          hasNext: true,
          hasPrevious: true,
          onNext: jest.fn(),
          onPrevious: jest.fn(),
          nextLabel: "Next",
          previousLabel: "Previous",
        },
      });

      // Pressing again while the rows are still arriving asks for a page nobody sees.
      expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    });
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = renderTable({
      columns: [...columns, actionsColumn],
      caption: "Students",
      toolbar: searchBox,
      sort: sortProps(),
      columnVisibility: {
        hidden: [],
        onChange: jest.fn(),
        triggerLabel: "Columns",
        title: "Toggle columns",
      },
      pagination: pagesPagination({
        pageSize: {
          value: 25,
          options: [25, 50, 100],
          onChange: jest.fn(),
          label: "Rows per page",
        },
        summary: <span>11 - 20 of 79</span>,
      }),
    });

    expect(await axe(container)).toHaveNoViolations();
  });
});
