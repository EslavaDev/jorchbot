import type { PluginRuntime } from "openclaw/plugin-sdk";

let _runtime: PluginRuntime | null = null;

export function setKapsoRuntime(runtime: PluginRuntime): void {
  _runtime = runtime;
}

export function getKapsoRuntime(): PluginRuntime {
  if (!_runtime) {
    throw new Error("Kapso runtime not initialized. Was setKapsoRuntime() called?");
  }
  return _runtime;
}
