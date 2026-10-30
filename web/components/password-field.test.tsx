import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PasswordField, PasswordRules } from "./password-field";

afterEach(cleanup);

describe("PasswordField", () => {
  it("can be read back and says which state it is in", () => {
    render(
      <PasswordField
        id="pw"
        name="password"
        label="Password"
        autoComplete="current-password"
      />,
    );
    const input = document.getElementById("pw") as HTMLInputElement;
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(input.type).toBe("password");
    fireEvent.click(toggle);
    expect(input.type).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("warns when Caps Lock is on, linked from the input", () => {
    render(
      <PasswordField
        id="pw2"
        name="password"
        label="Password"
        autoComplete="current-password"
      />,
    );
    const input = document.getElementById("pw2") as HTMLInputElement;
    const press = new KeyboardEvent("keydown", { key: "A", bubbles: true });
    Object.defineProperty(press, "getModifierState", { value: () => true });
    act(() => {
      input.dispatchEvent(press);
    });
    expect(input.getAttribute("aria-describedby")).toContain("pw2-caps");
  });

  it("marks each rule as it becomes true", () => {
    const { container, rerender } = render(
      <PasswordRules id="rules" password="" again="" />,
    );
    const rules = () => [...container.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(rules()[0]).toContain("At least 10 characters");
    expect(rules()[0]).toContain("(not yet)");
    rerender(<PasswordRules id="rules" password="longenough1" again="longenough1" />);
    expect(rules()[0]).toContain("(done)");
    expect(rules()[1]).toContain("Both passwords match");
    expect(rules()[1]).toContain("(done)");
  });
});
