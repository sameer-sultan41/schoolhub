import { act, renderHook } from "@testing-library/react";

import { useSessionStorageState } from "../use-session-storage-state";

describe("useSessionStorageState", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("reads an existing value on mount", () => {
    window.sessionStorage.setItem("test:key", "stored");
    const { result } = renderHook(() => useSessionStorageState("test:key"));
    expect(result.current[0]).toBe("stored");
  });

  it("writes through to sessionStorage and re-renders with the new value", () => {
    const { result } = renderHook(() => useSessionStorageState("test:key"));
    expect(result.current[0]).toBeNull();

    act(() => {
      result.current[1]("job-1");
    });

    expect(result.current[0]).toBe("job-1");
    expect(window.sessionStorage.getItem("test:key")).toBe("job-1");
  });

  it("removes the entry when set to null", () => {
    window.sessionStorage.setItem("test:key", "job-1");
    const { result } = renderHook(() => useSessionStorageState("test:key"));

    act(() => {
      result.current[1](null);
    });

    expect(result.current[0]).toBeNull();
    expect(window.sessionStorage.getItem("test:key")).toBeNull();
  });

  it("keeps every mounted reader of the same key in sync", () => {
    const first = renderHook(() => useSessionStorageState("test:key"));
    const second = renderHook(() => useSessionStorageState("test:key"));

    act(() => {
      first.result.current[1]("job-2");
    });

    expect(second.result.current[0]).toBe("job-2");
  });

  it("reads null and ignores writes while the key is null", () => {
    const { result } = renderHook(() => useSessionStorageState(null));

    act(() => {
      result.current[1]("job-3");
    });

    expect(result.current[0]).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("reads null, and never throws on write, when storage itself is unavailable", () => {
    const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const { result } = renderHook(() => useSessionStorageState("test:key"));
    expect(result.current[0]).toBeNull();
    expect(() => {
      act(() => {
        result.current[1]("job-4");
      });
    }).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
