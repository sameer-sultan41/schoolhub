import { act, renderHook } from "@testing-library/react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants";

describe("useDebouncedValue", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts with the value it was given, on both halves", () => {
    const { result } = renderHook(() => useDebouncedValue("Amina"));

    expect(result.current.draft).toBe("Amina");
    expect(result.current.settled).toBe("Amina");
  });

  it("starts empty when given nothing", () => {
    const { result } = renderHook(() => useDebouncedValue());

    expect(result.current.draft).toBe("");
    expect(result.current.settled).toBe("");
  });

  it("shows a keystroke at once and settles it only after the window", () => {
    const { result } = renderHook(() => useDebouncedValue());

    act(() => {
      result.current.onDraftChange("Am");
    });

    expect(result.current.draft).toBe("Am");
    expect(result.current.settled).toBe("");

    act(() => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });

    expect(result.current.settled).toBe("Am");
  });

  it("settles once, on the last keystroke, when they arrive inside the window", () => {
    const onSettle = jest.fn();
    const { result } = renderHook(() => useDebouncedValue("", { onSettle }));

    act(() => {
      result.current.onDraftChange("Am");
    });
    act(() => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
      result.current.onDraftChange("Amina");
    });
    act(() => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });

    // A keystroke inside the window replaces the pending settle rather than stacking a
    // second one: only the term the reader stopped on ever reaches the caller.
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith("Amina");
    expect(result.current.settled).toBe("Amina");
  });

  it("honours a caller's own window", () => {
    const { result } = renderHook(() => useDebouncedValue("", { delayMs: 1000 }));

    act(() => {
      result.current.onDraftChange("Am");
    });
    act(() => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });

    expect(result.current.settled).toBe("");

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(result.current.settled).toBe("Am");
  });

  it("set() settles both halves at once and drops a window still open", () => {
    const onSettle = jest.fn();
    const { result } = renderHook(() => useDebouncedValue("", { onSettle }));

    act(() => {
      result.current.onDraftChange("Amina");
    });
    act(() => {
      result.current.set("");
    });

    expect(result.current.draft).toBe("");
    expect(result.current.settled).toBe("");

    act(() => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });

    // The half-typed term must not come back over what the caller just set.
    expect(onSettle).not.toHaveBeenCalled();
    expect(result.current.settled).toBe("");
  });

  it("clears its timer on unmount, so a settle cannot fire into a component that is gone", () => {
    const onSettle = jest.fn();
    const { result, unmount } = renderHook(() => useDebouncedValue("", { onSettle }));

    act(() => {
      result.current.onDraftChange("Amina");
    });
    unmount();
    act(() => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });

    expect(onSettle).not.toHaveBeenCalled();
  });
});
