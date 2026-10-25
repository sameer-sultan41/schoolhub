import { act, renderHook } from "@testing-library/react";

import { useCursorStack } from "../use-cursor-stack";

describe("useCursorStack", () => {
  it("starts on the first page, with nothing to go back to", () => {
    const { result } = renderHook(() => useCursorStack("q1"));

    expect(result.current.cursor).toBeUndefined();
    expect(result.current.hasPrevious).toBe(false);
  });

  it("pushes the cursor of each page moved to, and pops it going back", () => {
    const { result } = renderHook(() => useCursorStack("q1"));

    act(() => {
      result.current.goNext("c2");
    });
    act(() => {
      result.current.goNext("c3");
    });
    expect(result.current.cursor).toBe("c3");
    expect(result.current.hasPrevious).toBe(true);

    act(() => {
      result.current.goPrevious();
    });
    expect(result.current.cursor).toBe("c2");

    act(() => {
      result.current.goPrevious();
    });
    expect(result.current.cursor).toBeUndefined();
    expect(result.current.hasPrevious).toBe(false);
  });

  it("drops the stack when the query it belongs to changes", () => {
    const { result, rerender } = renderHook(({ key }) => useCursorStack(key), {
      initialProps: { key: "q1" },
    });
    act(() => {
      result.current.goNext("c2");
    });
    expect(result.current.cursor).toBe("c2");

    rerender({ key: "q2" });

    expect(result.current.cursor).toBeUndefined();
    expect(result.current.hasPrevious).toBe(false);
  });

  it("resets to the first page on demand", () => {
    const { result } = renderHook(() => useCursorStack("q1"));
    act(() => {
      result.current.goNext("c2");
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.cursor).toBeUndefined();
  });
});
