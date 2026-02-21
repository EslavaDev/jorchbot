import { randomUUID } from "node:crypto";
import { Router } from "express";

const DOCUMENT_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const MAX_DOCUMENTS = 100;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

interface StoredDocument {
  content: string;
  filename: string;
  createdAt: number;
}

export interface DocumentRouter {
  router: Router;
  storeDocument: (content: string, filename: string) => string;
  /** Stop the periodic cleanup timer. Call on shutdown. */
  dispose: () => void;
}

/**
 * Creates Express router with document storage and serving endpoints.
 *
 * Documents are stored in-memory with a 1-hour TTL and max 100 entries.
 * Oldest documents are evicted when capacity is reached.
 *
 * - GET /api/documents/:id — download a stored document
 */
export function createDocumentRouter(): DocumentRouter {
  const store = new Map<string, StoredDocument>();

  // Periodic cleanup of expired documents
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, doc] of store) {
      if (now - doc.createdAt > DOCUMENT_EXPIRY_MS) {
        store.delete(id);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  const router = Router();

  router.get("/api/documents/:id", (req, res) => {
    const doc = store.get(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Document not found or expired" });
      return;
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.filename}"`);
    res.send(doc.content);
  });

  function storeDocument(content: string, filename: string): string {
    // Evict oldest if at capacity
    if (store.size >= MAX_DOCUMENTS) {
      const [oldestId] = store.keys();
      store.delete(oldestId);
    }

    const id = randomUUID();
    store.set(id, { content, filename, createdAt: Date.now() });
    return id;
  }

  function dispose(): void {
    clearInterval(cleanupTimer);
    store.clear();
  }

  return { router, storeDocument, dispose };
}
