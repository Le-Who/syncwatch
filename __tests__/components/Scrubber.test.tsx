import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Scrubber } from "../../components/Scrubber";

afterEach(() => {
  cleanup();
  // Finish any drag even when an assertion failed, so leaked listeners cannot
  // turn a later test into a false positive.
  fireEvent(document, new MouseEvent("pointerup", { bubbles: true }));
  vi.restoreAllMocks();
});

function pointer(target: Element | Document, type: string, clientX: number) {
  fireEvent(target, new MouseEvent(type, { bubbles: true, clientX }));
}

function timeline(element: HTMLElement, left = 100, width = 200) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    new DOMRect(left, 0, width, 10),
  );
  return element;
}

function setup({ canControl = true, duration = 100 } = {}) {
  const events: Array<string | number> = [];
  const props = {
    playerRef: { current: { getCurrentTime: () => 20 } },
    duration,
    canControl,
    onSeekStart: () => events.push("start"),
    onSeekEnd: (percent: number) => events.push(percent),
  };
  const view = render(<Scrubber {...props} />);
  const slider = timeline(screen.getByRole("slider"));
  return { ...view, events, props, slider };
}

describe("Scrubber pointer seeking", () => {
  it("commits the last drag position once when released outside the slider", () => {
    const { slider, events } = setup();
    pointer(slider, "pointerdown", 150);
    expect(events).toEqual(["start"]);
    expect(slider).toHaveFocus();

    pointer(document, "pointermove", 250);
    pointer(document, "pointerup", 900);
    expect(events).toEqual(["start", 0.75]);

    pointer(document, "pointermove", 100);
    pointer(document, "pointerup", 100);
    expect(events).toEqual(["start", 0.75]);
  });

  it.each([
    [50, 0],
    [350, 1],
  ])("clamps a drag at x=%i to %i", (clientX, expected) => {
    const { slider, events } = setup();
    pointer(slider, "pointerdown", 200);
    pointer(document, "pointermove", clientX);
    pointer(document, "pointerup", clientX);
    expect(events).toEqual(["start", expected]);
  });

  it("starts a fresh drag after completing an earlier seek", () => {
    const { slider, events } = setup();
    pointer(slider, "pointerdown", 150);
    pointer(document, "pointerup", 150);
    pointer(slider, "pointerdown", 200);
    pointer(document, "pointerup", 200);
    expect(events).toEqual(["start", 0.25, "start", 0.5]);
  });

  it.each([
    { canControl: false, duration: 100 },
    { canControl: true, duration: 0 },
    { canControl: true, duration: -1 },
  ])("ignores pointer seeking when disabled: %j", (options) => {
    const { slider, events } = setup(options);
    expect(slider).toHaveAttribute("aria-disabled", "true");
    pointer(slider, "pointerdown", 200);
    pointer(document, "pointermove", 250);
    pointer(document, "pointerup", 250);
    expect(events).toEqual([]);
  });

  it("does not issue a delayed seek after unmounting during a drag", () => {
    const { slider, events, unmount } = setup();
    pointer(slider, "pointerdown", 150);
    unmount();
    pointer(document, "pointermove", 250);
    pointer(document, "pointerup", 250);
    expect(events).toEqual(["start"]);
  });

  it("uses the dragged slider's bounds when multiple timelines are mounted", () => {
    const first = setup();
    const events: Array<number> = [];
    render(
      <Scrubber
        {...first.props}
        onSeekStart={() => {}}
        onSeekEnd={(percent) => events.push(percent)}
      />,
    );
    const second = timeline(screen.getAllByRole("slider")[1], 400, 400);
    pointer(second, "pointerdown", 500);
    pointer(document, "pointerup", 500);
    expect(events).toEqual([0.25]);
  });

  it.each([
    { canControl: false, duration: 100 },
    { canControl: true, duration: 200 },
  ])("cancels an active drag when its seek scope changes: %j", (next) => {
    const { slider, props, events, rerender } = setup();
    const onSeekCancel = vi.fn();
    rerender(<Scrubber {...props} onSeekCancel={onSeekCancel} />);
    pointer(slider, "pointerdown", 150);

    rerender(<Scrubber {...props} {...next} onSeekCancel={onSeekCancel} />);
    pointer(document, "pointerup", 250);

    expect(events).toEqual(["start"]);
    expect(onSeekCancel).toHaveBeenCalledOnce();
  });

  it("completes an unchanged drag with the current callback after rerender", () => {
    const { slider, props, events, rerender } = setup();
    const completed: number[] = [];
    pointer(slider, "pointerdown", 150);

    rerender(
      <Scrubber {...props} onSeekEnd={(percent) => completed.push(percent)} />,
    );
    pointer(document, "pointerup", 150);

    expect(completed).toEqual([0.25]);
    expect(events).toEqual(["start"]);
  });

  it("abandons pointercancel without a delayed commit and allows a new drag", () => {
    const { slider, props, events, rerender } = setup();
    const onSeekCancel = vi.fn();
    rerender(<Scrubber {...props} onSeekCancel={onSeekCancel} />);
    pointer(slider, "pointerdown", 150);

    pointer(document, "pointercancel", 150);
    pointer(document, "pointerup", 150);
    expect(events).toEqual(["start"]);
    expect(onSeekCancel).toHaveBeenCalledOnce();

    pointer(slider, "pointerdown", 200);
    pointer(document, "pointerup", 200);
    expect(events).toEqual(["start", "start", 0.5]);
    expect(onSeekCancel).toHaveBeenCalledOnce();
  });

  it("releases the parent's seeking state when unmounted during a drag", () => {
    const { slider, props, rerender, unmount } = setup();
    const onSeekCancel = vi.fn();
    rerender(<Scrubber {...props} onSeekCancel={onSeekCancel} />);
    pointer(slider, "pointerdown", 150);

    unmount();

    expect(onSeekCancel).toHaveBeenCalledOnce();
  });
});
