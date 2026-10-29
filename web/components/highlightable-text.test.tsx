import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  HighlightableText,
  type TranscriptSegment,
} from "./highlightable-text";
import { byteOffsetOf } from "@/lib/text";

vi.mock("@/app/(app)/w/[workspaceId]/research/actions", () => ({
  createHighlightAction: vi.fn(),
}));

const text =
  "Interviewer: What slows you down?\nPriya: Password reset, honestly. Password again.";

function segments(): TranscriptSegment[] {
  const cut = text.indexOf("Priya");
  return [
    {
      ordinal: 0,
      startMs: 0,
      endMs: 12_000,
      speaker: "Interviewer",
      spanStart: byteOffsetOf(text, 0),
      spanEnd: byteOffsetOf(text, cut),
    },
    {
      ordinal: 1,
      startMs: 12_000,
      endMs: 30_000,
      speaker: "Priya",
      spanStart: byteOffsetOf(text, cut),
      spanEnd: byteOffsetOf(text, text.length),
    },
  ];
}

function setup() {
  return render(
    <HighlightableText
      workspaceId="00000000-0000-4000-8000-000000000001"
      sourceItemId="00000000-0000-4000-8000-000000000801"
      text={text}
      marks={[]}
      tags={[]}
      canEdit={false}
      recording={{ mediaId: "m1", segments: segments() }}
    />,
  );
}

beforeEach(() => {
  // jsdom has no media element or scrolling; the component calls both.
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    writable: true,
    value: 0,
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(cleanup);

describe("transcript search", () => {
  it("counts matches and marks the first one", () => {
    const { container } = setup();
    fireEvent.change(screen.getByLabelText("Search the transcript"), {
      target: { value: "password" },
    });
    expect(screen.getByRole("status").textContent).toBe("1 of 2");
    expect(
      container.querySelectorAll('[data-search-current="true"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-search-current="true"]')?.textContent,
    ).toBe("Password");
  });

  it("moves to the next match and wraps around", () => {
    const { container } = setup();
    fireEvent.change(screen.getByLabelText("Search the transcript"), {
      target: { value: "password" },
    });
    const next = screen.getByRole("button", { name: "Next match" });
    fireEvent.click(next);
    expect(screen.getByRole("status").textContent).toBe("2 of 2");
    expect(
      container.querySelector('[data-search-current="true"]')?.textContent,
    ).toBe("Password");
    fireEvent.click(next);
    expect(screen.getByRole("status").textContent).toBe("1 of 2");
  });

  it("says so when nothing matches, and ignores one-character queries", () => {
    setup();
    const input = screen.getByLabelText("Search the transcript");
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByRole("status").textContent).toBe("No matches");
    expect(
      (screen.getByRole("button", { name: "Next match" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(input, { target: { value: "p" } });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
