#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
  listAssetContributions,
  previewOrSubmitAssetContribution,
  withdrawAssetContribution,
} from "./core/assetContribution.js";
import { renderDockerBuildProgress } from "./core/progressRenderer.js";
import { createStarterAssetPack } from "./core/roleCatalog.js";
import { runSelfUpdate } from "./core/selfUpdater.js";
import { distillStandardizedSkill, type DistillExportTarget } from "./core/skillDistiller.js";
import { VetoBoardTaskStore } from "./core/taskStore.js";
import { resolveLocale } from "./i18n/locales.js";
import { startVetoBoardHttpServer } from "./mcp/httpServer.js";
import { createVetoBoardMcpServer } from "./mcp/server.js";

function parseFlag(argv: readonly string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  const prefixed = argv.find((a) => a.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : undefined;
}

async function runWatchMode(taskId: string, store: VetoBoardTaskStore): Promise<void> {
  let lastSnapshot = "";
  while (true) {
    const task = await store.getTask(taskId);
    if (!task) {
      process.stderr.write(`Task "${taskId}" not found in ${store.rootDir}\n`);
      process.exitCode = 1;
      return;
    }
    const rendered = renderDockerBuildProgress(task, { ansi: true });
    if (rendered !== lastSnapshot) {
      process.stdout.write(`\x1b[2J\x1b[H${rendered}\n`);
      lastSnapshot = rendered;
    }
    if (task.status === "completed" || task.status === "failed" || task.status === "paused") {
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0];
  const langFlag = parseFlag(args, "--lang") as "auto" | "en" | "zh" | undefined;
  const dataDirFlag = parseFlag(args, "--data-dir");
  const store = new VetoBoardTaskStore(dataDirFlag);

  if (subcommand === "serve") {
    const portStr = parseFlag(args, "--port");
    const host = parseFlag(args, "--host") ?? "127.0.0.1";
    const port = portStr ? Number(portStr) : 4399;
    const started = await startVetoBoardHttpServer({
      defaultLocale: langFlag ?? "auto",
      host,
      port,
      store,
    });
    process.stderr.write(`[vetoboard-mcp] Remote Streamable HTTP MCP listening on ${started.url}\n`);
    return;
  }

  if (subcommand === "watch") {
    const taskId = args[1];
    if (!taskId) {
      process.stderr.write("Usage: vetoboard-mcp watch <taskId>\n");
      process.exitCode = 1;
      return;
    }
    await runWatchMode(taskId, store);
    return;
  }

  if (subcommand === "export-starter-pack") {
    process.stdout.write(`${JSON.stringify(createStarterAssetPack(), null, 2)}\n`);
    return;
  }

  if (subcommand === "distill-skill") {
    const taskId = args[1];
    const skillId = parseFlag(args, "--skill-id");
    const alsoCreateRole = args.includes("--also-role");
    const syncToHostIde = args.includes("--sync-ide");
    const targetsRaw = parseFlag(args, "--targets");
    const validTargets = new Set<DistillExportTarget>(["skill", "role", "rule", "project-pack"]);
    const exportTargets = targetsRaw
      ? (targetsRaw
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is DistillExportTarget => validTargets.has(s as DistillExportTarget)))
      : undefined;
    const task = taskId && !taskId.startsWith("--") ? await store.getTask(taskId) : undefined;
    const locale = resolveLocale(langFlag ?? "auto", task?.goal ?? "中文");
    const res = await distillStandardizedSkill({
      alsoCreateRole,
      dataRootDir: store.rootDir,
      exportTargets,
      locale,
      skillId,
      store,
      syncToHostIde,
      task: task ?? undefined,
    });
    process.stdout.write(`${res.summaryMarkdown}\n`);
    return;
  }

  if (subcommand === "contribute") {
    const assetTypeArg =
      args[1] === "role" ? "role" : args[1] === "pack" ? "pack" : "skill";
    const assetId = args[2] && !args[2].startsWith("--") ? args[2] : args[1];
    if (!assetId || assetId.startsWith("--")) {
      process.stderr.write(
        "Usage: vetoboard-mcp contribute <role|skill|pack> <assetId> [--confirm] [--gh] [--repo=owner/repo]\n",
      );
      process.exitCode = 1;
      return;
    }
    const confirmed = args.includes("--confirm");
    const res = await previewOrSubmitAssetContribution({
      action: confirmed ? "submit" : "preview",
      assetId,
      assetType:
        args[1] === "role" || args[1] === "skill" || args[1] === "pack" ? assetTypeArg : "skill",
      autoRunGhCli: args.includes("--gh"),
      confirmedConsent: confirmed,
      dataRootDir: store.rootDir,
      locale: resolveLocale(langFlag ?? "auto", "中文"),
      targetRepo: parseFlag(args, "--repo"),
    });
    process.stdout.write(`${res.markdown}\n`);
    if (res.isError) process.exitCode = 1;
    return;
  }

  if (subcommand === "update" || subcommand === "check-update") {
    const res = await runSelfUpdate({
      action: subcommand === "update" ? "apply" : "check",
      dataRootDir: store.rootDir,
      dryRun: args.includes("--dry-run"),
      locale: resolveLocale(langFlag ?? "auto", "中文"),
      repoDirOverride: parseFlag(args, "--repo-dir"),
    });
    process.stdout.write(`${res.markdown}\n`);
    if (res.isError) process.exitCode = 1;
    return;
  }

  if (subcommand === "withdraw") {
    const submissionId = args[1];
    if (!submissionId) {
      process.stderr.write("Usage: vetoboard-mcp withdraw <submissionId> [--reason=...] [--gh]\n");
      process.exitCode = 1;
      return;
    }
    const res = await withdrawAssetContribution({
      autoRunGhCli: args.includes("--gh"),
      dataRootDir: store.rootDir,
      locale: resolveLocale(langFlag ?? "auto", "中文"),
      reason: parseFlag(args, "--reason"),
      submissionId,
    });
    process.stdout.write(`${res.markdown}\n`);
    if (res.isError) process.exitCode = 1;
    return;
  }

  if (subcommand === "contributions") {
    const out = await listAssetContributions({
      dataRootDir: store.rootDir,
      locale: resolveLocale(langFlag ?? "auto", "中文"),
    });
    process.stdout.write(`${out}\n`);
    return;
  }

  // Default: MCP Stdio mode (`npx vetoboard-mcp`) — strictly zero non-JSON-RPC writes to stdout!
  const server = createVetoBoardMcpServer({
    defaultLocale: langFlag ?? "auto",
    store,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(
    `[vetoboard-mcp] Fatal error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
