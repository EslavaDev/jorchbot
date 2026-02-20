import { describe, expect, it } from "vitest";
import { detectQuestion } from "./question-detector.js";

describe("detectQuestion", () => {
  describe("yes-no questions", () => {
    it("detects simple yes/no question", () => {
      const result = detectQuestion("Do you want to continue?");
      expect(result.isQuestion).toBe(true);
      expect(result.type).toBe("yes-no");
      expect(result.questionText).toBe("Do you want to continue?");
      expect(result.options).toEqual([]);
    });

    it("detects question at end of multi-line text", () => {
      const text = "I found a bug in the code.\nIt seems to be in the parser.\nShould I fix it?";
      const result = detectQuestion(text);
      expect(result.isQuestion).toBe(true);
      expect(result.type).toBe("yes-no");
      expect(result.questionText).toBe("Should I fix it?");
    });

    it("picks the last question line when multiple exist", () => {
      const text = "What do you think?\nI have two options.\nDo you want to refactor?";
      const result = detectQuestion(text);
      expect(result.questionText).toBe("Do you want to refactor?");
    });
  });

  describe("multi-option questions", () => {
    it("detects numbered options with dots", () => {
      const text = "Which approach?\n1. Refactor\n2. Rewrite\n3. Skip";
      const result = detectQuestion(text);
      expect(result.isQuestion).toBe(true);
      expect(result.type).toBe("multi-option");
      expect(result.questionText).toBe("Which approach?");
      expect(result.options).toEqual(["Refactor", "Rewrite", "Skip"]);
    });

    it("detects numbered options with parentheses", () => {
      const text = "Choose one:\n1) First option\n2) Second option\nWhich one?";
      const result = detectQuestion(text);
      expect(result.isQuestion).toBe(true);
      expect(result.type).toBe("multi-option");
      expect(result.options).toEqual(["First option", "Second option"]);
    });

    it("detects lettered options", () => {
      const text = "Pick a method:\na) First\nb) Second\nWhich?";
      const result = detectQuestion(text);
      expect(result.isQuestion).toBe(true);
      expect(result.type).toBe("multi-option");
      expect(result.options).toEqual(["First", "Second"]);
    });

    it("detects uppercase lettered options", () => {
      const text = "Choose:\nA. Alpha\nB. Beta\nC. Gamma\nWhich one?";
      const result = detectQuestion(text);
      expect(result.type).toBe("multi-option");
      expect(result.options).toEqual(["Alpha", "Beta", "Gamma"]);
    });

    it("detects bullet options with dashes", () => {
      const text = "Here are the options:\n- A\n- B\n- C\n- D\nWhich one?";
      const result = detectQuestion(text);
      expect(result.isQuestion).toBe(true);
      expect(result.type).toBe("multi-option");
      expect(result.options).toEqual(["A", "B", "C", "D"]);
    });

    it("detects bullet options with asterisks", () => {
      const text = "Options:\n* Refactor\n* Rewrite\nWhich do you prefer?";
      const result = detectQuestion(text);
      expect(result.type).toBe("multi-option");
      expect(result.options).toEqual(["Refactor", "Rewrite"]);
    });
  });

  describe("not a question", () => {
    it("returns isQuestion false for plain statement", () => {
      const result = detectQuestion("I fixed the bug.");
      expect(result.isQuestion).toBe(false);
      expect(result.questionText).toBe("");
      expect(result.options).toEqual([]);
    });

    it("returns isQuestion false for completion message", () => {
      const result = detectQuestion("Done. The file was updated successfully.");
      expect(result.isQuestion).toBe(false);
    });

    it("returns isQuestion false for empty string", () => {
      const result = detectQuestion("");
      expect(result.isQuestion).toBe(false);
    });

    it("returns isQuestion false for whitespace-only string", () => {
      const result = detectQuestion("   \n\n  ");
      expect(result.isQuestion).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles mixed text with question at end", () => {
      const text =
        "I analyzed the codebase and found several patterns.\n" +
        "The main issue is in the auth module.\n" +
        "Would you like me to proceed with the fix?";
      const result = detectQuestion(text);
      expect(result.isQuestion).toBe(true);
      expect(result.type).toBe("yes-no");
      expect(result.questionText).toBe("Would you like me to proceed with the fix?");
    });

    it("trims whitespace from options", () => {
      const text = "Which?\n1.   Spaced option   \n2.   Another   ";
      const result = detectQuestion(text);
      expect(result.options).toEqual(["Spaced option", "Another"]);
    });

    it("handles options before the question line", () => {
      const text = "I can:\n1. Add tests\n2. Fix bugs\n3. Refactor code\nWhat should I do?";
      const result = detectQuestion(text);
      expect(result.isQuestion).toBe(true);
      expect(result.type).toBe("multi-option");
      expect(result.questionText).toBe("What should I do?");
      expect(result.options).toEqual(["Add tests", "Fix bugs", "Refactor code"]);
    });
  });
});
