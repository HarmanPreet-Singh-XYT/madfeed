import { describe, expect, it, vi } from "vitest";
import {
  KEYS,
  SAMPLE_WORKSPACE_NAME,
  hintFor,
  isSampleWorkspace,
  readFlag,
  tourSteps,
  writeFlag,
} from "./onboarding";
import { NAV } from "./modules";

const ALL = NAV.map((n) => n.path);

describe("tourSteps", () => {
  it("opens with a welcome and closes with a finish, with no spotlight on either", () => {
    const steps = tourSteps(ALL, true);
    expect(steps[0].target).toBeUndefined();
    expect(steps.at(-1)?.target).toBeUndefined();
    expect(steps.length).toBeGreaterThanOrEqual(6);
  });

  it("only points at tools this workspace has", () => {
    const steps = tourSteps(["people", "quality", "settings"], false);
    expect(steps.map((s) => s.id)).not.toContain("review");
    expect(steps.map((s) => s.id)).not.toContain("add");
    // What is left still makes sense: welcome, search, help, finish.
    expect(steps.map((s) => s.id)).toEqual(
      expect.arrayContaining(["welcome", "search", "help", "finish"]),
    );
  });

  it("does not offer to add feedback to someone who cannot", () => {
    expect(tourSteps(ALL, false).map((s) => s.id)).not.toContain("add");
  });

  it("gives every step a unique id and plain copy", () => {
    const steps = tourSteps(ALL, true);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    for (const s of steps) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(20);
    }
  });

  it("uses the product's own words", () => {
    const text = JSON.stringify(tourSteps(ALL, true)).toLowerCase();
    for (const banned of ["insight", "theme", " idea", "group"]) {
      expect(text).not.toContain(banned);
    }
  });
});

describe("hintFor", () => {
  const base = "/w/abc";
  it("finds the tip for a tool page and for pages inside it", () => {
    expect(hintFor(`${base}/review`, base)?.id).toBe("review");
    expect(hintFor(`${base}/requests`, base)?.id).toBe("requests");
    expect(hintFor(`${base}/requests/123`, base)).toBeUndefined();
  });
  it("shows nothing on the overview or on unknown pages", () => {
    expect(hintFor(base, base)).toBeUndefined();
    expect(hintFor(`${base}/nowhere`, base)).toBeUndefined();
  });
  it("has a tip for every main tool in the navigation", () => {
    for (const p of ["add", "review", "requests", "quotes", "ask", "roadmap", "outreach", "releases", "surveys", "inbox", "people", "quality"]) {
      expect(hintFor(`${base}/${p}`, base), p).toBeDefined();
    }
  });
});

describe("sample workspace", () => {
  it("is recognised by its name", () => {
    expect(isSampleWorkspace(SAMPLE_WORKSPACE_NAME)).toBe(true);
    expect(isSampleWorkspace("Acme")).toBe(false);
  });
});

describe("flags survive a browser that blocks storage", () => {
  it("reads null and ignores writes instead of throwing", () => {
    const blocked = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    vi.stubGlobal("window", { localStorage: blocked, dispatchEvent: () => true });
    expect(readFlag(KEYS.tour)).toBeNull();
    expect(() => writeFlag(KEYS.tour, "done")).not.toThrow();
    vi.unstubAllGlobals();
  });
});
