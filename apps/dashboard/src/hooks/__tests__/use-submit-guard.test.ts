import { renderHook } from "@testing-library/react";
import { useSubmitGuard } from "../use-submit-guard";

describe("useSubmitGuard", () => {
  it("runs the wrapped submit on the first call", async () => {
    const { result } = renderHook(() => useSubmitGuard());
    const run = jest.fn().mockResolvedValue(undefined);

    await result.current.guard(run);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores a second call while the first is still in flight, then allows a new one after release", async () => {
    const { result } = renderHook(() => useSubmitGuard());
    let resolveFirst!: () => void;
    const first = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const second = jest.fn().mockResolvedValue(undefined);

    const firstCall = result.current.guard(first);
    await result.current.guard(second); // dispatched while `first` is still pending
    expect(second).not.toHaveBeenCalled();

    resolveFirst();
    await firstCall;
    await result.current.guard(second); // guard was released when `first` settled
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("releases the guard even when the wrapped submit throws", async () => {
    // `guard` logs an unexpected rejection rather than letting it propagate (every real
    // caller's own `run` already catches its own errors — see GuardianFormBody.onSubmit);
    // silence just that expected console.error so the test output stays pristine.
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useSubmitGuard());
    const failing = jest.fn().mockRejectedValue(new Error("boom"));
    const next = jest.fn().mockResolvedValue(undefined);

    await result.current.guard(failing);
    await result.current.guard(next);

    expect(next).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
