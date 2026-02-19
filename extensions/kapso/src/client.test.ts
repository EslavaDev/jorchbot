import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KapsoClient } from "./client.js";
import { KapsoClientError } from "./types.js";

describe("KapsoClient", () => {
  let client: KapsoClient;

  beforeEach(() => {
    client = new KapsoClient({
      apiKey: "test-key",
      phoneNumberId: "12345",
      baseUrl: "https://test.api.kapso.ai",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("sendText", () => {
    it("sends correct payload", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [{ id: "msg_1" }] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.sendText({ to: "+521234567890", body: "Hello" });

      expect(result.messageId).toBe("msg_1");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.api.kapso.ai/12345/messages",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"Hello"'),
        }),
      );
    });

    it("throws KapsoClientError on API error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: () => Promise.resolve("Unauthorized"),
        }),
      );

      await expect(client.sendText({ to: "+521234567890", body: "Hello" })).rejects.toThrow(
        KapsoClientError,
      );
    });

    it("throws KapsoClientError on network error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

      await expect(client.sendText({ to: "+521234567890", body: "Hello" })).rejects.toThrow(
        KapsoClientError,
      );
    });
  });

  describe("sendButtons", () => {
    it("sends correct interactive message", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [{ id: "msg_2" }] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.sendButtons({
        to: "+521234567890",
        body: "Choose:",
        buttons: [{ id: "1", title: "Yes" }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.type).toBe("interactive");
      expect(body.interactive.type).toBe("button");
    });

    it("throws if more than 3 buttons", async () => {
      await expect(
        client.sendButtons({
          to: "+521234567890",
          body: "Choose:",
          buttons: [
            { id: "1", title: "A" },
            { id: "2", title: "B" },
            { id: "3", title: "C" },
            { id: "4", title: "D" },
          ],
        }),
      ).rejects.toThrow(KapsoClientError);
    });
  });

  describe("sendDocument", () => {
    it("sends correct document payload", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [{ id: "msg_3" }] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.sendDocument({
        to: "+521234567890",
        documentUrl: "https://example.com/doc.pdf",
        filename: "doc.pdf",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.type).toBe("document");
      expect(body.document.link).toBe("https://example.com/doc.pdf");
    });
  });
});
