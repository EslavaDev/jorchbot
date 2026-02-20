import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { KapsoWebhookVerificationError, KapsoWebhookSignatureError } from "./types.js";
import type {
  KapsoWebhookPayload,
  KapsoIncomingMessage,
  KapsoEventPayload,
  KapsoEventBatchPayload,
  KapsoEventMessage,
} from "./types.js";

interface WebhookHandlerDeps {
  /** Meta forward: verify token for GET hub.verify_token challenge */
  verifyToken: string;
  /** Kapso events: HMAC-SHA256 signing secret */
  webhookSecret: string;
  onMessage: (message: KapsoIncomingMessage, senderPhone: string) => Promise<void>;
  onButtonReply: (buttonId: string, senderPhone: string) => Promise<void>;
}

/**
 * Convert a Kapso (events) v2 message into the KapsoIncomingMessage shape
 * so downstream handlers (CommandRouter, etc.) work with a single type.
 */
function toIncomingMessage(msg: KapsoEventMessage, senderPhone: string): KapsoIncomingMessage {
  return {
    from: senderPhone,
    id: msg.id,
    timestamp: msg.timestamp,
    type: msg.type,
    text: msg.text,
    interactive: msg.interactive,
  };
}

function verifyHmacSignature(rawBody: string, signature: string, secret: string): void {
  if (!signature || !secret) {
    throw new KapsoWebhookSignatureError("Missing webhook signature or secret");
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  const sigBuf = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expected, "hex");

  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new KapsoWebhookSignatureError("Webhook signature mismatch");
  }
}

function processKapsoEvent(event: KapsoEventPayload, deps: WebhookHandlerDeps): Promise<void>[] {
  const senderPhone = event.conversation.phone_number;
  const msg = event.message;
  const promises: Promise<void>[] = [];

  if (msg.type === "interactive") {
    if (msg.interactive?.button_reply) {
      promises.push(deps.onButtonReply(msg.interactive.button_reply.id, senderPhone));
    } else if (msg.interactive?.list_reply) {
      promises.push(deps.onButtonReply(msg.interactive.list_reply.id, senderPhone));
    }
  } else if (msg.type === "text" && msg.text?.body) {
    promises.push(deps.onMessage(toIncomingMessage(msg, senderPhone), senderPhone));
  }

  return promises;
}

interface WebhookHandlers {
  verify(req: Request, res: Response): void;
  receive(req: Request, res: Response): Promise<void>;
}

export function createWebhookHandlers(deps: WebhookHandlerDeps): WebhookHandlers {
  return {
    /**
     * GET handler — Meta forward webhook verification.
     * Kapso sends hub.mode + hub.verify_token + hub.challenge.
     *
     * @throws {KapsoWebhookVerificationError} If verification token doesn't match
     */
    verify(req: Request, res: Response): void {
      const mode = req.query["hub.mode"] as string | undefined;
      const token = req.query["hub.verify_token"] as string | undefined;
      const challenge = req.query["hub.challenge"] as string | undefined;

      if (mode !== "subscribe" || token !== deps.verifyToken) {
        throw new KapsoWebhookVerificationError(
          `Webhook verification failed: mode=${mode}, token mismatch`,
        );
      }

      res.status(200).send(challenge);
    },

    /**
     * POST handler — auto-detects format and processes accordingly:
     *
     * - Header `X-Webhook-Event` present → Kapso (events) v2 format
     * - Body `object: "whatsapp_business_account"` → Meta forward format
     *
     * For Kapso events, verifies HMAC-SHA256 signature if webhookSecret is set.
     *
     * @throws {KapsoWebhookSignatureError} If Kapso events signature is invalid
     */
    async receive(req: Request, res: Response): Promise<void> {
      // Always respond 200 quickly to avoid Kapso retries
      res.sendStatus(200);

      const webhookEvent = req.headers["x-webhook-event"] as string | undefined;

      if (webhookEvent) {
        // --- Kapso (events) v2 format ---
        if (deps.webhookSecret) {
          const signature = req.headers["x-webhook-signature"] as string | undefined;
          const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
          verifyHmacSignature(rawBody, signature ?? "", deps.webhookSecret);
        }

        if (webhookEvent !== "whatsapp.message.received") {
          return;
        }

        const body = req.body as KapsoEventPayload | KapsoEventBatchPayload;
        const promises: Promise<void>[] = [];

        if ("batch" in body && body.batch === true) {
          for (const event of body.data) {
            promises.push(...processKapsoEvent(event, deps));
          }
        } else {
          promises.push(...processKapsoEvent(body as KapsoEventPayload, deps));
        }

        await Promise.all(promises);
        return;
      }

      // --- Meta forward format ---
      const payload = req.body as KapsoWebhookPayload;

      if (payload.object !== "whatsapp_business_account") {
        return;
      }

      for (const entry of payload.entry) {
        for (const change of entry.changes) {
          if (change.field !== "messages") {
            continue;
          }

          const messages = change.value.messages ?? [];
          for (const msg of messages) {
            if (msg.type === "interactive") {
              if (msg.interactive?.button_reply) {
                await deps.onButtonReply(msg.interactive.button_reply.id, msg.from);
              } else if (msg.interactive?.list_reply) {
                await deps.onButtonReply(msg.interactive.list_reply.id, msg.from);
              }
            } else if (msg.type === "text" && msg.text?.body) {
              await deps.onMessage(msg, msg.from);
            }
          }
        }
      }
    },
  };
}
