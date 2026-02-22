/**
 * Ring buffer for gateway log lines.
 * Captures console output for the `logs.tail` RPC handler.
 */
export class LogBuffer {
  private buffer: string[];
  private capacity: number;
  private head = 0;
  private count = 0;

  constructor(capacity = 1000) {
    this.capacity = capacity;
    this.buffer = Array.from<string>({ length: capacity });
  }

  /** Add a line, evicting the oldest if over capacity. */
  push(line: string): void {
    this.buffer[this.head] = line;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /** Return the last N lines (oldest first). */
  tail(limit: number): string[] {
    const n = Math.min(limit, this.count);
    const result: string[] = [];
    const start = (this.head - n + this.capacity) % this.capacity;
    for (let i = 0; i < n; i++) {
      result.push(this.buffer[(start + i) % this.capacity]);
    }
    return result;
  }

  /** Return the total number of lines stored. */
  get size(): number {
    return this.count;
  }
}

/**
 * Intercept console.log and console.error to capture output into a LogBuffer.
 * Returns the buffer for use in the `logs.tail` RPC handler.
 */
export function interceptConsole(logBuffer: LogBuffer): void {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    logBuffer.push(line);
    originalLog.apply(console, args);
  };

  console.error = (...args: unknown[]) => {
    const line = `[ERROR] ${args.map(String).join(" ")}`;
    logBuffer.push(line);
    originalError.apply(console, args);
  };

  console.warn = (...args: unknown[]) => {
    const line = `[WARN] ${args.map(String).join(" ")}`;
    logBuffer.push(line);
    originalWarn.apply(console, args);
  };
}
