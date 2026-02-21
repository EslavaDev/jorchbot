import { Router } from "express";
import { resolveApprovalByMode } from "../sessions/jorchbot/approval-modes.js";
import type { SessionManager } from "../sessions/jorchbot/manager.js";

export interface ApprovalApiDeps {
  sessionManager: SessionManager;
  sendReplyTo: (phone: string, text: string) => Promise<void>;
}

/**
 * Creates Express router with tool approval endpoints for Claude Code hooks.
 *
 * - POST /api/tool-approval — Hook calls this to request approval
 * - GET /api/tool-approval/:id — Hook polls this for the decision
 * - POST /api/tool-result — Hook reports tool execution result
 */
export function createApprovalRouter(deps: ApprovalApiDeps): Router {
  const router = Router();

  // POST /api/tool-approval — PreToolUse hook requests approval
  router.post("/api/tool-approval", (req, res) => {
    const { sessionId, toolName, toolInput } = req.body as {
      sessionId?: string;
      toolName?: string;
      toolInput?: Record<string, unknown>;
    };

    if (!sessionId || !toolName || !toolInput) {
      res.status(400).json({ error: "Missing sessionId, toolName, or toolInput" });
      return;
    }

    // Find the session's approval manager
    const activeSessions = deps.sessionManager.listActiveWithDetails();
    const session = activeSessions.find((s) => s.id === sessionId);
    if (!session) {
      res.status(404).json({ error: `Session ${sessionId} not found` });
      return;
    }

    // Check mode-based auto-resolution before creating a pending approval
    try {
      const record = deps.sessionManager.getSessionRecordById(sessionId);
      const modeResult = resolveApprovalByMode(record.mode, toolName);
      if (modeResult !== null) {
        res.json({
          id: `auto_${Date.now()}`,
          autoResolved: true,
          status: modeResult.decision === "allow" ? "approved" : "denied",
          reason: modeResult.reason,
        });
        return;
      }
    } catch {
      // Session record not found in DB — fall through to normal approval flow
    }

    // Confirm mode: create pending approval with buttons (existing flow)
    session.approval
      .requestApproval({
        toolUseId: `tool_${Date.now()}`,
        toolName,
        toolInput,
      })
      .then((approvalId) => {
        res.json({ id: approvalId });
      })
      .catch((err: unknown) => {
        console.error("[approval-api] Failed to request approval:", err);
        res.status(500).json({ error: "Failed to request approval" });
      });
  });

  // GET /api/tool-approval/:id — Hook polls for decision
  router.get("/api/tool-approval/:id", (req, res) => {
    const approvalId = req.params.id;

    // Search all sessions for this approval
    const activeSessions = deps.sessionManager.listActiveWithDetails();
    for (const session of activeSessions) {
      const result = session.approval.getApprovalStatus(approvalId);
      if (result !== null) {
        res.json({
          status: result.status,
          additionalContext: result.additionalContext,
        });
        return;
      }
    }

    res.status(404).json({ error: `Approval ${approvalId} not found` });
  });

  // POST /api/tool-result — PostToolUse/PostToolUseFailure hook reports result
  router.post("/api/tool-result", (req, res) => {
    const { sessionId, toolName, summary, success } = req.body as {
      sessionId?: string;
      toolName?: string;
      summary?: string;
      success?: boolean;
    };

    if (!sessionId || !toolName) {
      res.status(400).json({ error: "Missing sessionId or toolName" });
      return;
    }

    const icon = success ? "ok" : "FAIL";
    const resultText = `[${icon}] ${toolName}: ${summary ?? "(no summary)"}`;

    // Find project name from session ID
    const sessions = deps.sessionManager.listActiveWithDetails();
    const session = sessions.find((s) => s.id === sessionId);
    const prefix = session ? `[${session.project}] ` : "";

    if (session) {
      deps.sendReplyTo(session.ownerPhone, `${prefix}${resultText}`).catch((err: unknown) => {
        console.error("[approval-api] Failed to send tool result:", err);
      });
    }

    // Log the tool result
    if (session) {
      const type = success ? "notification" : "error";
      deps.sessionManager.logMessage(sessionId, "system", type, resultText);
    }

    res.json({ ok: true });
  });

  return router;
}
