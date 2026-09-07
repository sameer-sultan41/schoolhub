import { act, renderHook } from "@testing-library/react";
import { ALL_FILTER_VALUE } from "@/components/filter-bar";
import { useTableParams } from "@/hooks/use-table-params";

/**
 * The router has to ROUND-TRIP, not swallow the write.
 *
 * This hook's whole purpose is that table state lives in the URL, so a `replace` that
 * stored nothing would let every assertion below pass against a hook that never changed
 * anything. `replace` parses the query string it is handed and `useSearchParams` hands it
 * back, which is what makes "and then the next render sees it" a real claim.
 */
let mockSearchParams = new URLSearchParams();
const mockReplace = jest.fn((url: string) => {
  mockSearchParams = new URLSearchParams(url.split("?")[1] ?? "");
});
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => mockSearchParams,
}));

type Filter = "status" | "campus_id";
const FILTERS: readonly Filter[] = ["status", "campus_id"];

function setUrl(search: string) {
  mockSearchParams = new URLSearchParams(search);
}

interface Overrides {
  pageSize?: number;
  sortLabels?: { ascending: (column: string) => string; descending: (column: string) => string };
}

function renderTableParams({ pageSize = 25, sortLabels }: Overrides = {}) {
  return renderHook(() =>
    useTableParams<Filter>({ filterKeys: FILTERS, searchable: true, pageSize, sortLabels }),
  );
}

beforeEach(() => {
  mockReplace.mockClear();
  setUrl("");
});

describe("useTableParams: the request it assembles", () => {
  it("sends the page size and nothing else for an untouched list", () => {
    const { result } = renderTableParams();

    // No empty filters, no `ordering`, and no `page=1` — an unfiltered list should ask
    // for exactly what an unfiltered list is.
    expect(result.current.query).toEqual({ page_size: 25 });
  });

  it("carries only the filters that are actually set", () => {
    setUrl("status=active");
    const { result } = renderTableParams();

    expect(result.current.query).toEqual({ status: "active", page_size: 25 });
  });

  it("folds sort_by and sort_type into the single `ordering` DRF expects", () => {
    setUrl("sort_by=last_name&sort_type=desc");
    const { result } = renderTableParams();

    expect(result.current.query.ordering).toBe("-last_name");
  });

  it("omits page=1, because the first page of a list is the list", () => {
    setUrl("page=1");
    const { result } = renderTableParams();

    expect(result.current.query.page).toBeUndefined();
  });

  it("sends a page beyond the first", () => {
    setUrl("page=3");
    const { result } = renderTableParams();

    expect(result.current.query.page).toBe(3);
  });

  it("keeps a filter value carrying & and = in one piece", () => {
    // The regression this exists for: the filter values used to be flattened by joining
    // `key=value` with `&` and split back apart on those same two characters, so a value
    // containing either tore into the wrong keys. `setText` writes arbitrary strings.
    setUrl(`status=${encodeURIComponent("a&b=c")}`);
    const { result } = renderTableParams();

    expect(result.current.query.status).toBe("a&b=c");
  });
});

describe("useTableParams: reading state back", () => {
  it("reports an unset filter as the sentinel a Select can render", () => {
    const { result } = renderTableParams();

    expect(result.current.filter("status")).toBe(ALL_FILTER_VALUE);
  });

  it("reports an unset free-text filter as empty, not as the sentinel", () => {
    // A date input handed "__all__" would render it as the date.
    const { result } = renderTableParams();

    expect(result.current.text("status")).toBe("");
  });

  it("falls back to the caller's page size, and to page one", () => {
    const { result } = renderTableParams({ pageSize: 50 });

    expect(result.current.pageSize).toBe(50);
    expect(result.current.page).toBe(1);
  });

  it("refuses a page below one rather than asking the server for it", () => {
    setUrl("page=-4");
    const { result } = renderTableParams();

    expect(result.current.page).toBe(1);
  });

  it("splits the hidden column list, and reports none as an empty list", () => {
    setUrl("hidden=email,department");
    const { result } = renderTableParams();

    expect(result.current.hiddenColumns).toEqual(["email", "department"]);

    setUrl("");
    const { result: none } = renderTableParams();
    expect(none.current.hiddenColumns).toEqual([]);
  });
});

