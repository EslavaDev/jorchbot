import { KapsoClientError } from "./types.js";

interface KapsoClientOptions {
  apiKey: string;
  phoneNumberId: string;
  baseUrl?: string;
}

interface SendTextOptions {
  to: string;
  body: string;
}

interface SendButtonsOptions {
  to: string;
  body: string;
  buttons: Array<{ id: string; title: string }>;
}

interface KapsoSendResult {
  messageId: string;
}

export class KapsoClient {
  private readonly apiKey: string;
  private readonly phoneNumberId: string;
  private readonly baseUrl: string;

  constructor(options: KapsoClientOptions) {
    this.apiKey = options.apiKey;
    this.phoneNumberId = options.phoneNumberId;
    this.baseUrl = options.baseUrl ?? "https://api.kapso.ai/meta/whatsapp/v24.0";
  }

  async sendText(options: SendTextOptions): Promise<KapsoSendResult> {
    return this.post("/messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: options.to,
      type: "text",
      text: { body: options.body },
    });
  }

  async sendButtons(options: SendButtonsOptions): Promise<KapsoSendResult> {
    if (options.buttons.length > 3) {
      throw new KapsoClientError(`WhatsApp buttons limited to 3, got ${options.buttons.length}`);
    }
    return this.post("/messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: options.to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: options.body },
        action: {
          buttons: options.buttons.map((btn) => ({
            type: "reply",
            reply: { id: btn.id, title: btn.title },
          })),
        },
      },
    });
  }

  async sendDocument(options: {
    to: string;
    documentUrl: string;
    filename: string;
    caption?: string;
  }): Promise<KapsoSendResult> {
    return this.post("/messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: options.to,
      type: "document",
      document: {
        link: options.documentUrl,
        filename: options.filename,
        caption: options.caption,
      },
    });
  }

  private async post(path: string, body: unknown): Promise<KapsoSendResult> {
    const url = `${this.baseUrl}/${this.phoneNumberId}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      throw new KapsoClientError(
        `Kapso API network error: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown");
      throw new KapsoClientError(`Kapso API error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { messages?: Array<{ id: string }> };
    return { messageId: data.messages?.[0]?.id ?? "" };
  }
}
