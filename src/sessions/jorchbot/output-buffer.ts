const DEFAULT_FLUSH_INTERVAL_MS = 3000;
const WHATSAPP_TEXT_LIMIT = 4096;

type FlushCallback = (text: string) => void;

/**
 * Buffers text events and flushes them in batches.
 *
 * - Accumulates text for up to `flushIntervalMs`
 * - Flushes when buffer exceeds WhatsApp limit
 * - Flushes immediately on `forceFlush()` (used for result/error events)
 * - Respects WhatsApp 4096 char limit per flush
 */
export class OutputBuffer {
  private buffer = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onFlush: FlushCallback;
  private flushIntervalMs: number;

  constructor(onFlush: FlushCallback, flushIntervalMs?: number) {
    this.onFlush = onFlush;
    this.flushIntervalMs = flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  /**
   * Append text to the buffer. Starts a flush timer if not already running.
   */
  append(text: string): void {
    this.buffer += text;

    // Flush immediately if buffer exceeds WhatsApp limit
    if (this.buffer.length >= WHATSAPP_TEXT_LIMIT) {
      this.flush();
      return;
    }

    // Start timer if not running
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  /**
   * Flush the buffer immediately. Called on result/error events.
   */
  forceFlush(): void {
    this.flush();
  }

  /**
   * Dispose the buffer and flush any remaining content.
   */
  dispose(): void {
    this.flush();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.buffer.length === 0) {
      return;
    }

    const text = this.buffer;
    this.buffer = "";
    this.onFlush(text);
  }
}
