import { describe, expect, it, vi, afterEach } from "vitest";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { LocalTime } from "./local-time";

// React only checks hydration for client components, and a mismatch there leaves the page unresponsive. The
// server formats without knowing the reader's locale, so what it prints must not depend on locale at all.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("LocalTime", () => {
  it("prints the same fixed UTC text on the server whatever the server's locale is", () => {
    const html = renderToString(<LocalTime iso="2026-10-24T22:30:00Z" />);
    expect(html).toContain("2026-10-24");
    vi.spyOn(Date.prototype, "toLocaleDateString").mockReturnValue(
      "24/10/2026",
    );
    expect(renderToString(<LocalTime iso="2026-10-24T22:30:00Z" />)).toBe(html);
    expect(
      renderToString(<LocalTime iso="2026-10-24T22:30:00Z" time />),
    ).toContain("2026-10-24 22:30 UTC");
  });

  it("hydrates without a mismatch when the browser's locale differs from the server's, then shows the reader's format", async () => {
    const iso = "2026-10-24T22:30:00Z";
    const container = document.createElement("div");
    container.innerHTML = renderToString(<LocalTime iso={iso} />);
    document.body.appendChild(container);
    vi.spyOn(Date.prototype, "toLocaleDateString").mockReturnValue(
      "10/24/2026",
    );
    const problems: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <LocalTime iso={iso} />, {
        onRecoverableError: (e) => problems.push(e),
      });
    });
    expect(problems).toEqual([]);
    expect(container.textContent).toBe("10/24/2026");
    expect(container.querySelector("time")?.getAttribute("dateTime")).toBe(
      "2026-10-24T22:30:00.000Z",
    );
  });

  it("shows nothing for a value that is not a date", () => {
    expect(renderToString(<LocalTime iso="not a date" />)).toBe("");
  });
});
