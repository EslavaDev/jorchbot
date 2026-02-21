import { describe, expect, it } from "vitest";
import { resolveApprovalByMode } from "./approval-modes.js";

describe("resolveApprovalByMode", () => {
  describe("auto mode", () => {
    it("allows write tools", () => {
      expect(resolveApprovalByMode("auto", "Edit")).toStrictEqual({ decision: "allow" });
    });

    it("allows Bash", () => {
      expect(resolveApprovalByMode("auto", "Bash")).toStrictEqual({ decision: "allow" });
    });

    it("allows read-only tools", () => {
      expect(resolveApprovalByMode("auto", "Read")).toStrictEqual({ decision: "allow" });
    });

    it("allows unknown tools", () => {
      expect(resolveApprovalByMode("auto", "SomeCustomTool")).toStrictEqual({ decision: "allow" });
    });
  });

  describe("plan mode", () => {
    it("denies Edit with plan reason", () => {
      const result = resolveApprovalByMode("plan", "Edit");
      expect(result).not.toBeNull();
      expect(result!.decision).toBe("deny");
      expect(result!.reason).toContain("Plan mode");
    });

    it("denies Write", () => {
      const result = resolveApprovalByMode("plan", "Write");
      expect(result!.decision).toBe("deny");
    });

    it("denies Bash", () => {
      const result = resolveApprovalByMode("plan", "Bash");
      expect(result!.decision).toBe("deny");
    });

    it("denies NotebookEdit", () => {
      const result = resolveApprovalByMode("plan", "NotebookEdit");
      expect(result!.decision).toBe("deny");
    });

    it("denies MultiEdit", () => {
      const result = resolveApprovalByMode("plan", "MultiEdit");
      expect(result!.decision).toBe("deny");
    });

    it("allows Read", () => {
      expect(resolveApprovalByMode("plan", "Read")).toStrictEqual({ decision: "allow" });
    });

    it("allows Grep", () => {
      expect(resolveApprovalByMode("plan", "Grep")).toStrictEqual({ decision: "allow" });
    });

    it("allows Glob", () => {
      expect(resolveApprovalByMode("plan", "Glob")).toStrictEqual({ decision: "allow" });
    });

    it("allows WebSearch", () => {
      expect(resolveApprovalByMode("plan", "WebSearch")).toStrictEqual({ decision: "allow" });
    });

    it("allows WebFetch", () => {
      expect(resolveApprovalByMode("plan", "WebFetch")).toStrictEqual({ decision: "allow" });
    });

    it("allows Task", () => {
      expect(resolveApprovalByMode("plan", "Task")).toStrictEqual({ decision: "allow" });
    });

    it("allows unknown tools (not in write list)", () => {
      expect(resolveApprovalByMode("plan", "SomeReadTool")).toStrictEqual({ decision: "allow" });
    });
  });

  describe("confirm mode", () => {
    it("returns null for write tools (normal approval flow)", () => {
      expect(resolveApprovalByMode("confirm", "Edit")).toBeNull();
    });

    it("returns null for read tools (normal approval flow)", () => {
      expect(resolveApprovalByMode("confirm", "Read")).toBeNull();
    });

    it("returns null for Bash (normal approval flow)", () => {
      expect(resolveApprovalByMode("confirm", "Bash")).toBeNull();
    });
  });
});
