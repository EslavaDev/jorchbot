// Phase 4: Tunnel manager
// NOTE (DeepWiki rev.2): Tailscale-only. No Cloudflare fallback.
// Coordinates PortManager + TailscaleManager. Serve (private) is default,
// Funnel (public) is optional and requires explicit user confirmation.
export type TunnelManagerPlaceholder = Record<string, never>;
