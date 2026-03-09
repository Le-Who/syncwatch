import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Participants from "../../components/Participants";
import { useStore } from "../../lib/store";

// Mock Zustand Store
vi.mock("../../lib/store", () => ({
  useStore: vi.fn(),
}));

// Mock Framer Motion
vi.mock("motion/react", () => ({
  motion: {
    div: ({ children, className, onClick }: any) => (
      <div className={className} onClick={onClick}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe("Participants Component (Unit Tests)", () => {
  const mockSendCommand = vi.fn();
  const mockSetNickname = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      room: {
        participants: {
          "user-owner": { id: "user-owner", role: "owner", nickname: "Alice" },
          "user-mod": { id: "user-mod", role: "moderator", nickname: "Bob" },
          "user-guest": {
            id: "user-guest",
            role: "guest",
            nickname: "Charlie",
          },
        },
      },
      participantId: "user-owner",
      sendCommand: mockSendCommand,
      setNickname: mockSetNickname,
    });
  });

  it("TC-UI-09: Renders participants sorted by role (Owner > Mod > Guest)", () => {
    render(<Participants />);

    // The order in the DOM should match the sort logic in the component
    const items = document.querySelectorAll(".participant-item");
    expect(items.length).toBe(3);

    // Extract textual name from each item (either from <p> or <input value>)
    const getParticipantName = (el: Element) => {
      const input = el.querySelector("input");
      if (input) return input.value;
      const p = el.querySelector("p");
      return p?.textContent;
    };

    expect(getParticipantName(items[0])).toBe("Alice");
    expect(getParticipantName(items[1])).toBe("Bob");
    expect(getParticipantName(items[2])).toBe("Charlie");
  });

  it("TC-UI-10: Shows 'Manage user' menu only for Owner", () => {
    render(<Participants />);

    // Owner should see two "Manage user" buttons (one for Bob, one for Charlie, not themselves)
    const manageBtns = screen.getAllByRole("button", { name: "Manage user" });
    expect(manageBtns.length).toBe(2);
  });

  it("TC-UI-11: Allows updating nickname locally", () => {
    render(<Participants />);

    const nicknameInput = screen.getByDisplayValue("Alice");
    fireEvent.change(nicknameInput, { target: { value: "Alicia" } });

    expect(mockSetNickname).toHaveBeenCalledWith("Alicia");
  });

  it("TC-UI-12: Prevents Guests from seeing the manage menu", () => {
    // Change current user to guest
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      room: {
        participants: {
          "user-owner": { id: "user-owner", role: "owner", nickname: "Alice" },
          "user-guest": {
            id: "user-guest",
            role: "guest",
            nickname: "Charlie",
          },
        },
      },
      participantId: "user-guest",
      sendCommand: mockSendCommand,
      setNickname: mockSetNickname,
    });

    render(<Participants />);

    const manageBtns = screen.queryAllByRole("button", { name: "Manage user" });
    expect(manageBtns.length).toBe(0); // Guests cannot manage anyone
  });

  it("TC-UI-13: Emits update_role command when Owner promotes a Guest", () => {
    render(<Participants />);

    // Click manage button on Charlie (Guest)
    // We mock the click that opens the menu
    const manageBtns = screen.getAllByRole("button", { name: "Manage user" });
    fireEvent.click(manageBtns[1]); // Assuming 2nd button is for Charlie (Guest) based on sorting

    // Click Make Moderator
    const promoteBtn = screen.getByText(/Make Moderator/i);
    fireEvent.click(promoteBtn);

    expect(mockSendCommand).toHaveBeenCalledWith("update_role", {
      participantId: "user-guest",
      role: "moderator",
    });
  });

  it("TC-UI-14: Owner can demote a Moderator", () => {
    render(<Participants />);

    const manageBtns = screen.getAllByRole("button", { name: "Manage user" });
    fireEvent.click(manageBtns[0]); // Button for Bob (Mod)

    const demoteBtn = screen.getByText(/Remove Mod/i);
    fireEvent.click(demoteBtn);

    expect(mockSendCommand).toHaveBeenCalledWith("update_role", {
      participantId: "user-mod",
      role: "guest",
    });
  });
});
