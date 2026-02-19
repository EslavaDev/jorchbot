import { describe, expect, it } from "vitest";
import { FocusModel } from "./focus-model.js";

describe("FocusModel", () => {
  it("starts with no focus", () => {
    const model = new FocusModel();
    expect(model.getFocused()).toBeNull();
  });

  it("sets and gets focus", () => {
    const model = new FocusModel();
    model.setFocused("frontend");
    expect(model.getFocused()).toBe("frontend");
  });

  it("clears focus", () => {
    const model = new FocusModel();
    model.setFocused("frontend");
    model.clearFocus();
    expect(model.getFocused()).toBeNull();
  });

  it("isFocused returns correct value", () => {
    const model = new FocusModel();
    model.setFocused("frontend");
    expect(model.isFocused("frontend")).toBe(true);
    expect(model.isFocused("backend")).toBe(false);
  });

  it("switching focus replaces the previous", () => {
    const model = new FocusModel();
    model.setFocused("frontend");
    model.setFocused("backend");
    expect(model.getFocused()).toBe("backend");
    expect(model.isFocused("frontend")).toBe(false);
  });
});
