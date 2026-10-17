import { ApiError } from "@schoolhub/api-client";
import type { Pagination } from "@schoolhub/types";
import { renderHook } from "@testing-library/react";

import { usePageClamp, type PageClampOptions } from "../use-page-clamp";

// The real class: the hook `instanceof`-checks it, and tests build `new ApiError(...)`.
jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
}));

function offsetPagination(totalPages: number): Pagination {
  return { page: 1, page_size: 10, total_count: totalPages * 10, total_pages: totalPages };
}

const CURSOR_PAGINATION: Pagination = { next_cursor: null, previous_cursor: null, page_size: 10 };

/** What DRF's page-number pagination answers for a page past the end. */
function pageNotFound() {
  return new ApiError({
    code: "not_found",
    message: "Invalid page.",
    status: 404,
    url: "/students",
  });
}

function renderClamp(overrides: Partial<PageClampOptions> = {}) {
  const setPageIndex = jest.fn();
  const options: PageClampOptions = {
    pageMeta: offsetPagination(3),
    isPlaceholderData: false,
    error: null,
    pageIndex: 0,
    setPageIndex,
    ...overrides,
  };
  const hook = renderHook((props: PageClampOptions) => usePageClamp(props), {
    initialProps: options,
  });
  return { ...hook, setPageIndex, options };
}

describe("usePageClamp", () => {
  describe("page count", () => {
    it("is the offset pagination's total_pages", () => {
      const { result } = renderClamp({ pageMeta: offsetPagination(7) });

      expect(result.current.pageCount).toBe(7);
    });

    it("is 1 with no pagination yet, and for a cursor-paginated list", () => {
      expect(renderClamp({ pageMeta: undefined }).result.current.pageCount).toBe(1);
      expect(renderClamp({ pageMeta: CURSOR_PAGINATION }).result.current.pageCount).toBe(1);
    });
  });

  describe("clamping a page past the end", () => {
    it("moves back to the last page when this page's own data says the list shrank", () => {
      const { setPageIndex } = renderClamp({ pageIndex: 5, pageMeta: offsetPagination(3) });

      expect(setPageIndex).toHaveBeenCalledTimes(1);
      expect(setPageIndex).toHaveBeenCalledWith(2);
    });

    it("moves to page 1 when the list is empty (zero pages)", () => {
      const { setPageIndex } = renderClamp({ pageIndex: 2, pageMeta: offsetPagination(0) });

      expect(setPageIndex).toHaveBeenCalledWith(0);
    });

    it("leaves a page within range alone, including the last one", () => {
      const { setPageIndex } = renderClamp({ pageIndex: 2, pageMeta: offsetPagination(3) });

      expect(setPageIndex).not.toHaveBeenCalled();
    });

    it("waits out placeholder data (the previous request's), then clamps on the real page", () => {
      const { rerender, setPageIndex, options } = renderClamp({
        pageIndex: 5,
        isPlaceholderData: true,
      });

      expect(setPageIndex).not.toHaveBeenCalled();

      rerender({ ...options, isPlaceholderData: false });

      expect(setPageIndex).toHaveBeenCalledWith(2);
    });

    it("does nothing on a cold load, before any page data exists", () => {
      const { setPageIndex } = renderClamp({ pageIndex: 5, pageMeta: undefined });

      expect(setPageIndex).not.toHaveBeenCalled();
    });
  });

  describe("a 404 for a page past the end", () => {
    it("reports the page as stale and goes back to page 1", () => {
      const { result, setPageIndex } = renderClamp({
        pageIndex: 4,
        pageMeta: undefined,
        error: pageNotFound(),
      });

      expect(result.current.isStalePage).toBe(true);
      expect(setPageIndex).toHaveBeenCalledWith(0);
    });

    it("is not stale on the first page, where a 404 is a real error", () => {
      const { result, setPageIndex } = renderClamp({
        pageIndex: 0,
        pageMeta: undefined,
        error: pageNotFound(),
      });

      expect(result.current.isStalePage).toBe(false);
      expect(setPageIndex).not.toHaveBeenCalled();
    });

    it("is not stale for any other failure", () => {
      const forbidden = new ApiError({
        code: "permission_denied",
        message: "No.",
        status: 403,
        url: "/students",
      });

      const { result, setPageIndex } = renderClamp({
        pageIndex: 4,
        pageMeta: undefined,
        error: forbidden,
      });
      const network = renderClamp({ pageIndex: 4, pageMeta: undefined, error: new Error("down") });

      expect(result.current.isStalePage).toBe(false);
      expect(setPageIndex).not.toHaveBeenCalled();
      expect(network.result.current.isStalePage).toBe(false);
      expect(network.setPageIndex).not.toHaveBeenCalled();
    });
  });
});
