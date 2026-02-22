import { clearDeviceAuthToken, storeDeviceAuthToken } from "../device-auth.ts";
import { loadOrCreateDeviceIdentity } from "../device-identity.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { BlockedDevicesResult } from "../types.ts";

export type DeviceTokenSummary = {
  role: string;
  scopes?: string[];
  createdAtMs?: number;
  rotatedAtMs?: number;
  revokedAtMs?: number;
  lastUsedAtMs?: number;
};

export type PendingDevice = {
  requestId: string;
  deviceId: string;
  displayName?: string;
  role?: string;
  remoteIp?: string;
  isRepair?: boolean;
  ts?: number;
};

export type PairedDevice = {
  deviceId: string;
  displayName?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  tokens?: DeviceTokenSummary[];
  createdAtMs?: number;
  approvedAtMs?: number;
};

export type DevicePairingList = {
  pending: PendingDevice[];
  paired: PairedDevice[];
};

export type DevicesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  devicesLoading: boolean;
  devicesError: string | null;
  devicesList: DevicePairingList | null;
};

export async function loadDevices(state: DevicesState, opts?: { quiet?: boolean }) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.devicesLoading) {
    return;
  }
  state.devicesLoading = true;
  if (!opts?.quiet) {
    state.devicesError = null;
  }
  try {
    const res = await state.client.request<{
      pending?: Array<PendingDevice>;
      paired?: Array<PendingDevice>;
    }>("device.pair.list", {});
    state.devicesList = {
      pending: Array.isArray(res?.pending) ? res.pending : [],
      paired: Array.isArray(res?.paired) ? res.paired : [],
    };
  } catch (err) {
    if (!opts?.quiet) {
      state.devicesError = String(err);
    }
  } finally {
    state.devicesLoading = false;
  }
}

export async function approveDevicePairing(state: DevicesState, requestId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("device.pair.approve", { requestId });
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}

export async function removeDevice(state: DevicesState, deviceId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const confirmed = window.confirm(
    `Remove paired device "${deviceId}"? This will revoke its access.`,
  );
  if (!confirmed) {
    return;
  }
  try {
    await state.client.request("device.pair.remove", { deviceId });
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}

export async function rejectDevicePairing(state: DevicesState, requestId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const confirmed = window.confirm("Reject this device pairing request?");
  if (!confirmed) {
    return;
  }
  try {
    await state.client.request("device.pair.reject", { requestId });
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}

export async function rotateDeviceToken(
  state: DevicesState,
  params: { deviceId: string; role: string; scopes?: string[] },
) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{
      token: string;
      role?: string;
      deviceId?: string;
      scopes?: Array<string>;
    }>("device.token.rotate", params);
    if (res?.token) {
      const identity = await loadOrCreateDeviceIdentity();
      const role = res.role ?? params.role;
      if (res.deviceId === identity.deviceId || params.deviceId === identity.deviceId) {
        storeDeviceAuthToken({
          deviceId: identity.deviceId,
          role,
          token: res.token,
          scopes: res.scopes ?? params.scopes ?? [],
        });
      }
      window.prompt("New device token (copy and store securely):", res.token);
    }
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}

export async function revokeDeviceToken(
  state: DevicesState,
  params: { deviceId: string; role: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const confirmed = window.confirm(`Revoke token for ${params.deviceId} (${params.role})?`);
  if (!confirmed) {
    return;
  }
  try {
    await state.client.request("device.token.revoke", params);
    const identity = await loadOrCreateDeviceIdentity();
    if (params.deviceId === identity.deviceId) {
      clearDeviceAuthToken({ deviceId: identity.deviceId, role: params.role });
    }
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}

// --- Phase I: Blocked devices ---

export type BlockedDevicesState = DevicesState & {
  blockedDevicesLoading: boolean;
  blockedDevicesResult: BlockedDevicesResult | null;
};

export async function loadBlockedDevices(state: BlockedDevicesState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.blockedDevicesLoading = true;
  try {
    const res = await state.client.request<BlockedDevicesResult>("jb.devices.blocked", {});
    state.blockedDevicesResult = res ?? { devices: [] };
  } catch {
    // Silently fail — blocked list is supplementary
    state.blockedDevicesResult = { devices: [] };
  } finally {
    state.blockedDevicesLoading = false;
  }
}

export async function blockDeviceFromUi(state: BlockedDevicesState, deviceId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const reason = window.prompt(`Block device "${deviceId}"? Enter a reason (optional):`);
  if (reason === null) {
    return; // User cancelled
  }
  try {
    await state.client.request("jb.devices.block", { deviceId, reason: reason || undefined });
    await loadBlockedDevices(state);
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}

export async function unblockDeviceFromUi(state: BlockedDevicesState, deviceId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const confirmed = window.confirm(`Unblock device "${deviceId}"?`);
  if (!confirmed) {
    return;
  }
  try {
    await state.client.request("jb.devices.unblock", { deviceId });
    await loadBlockedDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}
