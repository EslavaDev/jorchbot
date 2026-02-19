import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { kapsoPlugin } from "./src/channel.js";
import { setKapsoRuntime } from "./src/runtime.js";

const plugin = {
  id: "kapso",
  name: "Kapso (WhatsApp)",
  description: "WhatsApp channel plugin via Kapso.ai official Meta API",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setKapsoRuntime(api.runtime);
    api.registerChannel({ plugin: kapsoPlugin });
  },
};

export default plugin;
