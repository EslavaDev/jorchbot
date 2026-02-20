import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { JorchfileParseError, JorchfileValidationError } from "../errors/index.js";
import { parseJorchfile } from "./parser.js";

describe("parseJorchfile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "jorchfile-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses a basic Jorchfile with one project", () => {
    const content = `
PROJECT frontend
  path = ${tempDir}
  dev = npm run dev
  test = npm run test
`;
    const result = parseJorchfile(content);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe("frontend");
    expect(result.projects[0].path).toBe(tempDir);
    expect(result.projects[0].commands).toEqual({
      dev: "npm run dev",
      test: "npm run test",
    });
  });

  it("parses multiple projects", () => {
    const content = `
PROJECT frontend
  path = ${tempDir}
  dev = npm run dev

PROJECT backend
  path = ${tempDir}
  dev = python manage.py runserver
`;
    const result = parseJorchfile(content);

    expect(result.projects).toHaveLength(2);
    expect(result.projects[0].name).toBe("frontend");
    expect(result.projects[1].name).toBe("backend");
  });

  it("parses reserved fields (port, tunnel, approve, output)", () => {
    const content = `
PROJECT app
  path = ${tempDir}
  port = 3000
  tunnel = serve
  approve = plan
  output = summary
  dev = npm start
`;
    const result = parseJorchfile(content);
    const p = result.projects[0];

    expect(p.port).toBe(3000);
    expect(p.tunnel).toBe("serve");
    expect(p.approve).toBe("plan");
    expect(p.output).toBe("summary");
  });

  it("handles backslash continuation", () => {
    const content = `
PROJECT app
  path = ${tempDir}
  instructions = Line one \\
    line two \\
    line three
`;
    const result = parseJorchfile(content);

    expect(result.projects[0].instructions).toBe("Line one line two line three");
  });

  it("expands ~ in path", () => {
    const content = `
PROJECT app
  path = ~/my-project
  dev = npm start
`;
    const result = parseJorchfile(content);

    expect(result.projects[0].path).toBe(path.join(homedir(), "my-project"));
  });

  it("parses SETTINGS block", () => {
    const content = `
PROJECT app
  path = ${tempDir}

SETTINGS
  log_retention_days = 7
  summary_retention_days = 30
  error_retention_days = 90
  db_max_size_mb = 500
`;
    const result = parseJorchfile(content);

    expect(result.settings.logRetentionDays).toBe(7);
    expect(result.settings.summaryRetentionDays).toBe(30);
    expect(result.settings.errorRetentionDays).toBe(90);
    expect(result.settings.dbMaxSizeMb).toBe(500);
  });

  it("ignores comments and blank lines", () => {
    const content = `
# This is a comment
PROJECT app
  path = ${tempDir}

  # Another comment
  dev = npm start

`;
    const result = parseJorchfile(content);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].commands["dev"]).toBe("npm start");
  });

  it("handles @file references in instructions field", () => {
    const instructionsFile = path.join(tempDir, "instructions.md");
    writeFileSync(instructionsFile, "You are a React expert.\nUse TypeScript.");

    const content = `
PROJECT app
  path = ${tempDir}
  instructions = @./instructions.md
`;
    const result = parseJorchfile(content);

    expect(result.projects[0].instructions).toBe("You are a React expert.\nUse TypeScript.");
  });

  it("handles @file references in command values", () => {
    const scriptFile = path.join(tempDir, "scripts", "dev.sh");
    mkdirSync(path.join(tempDir, "scripts"), { recursive: true });
    writeFileSync(scriptFile, "npm run dev -- --port 3000\n");

    const content = `
PROJECT app
  path = ${tempDir}
  dev = @./scripts/dev.sh
`;
    const result = parseJorchfile(content);

    expect(result.projects[0].commands["dev"]).toBe("npm run dev -- --port 3000");
  });

  it("parses background field as comma-separated list", () => {
    const content = `
PROJECT app
  path = ${tempDir}
  background = dev, build, start
  dev = npm run dev
  build = npm run build
  start = npm start
`;
    const result = parseJorchfile(content);

    expect(result.projects[0].background).toEqual(["dev", "build", "start"]);
  });

  it("defaults background to ['dev', 'build'] when not specified", () => {
    const content = `
PROJECT app
  path = ${tempDir}
  dev = npm run dev
`;
    const result = parseJorchfile(content);

    expect(result.projects[0].background).toEqual(["dev", "build"]);
  });

  it("throws JorchfileValidationError for missing path", () => {
    const content = `
PROJECT app
  dev = npm start
`;

    expect(() => parseJorchfile(content)).toThrow(JorchfileValidationError);
    expect(() => parseJorchfile(content)).toThrow(/missing required field "path"/);
  });

  it("throws JorchfileValidationError for duplicate project names", () => {
    const content = `
PROJECT app
  path = ${tempDir}

PROJECT app
  path = ${tempDir}
`;

    expect(() => parseJorchfile(content)).toThrow(JorchfileValidationError);
    expect(() => parseJorchfile(content)).toThrow(/Duplicate project name/);
  });

  it("throws JorchfileParseError for invalid format (no block)", () => {
    const content = `
  dev = npm start
`;

    expect(() => parseJorchfile(content)).toThrow(JorchfileParseError);
    expect(() => parseJorchfile(content)).toThrow(/outside of a PROJECT or SETTINGS block/);
  });

  it("throws JorchfileParseError for invalid tunnel value", () => {
    const content = `
PROJECT app
  path = ${tempDir}
  tunnel = invalid
`;

    expect(() => parseJorchfile(content)).toThrow(JorchfileParseError);
    expect(() => parseJorchfile(content)).toThrow(/tunnel must be "serve" or "funnel"/);
  });

  it("throws JorchfileParseError for non-existent @file", () => {
    const content = `
PROJECT app
  path = ${tempDir}
  instructions = @./nonexistent.md
`;

    expect(() => parseJorchfile(content)).toThrow(JorchfileParseError);
    expect(() => parseJorchfile(content)).toThrow(/cannot read instructions file/);
  });
});
