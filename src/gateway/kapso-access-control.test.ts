import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore: vi.fn().mockResolvedValue([]),
  upsertChannelPairingRequest: vi.fn().mockResolvedValue({ code: "ABC2XYZ9", created: true }),
}));

const { readChannelAllowFromStore, upsertChannelPairingRequest } =
  await import("../pairing/pairing-store.js");
const { checkKapsoAccess } = await import("./kapso-access-control.js");

const readStoreMock = vi.mocked(readChannelAllowFromStore);
const upsertMock = vi.mocked(upsertChannelPairingRequest);

describe("checkKapsoAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readStoreMock.mockResolvedValue([]);
    upsertMock.mockResolvedValue({ code: "ABC2XYZ9", created: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows any sender when policy is "open"', async () => {
    const result = await checkKapsoAccess("+15550001111", {
      dmPolicy: "open",
      allowFrom: [],
    });

    expect(result.allowed).toBe(true);
    expect(result.pairingMessage).toBeUndefined();
    expect(readStoreMock).not.toHaveBeenCalled();
  });

  it('blocks all senders with no message when policy is "disabled"', async () => {
    const result = await checkKapsoAccess("+15550001111", {
      dmPolicy: "disabled",
      allowFrom: [],
    });

    expect(result.allowed).toBe(false);
    expect(result.pairingMessage).toBeUndefined();
    expect(readStoreMock).not.toHaveBeenCalled();
  });

  it('allows any sender when "*" is in config allowFrom', async () => {
    const result = await checkKapsoAccess("+15550001111", {
      dmPolicy: "pairing",
      allowFrom: ["*"],
    });

    expect(result.allowed).toBe(true);
  });

  it('allows any sender when "*" is in store allowFrom', async () => {
    readStoreMock.mockResolvedValue(["*"]);

    const result = await checkKapsoAccess("+15550001111", {
      dmPolicy: "pairing",
      allowFrom: [],
    });

    expect(result.allowed).toBe(true);
  });

  it("allows sender present in config allowFrom", async () => {
    const result = await checkKapsoAccess("+15550001111", {
      dmPolicy: "pairing",
      allowFrom: ["+15550001111"],
    });

    expect(result.allowed).toBe(true);
  });

  it("allows sender present in store allowFrom (pairing-approved)", async () => {
    readStoreMock.mockResolvedValue(["+15550001111"]);

    const result = await checkKapsoAccess("+15550001111", {
      dmPolicy: "pairing",
      allowFrom: [],
    });

    expect(result.allowed).toBe(true);
  });

  it("normalizes phone numbers before comparison", async () => {
    const result = await checkKapsoAccess("15550001111", {
      dmPolicy: "pairing",
      allowFrom: ["+15550001111"],
    });

    expect(result.allowed).toBe(true);
  });

  it("returns pairing code for unauthorized sender with pairing policy", async () => {
    const result = await checkKapsoAccess("+15559999999", {
      dmPolicy: "pairing",
      allowFrom: ["+15550001111"],
    });

    expect(result.allowed).toBe(false);
    expect(result.pairingMessage).toBeDefined();
    expect(result.pairingMessage).toContain("JorchBot: access not configured.");
    expect(result.pairingMessage).toContain("+15559999999");
    expect(result.pairingMessage).toContain("ABC2XYZ9");
    expect(result.pairingMessage).toContain("jorchbot pairing approve kapso ABC2XYZ9");
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "kapso", id: "+15559999999" }),
    );
  });

  it("blocks silently when pairing code generation returns empty code", async () => {
    upsertMock.mockResolvedValue({ code: "", created: false });

    const result = await checkKapsoAccess("+15559999999", {
      dmPolicy: "pairing",
      allowFrom: [],
    });

    expect(result.allowed).toBe(false);
    expect(result.pairingMessage).toBeUndefined();
  });

  it("blocks unauthorized sender silently with allowlist policy", async () => {
    const result = await checkKapsoAccess("+15559999999", {
      dmPolicy: "allowlist",
      allowFrom: ["+15550001111"],
    });

    expect(result.allowed).toBe(false);
    expect(result.pairingMessage).toBeUndefined();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("deduplicates entries from config and store", async () => {
    readStoreMock.mockResolvedValue(["+15550001111"]);

    const result = await checkKapsoAccess("+15550001111", {
      dmPolicy: "pairing",
      allowFrom: ["+15550001111"],
    });

    expect(result.allowed).toBe(true);
  });

  it("passes env to readChannelAllowFromStore", async () => {
    const env = { JORCHBOT_STATE_DIR: "/tmp/test" } as NodeJS.ProcessEnv;

    await checkKapsoAccess("+15550001111", { dmPolicy: "pairing", allowFrom: [] }, env);

    expect(readStoreMock).toHaveBeenCalledWith("kapso", env);
  });

  it("handles store read failure gracefully", async () => {
    readStoreMock.mockRejectedValue(new Error("file not found"));

    const result = await checkKapsoAccess("+15559999999", {
      dmPolicy: "pairing",
      allowFrom: [],
    });

    expect(result.allowed).toBe(false);
    expect(result.pairingMessage).toBeDefined();
  });
});
