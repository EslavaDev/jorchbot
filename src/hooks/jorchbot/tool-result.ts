/**
 * PostToolUse / PostToolUseFailure hook script for JorchBot.
 *
 * Claude Code invokes this script after executing tools.
 * It reads tool result JSON from stdin and reports to the gateway.
 * This is an async (non-blocking) hook — fire and forget.
 *
 * Detects failure via presence of `tool_error` field in stdin JSON.
 *
 * Environment variables:
 * - JORCHBOT_ACTIVE (required — only JorchBot-spawned instances set this)
 * - JORCHBOT_GATEWAY_PORT (default: 18789)
 * - JORCHBOT_SESSION_ID (required)
 */

// Skip immediately for non-JorchBot Claude instances (e.g. user's local console).
if (!process.env.JORCHBOT_ACTIVE) {
  process.exit(0);
}

interface StdinPayload {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output?: string;
  tool_error?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function formatSummary(payload: StdinPayload): string {
  const { tool_name, tool_input, tool_output, tool_error } = payload;

  if (tool_error) {
    const errMsg = tool_error.length > 200 ? `${tool_error.slice(0, 200)}...` : tool_error;
    return `${tool_name} failed: ${errMsg}`;
  }

  switch (tool_name) {
    case "Edit": {
      const filePath = typeof tool_input.file_path === "string" ? tool_input.file_path : "unknown";
      return `Edited ${filePath}`;
    }
    case "Write": {
      const filePath = typeof tool_input.file_path === "string" ? tool_input.file_path : "unknown";
      return `Wrote ${filePath}`;
    }
    case "Bash": {
      const output = tool_output ?? "";
      const lines = output.split("\n").filter(Boolean);
      if (lines.length > 3) {
        return `${lines.slice(0, 3).join("\n")}... (${lines.length} lines)`;
      }
      return output.length > 200 ? `${output.slice(0, 200)}...` : output || "(no output)";
    }
    case "NotebookEdit": {
      const path =
        typeof tool_input.notebook_path === "string" ? tool_input.notebook_path : "unknown";
      return `Edited notebook ${path}`;
    }
    default:
      return tool_output
        ? tool_output.length > 200
          ? `${tool_output.slice(0, 200)}...`
          : tool_output
        : "(completed)";
  }
}

async function main(): Promise<void> {
  const port = process.env.JORCHBOT_GATEWAY_PORT ?? "18789";
  const sessionId = process.env.JORCHBOT_SESSION_ID;
  const baseUrl = `http://localhost:${port}`;

  if (!sessionId) {
    process.exit(0); // Non-blocking — just exit silently
  }

  let payload: StdinPayload;
  try {
    const input = await readStdin();
    payload = JSON.parse(input) as StdinPayload;
  } catch {
    process.exit(0);
  }

  const success = !payload.tool_error;
  const summary = formatSummary(payload);

  try {
    await fetch(`${baseUrl}/api/tool-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        toolName: payload.tool_name,
        summary,
        success,
      }),
    });
  } catch {
    // Fire and forget — don't fail
  }
}

main().catch(() => {
  process.exit(0);
});
