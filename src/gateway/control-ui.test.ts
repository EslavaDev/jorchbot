import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTROL_UI_BOOTSTRAP_CONFIG_PATH } from "./control-ui-contract.js";
import { handleControlUiHttpRequest } from "./control-ui.js";
import { makeMockHttpResponse } from "./test-http-response.js";

describe("JorchBot Control UI bootstrap config", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "jorchbot-ui-"));
    await fs.writeFile(path.join(tmp, "index.html"), "<html></html>\n");
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("bootstrap config returns assistantName 'JorchBot' and basePath ''", () => {
    const { res, end } = makeMockHttpResponse();
    const handled = handleControlUiHttpRequest(
      { url: CONTROL_UI_BOOTSTRAP_CONFIG_PATH, method: "GET" } as IncomingMessage,
      res,
      {
        root: { kind: "resolved", path: tmp },
        basePath: "",
        config: { ui: { assistant: { name: "JorchBot" } } },
      },
    );
    expect(handled).toBe(true);
    const payload = JSON.parse(String(end.mock.calls[0]?.[0] ?? "")) as {
      basePath: string;
      assistantName: string;
    };
    expect(payload.assistantName).toBe("JorchBot");
    expect(payload.basePath).toBe("");
  });

  it("bootstrap config path uses /__jorchbot/ prefix", () => {
    expect(CONTROL_UI_BOOTSTRAP_CONFIG_PATH).toBe("/__jorchbot/control-ui-config.json");
  });

  it("SPA fallback returns index.html for unknown paths", () => {
    const { res, end } = makeMockHttpResponse();
    const handled = handleControlUiHttpRequest(
      { url: "/foo/bar", method: "GET" } as IncomingMessage,
      res,
      {
        root: { kind: "resolved", path: tmp },
        basePath: "",
      },
    );
    expect(handled).toBe(true);
    expect(end).toHaveBeenCalledWith("<html></html>\n");
  });

  it("missing static assets return 404 (not index.html)", () => {
    const { res, end } = makeMockHttpResponse();
    const handled = handleControlUiHttpRequest(
      { url: "/missing-file.js", method: "GET" } as IncomingMessage,
      res,
      {
        root: { kind: "resolved", path: tmp },
        basePath: "",
      },
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(404);
    expect(end).toHaveBeenCalledWith("Not Found");
  });

  it("root path returns index.html", () => {
    const { res, end } = makeMockHttpResponse();
    const handled = handleControlUiHttpRequest(
      { url: "/", method: "GET" } as IncomingMessage,
      res,
      {
        root: { kind: "resolved", path: tmp },
        basePath: "",
      },
    );
    expect(handled).toBe(true);
    expect(end).toHaveBeenCalledWith("<html></html>\n");
  });
});
