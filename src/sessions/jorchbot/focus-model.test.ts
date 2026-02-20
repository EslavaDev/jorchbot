import { describe, expect, it } from "vitest";
import { FocusModel } from "./focus-model.js";

describe("FocusModel", () => {
  it("starts with no focus for any phone", () => {
    const model = new FocusModel();
    expect(model.getFocused("+1111")).toBeNull();
  });

  it("sets and gets focus per phone", () => {
    const model = new FocusModel();
    model.setFocused("+1111", "frontend");
    expect(model.getFocused("+1111")).toBe("frontend");
    expect(model.getFocused("+2222")).toBeNull();
  });

  it("clears focus for a phone", () => {
    const model = new FocusModel();
    model.setFocused("+1111", "frontend");
    model.clearFocus("+1111");
    expect(model.getFocused("+1111")).toBeNull();
  });

  it("isFocused returns correct value per phone", () => {
    const model = new FocusModel();
    model.setFocused("+1111", "frontend");
    expect(model.isFocused("+1111", "frontend")).toBe(true);
    expect(model.isFocused("+1111", "backend")).toBe(false);
    expect(model.isFocused("+2222", "frontend")).toBe(false);
  });

  it("switching focus replaces the previous for that phone", () => {
    const model = new FocusModel();
    model.setFocused("+1111", "frontend");
    model.setFocused("+1111", "backend");
    expect(model.getFocused("+1111")).toBe("backend");
    expect(model.isFocused("+1111", "frontend")).toBe(false);
  });

  it("different phones can focus different projects", () => {
    const model = new FocusModel();
    model.setFocused("+1111", "frontend");
    model.setFocused("+2222", "backend");
    expect(model.getFocused("+1111")).toBe("frontend");
    expect(model.getFocused("+2222")).toBe("backend");
  });

  it("clearProject removes focus from all phones", () => {
    const model = new FocusModel();
    model.setFocused("+1111", "frontend");
    model.setFocused("+2222", "frontend");
    model.setFocused("+3333", "backend");
    model.clearProject("frontend");
    expect(model.getFocused("+1111")).toBeNull();
    expect(model.getFocused("+2222")).toBeNull();
    expect(model.getFocused("+3333")).toBe("backend");
  });
});
