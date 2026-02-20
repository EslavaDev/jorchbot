/**
 * PreToolUse hook script for JorchBot.
 *
 * Claude Code invokes this script before executing write/modify tools.
 * It reads tool invocation JSON from stdin, requests approval from the
 * gateway, and polls until the user approves or denies via WhatsApp.
 *
 * Environment variables:
 * - JORCHBOT_ACTIVE (required — only JorchBot-spawned instances set this)
 * - JORCHBOT_GATEWAY_PORT (default: 18789)
 * - JORCHBOT_SESSION_ID (required)
 */

// Skip immediately for non-JorchBot Claude instances (e.g. user's local console).
// Claude Code inherits parent env, so only JorchBot-spawned processes have this.
if (!process.env.JORCHBOT_ACTIVE) {
  process.exit(0);
}

const POLL_INTERVAL_MS = 500;
const MAX_POLL_MS = 300_000; // 5 minutes

interface StdinPayload {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

interface ApprovalResponse {
  id: string;
}

interface PollResponse {
  status: "pending" | "approved" | "denied";
  reason?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function main(): Promise<void> {
  const port = process.env.JORCHBOT_GATEWAY_PORT ?? "18789";
  const sessionId = process.env.JORCHBOT_SESSION_ID;
  const baseUrl = `http://localhost:${port}`;

  if (!sessionId) {
    console.error("[tool-approval] JORCHBOT_SESSION_ID not set");
    process.exit(1);
  }

  let payload: StdinPayload;
  try {
    const input = await readStdin();
    payload = JSON.parse(input) as StdinPayload;
  } catch {
    console.error("[tool-approval] Failed to parse stdin JSON");
    process.exit(1);
  }

  // Request approval from gateway
  let approvalId: string;
  try {
    const resp = await fetch(`${baseUrl}/api/tool-approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
      }),
    });

    if (!resp.ok) {
      // Session not found (404) or gateway error — deny the tool to prevent
      // orphaned runners from consuming tokens after session destroy.
      const output = {
        hookSpecificOutput: {
          permissionDecision: "deny",
          permissionDecisionReason:
            resp.status === 404
              ? "Session no longer exists on gateway. Use /new to create a new session."
              : `Gateway error (HTTP ${resp.status}). Is the gateway running?`,
        },
      };
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    }

    const data = (await resp.json()) as ApprovalResponse;
    approvalId = data.id;
  } catch {
    // Gateway unreachable — deny to prevent orphaned token consumption.
    const output = {
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: "Cannot reach JorchBot gateway. Is it running?",
      },
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }

  // Poll for decision
  const startTime = Date.now();
  while (Date.now() - startTime < MAX_POLL_MS) {
    try {
      const resp = await fetch(`${baseUrl}/api/tool-approval/${approvalId}`);
      if (!resp.ok) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const data = (await resp.json()) as PollResponse;

      if (data.status === "approved") {
        const output = {
          hookSpecificOutput: {
            permissionDecision: "allow",
            additionalContext: "Approved by user via WhatsApp",
          },
        };
        process.stdout.write(JSON.stringify(output));
        process.exit(0);
      }

      if (data.status === "denied") {
        const output = {
          hookSpecificOutput: {
            permissionDecision: "deny",
            permissionDecisionReason: data.reason ?? "Rejected by user via WhatsApp",
          },
        };
        process.stdout.write(JSON.stringify(output));
        process.exit(0);
      }

      // Still pending
      await sleep(POLL_INTERVAL_MS);
    } catch {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  // Timeout — deny to prevent unattended token consumption.
  const output = {
    hookSpecificOutput: {
      permissionDecision: "deny",
      permissionDecisionReason: "Approval timed out (5 minutes). No response from user.",
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("[tool-approval] Unexpected error:", err);
  process.exit(1);
});
