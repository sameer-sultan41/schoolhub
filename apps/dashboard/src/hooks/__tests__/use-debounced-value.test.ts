import { renderHook } from "@testing-library/react";

import { useDebouncedValue } from "../use-debounced-value";

describe("useDebouncedValue", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("ali", 300));
    expect(result.current).toBe("ali");
  });

  it("does not update until delayMs have passed with no further change", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: "a" },
    });

    rerender({ value: "al" });
    jest.advanceTimersByTime(299);
    expect(result.current).toBe("a");

    jest.advanceTimersByTime(1);
    expect(result.current).toBe("al");
  });

  it("restarts the delay on every change, settling only on the last value", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: "a" },
    });

    rerender({ value: "al" });
    jest.advanceTimersByTime(200);
    rerender({ value: "ali" });
    jest.advanceTimersByTime(200);
    expect(result.current).toBe("a");

    jest.advanceTimersByTime(100);
    expect(result.current).toBe("ali");
  });
});
