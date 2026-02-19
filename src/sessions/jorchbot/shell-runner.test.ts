import { describe, expect, it } from "vitest";
import { ShellRunnerTimeoutError } from "../../errors/index.js";
import { ShellRunner } from "./shell-runner.js";

describe("ShellRunner", () => {
  describe("checkDangerous()", () => {
    it("detects rm -rf as dangerous", () => {
      const runner = new ShellRunner();
      const check = runner.checkDangerous("rm -rf node_modules");
      expect(check.isDangerous).toBe(true);
      expect(check.reason).toBe("recursive/force delete");
    });

    it("detects rm -r as dangerous", () => {
      const runner = new ShellRunner();
      expect(runner.checkDangerous("rm -r dist").isDangerous).toBe(true);
    });

    it("detects sudo as dangerous", () => {
      const runner = new ShellRunner();
      const check = runner.checkDangerous("sudo apt install nginx");
      expect(check.isDangerous).toBe(true);
      expect(check.reason).toBe("privilege escalation");
    });

    it("detects git push --force as dangerous", () => {
      const runner = new ShellRunner();
      const check = runner.checkDangerous("git push --force origin main");
      expect(check.isDangerous).toBe(true);
      expect(check.reason).toBe("force push");
    });

    it("detects git reset --hard as dangerous", () => {
      const runner = new ShellRunner();
      expect(runner.checkDangerous("git reset --hard HEAD~1").isDangerous).toBe(true);
    });

    it("detects DROP TABLE as dangerous", () => {
      const runner = new ShellRunner();
      expect(runner.checkDangerous("sqlite3 db.sqlite 'DROP TABLE users'").isDangerous).toBe(true);
    });

    it("allows safe commands", () => {
      const runner = new ShellRunner();
      expect(runner.checkDangerous("ls -la").isDangerous).toBe(false);
      expect(runner.checkDangerous("git status").isDangerous).toBe(false);
      expect(runner.checkDangerous("npm test").isDangerous).toBe(false);
      expect(runner.checkDangerous("cat README.md").isDangerous).toBe(false);
      expect(runner.checkDangerous("git push origin main").isDangerous).toBe(false);
    });
  });

  describe("execute()", () => {
    it("executes a command and returns output", async () => {
      const runner = new ShellRunner();
      const result = await runner.execute("echo hello", "/tmp");
      expect(result.stdout.trim()).toBe("hello");
      expect(result.exitCode).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it("captures stderr", async () => {
      const runner = new ShellRunner();
      const result = await runner.execute("echo error >&2", "/tmp");
      expect(result.stderr.trim()).toBe("error");
    });

    it("returns non-zero exit code without throwing", async () => {
      const runner = new ShellRunner();
      const result = await runner.execute("exit 42", "/tmp");
      expect(result.exitCode).toBe(42);
    });

    it("truncates output exceeding WhatsApp limit", async () => {
      const runner = new ShellRunner();
      // Generate output > 4096 chars using printf (more portable than python)
      const result = await runner.execute("printf '%0.s-' $(seq 1 5000)", "/tmp");
      expect(result.truncated).toBe(true);
      expect(result.stdout.length).toBeLessThanOrEqual(4096);
      expect(result.stdout).toContain("(truncated)");
    });

    it("throws ShellRunnerTimeoutError on timeout", async () => {
      const runner = new ShellRunner();
      await expect(runner.execute("sleep 10", "/tmp", 100)).rejects.toThrow(
        ShellRunnerTimeoutError,
      );
    });

    it("uses provided cwd", async () => {
      const runner = new ShellRunner();
      const result = await runner.execute("pwd", "/tmp");
      // /tmp may resolve to /private/tmp on macOS
      expect(result.stdout.trim()).toMatch(/\/?tmp$/);
    });
  });
});