describe("useTableParams: what resets the page", () => {
  /** Every writer that changes WHICH rows are in the list must drop the page. */
  type Rendered = ReturnType<typeof renderTableParams>["result"];
  const narrowing: [string, (table: Rendered) => void][] = [
    [
      "a filter",
      (r) => {
        r.current.setFilter("status", "active");
      },
    ],
    [
      "a free-text filter",
      (r) => {
        r.current.setText("campus_id", "2026-01-01");
      },
    ],
    [
      "the search box",
      (r) => {
        r.current.setSearch("khan");
      },
    ],
    [
      "the sort",
      (r) => {
        r.current.sort?.onChange("last_name", "asc");
      },
    ],
    [
      "the page size",
      (r) => {
        r.current.setPageSize(50);
      },
    ],
    [
      "clearing",
      (r) => {
        r.current.clear();
      },
    ],
  ];

  for (const [label, write] of narrowing) {
    it(`sends the reader back to page 1 when ${label} changes`, () => {
      setUrl("page=9");
      const { result } = renderTableParams({
        sortLabels: { ascending: (c) => `asc ${c}`, descending: (c) => `desc ${c}` },
      });

      act(() => {
        write(result);
      });

      // Staying on page 9 of a list that just shrank to 3 pages shows an empty table.
      expect(mockSearchParams.get("page")).toBeNull();
    });
  }

  it("does NOT reset the page when only the hidden columns change", () => {
    // Hiding a column changes what the reader sees of a row, never which rows there are.
    setUrl("page=9");
    const { result } = renderTableParams();

    act(() => {
      result.current.setHiddenColumns(["email"]);
    });

    expect(mockSearchParams.get("page")).toBe("9");
    expect(mockSearchParams.get("hidden")).toBe("email");
  });
});

describe("useTableParams: writing", () => {
  it("removes a filter rather than sending the sentinel when it goes back to all", () => {
    setUrl("status=active");
    const { result } = renderTableParams();

    act(() => {
      result.current.setFilter("status", ALL_FILTER_VALUE);
    });

    // `{}` and `{status: "__all__"}` have to be the same cache key, and the sentinel is
    // not a value the API knows.
    expect(mockSearchParams.get("status")).toBeNull();
  });

  it("writes page 1 as the absence of the key", () => {
    setUrl("page=4");
    const { result } = renderTableParams();

    act(() => {
      result.current.setPage(1);
    });

    expect(mockSearchParams.get("page")).toBeNull();
  });

  it("drops the hidden list entirely once every column is showing again", () => {
    setUrl("hidden=email");
    const { result } = renderTableParams();

    act(() => {
      result.current.setHiddenColumns([]);
    });

    expect(mockSearchParams.get("hidden")).toBeNull();
  });

  it("clears the sort along with the filters, but keeps the page size", () => {
    setUrl("status=active&search=khan&sort_by=last_name&sort_type=desc&page_size=50");
    const { result } = renderTableParams();

    act(() => {
      result.current.clear();
    });

    // "Clear filters" on a list someone has also reordered means the whole view. Page
    // size survives: it is a preference about how they read, not a filter.
    expect(mockSearchParams.get("status")).toBeNull();
    expect(mockSearchParams.get("search")).toBeNull();
    expect(mockSearchParams.get("sort_by")).toBeNull();
    expect(mockSearchParams.get("sort_type")).toBeNull();
    expect(mockSearchParams.get("page_size")).toBe("50");
  });
});

describe("useTableParams: the sort control it hands DataTable", () => {
  it("hands back nothing at all when the caller supplies no labels", () => {
    // Supplying them is what turns sorting on: a list whose endpoint declares no useful
    // ordering_fields omits them and gets no control.
    const { result } = renderTableParams();

    expect(result.current.sort).toBeUndefined();
  });

  it("returns a finished control, labels included, rather than parts to assemble", () => {
    setUrl("sort_by=last_name&sort_type=desc");
    const { result } = renderTableParams({
      sortLabels: { ascending: (c) => `Sort by ${c}, A to Z`, descending: (c) => `Sort by ${c}` },
    });

    // Assembling this at the call sites is how the first version shipped a spread that
    // dropped both labels: every table rendered, then threw on the first header click.
    expect(result.current.sort).toMatchObject({ activeKey: "last_name", direction: "desc" });
    expect(result.current.sort?.sortAscendingLabel("Name")).toBe("Sort by Name, A to Z");
    expect(result.current.sort?.sortDescendingLabel("Name")).toBe("Sort by Name");
  });

  it("treats anything but `desc` as ascending rather than passing it on", () => {
    setUrl("sort_by=last_name&sort_type=sideways");
    const { result } = renderTableParams({
      sortLabels: { ascending: (c) => c, descending: (c) => c },
    });

    expect(result.current.sort?.direction).toBe("asc");
    expect(result.current.query.ordering).toBe("last_name");
  });
});
