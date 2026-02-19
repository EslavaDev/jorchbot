// Phase 4: Tailscale tunnel
// NOTE (DeepWiki rev.2): Two modes — Serve (private, tailnet only) and
// Funnel (public, internet). Funnel limited to ports 443, 8443, 10000.
// This is the ONLY tunnel provider (no Cloudflare fallback).
export type TailscaleTunnelPlaceholder = Record<string, never>;
