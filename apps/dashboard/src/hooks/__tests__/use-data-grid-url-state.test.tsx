import { act, renderHook } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";

import { FILTER_ALL, SEARCH_DEBOUNCE_MS } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import { setUrl } from "@/test-utils";
import {
  hideableColumnIds,
  useDataGridUrlState,
  type DataGridUrlStateOptions,
} from "../use-data-grid-url-state";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

const CAMPUS_ID = "6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7";
const STATUSES = ["active", "inactive", FILTER_ALL];

const FILTERS = {
  status: { default: "active", isValid: (value: string) => STATUSES.includes(value) },
  campus: { default: "", isValid: isUuid },
};
const DEFAULT_SORTING = [{ id: "name", desc: false }];
const NO_SORTING: { id: string; desc: boolean }[] = [];

const OPTIONS: DataGridUrlStateOptions<keyof typeof FILTERS> = {
  filters: FILTERS,
  sortableIds: ["name", "joiningDate"],
  defaultSorting: DEFAULT_SORTING,
  hideableIds: ["name", "campus"],
  trimSearch: false,
};

function renderState(overrides: Partial<typeof OPTIONS> = {}) {
  return renderHook(() => useDataGridUrlState({ ...OPTIONS, ...overrides }));
}

/** The address bar's current query, as key/value pairs. */
function urlParams() {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

function waitOutDebounce() {
  act(() => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
}

describe("useDataGridUrlState", () => {
  beforeEach(() => {
    setUrl("/list");
  });

  it("starts from the defaults on a bare URL", () => {
    const { result } = renderState();

    expect(result.current.filters).toEqual({ status: "active", campus: "" });
    expect(result.current.searchInput).toBe("");
    expect(result.current.search).toBe("");
    expect(result.current.sorting).toEqual(DEFAULT_SORTING);
    expect(result.current.pagination).toEqual({ pageIndex: 0, pageSize: 10 });
    expect(result.current.columnVisibility).toEqual({});
  });

  it("reads every key back from a URL", () => {
    const query = new URLSearchParams({
      status: "inactive",
      campus: CAMPUS_ID,
      search: "khan",
      sort: "-joiningDate",
      page: "3",
      page_size: "25",
      hidden: "campus",
    });
    setUrl(`/list?${query.toString()}`);

    const { result } = renderState();

    expect(result.current.filters).toEqual({ status: "inactive", campus: CAMPUS_ID });
    expect(result.current.searchInput).toBe("khan");
    expect(result.current.search).toBe("khan");
    expect(result.current.sorting).toEqual([{ id: "joiningDate", desc: true }]);
    expect(result.current.pagination).toEqual({ pageIndex: 2, pageSize: 25 });
    expect(result.current.columnVisibility).toEqual({ campus: false });
  });

  it("falls back to the defaults for hand-edited garbage", () => {
    setUrl("/list?page=abc&page_size=999&sort=nope&hidden=foo&campus=xyz&status=bogus");

    const { result } = renderState();

    expect(result.current.filters).toEqual({ status: "active", campus: "" });
    expect(result.current.sorting).toEqual(DEFAULT_SORTING);
    expect(result.current.pagination).toEqual({ pageIndex: 0, pageSize: 10 });
    expect(result.current.columnVisibility).toEqual({});
  });

  it.each(["0", "-2", "2.5", "07", ""])("reads page=%p as the first page", (page) => {
    setUrl(`/list?page=${page}`);

    const { result } = renderState();

    expect(result.current.pagination.pageIndex).toBe(0);
  });

  it("writes nothing on mount, so a cold load keeps its page", () => {
    setUrl("/list?page=2&search=khan");
    const replaceState = jest.spyOn(window.history, "replaceState");

    try {
      renderState();

      expect(replaceState).not.toHaveBeenCalled();
      expect(urlParams()).toEqual({ page: "2", search: "khan" });
    } finally {
      replaceState.mockRestore();
    }
  });

  describe("filters", () => {
    it("writes a filter, omits one at its default, and resets the page", () => {
      setUrl("/list?page=3&status=inactive");
      const { result } = renderState();

      act(() => {
        result.current.setFilters({ status: "active", campus: CAMPUS_ID });
      });

      expect(urlParams()).toEqual({ campus: CAMPUS_ID });
      expect(result.current.filters).toEqual({ status: "active", campus: CAMPUS_ID });
    });

    it("round-trips status=all", () => {
      const { result } = renderState();

      act(() => {
        result.current.setFilters({ status: FILTER_ALL });
      });

      expect(urlParams()).toEqual({ status: "all" });
      expect(result.current.filters.status).toBe(FILTER_ALL);
    });
  });

  describe("sorting", () => {
    it("writes a sort with a - prefix for descending, and resets the page", () => {
      setUrl("/list?page=3");
      const { result } = renderState();

      act(() => {
        result.current.onSortingChange([{ id: "joiningDate", desc: true }]);
      });

      expect(urlParams()).toEqual({ sort: "-joiningDate" });
      expect(result.current.sorting).toEqual([{ id: "joiningDate", desc: true }]);
    });

    it("writes sort=none when cleared, and omits the default sort", () => {
      const { result } = renderState();

      act(() => {
        result.current.onSortingChange(() => []);
      });

      expect(urlParams()).toEqual({ sort: "none" });
      expect(result.current.sorting).toEqual([]);

      act(() => {
        result.current.onSortingChange((current) => [...current, { id: "name", desc: false }]);
      });

      expect(urlParams()).toEqual({});
      expect(result.current.sorting).toEqual(DEFAULT_SORTING);
    });

    it("omits sort when cleared on a list whose default is unsorted", () => {
      setUrl("/list?sort=name");
      const { result } = renderState({ defaultSorting: NO_SORTING });

      act(() => {
        result.current.onSortingChange([]);
      });

      expect(urlParams()).toEqual({});
      expect(result.current.sorting).toEqual([]);
    });
  });

  describe("pagination", () => {
    it("writes the page, omitting page 1", () => {
      const { result } = renderState();

      act(() => {
        result.current.onPaginationChange((current) => ({ ...current, pageIndex: 2 }));
      });
      expect(urlParams()).toEqual({ page: "3" });

      act(() => {
        result.current.setPageIndex(4);
      });
      expect(result.current.pagination.pageIndex).toBe(4);

      act(() => {
        result.current.onPaginationChange({ pageIndex: 0, pageSize: 10 });
      });
      expect(urlParams()).toEqual({});
    });

    it("drops the page index TanStack moves alongside a page-size change", () => {
      setUrl("/list?page=3");
      const { result } = renderState();

      act(() => {
        result.current.onPaginationChange({ pageIndex: 1, pageSize: 25 });
      });
      expect(urlParams()).toEqual({ page_size: "25" });
      expect(result.current.pagination).toEqual({ pageIndex: 0, pageSize: 25 });

      act(() => {
        result.current.onPaginationChange((current) => ({ ...current, pageSize: 10 }));
      });
      expect(urlParams()).toEqual({});
    });
  });

  describe("hidden columns", () => {
    it("keeps only hideable ids, from the URL and on write", () => {
      setUrl("/list?hidden=campus,foo,actions,name");
      const { result } = renderState();

      expect(result.current.columnVisibility).toEqual({ campus: false, name: false });

      act(() => {
        result.current.onColumnVisibilityChange((current) => ({
          ...current,
          name: true,
          actions: false,
        }));
      });
      expect(urlParams()).toEqual({ hidden: "campus" });

      act(() => {
        result.current.onColumnVisibilityChange({});
      });
      expect(urlParams()).toEqual({});
    });

    it("lands a filter and a hidden column changed in the same tick", () => {
      const { result } = renderState();

      act(() => {
        result.current.setFilters({ campus: CAMPUS_ID });
        result.current.onColumnVisibilityChange({ campus: false });
      });

      expect(urlParams()).toEqual({ campus: CAMPUS_ID, hidden: "campus" });
    });

    it("derives the hideable ids from column defs", () => {
      const columns: ColumnDef<{ name: string }>[] = [
        { id: "select", enableHiding: false },
        { accessorKey: "name" },
        { id: "role", accessorFn: (row) => row.name },
        { id: "actions", enableHiding: false },
        { accessorKey: "address.city" },
        { header: "Notes" },
      ];

      // TanStack's own id rule: a dotted accessor key becomes underscored, and a column
      // with neither an id nor a key is named by its string header.
      expect(hideableColumnIds(columns)).toEqual(["name", "role", "address_city", "Notes"]);
    });
  });

  describe("search", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("writes the search once typing pauses, and resets the page", () => {
      setUrl("/list?page=3");
      const { result } = renderState();
      const replaceState = jest.spyOn(window.history, "replaceState");

      try {
        for (const text of ["k", "kh", "khan"]) {
          act(() => {
            result.current.setSearchInput(text);
          });
        }
        expect(result.current.searchInput).toBe("khan");
        expect(result.current.search).toBe("");
        expect(replaceState).not.toHaveBeenCalled();

        waitOutDebounce();

        expect(replaceState).toHaveBeenCalledTimes(1);
        expect(urlParams()).toEqual({ search: "khan" });
        expect(result.current.search).toBe("khan");
        expect(result.current.searchInput).toBe("khan");
      } finally {
        replaceState.mockRestore();
      }
    });

    it("writes and returns the text untrimmed when trimSearch is false", () => {
      const { result } = renderState();

      act(() => {
        result.current.setSearchInput("  khan ");
      });
      waitOutDebounce();

      expect(urlParams()).toEqual({ search: "  khan " });
      expect(result.current.search).toBe("  khan ");
    });

    it("writes and returns the text trimmed when trimSearch is true, without touching the box", () => {
      const { result } = renderState({ trimSearch: true });

      act(() => {
        result.current.setSearchInput("  khan ");
      });
      waitOutDebounce();

      expect(urlParams()).toEqual({ search: "khan" });
      expect(result.current.search).toBe("khan");
      expect(result.current.searchInput).toBe("  khan ");
    });

    it("deletes the key when the box is cleared", () => {
      setUrl("/list?search=khan");
      const { result } = renderState();

      act(() => {
        result.current.setSearchInput("");
      });
      waitOutDebounce();

      expect(urlParams()).toEqual({});
    });

    it("adopts an outside URL change, and never writes the stale typed value over it", () => {
      const { result } = renderState();

      act(() => {
        result.current.setSearchInput("kha");
      });
      waitOutDebounce();
      expect(urlParams()).toEqual({ search: "kha" });

      // Typed, but not yet written, when the URL changes from outside.
      act(() => {
        result.current.setSearchInput("khan");
      });
      setUrl("/list?search=other");

      expect(result.current.searchInput).toBe("other");
      expect(result.current.search).toBe("other");

      waitOutDebounce();
      expect(urlParams()).toEqual({ search: "other" });
      expect(result.current.searchInput).toBe("other");

      // A sidebar link back to the bare list clears the box too.
      setUrl("/list");
      waitOutDebounce();
      expect(result.current.searchInput).toBe("");
      expect(urlParams()).toEqual({});
    });

    it("drops a pending search when the URL changes from outside without touching search", () => {
      setUrl(`/list?campus=${CAMPUS_ID}`);
      const { result } = renderState();

      act(() => {
        result.current.setSearchInput("abc");
      });
      setUrl("/list");

      expect(result.current.searchInput).toBe("");

      waitOutDebounce();
      expect(urlParams()).toEqual({});
      expect(result.current.searchInput).toBe("");
    });
  });
});
