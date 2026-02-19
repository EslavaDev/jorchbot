import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KapsoWebhookVerificationError, KapsoWebhookSignatureError } from "./types.js";
import type { KapsoIncomingMessage } from "./types.js";
import { createWebhookHandlers } from "./webhook.js";

function sign(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");
}

describe("createWebhookHandlers", () => {
  let onMessage: ReturnType<
    typeof vi.fn<(message: KapsoIncomingMessage, senderPhone: string) => Promise<void>>
  >;
  let onButtonReply: ReturnType<
    typeof vi.fn<(buttonId: string, senderPhone: string) => Promise<void>>
  >;
  let handlers: ReturnType<typeof createWebhookHandlers>;

  const SECRET = "test-webhook-secret";

  beforeEach(() => {
    onMessage = vi
      .fn<(message: KapsoIncomingMessage, senderPhone: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    onButtonReply = vi
      .fn<(buttonId: string, senderPhone: string) => Promise<void>>()
      .mockResolvedValue(undefined);

    handlers = createWebhookHandlers({
      verifyToken: "test-token",
      webhookSecret: SECRET,
      onMessage,
      onButtonReply,
    });
  });

  // --- Meta forward format ---

  describe("verify() — Meta forward", () => {
    it("responds with challenge on valid verification", () => {
      const req = {
        query: {
          "hub.mode": "subscribe",
          "hub.verify_token": "test-token",
          "hub.challenge": "challenge123",
        },
      };
      const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };

      handlers.verify(req as never, res as never);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith("challenge123");
    });

    it("throws on invalid verify token", () => {
      const req = {
        query: {
          "hub.mode": "subscribe",
          "hub.verify_token": "wrong-token",
          "hub.challenge": "challenge123",
        },
      };
      const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };

      expect(() => handlers.verify(req as never, res as never)).toThrow(
        KapsoWebhookVerificationError,
      );
    });
  });

  describe("receive() — Meta forward", () => {
    it("calls onMessage for text messages", async () => {
      const req = {
        headers: {},
        body: {
          object: "whatsapp_business_account",
          entry: [
            {
              id: "entry1",
              changes: [
                {
                  field: "messages",
                  value: {
                    messaging_product: "whatsapp",
                    metadata: { display_phone_number: "1234", phone_number_id: "5678" },
                    messages: [
                      {
                        from: "521234567890",
                        id: "msg_1",
                        timestamp: "1708300000",
                        type: "text",
                        text: { body: "Hello" },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      };
      const res = { sendStatus: vi.fn() };

      await handlers.receive(req as never, res as never);

      expect(res.sendStatus).toHaveBeenCalledWith(200);
      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage.mock.calls[0][1]).toBe("521234567890");
    });

    it("calls onButtonReply for button responses", async () => {
      const req = {
        headers: {},
        body: {
          object: "whatsapp_business_account",
          entry: [
            {
              id: "entry1",
              changes: [
                {
                  field: "messages",
                  value: {
                    messaging_product: "whatsapp",
                    metadata: { display_phone_number: "1234", phone_number_id: "5678" },
                    messages: [
                      {
                        from: "521234567890",
                        id: "msg_2",
                        timestamp: "1708300001",
                        type: "interactive",
                        interactive: {
                          type: "button_reply",
                          button_reply: { id: "approve_123", title: "Yes" },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      };
      const res = { sendStatus: vi.fn() };

      await handlers.receive(req as never, res as never);

      expect(onButtonReply).toHaveBeenCalledWith("approve_123", "521234567890");
    });

    it("ignores payloads that are not whatsapp_business_account", async () => {
      const req = {
        headers: {},
        body: { object: "something_else", entry: [] },
      };
      const res = { sendStatus: vi.fn() };

      await handlers.receive(req as never, res as never);

      expect(res.sendStatus).toHaveBeenCalledWith(200);
      expect(onMessage).not.toHaveBeenCalled();
      expect(onButtonReply).not.toHaveBeenCalled();
    });
  });

  // --- Kapso (events) v2 format ---

  describe("receive() — Kapso events", () => {
    function kapsoTextPayload(text: string, phone = "+5215512345678") {
      return {
        message: {
          id: "wamid.123",
          timestamp: "1730092800",
          type: "text",
          text: { body: text },
          kapso: {
            direction: "inbound",
            status: "received",
            processing_status: "pending",
            origin: "cloud_api",
            has_media: false,
            content: text,
          },
        },
        conversation: {
          id: "conv_123",
          phone_number: phone,
          status: "active",
          last_active_at: "2025-10-28T14:25:01Z",
          created_at: "2025-10-28T13:40:00Z",
          updated_at: "2025-10-28T14:25:01Z",
          metadata: {},
          phone_number_id: "123456789012345",
        },
        is_new_conversation: true,
        phone_number_id: "123456789012345",
      };
    }

    it("calls onMessage for Kapso events text message", async () => {
      const body = kapsoTextPayload("Hello from Kapso");
      const req = {
        headers: {
          "x-webhook-event": "whatsapp.message.received",
          "x-webhook-signature": sign(body, SECRET),
          "x-idempotency-key": "uuid-123",
        },
        body,
      };
      const res = { sendStatus: vi.fn() };

      await handlers.receive(req as never, res as never);

      expect(res.sendStatus).toHaveBeenCalledWith(200);
      expect(onMessage).toHaveBeenCalledTimes(1);
      const [msg, senderPhone] = onMessage.mock.calls[0];
      expect(senderPhone).toBe("+5215512345678");
      expect(msg.text?.body).toBe("Hello from Kapso");
      expect(msg.id).toBe("wamid.123");
    });

    it("calls onButtonReply for Kapso events button reply", async () => {
      const body = {
        message: {
          id: "wamid.456",
          timestamp: "1730092801",
          type: "interactive",
          interactive: {
            type: "button_reply",
            button_reply: { id: "approve_456", title: "Approve" },
          },
          kapso: {
            direction: "inbound",
            status: "received",
            processing_status: "pending",
            origin: "cloud_api",
            has_media: false,
            content: "Approve",
          },
        },
        conversation: {
          id: "conv_123",
          phone_number: "+5215512345678",
          status: "active",
          last_active_at: "2025-10-28T14:25:01Z",
          created_at: "2025-10-28T13:40:00Z",
          updated_at: "2025-10-28T14:25:01Z",
          metadata: {},
          phone_number_id: "123456789012345",
        },
        is_new_conversation: false,
        phone_number_id: "123456789012345",
      };
      const req = {
        headers: {
          "x-webhook-event": "whatsapp.message.received",
          "x-webhook-signature": sign(body, SECRET),
        },
        body,
      };
      const res = { sendStatus: vi.fn() };

      await handlers.receive(req as never, res as never);

      expect(onButtonReply).toHaveBeenCalledWith("approve_456", "+5215512345678");
    });

    it("handles batched Kapso events", async () => {
      const body = {
        batch: true,
        data: [kapsoTextPayload("First message"), kapsoTextPayload("Second message")],
        batch_info: {
          size: 2,
          window_ms: 5000,
          sequence_numbers: [1, 2],
          conversation_id: "conv_123",
        },
      };
      const req = {
        headers: {
          "x-webhook-event": "whatsapp.message.received",
          "x-webhook-signature": sign(body, SECRET),
        },
        body,
      };
      const res = { sendStatus: vi.fn() };

      await handlers.receive(req as never, res as never);

      expect(onMessage).toHaveBeenCalledTimes(2);
      expect(onMessage.mock.calls[0][0].text?.body).toBe("First message");
      expect(onMessage.mock.calls[1][0].text?.body).toBe("Second message");
    });

    it("throws on invalid HMAC signature", async () => {
      const body = kapsoTextPayload("Hello");
      const req = {
        headers: {
          "x-webhook-event": "whatsapp.message.received",
          "x-webhook-signature": "deadbeef".repeat(8),
        },
        body,
      };
      const res = { sendStatus: vi.fn() };

      await expect(handlers.receive(req as never, res as never)).rejects.toThrow(
        KapsoWebhookSignatureError,
      );
    });

    it("ignores non-message-received Kapso events", async () => {
      const body = { message: { id: "wamid.789" }, conversation: {} };
      const req = {
        headers: {
          "x-webhook-event": "whatsapp.message.sent",
          "x-webhook-signature": sign(body, SECRET),
        },
        body,
      };
      const res = { sendStatus: vi.fn() };

      await handlers.receive(req as never, res as never);

      expect(onMessage).not.toHaveBeenCalled();
      expect(onButtonReply).not.toHaveBeenCalled();
    });

    it("skips HMAC verification when webhookSecret is empty", async () => {
      const noSecretHandlers = createWebhookHandlers({
        verifyToken: "test-token",
        webhookSecret: "",
        onMessage,
        onButtonReply,
      });

      const body = kapsoTextPayload("No secret");
      const req = {
        headers: {
          "x-webhook-event": "whatsapp.message.received",
          // No signature header
        },
        body,
      };
      const res = { sendStatus: vi.fn() };

      await noSecretHandlers.receive(req as never, res as never);

      expect(onMessage).toHaveBeenCalledTimes(1);
    });
  });
});
