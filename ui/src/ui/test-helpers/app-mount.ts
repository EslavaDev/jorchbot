import { afterEach, beforeEach } from "vitest";
import type { JorchBotApp } from "../app.ts";

export function mountApp(pathname: string) {
  window.history.replaceState({}, "", pathname);
  const app = document.createElement("jorchbot-app") as JorchBotApp;
  app.connect = () => {
    // no-op: avoid real gateway WS connections in browser tests
  };
  document.body.append(app);
  return app;
}

export function registerAppMountHooks() {
  beforeEach(() => {
    window.__JORCHBOT_CONTROL_UI_BASE_PATH__ = undefined;
    localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    window.__JORCHBOT_CONTROL_UI_BASE_PATH__ = undefined;
    localStorage.clear();
    document.body.innerHTML = "";
  });
}
