import { describe, expect, it } from "vitest";
import { MODULE_NAMES, NAV, visibleNav } from "./modules";

describe("navigation manifest", () => {
  it("lists each page once", () => {
    const paths = NAV.map((n) => n.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("only names tools that exist", () => {
    for (const n of NAV)
      if (n.module) expect(MODULE_NAMES).toHaveProperty(n.module);
  });

  it("always keeps the core pages, even with every tool off", () => {
    expect(visibleNav([]).map((n) => n.path)).toEqual([
      "people",
      "quality",
      "settings",
    ]);
  });

  it("shows every page when every tool is on, in the manifest order", () => {
    expect(visibleNav(Object.keys(MODULE_NAMES))).toEqual(NAV);
  });

  it("hides only the pages of a tool that is off", () => {
    const shown = visibleNav(["feedback"]).map((n) => n.path);
    expect(shown).toContain("requests");
    expect(shown).not.toContain("inbox");
    expect(shown).not.toContain("surveys");
    expect(shown).not.toContain("recordings");
    expect(shown).toContain("settings");
  });
});
