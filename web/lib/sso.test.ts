import { describe, expect, it } from "vitest";
import {
  challengeOf,
  domainOf,
  newVerifier,
  parseProviders,
  validCode,
  validVerifier,
} from "./sso";

describe("company sign-in helpers", () => {
  it("reads only known providers, once each", () => {
    expect(parseProviders(" Google, azure,google,evil,, ")).toEqual([
      "google",
      "azure",
    ]);
    expect(parseProviders(undefined)).toEqual([]);
  });

  it("finds the domain of a work email and refuses odd input", () => {
    expect(domainOf("Dana@Acme.Example.com ")).toBe("acme.example.com");
    for (const bad of [
      "nobody",
      "a@b",
      "a@@b.com",
      "@acme.com",
      "a@acme.com/evil",
      "a@acme..com",
      "a@-acme.com",
      `${"x".repeat(65)}@acme.com`,
      "a b@acme.com",
    ])
      expect(domainOf(bad)).toBeUndefined();
  });

  it("makes a verifier the identity service will accept and a matching challenge", () => {
    const v = newVerifier();
    expect(validVerifier(v)).toBe(true);
    expect(newVerifier()).not.toBe(v);
    // the example from the PKCE specification (RFC 7636, appendix B)
    expect(challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("checks what comes back from the browser", () => {
    expect(validCode("abc12345-def")).toBe(true);
    for (const bad of [
      undefined,
      "",
      "short",
      "has space 12345",
      "a".repeat(301),
      "x;y=1&z",
      ["a"],
    ])
      expect(validCode(bad)).toBe(false);
    expect(validVerifier("short")).toBe(false);
    expect(validVerifier("a".repeat(129))).toBe(false);
    expect(validVerifier("bad chars!".repeat(5))).toBe(false);
  });
});
