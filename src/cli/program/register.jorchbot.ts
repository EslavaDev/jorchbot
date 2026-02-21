import { Command } from "commander";
import { loadConfig } from "../../config/jorchbot-config-loader.js";

export function registerJorchBotCommands(program: Command): void {
  const jb = program.command("jb").description("JorchBot commands");

  jb.command("setup")
    .description("Interactive setup wizard for JorchBot")
    .action(async () => {
      const { runSetup } = await import("../../gateway/jorchbot-setup.js");
      await runSetup();
    });

  jb.command("start")
    .description("Start the JorchBot gateway")
    .option("-p, --port <port>", "Gateway port")
    .option("--host <host>", "Gateway host")
    .action(async (opts) => {
      const { startGateway } = await import("../../gateway/jorchbot-start.js");
      await startGateway(opts);
    });

  jb.command("stop")
    .description("Stop the JorchBot gateway")
    .action(async () => {
      const { stopGateway } = await import("../../gateway/jorchbot-stop.js");
      await stopGateway();
    });

  jb.command("status")
    .description("Show JorchBot gateway status")
    .action(async () => {
      const { showStatus } = await import("../../gateway/jorchbot-status.js");
      await showStatus();
    });

  jb.command("config")
    .description("Show or edit JorchBot configuration")
    .option("--show", "Print current configuration as JSON")
    .option("--path", "Print config file path")
    .action(async (opts: { show?: boolean; path?: boolean }) => {
      if (opts.path) {
        const configDir = process.env.JORCHBOT_CONFIG_DIR ?? "~/.jorchbot";
        console.log(`${configDir}/config.json`);
        return;
      }
      // Default to --show behavior
      const config = loadConfig();
      console.log(JSON.stringify(config, null, 2));
    });

  jb.command("version")
    .description("Show JorchBot version")
    .action(() => {
      // version is set in package.json and read by Commander at program level
      console.log(`jorchbot v${program.parent?.version() ?? program.version() ?? "unknown"}`);
    });

  // Tunnel management subcommand
  const tunnel = jb.command("tunnel").description("Manage tunnels");

  tunnel.addCommand(
    new Command("start")
      .argument("<project>", "Project name")
      .option("-p, --port <port>", "Local port to expose")
      .option("--public", "Use Funnel (public internet) instead of Serve (tailnet)")
      .description("Start a tunnel")
      .action(async (project: string, opts: { port?: string; public?: boolean }) => {
        const port = opts.port ? Number.parseInt(opts.port, 10) : undefined;
        const mode = opts.public ? "funnel" : "serve";
        console.log(`Starting ${mode} tunnel for "${project}"${port ? ` on port ${port}` : ""}...`);
        console.log("Note: Tunnel management requires a running gateway. Use 'jb start' first.");
      }),
  );

  tunnel.addCommand(
    new Command("stop")
      .argument("<project>", "Project name")
      .option("-p, --port <port>", "Specific port to stop")
      .description("Stop tunnel(s)")
      .action(async (project: string, opts: { port?: string }) => {
        const port = opts.port ? Number.parseInt(opts.port, 10) : undefined;
        console.log(`Stopping tunnel(s) for "${project}"${port ? ` on port ${port}` : ""}...`);
        console.log("Note: Tunnel management requires a running gateway. Use 'jb start' first.");
      }),
  );

  tunnel.addCommand(
    new Command("list").description("List active tunnels").action(async () => {
      console.log("Listing active tunnels...");
      console.log("Note: Tunnel management requires a running gateway. Use 'jb start' first.");
    }),
  );

  tunnel.addCommand(
    new Command("status").description("Health status of all tunnels").action(async () => {
      console.log("Checking tunnel health...");
      console.log("Note: Tunnel management requires a running gateway. Use 'jb start' first.");
    }),
  );
}
