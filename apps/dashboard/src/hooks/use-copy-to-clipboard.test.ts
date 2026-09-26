import { act, renderHook } from "@testing-library/react";
import { useCopyToClipboard } from "./use-copy-to-clipboard";

describe("useCopyToClipboard", () => {
  const originalClipboard = navigator.clipboard as Clipboard | undefined;

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
  });

  it("calls the given onCopy once the write genuinely resolves — the caller's own API, not just the UI that happens to use it", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const onCopy = jest.fn();
    const { result } = renderHook(() => useCopyToClipboard({ onCopy }));

    let copied: boolean | undefined;
    await act(async () => {
      copied = await result.current.copyToClipboard("st-1");
    });

    expect(copied).toBe(true);
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(result.current.isCopied).toBe(true);
  });

  it("never throws for a caller that passes no onCopy at all", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copyToClipboard("st-1");
    });

    expect(result.current.isCopied).toBe(true);
  });

  it("resolves false, and never touches the clipboard, when there is nothing to copy", async () => {
    const writeText = jest.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useCopyToClipboard());

    const copied = await result.current.copyToClipboard("");

    expect(copied).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("resolves false outside a secure context, where navigator.clipboard doesn't exist", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useCopyToClipboard());

    const copied = await result.current.copyToClipboard("st-1");

    expect(copied).toBe(false);
  });

  it("un-flags isCopied again after the given timeout", async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useCopyToClipboard({ timeout: 500 }));

    await act(async () => {
      await result.current.copyToClipboard("st-1");
    });
    expect(result.current.isCopied).toBe(true);

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(result.current.isCopied).toBe(false);
    jest.useRealTimers();
  });
});
