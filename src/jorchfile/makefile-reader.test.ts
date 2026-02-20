import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MakefileReadError } from "../errors/index.js";
import { readMakefileTargets } from "./makefile-reader.js";

describe("readMakefileTargets", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "makefile-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads target names from a temp Makefile", () => {
    writeFileSync(
      path.join(tempDir, "Makefile"),
      `build:
\tgo build ./...

test:
\tgo test ./...

deploy:
\t./scripts/deploy.sh

.PHONY: build test deploy
`,
    );

    const targets = readMakefileTargets(tempDir);

    expect(targets).toEqual(["build", "test", "deploy"]);
  });

  it("returns empty array when no Makefile exists", () => {
    const targets = readMakefileTargets(tempDir);

    expect(targets).toEqual([]);
  });

  it("skips .PHONY and other dot-targets", () => {
    writeFileSync(
      path.join(tempDir, "Makefile"),
      `.PHONY: all clean
.DEFAULT_GOAL := all

all:
\techo all

clean:
\trm -rf build
`,
    );

    const targets = readMakefileTargets(tempDir);

    expect(targets).toEqual(["all", "clean"]);
  });

  it("throws MakefileReadError for unreadable file", () => {
    const makefilePath = path.join(tempDir, "Makefile");
    writeFileSync(makefilePath, "build:\n\techo hi");
    chmodSync(makefilePath, 0o000);

    expect(() => readMakefileTargets(tempDir)).toThrow(MakefileReadError);

    // Restore permissions for cleanup
    chmodSync(makefilePath, 0o644);
  });
});
