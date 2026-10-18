import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlayerControlBar } from "../../components/PlayerControlBar";
import { useSettingsStore, useStore } from "../../lib/store";

const originalSendCommand = useStore.getState().sendCommand;

beforeEach(() => {
  useSettingsStore.setState({ volume: 0.8, muted: false, theaterMode: false });
});

afterEach(() => {
  cleanup();
  useStore.setState({ sendCommand: originalSendCommand });
});

function setup() {
  const events: string[] = [];
  const commands: Array<{ type: string; payload: unknown }> = [];
  useStore.setState({
    sendCommand: (type, payload) => commands.push({ type, payload }),
  });
  const props = {
    playerRef: { current: { getCurrentTime: () => 20 } },
    containerRef: { current: null },
    duration: 120,
    playing: false,
    canControl: true,
    currentMedia: { provider: "direct", title: "Direct video" },
    playback: undefined,
    currentMediaId: "media-1",
    flashbacks: [],
    popFlashback: () => null,
    onPlay: () => events.push("play"),
    onPause: () => events.push("pause"),
    onNext: () => events.push("next"),
    onSeekStart: () => events.push("seek-start"),
    onSeekEnd: () => events.push("seek-end"),
    onSeekCancel: () => events.push("seek-cancel"),
  };
  return {
    ...render(<PlayerControlBar {...props} />),
    props,
    events,
    commands,
  };
}

describe("direct-media player controls", () => {
  it("does not offer an empty quality selector", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: "Quality settings" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("direct")).toBeInTheDocument();
    expect(screen.getByText("Direct video")).toBeInTheDocument();
  });

  it("keeps playback, next, volume, and playback-rate controls working", () => {
    const { props, events, commands, rerender } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    rerender(<PlayerControlBar {...props} playing />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Next media" }));
    expect(events).toEqual(["play", "pause", "next"]);

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(useSettingsStore.getState().muted).toBe(true);
    fireEvent.change(screen.getByRole("slider", { name: "Volume slider" }), {
      target: { value: "0.4" },
    });
    expect(useSettingsStore.getState()).toMatchObject({
      volume: 0.4,
      muted: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "1.5x", hidden: true }));
    expect(commands).toEqual([{ type: "update_rate", payload: { rate: 1.5 } }]);
  });

  it("preserves seek cancellation when unmounted during a drag", () => {
    const { events, unmount } = setup();
    fireEvent(
      screen.getByRole("slider", { name: "Playback position" }),
      new MouseEvent("pointerdown", { bubbles: true, clientX: 10 }),
    );
    unmount();
    expect(events).toEqual(["seek-start", "seek-cancel"]);
  });
});
