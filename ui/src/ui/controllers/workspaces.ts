import type { GatewayBrowserClient } from "../gateway.ts";
import type { WorkspacesListResult } from "../types.ts";

export type WorkspacesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  workspacesLoading: boolean;
  workspacesResult: WorkspacesListResult | null;
  workspacesError: string | null;
};

export async function loadWorkspaces(state: WorkspacesState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.workspacesLoading) {
    return;
  }
  state.workspacesLoading = true;
  state.workspacesError = null;
  try {
    const res = await state.client.request<WorkspacesListResult | undefined>(
      "jb.workspaces.list",
      {},
    );
    if (res) {
      state.workspacesResult = res;
    }
  } catch (err) {
    state.workspacesError = String(err);
  } finally {
    state.workspacesLoading = false;
  }
}

export async function focusWorkspace(state: WorkspacesState, project: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("jb.session.focus", { project });
    await loadWorkspaces(state);
  } catch (err) {
    state.workspacesError = String(err);
  }
}

export async function compactWorkspace(state: WorkspacesState, project: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("jb.session.compact", { project });
    await loadWorkspaces(state);
  } catch (err) {
    state.workspacesError = String(err);
  }
}

export async function stopWorkspace(state: WorkspacesState, project: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("jb.session.stop", { project });
    await loadWorkspaces(state);
  } catch (err) {
    state.workspacesError = String(err);
  }
}

export async function restartWorkspace(state: WorkspacesState, project: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("jb.session.restart", { project });
    await loadWorkspaces(state);
  } catch (err) {
    state.workspacesError = String(err);
  }
}

export async function createWorkspace(
  state: WorkspacesState,
  input: { project: string; path: string; initialMode?: string; initialOutputMode?: string },
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("jb.workspaces.create", input);
    await loadWorkspaces(state);
  } catch (err) {
    state.workspacesError = String(err);
  }
}

export async function deleteWorkspace(state: WorkspacesState, project: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("jb.workspaces.delete", { project });
    await loadWorkspaces(state);
  } catch (err) {
    state.workspacesError = String(err);
  }
}
