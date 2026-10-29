import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { SurveysList } from "./surveys-list";

const duplicate = vi.hoisted(() =>
  vi.fn(async () => ({ id: "new-survey-id" })),
);
const close = vi.hoisted(() => vi.fn(async () => ({ notice: "Closed." })));
const remove = vi.hoisted(() => vi.fn(async () => ({ notice: "Deleted." })));
const push = vi.hoisted(() => vi.fn());
const older = vi.hoisted(() =>
  vi.fn(async () => ({
    surveys: [
      {
        id: "older-1",
        title: "Older survey",
        state: "closed",
        delivery: "open",
        createdAt: "2026-01-01T00:00:00Z",
        invitesSent: 0,
        responses: 1,
        partial: 0,
        questions: 1,
      },
    ],
    nextCursor: undefined,
  })),
);

vi.mock("@/app/(app)/w/[workspaceId]/surveys/actions", () => ({
  duplicateSurveyAction: duplicate,
  closeSurveyAction: close,
  deleteSurveyAction: remove,
  loadOlderSurveysAction: older,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const base = {
  createdAt: new Date().toISOString(),
  invitesSent: 0,
  partial: 0,
  questions: 3,
};

const surveys = [
  {
    ...base,
    id: "00000000-0000-4000-8000-000000000001",
    title: "Quarterly check-in",
    state: "open" as const,
    delivery: "invited" as const,
    responses: 12,
    invitesSent: 20,
  },
  {
    ...base,
    id: "00000000-0000-4000-8000-000000000002",
    title: "Pricing research",
    state: "draft" as const,
    delivery: "open" as const,
    questions: 0,
    responses: 0,
  },
  {
    ...base,
    id: "00000000-0000-4000-8000-000000000003",
    title: "Churn interviews",
    state: "closed" as const,
    delivery: "open" as const,
    responses: 4,
    partial: 2,
  },
];

const renderList = (canWrite = true, isAdmin = true, nextCursor?: string) =>
  render(
    <SurveysList
      workspaceId="ws-1"
      surveys={surveys}
      nextCursor={nextCursor}
      canWrite={canWrite}
      isAdmin={isAdmin}
    />,
  );

afterEach(cleanup);

describe("surveys list", () => {
  it("shows each survey with its status, questions and answers", () => {
    renderList();
    const open = screen.getByText("Quarterly check-in").closest("li")!;
    expect(within(open).getByText("Open")).toBeTruthy();
    expect(within(open).getByText("3 questions")).toBeTruthy();
    expect(within(open).getByText("20 sent")).toBeTruthy();
    expect(within(open).getByText("60% replied")).toBeTruthy();
    const draft = screen.getByText("Pricing research").closest("li")!;
    expect(within(draft).getByText("Draft")).toBeTruthy();
    expect(within(draft).getByText("No questions yet")).toBeTruthy();
    expect(within(draft).getByText("Finish setup")).toBeTruthy();
    const closed = screen.getByText("Churn interviews").closest("li")!;
    expect(within(closed).getByText("Closed")).toBeTruthy();
    expect(within(closed).getByText("2 starts unfinished")).toBeTruthy();
    expect(screen.getAllByText("Results")).toHaveLength(2);
  });

  it("filters by state and counts each one", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /Open/ }));
    expect(screen.getByText("Quarterly check-in")).toBeTruthy();
    expect(screen.queryByText("Pricing research")).toBeNull();
    expect(screen.queryByText("Churn interviews")).toBeNull();
  });

  it("searches by title and clears back to everything", () => {
    renderList();
    const search = screen.getByLabelText("Search surveys");
    fireEvent.change(search, { target: { value: "churn" } });
    expect(screen.getByText("Churn interviews")).toBeTruthy();
    expect(screen.queryByText("Quarterly check-in")).toBeNull();

    fireEvent.change(search, { target: { value: "nothing" } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear search and filters" }),
    );
    expect(screen.getByText("Quarterly check-in")).toBeTruthy();
  });

  it("duplicates a survey and opens the new draft", async () => {
    renderList();
    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate Quarterly check-in" }),
    );
    await waitFor(() =>
      expect(duplicate).toHaveBeenCalledWith(
        "ws-1",
        "00000000-0000-4000-8000-000000000001",
      ),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/w/ws-1/surveys/new-survey-id"),
    );
  });

  it("closes only the open surveys among the selected", async () => {
    renderList();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all surveys" }),
    );
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByText("3 surveys selected")).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(close).toHaveBeenCalledWith(
      "ws-1",
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("deletes selected surveys after confirming, for admins only", async () => {
    const { unmount } = renderList();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all surveys" }),
    );
    fireEvent.click(
      within(screen.getByRole("region", { name: "Bulk actions" })).getByRole(
        "button",
        { name: "Delete" },
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Yes, delete them" }),
    );
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(3));
    unmount();

    renderList(true, false);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all surveys" }),
    );
    expect(
      within(screen.getByRole("region", { name: "Bulk actions" })).queryByRole(
        "button",
        { name: "Delete" },
      ),
    ).toBeNull();
  });

  it("loads older surveys and appends them", async () => {
    renderList(true, true, "cursor-1");
    fireEvent.click(screen.getByRole("button", { name: "Load older surveys" }));
    await waitFor(() => expect(older).toHaveBeenCalledWith("ws-1", "cursor-1"));
    expect(await screen.findByText("Older survey")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Load older surveys" }),
    ).toBeNull();
  });

  it("hides the duplicate action from viewers", () => {
    renderList(false);
    expect(screen.queryByRole("button", { name: /^Duplicate/ })).toBeNull();
  });

  it("links each survey to its editor and its results", () => {
    renderList();
    expect(
      screen
        .getByRole("link", { name: "Quarterly check-in" })
        .getAttribute("href"),
    ).toBe("/w/ws-1/surveys/00000000-0000-4000-8000-000000000001");
    expect(
      screen.getAllByRole("link", { name: "Results" })[0].getAttribute("href"),
    ).toBe("/w/ws-1/surveys/00000000-0000-4000-8000-000000000001/results");
  });
});
