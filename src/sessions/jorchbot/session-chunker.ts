import { chunkTextForOutbound } from "../../plugin-sdk/text-chunking.js";

const WHATSAPP_TEXT_LIMIT = 4096;
const MAX_CHUNKS = 3;
const DOCUMENT_THRESHOLD = 12_000; // chars

export interface SessionChunkResult {
  /** Chunks to send as WhatsApp text messages. */
  chunks: string[];
  /** If set, full content should be sent as document attachment. */
  document?: {
    content: string;
    filename: string;
  };
}

/**
 * Chunk a message for WhatsApp with session prefix and document fallback.
 *
 * - Adds numbered prefix when multiple chunks: "[project] (1/3) ..."
 * - Limits to MAX_CHUNKS messages
 * - Falls back to document attachment for output > DOCUMENT_THRESHOLD
 */
export function chunkForSession(
  content: string,
  project: string,
  options?: { maxChunks?: number; documentThreshold?: number },
): SessionChunkResult {
  const maxChunks = options?.maxChunks ?? MAX_CHUNKS;
  const docThreshold = options?.documentThreshold ?? DOCUMENT_THRESHOLD;

  // Short message — single chunk, no numbering
  if (content.length <= WHATSAPP_TEXT_LIMIT - project.length - 10) {
    return { chunks: [`[${project}] ${content}`] };
  }

  // Long message — check if document is needed
  const needsDocument = content.length > docThreshold;

  // Chunk the content (without prefix, to maximize content per chunk)
  const rawChunks = chunkTextForOutbound(content, WHATSAPP_TEXT_LIMIT - 30);
  const totalChunks = Math.min(rawChunks.length, maxChunks);

  const chunks: string[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const prefix = totalChunks > 1 ? `[${project}] (${i + 1}/${totalChunks})` : `[${project}]`;
    chunks.push(`${prefix} ${rawChunks[i]}`);
  }

  if (needsDocument) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return {
      chunks: [
        ...chunks,
        `[${project}] Output too long (${Math.round(content.length / 1024)}KB). ` +
          `Summary above, full output attached as document.`,
      ],
      document: {
        content,
        filename: `${project}-output-${timestamp}.txt`,
      },
    };
  }

  return { chunks };
}
