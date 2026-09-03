import { act, renderHook } from "@testing-library/react";
import { useCursorPager } from "@/features/students/use-cursor-pager";

describe("useCursorPager", () => {
  it("starts with no cursor and hasPrevious false", () => {
    const { result } = renderHook(() => useCursorPager());
    expect(result.current.cursor).toBeNull();
    expect(result.current.hasPrevious).toBe(false);
  });

  it("onNext advances the cursor and pushes the stack", () => {
    const { result } = renderHook(() => useCursorPager());

    act(() => {
      result.current.onNext({ next_cursor: "page-2", previous_cursor: null, page_size: 25 });
    });

    expect(result.current.cursor).toBe("page-2");
    expect(result.current.hasPrevious).toBe(true);
  });

  it("onNext does nothing when pagination itself is undefined", () => {
    const { result } = renderHook(() => useCursorPager());

    act(() => {
      result.current.onNext(undefined);
    });

    expect(result.current.cursor).toBeNull();
    expect(result.current.hasPrevious).toBe(false);
  });

  it("onNext does nothing when there is no next_cursor", () => {
    const { result } = renderHook(() => useCursorPager());

    act(() => {
      result.current.onNext({ next_cursor: null, previous_cursor: null, page_size: 25 });
    });

    expect(result.current.cursor).toBeNull();
    expect(result.current.hasPrevious).toBe(false);
  });

  it("onPrevious pops back to the prior cursor", () => {
    const { result } = renderHook(() => useCursorPager());

    act(() => {
      result.current.onNext({ next_cursor: "page-2", previous_cursor: null, page_size: 25 });
    });
    act(() => {
      result.current.onNext({ next_cursor: "page-3", previous_cursor: null, page_size: 25 });
    });
    expect(result.current.cursor).toBe("page-3");

    act(() => {
      result.current.onPrevious();
    });
    expect(result.current.cursor).toBe("page-2");
    expect(result.current.hasPrevious).toBe(true);

    act(() => {
      result.current.onPrevious();
    });
    expect(result.current.cursor).toBeNull();
    expect(result.current.hasPrevious).toBe(false);
  });

  it("onPrevious at depth 0 is a no-op", () => {
    const { result } = renderHook(() => useCursorPager());

    act(() => {
      result.current.onPrevious();
    });

    expect(result.current.cursor).toBeNull();
    expect(result.current.hasPrevious).toBe(false);
  });

  it("syncFilterKey resets the cursor and stack when the filter set changes", () => {
    const { result } = renderHook(() => useCursorPager());

    act(() => {
      result.current.syncFilterKey("filters-a");
    });
    act(() => {
      result.current.onNext({ next_cursor: "page-2", previous_cursor: null, page_size: 25 });
    });
    expect(result.current.cursor).toBe("page-2");

    act(() => {
      result.current.syncFilterKey("filters-b");
    });

    expect(result.current.cursor).toBeNull();
    expect(result.current.hasPrevious).toBe(false);
  });

  it("syncFilterKey with the same key does not reset an in-progress page", () => {
    const { result } = renderHook(() => useCursorPager());

    act(() => {
      result.current.syncFilterKey("filters-a");
    });
    act(() => {
      result.current.onNext({ next_cursor: "page-2", previous_cursor: null, page_size: 25 });
    });
    act(() => {
      result.current.syncFilterKey("filters-a");
    });

    expect(result.current.cursor).toBe("page-2");
  });
});
