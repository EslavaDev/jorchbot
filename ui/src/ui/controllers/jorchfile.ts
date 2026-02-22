import type { GatewayBrowserClient } from "../gateway.ts";
import type { JorchfileGetResult, JorchfileView } from "../types.ts";

export type JorchfileState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  jorchfileLoading: boolean;
  jorchfileResult: JorchfileView | null;
  jorchfileError: string | null;
  jorchfileRaw: string;
  jorchfileDirty: boolean;
  jorchfileTextMode: boolean;
};

export async function loadJorchfile(state: JorchfileState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.jorchfileLoading) {
    return;
  }
  state.jorchfileLoading = true;
  state.jorchfileError = null;
  try {
    const res = await state.client.request<JorchfileGetResult | undefined>("jb.jorchfile.get", {});
    if (res) {
      state.jorchfileResult = res.jorchfile;
      if (res.jorchfile) {
        state.jorchfileRaw = serializeJorchfile(res.jorchfile);
      }
      state.jorchfileDirty = false;
    }
  } catch (err) {
    state.jorchfileError = String(err);
  } finally {
    state.jorchfileLoading = false;
  }
}

export async function saveJorchfile(state: JorchfileState, content: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.jorchfileError = null;
  try {
    await state.client.request("jb.jorchfile.set", { content });
    state.jorchfileDirty = false;
    // Reload after save to get the parsed result back
    await loadJorchfile(state);
  } catch (err) {
    state.jorchfileError = String(err);
  }
}

export async function reloadJorchfile(state: JorchfileState): Promise<void> {
  state.jorchfileDirty = false;
  await loadJorchfile(state);
}

/**
 * Serialize a JorchfileView back to the INI-like Jorchfile text format.
 * This produces content that can be written to disk and parsed by parseJorchfile().
 */
export function serializeJorchfile(jorchfile: JorchfileView): string {
  const lines: string[] = [];

  for (const project of jorchfile.projects) {
    lines.push(`PROJECT ${project.name}`);
    lines.push(`  path = ${project.path}`);

    if (project.port !== undefined) {
      lines.push(`  port = ${project.port}`);
    }
    if (project.tunnel) {
      lines.push(`  tunnel = ${project.tunnel}`);
    }
    if (project.approve) {
      lines.push(`  approve = ${project.approve}`);
    }
    if (project.output) {
      lines.push(`  output = ${project.output}`);
    }
    if (project.instructions) {
      lines.push(`  instructions = ${project.instructions}`);
    }

    // Custom commands
    for (const [name, command] of Object.entries(project.commands)) {
      lines.push(`  ${name} = ${command}`);
    }

    lines.push("");
  }

  // Settings block
  const { settings } = jorchfile;
  const hasSettings =
    settings.logRetentionDays !== undefined ||
    settings.summaryRetentionDays !== undefined ||
    settings.errorRetentionDays !== undefined ||
    settings.dbMaxSizeMb !== undefined;

  if (hasSettings) {
    lines.push("SETTINGS");
    if (settings.logRetentionDays !== undefined) {
      lines.push(`  log_retention_days = ${settings.logRetentionDays}`);
    }
    if (settings.summaryRetentionDays !== undefined) {
      lines.push(`  summary_retention_days = ${settings.summaryRetentionDays}`);
    }
    if (settings.errorRetentionDays !== undefined) {
      lines.push(`  error_retention_days = ${settings.errorRetentionDays}`);
    }
    if (settings.dbMaxSizeMb !== undefined) {
      lines.push(`  db_max_size_mb = ${settings.dbMaxSizeMb}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
