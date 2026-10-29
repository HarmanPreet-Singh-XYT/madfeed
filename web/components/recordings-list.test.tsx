import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { toast } from "sonner";
import { RecordingsList } from "./recordings-list";
import * as actions from "@/app/(app)/w/[workspaceId]/recordings/actions";

vi.mock("@/app/(app)/w/[workspaceId]/recordings/actions", () => ({
  deleteMediaAction: vi.fn(async () => ({ notice: "Deleted." })),
  renameMediaAction: vi.fn(async () => ({ notice: "Saved." })),
  retryMediaAction: vi.fn(async () => ({ notice: "Queued." })),
  restoreMediaAction: vi.fn(async () => ({ notice: "Restored." })),
  loadOlderMediaAction: vi.fn(async () => ({ media: [] })),
}));

const renameMediaAction = vi.mocked(actions.renameMediaAction);
const retryMediaAction = vi.mocked(actions.retryMediaAction);
const restoreMediaAction = vi.mocked(actions.restoreMediaAction);
const deleteMediaAction = vi.mocked(actions.deleteMediaAction);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const base = {
  mimeType: "audio/mp4",
  sizeBytes: 2_400_000,
  receivedBytes: 2_400_000,
  chunkBytes: 1_048_576,
  createdAt: new Date().toISOString(),
};

const items = [
  {
    ...base,
    id: "00000000-0000-4000-8000-000000000001",
    filename: "interview-priya.m4a",
    state: "done" as const,
    durationMs: 62_000,
    personId: "00000000-0000-4000-8000-000000000002",
    sourceItemId: "00000000-0000-4000-8000-000000000003",
  },
  {
    ...base,
    id: "00000000-0000-4000-8000-000000000004",
    filename: "sam-call.wav",
    state: "failed" as const,
    failureReason: "The audio was silent.",
  },
  {
    ...base,
    id: "00000000-0000-4000-8000-000000000005",
    filename: "team-offsite.m4a",
    state: "transcribing" as const,
  },
];

const people = [
  { id: "00000000-0000-4000-8000-000000000002", name: "Priya Shah" },
];

function setup() {
  return render(
    <RecordingsList
      workspaceId="00000000-0000-4000-8000-000000000009"
      items={items}
      people={people}
      canEdit
    />,
  );
}

afterEach(cleanup);

describe("recordings list", () => {
  it("shows every recording, with its speaker and failure reason", () => {
    setup();
    expect(screen.getByText("interview-priya.m4a")).toBeTruthy();
    expect(screen.getByText("· Priya Shah")).toBeTruthy();
    expect(screen.getByText("The audio was silent.")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
  });

  it("filters by state", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    expect(screen.getByText("interview-priya.m4a")).toBeTruthy();
    expect(screen.queryByText("sam-call.wav")).toBeNull();
    expect(screen.queryByText("team-offsite.m4a")).toBeNull();
  });

  it("searches by file name and by person", () => {
    setup();
    const search = screen.getByLabelText("Search recordings");
    fireEvent.change(search, { target: { value: "sam" } });
    expect(screen.getByText("sam-call.wav")).toBeTruthy();
    expect(screen.queryByText("interview-priya.m4a")).toBeNull();

    fireEvent.change(search, { target: { value: "priya" } });
    expect(screen.getByText("interview-priya.m4a")).toBeTruthy();
    expect(screen.queryByText("sam-call.wav")).toBeNull();

    fireEvent.change(search, { target: { value: "nothing" } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear search and filters" }),
    );
    expect(screen.getByText("sam-call.wav")).toBeTruthy();
  });

  it("selects recordings for a bulk action", () => {
    setup();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select sam-call.wav" }),
    );
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByText("1 recording selected")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all recordings" }),
    );
    expect(within(bar).getByText("3 recordings selected")).toBeTruthy();

    fireEvent.click(within(bar).getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
  });

  it("renames a recording from its row", () => {
    setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Rename sam-call.wav" }),
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    fireEvent.change(input, { target: { value: "Sam, renewal call" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(renameMediaAction).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000009",
      "00000000-0000-4000-8000-000000000004",
      "Sam, renewal call",
    );
  });

  it("tries a failed transcription again", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retryMediaAction).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000009",
      "00000000-0000-4000-8000-000000000004",
    );
  });

  it("deletes a recording and offers an undo", async () => {
    setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete sam-call.wav" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Yes, delete it" }),
    );
    await waitFor(() =>
      expect(deleteMediaAction).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000009",
        "00000000-0000-4000-8000-000000000004",
      ),
    );
    const opts = vi.mocked(toast.success).mock.calls.at(-1)?.[1] as
      { action?: { label: string; onClick: () => Promise<void> } } | undefined;
    expect(opts?.action?.label).toBe("Undo");
    await opts!.action!.onClick();
    expect(restoreMediaAction).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000009",
      "00000000-0000-4000-8000-000000000004",
    );
  });

  it("keeps delete and download reachable by name, and hides them from viewers", () => {
    const { unmount } = setup();
    expect(
      screen.getByRole("button", { name: "Delete sam-call.wav" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Download sam-call.wav" }),
    ).toBeTruthy();
    unmount();

    render(
      <RecordingsList
        workspaceId="00000000-0000-4000-8000-000000000009"
        items={items}
        people={people}
        canEdit={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
