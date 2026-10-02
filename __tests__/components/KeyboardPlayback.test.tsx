import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useState } from "react";
import { Scrubber } from "../../components/Scrubber";
import { usePlayerShortcuts } from "../../hooks/usePlayerShortcuts";
afterEach(cleanup);
function KeyboardRoom({ canControl = true }: { canControl?: boolean }) {
  const [position, setPosition] = useState(20);
  const [playing, setPlaying] = useState(false);
  usePlayerShortcuts({
    canControl,
    playing,
    muted: true,
    handlePlay: () => setPlaying(true),
    handlePause: () => setPlaying(false),
    setMuted: () => {},
  });
  return (
    <>
      <button>Unrelated action</button>
      <output>
        {playing ? "playing" : "paused"}:{position}
      </output>
      <Scrubber
        duration={100}
        canControl={canControl}
        playerRef={{ current: { getCurrentTime: () => position } }}
        onSeekStart={() => {}}
        onSeekEnd={(percent) => setPosition(percent * 100)}
      />
    </>
  );
}
it("Space leaves focused room actions to the button", () => {
  render(<KeyboardRoom />);
  fireEvent.keyDown(screen.getByRole("button"), { code: "Space", key: " " });
  expect(screen.getByText("paused:20")).toBeInTheDocument();
});
it("the timeline is a labelled keyboard slider with bounded seeks", () => {
  render(<KeyboardRoom />);
  const slider = screen.getByRole("slider", { name: "Playback position" });
  fireEvent.keyDown(slider, { key: "ArrowRight", code: "ArrowRight" });
  expect(screen.getByText("paused:25")).toBeInTheDocument();
  fireEvent.keyDown(slider, { key: "End", code: "End" });
  expect(screen.getByText("paused:100")).toBeInTheDocument();
  fireEvent.keyDown(slider, { key: "Home", code: "Home" });
  expect(screen.getByText("paused:0")).toBeInTheDocument();
});
it("an unauthorized slider never seeks", () => {
  render(<KeyboardRoom canControl={false} />);
  const slider = screen.getByRole("slider", { name: "Playback position" });
  expect(slider).toHaveAttribute("aria-disabled", "true");
  fireEvent.keyDown(slider, { key: "End", code: "End" });
  expect(screen.getByText("paused:20")).toBeInTheDocument();
});
