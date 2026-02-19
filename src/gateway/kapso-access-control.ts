/**
 * Inline E164 normalization to avoid importing from utils.ts,
 * which gets bundled into entry.js and creates a circular dependency.
 */
function normalizePhone(number: string): string {
  const withoutPrefix = number.replace(/^whatsapp:/, "").trim();
  const digits = withoutPrefix.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? `+${digits.slice(1)}` : `+${digits}`;
}

export type KapsoAccessConfig = {
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled";
  allowFrom: string[];
};

export type KapsoAccessResult = {
  allowed: boolean;
  pairingMessage?: string;
};

export async function checkKapsoAccess(
  senderPhone: string,
  config: KapsoAccessConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<KapsoAccessResult> {
  const { dmPolicy } = config;

  if (dmPolicy === "open") {
    return { allowed: true };
  }

  if (dmPolicy === "disabled") {
    return { allowed: false };
  }

  // Dynamic import to avoid static dependency chain that creates
  // bundler circular dependency: jorchbot-start → plugins → jorchbot-start
  const { readChannelAllowFromStore, upsertChannelPairingRequest } =
    await import("../pairing/pairing-store.js");

  const configAllowFrom = config.allowFrom;
  const storeAllowFrom = await readChannelAllowFromStore("kapso", env).catch(() => []);
  const combined = Array.from(new Set([...configAllowFrom, ...storeAllowFrom]));

  if (combined.includes("*")) {
    return { allowed: true };
  }

  const normalizedSender = normalizePhone(senderPhone);
  const normalizedList = combined.filter((entry) => entry !== "*").map(normalizePhone);

  if (normalizedList.includes(normalizedSender)) {
    return { allowed: true };
  }

  if (dmPolicy === "pairing") {
    const { code } = await upsertChannelPairingRequest({
      channel: "kapso",
      id: senderPhone,
      env,
    });

    if (!code) {
      return { allowed: false };
    }

    const message = [
      "JorchBot: access not configured.",
      "",
      `Your WhatsApp number: ${senderPhone}`,
      "",
      `Pairing code: ${code}`,
      "",
      "Ask the bot owner to approve with:",
      `jorchbot pairing approve kapso ${code}`,
    ].join("\n");

    return { allowed: false, pairingMessage: message };
  }

  // dmPolicy === "allowlist" → silent drop
  return { allowed: false };
}
