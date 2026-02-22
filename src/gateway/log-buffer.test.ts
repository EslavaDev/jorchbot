import { describe, expect, it } from "vitest";
import { LogBuffer } from "./log-buffer.js";

describe("LogBuffer", () => {
  it("stores and retrieves lines", () => {
    const buf = new LogBuffer(10);
    buf.push("line 1");
    buf.push("line 2");

    expect(buf.tail(10)).toEqual(["line 1", "line 2"]);
    expect(buf.size).toBe(2);
  });

  it("tail returns only last N lines", () => {
    const buf = new LogBuffer(10);
    buf.push("a");
    buf.push("b");
    buf.push("c");

    expect(buf.tail(2)).toEqual(["b", "c"]);
  });

  it("evicts oldest lines when over capacity", () => {
    const buf = new LogBuffer(3);
    buf.push("a");
    buf.push("b");
    buf.push("c");
    buf.push("d");

    expect(buf.tail(10)).toEqual(["b", "c", "d"]);
    expect(buf.size).toBe(3);
  });

  it("handles wrap-around correctly", () => {
    const buf = new LogBuffer(3);
    for (let i = 0; i < 10; i++) {
      buf.push(`line ${i}`);
    }

    expect(buf.tail(3)).toEqual(["line 7", "line 8", "line 9"]);
  });

  it("returns empty array when no lines pushed", () => {
    const buf = new LogBuffer(10);
    expect(buf.tail(5)).toEqual([]);
    expect(buf.size).toBe(0);
  });

  it("tail with limit 0 returns empty array", () => {
    const buf = new LogBuffer(10);
    buf.push("a");
    expect(buf.tail(0)).toEqual([]);
  });
});
