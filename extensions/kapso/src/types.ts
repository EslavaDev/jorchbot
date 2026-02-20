import { JorchBotError } from "../../../src/errors/index.js";

export class KapsoClientError extends JorchBotError {}
export class KapsoWebhookVerificationError extends JorchBotError {}
export class KapsoWebhookSignatureError extends JorchBotError {}

// --- Meta forward webhook types (used by OpenClaw ChannelPlugin) ---

export interface KapsoWebhookPayload {
  object: string;
  entry: KapsoWebhookEntry[];
}

export interface KapsoWebhookEntry {
  id: string;
  changes: KapsoWebhookChange[];
}

export interface KapsoWebhookChange {
  field: string;
  value: KapsoWebhookValue;
}

export interface KapsoWebhookValue {
  messaging_product: string;
  metadata: { display_phone_number: string; phone_number_id: string };
  messages?: KapsoIncomingMessage[];
  statuses?: KapsoMessageStatus[];
}

export interface KapsoIncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description: string };
  };
}

export interface KapsoMessageStatus {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
}

// --- Resolved account (for ChannelPlugin<ResolvedKapsoAccount>) ---

export interface ResolvedKapsoAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  apiKey: string;
  phoneNumberId: string;
  webhookVerifyToken: string;
  webhookSecret: string;
  dmPolicy: string;
  allowFrom: string[];
}

// --- Kapso (events) v2 webhook types (used by JorchBot gateway) ---

export interface KapsoEventMessage {
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { caption?: string; id: string };
  audio?: { id: string };
  document?: { caption?: string; id: string; filename?: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description: string };
  };
  reaction?: { message_id: string; emoji: string };
  kapso?: {
    direction: string;
    status: string;
    processing_status: string;
    origin: string;
    has_media: boolean;
    content: string;
    transcript?: { text: string };
    media_url?: string;
    media_data?: {
      url: string;
      filename: string;
      content_type: string;
      byte_size: number;
    };
  };
}

export interface KapsoEventConversation {
  id: string;
  phone_number: string;
  status: string;
  last_active_at: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  phone_number_id: string;
  kapso?: {
    contact_name: string;
    messages_count: number;
    last_message_id: string;
    last_message_type: string;
    last_message_timestamp: string;
    last_message_text: string;
    last_inbound_at: string | null;
    last_outbound_at: string | null;
  };
}

export interface KapsoEventPayload {
  message: KapsoEventMessage;
  conversation: KapsoEventConversation;
  is_new_conversation: boolean;
  phone_number_id: string;
}

export interface KapsoEventBatchPayload {
  batch: true;
  data: KapsoEventPayload[];
  batch_info: {
    size: number;
    window_ms: number;
    sequence_numbers: number[];
    conversation_id: string;
  };
}

export interface ApprovalButtonPayload {
  sessionId: string;
  approvalId: string;
  action: "approve" | "reject";
}

export interface QuestionAnswerPayload {
  type: "question_answer";
  project: string;
  answer: string;
}

export type ButtonPayload =
  | ApprovalButtonPayload
  | QuestionAnswerPayload
  | { type: "shell_approve"; command: string; project: string }
  | { type: "shell_reject"; command: string; project: string };
