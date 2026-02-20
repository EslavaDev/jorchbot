import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JorchfileParseError } from "../errors/index.js";
import { loadJorchfile } from "./loader.js";

describe("loadJorchfile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "jorchfile-loader-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null when Jorchfile does not exist", () => {
    const result = loadJorchfile(path.join(tempDir, "nonexistent"));

    expect(result).toBeNull();
  });

  it("loads and parses a valid Jorchfile from temp directory", () => {
    const projectDir = path.join(tempDir, "my-project");
    mkdirSync(projectDir, { recursive: true });

    const jorchfilePath = path.join(tempDir, "Jorchfile");
    writeFileSync(
      jorchfilePath,
      `
PROJECT app
  path = ${projectDir}
  dev = npm run dev
  test = npm run test
`,
    );

    const result = loadJorchfile(jorchfilePath);

    expect(result).not.toBeNull();
    expect(result!.projects).toHaveLength(1);
    expect(result!.projects[0].name).toBe("app");
    expect(result!.projects[0].path).toBe(projectDir);
    expect(result!.projects[0].commands).toEqual({
      dev: "npm run dev",
      test: "npm run test",
    });
  });

  it("throws JorchfileParseError for malformed file", () => {
    const jorchfilePath = path.join(tempDir, "Jorchfile");
    writeFileSync(jorchfilePath, "this is not valid");

    expect(() => loadJorchfile(jorchfilePath)).toThrow(JorchfileParseError);
  });

  it("logs console.warn for projects with non-existent path", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const jorchfilePath = path.join(tempDir, "Jorchfile");
    writeFileSync(
      jorchfilePath,
      `
PROJECT app
  path = /nonexistent/path/to/project
  dev = npm start
`,
    );

    const result = loadJorchfile(jorchfilePath);

    expect(result).not.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("path does not exist"));

    warnSpy.mockRestore();
  });
});
