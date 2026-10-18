import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFlashback } from "../useFlashback";

describe("useFlashback synchronous undo", () => {
  it("returns the latest position when registering and popping in the same batch", () => {
    const { result } = renderHook(() => useFlashback());
    let restored: number | null = null;
    act(() => {
      result.current.registerPossibleFlashback(10, 100, "a");
      result.current.registerPossibleFlashback(20, 100, "a");
      restored = result.current.popFlashback("a");
    });

    expect(restored).toBe(20);
    expect(result.current.flashbacks.map((point) => point.position)).toEqual([
      10,
    ]);
  });

  it("returns consecutive undo positions synchronously without consuming another media's history", () => {
    const { result } = renderHook(() => useFlashback());
    act(() => {
      result.current.registerPossibleFlashback(10, 100, "a");
      result.current.registerPossibleFlashback(30, 100, "b");
      result.current.registerPossibleFlashback(20, 100, "a");
    });
    const restored: Array<number | null> = [];
    act(() => {
      restored.push(result.current.popFlashback("a"));
      restored.push(result.current.popFlashback("a"));
    });

    expect(restored).toEqual([20, 10]);
    expect(
      result.current.flashbacks.map((point) => [point.mediaId, point.position]),
    ).toEqual([["b", 30]]);
  });
});
