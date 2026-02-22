/** Tailscale CGNAT range: 100.64.0.0/10 */
const TAILSCALE_CGNAT_PREFIX = 0x64400000; // 100.64.0.0
const TAILSCALE_CGNAT_MASK = 0xffc00000; // /10

/**
 * Check if an IP address belongs to the Tailscale CGNAT range (100.64.0.0/10)
 * or is a loopback address. Handles IPv4-mapped IPv6 addresses (::ffff:x.x.x.x).
 */
export function isTailnetIp(ip: string): boolean {
  if (!ip) {
    return false;
  }

  // Allow IPv6 loopback
  if (ip === "::1") {
    return true;
  }

  // Handle IPv4-mapped IPv6 (::ffff:100.x.x.x)
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;

  // Allow IPv4 loopback
  if (v4 === "127.0.0.1") {
    return true;
  }

  const parts = v4.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return false;
  }

  const a = nums[0] ?? 0;
  const b = nums[1] ?? 0;
  const c = nums[2] ?? 0;
  const d = nums[3] ?? 0;
  const ipNum = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  return (ipNum & TAILSCALE_CGNAT_MASK) === TAILSCALE_CGNAT_PREFIX;
}
