import { access, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { VetoBoardLocale } from "../i18n/locales.js";
import { CURRENT_VETOBOARD_VERSION } from "./selfUpdater.js";

/**
 * 1-Command Full-Power Host Installer (`npx -y vetoboard-mcp@latest init`).
 *
 * Eliminates the "bare MCP vs full plugin" gap by automatically detecting installed coding agents
 * (Antigravity, Claude Code, Cursor, OpenAI Codex CLI, Hermes Agent, or Workspace `.agents/`)
 * and installing the complete 3-in-1 bundle in <1 second:
 *   1. MCP Server entry (`mcp_config.json` / `.claude.json` / `.cursor/mcp.json` / `config.toml` / `config.yaml`)
 *   2. Always-On Guardrail Rules (`AGENTS.md` / `vetoboard.md` — live web grounding, Coordinator MCP gateway, model picker, post-task menu)
 *   3. `/vetoboard` Orchestration Skill & Slash Command (`SKILL.md` + `.claude/commands/vetoboard.md`)
 */

export type HostInstallTarget =
  | "antigravity"
  | "claude"
  | "cursor"
  | "codex"
  | "hermes"
  | "opencode"
  | "t3code"
  | "workspace";

export interface RunHostInitOptions {
  readonly locale: VetoBoardLocale;
  readonly homeDirOverride?: string;
  readonly workspaceDir?: string;
  readonly targets?: readonly HostInstallTarget[];
  readonly preferNpx?: boolean;
  readonly preferLocalBin?: boolean;
  readonly platformOverride?: NodeJS.Platform;
  /** When true (default), also installs VetoBoard's 27 bundled governance skills into each host IDE! */
  readonly includeBundledSkills?: boolean;
}

export interface SkippedCorruptConfigNotice {
  readonly target: HostInstallTarget;
  readonly filePath: string;
  readonly reason: string;
}

export interface InstalledHostSummary {
  readonly target: HostInstallTarget;
  readonly filesWritten: readonly string[];
  readonly backupsCreated?: readonly string[];
  readonly skippedCorruptFiles?: readonly SkippedCorruptConfigNotice[];
  readonly bundledSkillsInstalledCount?: number;
  readonly note: string;
}

export interface RunHostInitResult {
  readonly commandMode: "npx" | "local-node";
  readonly installed: readonly InstalledHostSummary[];
  readonly backupsCreated?: readonly string[];
  readonly skippedCorruptFiles?: readonly SkippedCorruptConfigNotice[];
  readonly markdown: string;
}

const VETOBOARD_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" fill="none">
  <defs>
    <linearGradient id="vbGrad" x1="32" y1="32" x2="224" y2="224" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#38BDF8"/>
      <stop offset="50%" stop-color="#6366F1"/>
      <stop offset="100%" stop-color="#A855F7"/>
    </linearGradient>
  </defs>
  <rect x="28" y="28" width="200" height="200" rx="44" fill="#0F172A" stroke="url(#vbGrad)" stroke-width="10"/>
  <path d="M128 62L182 86V132C182 166 158 192 128 202C98 192 74 166 74 132V86L128 62Z" fill="#1E293B" stroke="#38BDF8" stroke-width="6" stroke-linejoin="round"/>
  <path d="M104 130L121 147L154 112" stroke="#34D399" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="182" cy="74" r="14" fill="#F59E0B"/>
</svg>
`;

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function buildAntigravityAgentsRule(): string {
  return [
    "# VetoBoard Governance Plugin Rules (Always-On Guardrails)",
    "",
    "When the user asks to use **VetoBoard** (`/vetoboard`, `vetoboard_calc`, `vetoboard_plan_lineup`, `vetoboard_start_council`, multi-role whiteboard audit/council, or unit-economics verification):",
    "",
    "1. **Exact MCP Server Name (`vetoboard-mcp_engine`)**:",
    "   - Invoke VetoBoard tools via `call_mcp_tool` with `ServerName: \"vetoboard-mcp_engine\"` (read schema at `<appDataDir>\\mcp\\vetoboard-mcp_engine\\<toolName>.json` once before calling).",
    "   - **Anti-Spoofing Redline**: NEVER hand-type or fabricate a `[+] VetoBoard` progress bar from memory, and NEVER spawn unguarded subagents pretending to be VetoBoard if `call_mcp_tool` fails. If `vetoboard-mcp_engine` returns an error or is unavailable, STOP immediately and report the exact tool error to the user.",
    "",
    "2. **100% Conversational Pre-Flight Briefing + Zero-Omission Model Picker (NEVER Call `ask_question` Popup!)**:",
    "   - Calling `ask_question` hides chat prose and prevents the user from reading the 6-column table! **DO NOT call `ask_question`** during pre-flight setup.",
    "   - Unless the user explicitly says \"不用确认直接跑\":",
    "     1. Call `swarm({ action: \"models\", all: true })` to obtain the complete cross-vendor model list & remaining quotas;",
    "     2. Call `vetoboard_plan_lineup` passing `workspaceDir`, `hostPlatform: \"antigravity\"`, and **`rawHostModelsJson`** set to the **verbatim, unedited JSON string** returned by `swarm({ action: \"models\", all: true })` (**NEVER cherry-pick or omit any model**);",
    "     3. **Print the returned `briefingMarkdown` directly as a normal chat message and end your turn** so the user can reply \"开跑\" or tweak models/roles in plain conversation!",
    "   - On the next turn, translate the user's plain-language reply into `roleIds`, `primaryRoleIds`, `weightOverrides`, `modelOverrides`, `spawnRoleFromSkillIds`, `customRoles`, and **ALWAYS pass `workspaceDir`** when calling `vetoboard_start_council` (`lineupConfirmed: true`).",
    "",
    "3. **Mandatory Live Web Grounding + Coordinator MCP Gateway (Zero `blocked_on_mcp` in `swarm`!)**:",
    "   - **NEVER use `TypeName: \"research\"`** in `invoke_subagent` (`research` has NO network access!). Always use **`TypeName: \"self\"`** (for `inherit`/`pro`/`flash`) OR **`swarm({ action: \"add\", model: \"<exact-model-id>\" })`** (for concrete cross-vendor models).",
    "   - **CRITICAL `swarm` Rule**: Child `swarm` workers do **NOT** have `call_mcp_tool` — ONLY `@coordinator` has `call_mcp_tool`! NEVER ask `swarm` workers to call `call_mcp_tool`: instruct them to post `@coordinator [done]` with verified `https://` URLs + `variables`/`decision` on `board_post`/`board_review`, and write full deliverables via `write_file` to `<workspaceDir>/.vetoboard-tmp/<taskId>/<trackId>.md` so `@coordinator` submits via `vetoboard_submit_track_output({ markdownFilePath })` with zero copy-paste!",
    "   - **Universal Live Web Search First + Borg Weighted Quota Pool**: Every specialist MUST obey its weight-allocated Borg quota (`w>=90` Primary `20-34` searches, `70..89` Guardrail `12-20`, `<70` Secondary `4-8` with zero burst; stop as `[ASSUMPTION]` after 2 empty queries!).",
    "   - **Parallel SWE `workspace: \"share\"` Isolation + 2-Seat Dynamic Peer Gate**: When `>= 2` writable coding tracks (`backend-engineer`, `frontend-engineer`, etc.) run concurrently in `swarm`, ALWAYS pass `workspace: \"share\"` so each edits in an isolated host Git worktree and merges only after `code-reviewer`/`[V1]` LGTM. If `requestPeerRoles` hits Seat 3+ (`awaiting_peer_approval`), ask the user in plain chat (NO `ask_question` popup!) and pass `approvePendingPeerRoles` / `rejectPendingPeerRoles` to `vetoboard_update_council`.",
    "",
    "4. **Whiteboard (`ELECTRE / QMV`) -> Parallel Finalize -> Post-Task Menu & Clean Exit**:",
    "   - Run `board_post` -> `board_review` -> `deliverable` -> `quality-inspector` (`vetoboard_calc mode='reconcile'`, `executiveBriefingMarkdown` with `>= 10` inline `[[Sx·§y]](#ref-sx-secy)` & `[[V1]](#ref-v1)` badges), link the 3 workspace files, **include the concise 2–3 line `🎁 实战资产沉淀与社区共享菜单` at the bottom of your final chat reply**, and **immediately exit VetoBoard mode back to normal chat**!",
    "",
    "5. **1-Sentence Asset Export, Consent-Gated Contribution & Self-Update**:",
    "   - Map *\"存为技能 / 存为角色 / 存为全局规则 / 存为项目模板\"* to `vetoboard_distill_skill({ exportTargets: [...], syncToHostIde: true })`.",
    "   - NEVER call `vetoboard_contribute_asset` with `confirmedConsent: true` before showing `action: \"preview\"` (stating: collected into library, used **SOLELY** for project upgrades/optimization, **100% withdrawable anytime**).",
    "   - Map *\"更新 VetoBoard\"* to `vetoboard_self_update({ action: \"apply\" })`.",
    "",
  ].join("\n");
}

function buildCrossPlatformSkillMarkdown(serverLabel: string): string {
  return [
    "---",
    "name: vetoboard",
    "description: >-",
    "  Run VetoBoard Shared Whiteboard & ELECTRE/QMV mathematical governance, universal live web-grounded research with Effort-Scaling quotas, per-role heterogeneous model selection, deterministic unit-economics & capacity-ceiling verification (vetoboard_calc), and 7-Gate SWE auditing. Activate on /vetoboard or when auditing business/architecture plans and numbers.",
    "---",
    "",
    "# VetoBoard Shared Whiteboard & Hard-Veto Governance (`/vetoboard`)",
    "",
    `Use MCP server \`${serverLabel}\` tools alongside your host's network-capable subagents.`,
    "",
    "## 1. Conversational Pre-Flight + Live Model Picker (Never Use Popups!)",
    "Unless the user explicitly wrote *\"不用确认直接跑\"*:",
    "1. Query available host models if supported (e.g. Antigravity `swarm({ action: \"models\", all: true })` -> pass verbatim JSON in `rawHostModelsJson`; Claude Code `opus`/`sonnet`/`haiku`; Codex/Hermes/T3 Code model list).",
    "2. Call `vetoboard_plan_lineup` (`goal`, `domain`, `workspaceDir`, `hostPlatform`, `rawHostModelsJson` or `hostModels`) and print `briefingMarkdown` directly in chat so the user can reply **\"开跑\"** or tweak models/weights/custom roles in plain language.",
    "3. Call `vetoboard_start_council` (`lineupConfirmed: true`, `workspaceDir`, `roleIds`, `primaryRoleIds`, `weightOverrides`, `modelOverrides`, `customRoles`).",
    "",
    "## 2. Live Web Grounding + Coordinator MCP Gateway",
    "- Every topic (`commercial` & `swe`) MUST verify live primary facts via `search_web`/`WebSearch` BEFORE posting to the whiteboard within its weight-scaled **Borg Quota Pool** (`w>=90` Primary `20-34` calls, `70..89` Guardrail `12-20`, `<70` Secondary `4-8`; stop after 2 empty queries as `[ASSUMPTION]`).",
    "- **Parallel SWE Native Worktree Isolation**: When `>= 2` writable coding tracks run in parallel, use your host's native worktree primitive (Antigravity `swarm` `workspace: \"share\"`, Claude Code `--worktree`, or T3 harness worktrees) and merge after `code-reviewer`/`[V1]` LGTM.",
    "- **Dynamic Peer Expansion (`requestPeerRoles`)**: First 2 peer seats auto-approve from the Borg reflow pool; 3rd+ pauses (`awaiting_peer_approval`) for plain-chat user confirmation via `vetoboard_update_council`.",
    "- If child workers lack direct MCP access (e.g. Antigravity `swarm` workers or sandboxed subagents), do NOT ask workers to call MCP directly: have them write deliverables to `<workspaceDir>/.vetoboard-tmp/<taskId>/<trackId>.md` and submit from the coordinator via `vetoboard_submit_track_output({ markdownFilePath })`!",
    "",
    "## 3. 4-Step Execution -> Post-Task Menu -> Clean Exit",
    "1. `stage='board_post'` -> 2. `stage='board_review'` (`ELECTRE/QMV`) -> 3. `stage='deliverable'` (3-tier SKU + physical capacity utilization `%` + `vetoboard_calc`) -> 4. `quality-inspector` (`reconcile` + `[[Sx·§y]]` & `[[V1]]` citations).",
    "5. Link the 3 exported workspace `.md` files, preserve the 2–3 line **🎁 Post-Task Asset Export & Contribution Menu** at the bottom, and exit cleanly to normal chat.",
    "",
  ].join("\n");
}

type StrictReadResult =
  | { readonly kind: "missing" }
  | { readonly kind: "present"; readonly raw: string }
  | { readonly kind: "io-error"; readonly reason: string };

async function readTextFileStrict(filePath: string): Promise<StrictReadResult> {
  try {
    const raw = await readFile(filePath, "utf8");
    return { kind: "present", raw };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return { kind: "missing" };
    }
    return {
      kind: "io-error",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Safely strips JSONC `//` line comments, `/* ... * /` block comments, and trailing commas `,`
 * BEFORE `}` or `]` WITHOUT touching URLs (`https://...`) or comment tokens inside string literals.
 */
export function stripJsoncCommentsAndTrailingCommas(input: string): string {
  const withoutComments: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    const next = input[i + 1];

    if (inString) {
      withoutComments.push(ch);
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      withoutComments.push(ch);
      continue;
    }

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < input.length && input[i] !== "\n") {
        i++;
      }
      if (i < input.length && input[i] === "\n") {
        withoutComments.push("\n");
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      let closed = false;
      while (i < input.length) {
        if (input[i] === "*" && input[i + 1] === "/") {
          i += 1;
          closed = true;
          break;
        }
        if (input[i] === "\n") {
          withoutComments.push("\n");
        }
        i++;
      }
      if (!closed) {
        // Force JSON.parse to reject unclosed block comments as corrupt!
        withoutComments.push("/*UNCLOSED_BLOCK_COMMENT");
      }
      continue;
    }

    withoutComments.push(ch);
  }

  const joined = withoutComments.join("");
  const out: string[] = [];
  inString = false;
  escaped = false;

  for (let i = 0; i < joined.length; i++) {
    const ch = joined[i]!;
    if (inString) {
      out.push(ch);
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out.push(ch);
      continue;
    }

    if (ch === ",") {
      let k = i + 1;
      while (k < joined.length && /\s/.test(joined[k]!)) {
        k++;
      }
      if (k < joined.length && (joined[k] === "}" || joined[k] === "]")) {
        continue;
      }
    }

    out.push(ch);
  }

  return out.join("");
}

function parseJsonOrJsoncObject(
  raw: string,
): { readonly ok: true; readonly value: Record<string, unknown> } | { readonly ok: false; readonly reason: string } {
  if (raw.includes("\u0000")) {
    return { ok: false, reason: "Contains binary NUL bytes" };
  }
  const cleanBom = raw.replace(/^\uFEFF/, "");
  if (cleanBom.trim().length === 0) {
    return { ok: true, value: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanBom);
  } catch {
    try {
      parsed = JSON.parse(stripJsoncCommentsAndTrailingCommas(cleanBom));
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "Invalid JSON/JSONC syntax",
      };
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      reason: "Top-level JSON value must be an object (refusing to overwrite array/primitive)",
    };
  }

  return { ok: true, value: parsed as Record<string, unknown> };
}

type ConfigWriteOutcome =
  | { readonly status: "written"; readonly backupPath?: string }
  | { readonly status: "unchanged" }
  | { readonly status: "skipped-corrupt"; readonly reason: string };

async function backupAndWriteAtomic(params: {
  readonly filePath: string;
  readonly nextContent: string;
  readonly existingRaw: string | undefined;
  readonly backupDir?: string;
  readonly target: HostInstallTarget;
}): Promise<{ readonly status: "written"; readonly backupPath?: string } | { readonly status: "unchanged" }> {
  if (params.existingRaw !== undefined && params.existingRaw === params.nextContent) {
    return { status: "unchanged" };
  }

  await mkdir(dirname(params.filePath), { recursive: true });

  let backupPath: string | undefined;
  if (params.backupDir && params.existingRaw !== undefined && params.existingRaw.length > 0) {
    await mkdir(params.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const nonce = Math.random().toString(36).slice(2, 6);
    const safeBase = basename(params.filePath).replace(/[^A-Za-z0-9._-]/g, "_");
    backupPath = join(params.backupDir, `${params.target}--${safeBase}.${stamp}-${nonce}.bak`);
    await writeFile(backupPath, params.existingRaw, "utf8");
  }

  const tmpPath = `${params.filePath}.vetoboard-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.tmp`;
  try {
    await writeFile(tmpPath, params.nextContent, "utf8");
    await rename(tmpPath, params.filePath);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw err;
  }

  return { backupPath, status: "written" };
}

function validateTomlSafeToAppend(raw: string): string | undefined {
  if (raw.includes("\u0000")) {
    return "Contains binary NUL bytes";
  }
  if ((raw.match(/"""/g) ?? []).length % 2 !== 0) {
    return "Unclosed multiline string (\"\"\") in config.toml";
  }
  if ((raw.match(/'''/g) ?? []).length % 2 !== 0) {
    return "Unclosed literal multiline string (''') in config.toml";
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[") && !/^\[\[?[A-Za-z0-9_."'-]+(?:\s*\.\s*[A-Za-z0-9_."'-]+)*\]\]?\s*(?:#.*)?$/.test(trimmed)) {
      return `Malformed TOML table header: ${trimmed.slice(0, 60)}`;
    }
  }
  return undefined;
}

async function mergeJsonMcpServerConfig(params: {
  readonly jsonFilePath: string;
  readonly serverKey: string;
  readonly mcpEntry: { readonly command: string; readonly args: readonly string[] };
  readonly backupDir?: string;
  readonly target: HostInstallTarget;
}): Promise<ConfigWriteOutcome> {
  const existing = await readTextFileStrict(params.jsonFilePath);
  if (existing.kind === "io-error") {
    return { reason: existing.reason, status: "skipped-corrupt" };
  }

  let rootObj: Record<string, unknown> = {};
  if (existing.kind === "present") {
    const parsed = parseJsonOrJsoncObject(existing.raw);
    if (!parsed.ok) {
      return { reason: parsed.reason, status: "skipped-corrupt" };
    }
    rootObj = { ...parsed.value };
  }

  if (
    rootObj.mcpServers !== undefined &&
    (!rootObj.mcpServers || typeof rootObj.mcpServers !== "object" || Array.isArray(rootObj.mcpServers))
  ) {
    return {
      reason: "`mcpServers` field exists but is not a JSON object",
      status: "skipped-corrupt",
    };
  }

  const existingServers = (rootObj.mcpServers as Record<string, unknown> | undefined) ?? {};
  rootObj.mcpServers = {
    ...existingServers,
    [params.serverKey]: {
      args: [...params.mcpEntry.args],
      command: params.mcpEntry.command,
    },
  };

  const nextContent = `${JSON.stringify(rootObj, null, 2)}\n`;
  return backupAndWriteAtomic({
    backupDir: params.backupDir,
    existingRaw: existing.kind === "present" ? existing.raw : undefined,
    filePath: params.jsonFilePath,
    nextContent,
    target: params.target,
  });
}

async function mergeOpenCodeMcpConfig(params: {
  readonly jsonFilePath: string;
  readonly serverKey: string;
  readonly commandArray: readonly string[];
  readonly backupDir?: string;
  readonly target: HostInstallTarget;
}): Promise<ConfigWriteOutcome> {
  const existing = await readTextFileStrict(params.jsonFilePath);
  if (existing.kind === "io-error") {
    return { reason: existing.reason, status: "skipped-corrupt" };
  }

  let rootObj: Record<string, unknown> = {};
  if (existing.kind === "present") {
    const parsed = parseJsonOrJsoncObject(existing.raw);
    if (!parsed.ok) {
      return { reason: parsed.reason, status: "skipped-corrupt" };
    }
    rootObj = { ...parsed.value };
  }

  if (rootObj.mcp !== undefined && (!rootObj.mcp || typeof rootObj.mcp !== "object" || Array.isArray(rootObj.mcp))) {
    return {
      reason: "`mcp` field exists in opencode.json but is not a JSON object",
      status: "skipped-corrupt",
    };
  }

  if (!rootObj.$schema) {
    rootObj.$schema = "https://opencode.ai/config.json";
  }

  const existingMcp = (rootObj.mcp as Record<string, unknown> | undefined) ?? {};
  rootObj.mcp = {
    ...existingMcp,
    [params.serverKey]: {
      command: [...params.commandArray],
      enabled: true,
      type: "local",
    },
  };

  const nextContent = `${JSON.stringify(rootObj, null, 2)}\n`;
  return backupAndWriteAtomic({
    backupDir: params.backupDir,
    existingRaw: existing.kind === "present" ? existing.raw : undefined,
    filePath: params.jsonFilePath,
    nextContent,
    target: params.target,
  });
}

async function copyTreeRecursive(srcDir: string, dstDir: string, overwrite: boolean): Promise<void> {
  await mkdir(dstDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const srcPath = join(srcDir, entry.name);
    const dstPath = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      await copyTreeRecursive(srcPath, dstPath, overwrite);
    } else if (entry.isFile()) {
      if (!overwrite && (await pathExists(dstPath))) continue;
      await copyFile(srcPath, dstPath);
    }
  }
}

async function syncBundledGovernanceSkills(
  bundledSkillsRoot: string,
  targetSkillsRoot: string,
  overwriteExisting: boolean,
): Promise<number> {
  if (!(await pathExists(bundledSkillsRoot))) return 0;
  let syncedCount = 0;
  const skillDirs = await readdir(bundledSkillsRoot, { withFileTypes: true });
  for (const entry of skillDirs) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const srcSkillDir = join(bundledSkillsRoot, entry.name);
    const dstSkillDir = join(targetSkillsRoot, entry.name);
    if (!overwriteExisting && (await pathExists(join(dstSkillDir, "SKILL.md")))) {
      syncedCount += 1;
      continue;
    }
    await copyTreeRecursive(srcSkillDir, dstSkillDir, overwriteExisting);
    syncedCount += 1;
  }
  return syncedCount;
}

export async function runHostInit(options: RunHostInitOptions): Promise<RunHostInitResult> {
  const zh = options.locale === "zh";
  const home = options.homeDirOverride ? resolve(options.homeDirOverride) : homedir();
  const ws = options.workspaceDir ? resolve(options.workspaceDir) : process.cwd();
  const effectivePlatform = options.platformOverride ?? process.platform;
  const shouldSyncSkills = options.includeBundledSkills !== false;

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const installRoot = resolve(moduleDir, "..", "..");
  const bundledSkillsRoot = join(installRoot, "skills");
  const cliEntryPath = join(installRoot, "dist", "cli.js").replace(/\\/g, "/");
  const isGitSourceClone = await pathExists(join(installRoot, ".git"));

  const useLocalNode =
    options.preferLocalBin === true || (isGitSourceClone && options.preferNpx !== true);
  const commandMode: "npx" | "local-node" = useLocalNode ? "local-node" : "npx";
  // Windows `npx` resolves to `npx.cmd` and requires `cmd /c npx` for direct child_process.spawn in Claude Code / Codex / Cursor!
  const mcpEntry = useLocalNode
    ? { args: [cliEntryPath, "--lang", "auto"], command: "node" }
    : effectivePlatform === "win32"
      ? { args: ["/c", "npx", "-y", "vetoboard-mcp@latest", "--lang", "auto"], command: "cmd" }
      : { args: ["-y", "vetoboard-mcp@latest", "--lang", "auto"], command: "npx" };

  const selectedTargets = new Set<HostInstallTarget>(options.targets ?? []);
  if (selectedTargets.size === 0) {
    if (
      (await pathExists(join(home, ".gemini", "config"))) ||
      (await pathExists(join(home, ".gemini", "antigravity")))
    ) {
      selectedTargets.add("antigravity");
    }
    if (await pathExists(join(home, ".claude"))) {
      selectedTargets.add("claude");
    }
    if (await pathExists(join(home, ".cursor"))) {
      selectedTargets.add("cursor");
    }
    if (await pathExists(join(home, ".codex"))) {
      selectedTargets.add("codex");
    }
    if (await pathExists(join(home, ".hermes"))) {
      selectedTargets.add("hermes");
    }
    if (await pathExists(join(home, ".config", "opencode"))) {
      selectedTargets.add("opencode");
    }
    if (await pathExists(join(home, ".t3code"))) {
      selectedTargets.add("t3code");
    }
    if (selectedTargets.size === 0) {
      selectedTargets.add("workspace");
    }
  }

  // `t3code` is a multi-harness control plane over Claude Code, Codex, Cursor & OpenCode:
  // ensure OpenCode + any existing T3 harnesses are configured seamlessly when `t3code` is selected!
  if (selectedTargets.has("t3code")) {
    selectedTargets.add("opencode");
    if (await pathExists(join(home, ".claude"))) selectedTargets.add("claude");
    if (await pathExists(join(home, ".codex"))) selectedTargets.add("codex");
    if (await pathExists(join(home, ".cursor"))) selectedTargets.add("cursor");
  }

  const backupDir = join(home, ".vetoboard-mcp", "backups");
  const allBackupsCreated: string[] = [];
  const allSkippedCorruptFiles: SkippedCorruptConfigNotice[] = [];
  const installed: InstalledHostSummary[] = [];

  const recordConfigOutcome = (
    target: HostInstallTarget,
    filePath: string,
    outcome: ConfigWriteOutcome,
    targetFiles: string[],
    targetBackups: string[],
    targetSkipped: SkippedCorruptConfigNotice[],
  ): void => {
    if (outcome.status === "skipped-corrupt") {
      const notice: SkippedCorruptConfigNotice = { filePath, reason: outcome.reason, target };
      targetSkipped.push(notice);
      allSkippedCorruptFiles.push(notice);
      return;
    }
    targetFiles.push(filePath);
    if (outcome.status === "written" && outcome.backupPath) {
      targetBackups.push(outcome.backupPath);
      allBackupsCreated.push(outcome.backupPath);
    }
  };

  // 1. Antigravity Full Plugin Bundle (`~/.gemini/config/plugins/vetoboard-mcp/`)
  if (selectedTargets.has("antigravity")) {
    const plugRoot = join(home, ".gemini", "config", "plugins", "vetoboard-mcp");
    const files: string[] = [];
    const targetBackups: string[] = [];
    const targetSkipped: SkippedCorruptConfigNotice[] = [];

    const pluginJsonPath = join(plugRoot, "plugin.json");
    const pluginReadmePath = join(plugRoot, "README.md");
    const mcpJsonPath = join(plugRoot, "mcp_config.json");
    const rulePath = join(plugRoot, "rules", "AGENTS.md");
    const skillShortPath = join(plugRoot, "skills", "vetoboard", "SKILL.md");
    const skillLegacyPath = join(plugRoot, "skills", "vetoboard-council", "SKILL.md");
    const logoPath = join(plugRoot, "assets", "logo.svg");
    const demoSvgSrcPath = join(installRoot, "assets", "vetoboard-antigravity-demo.svg");
    const demoSvgDstPath = join(plugRoot, "assets", "vetoboard-antigravity-demo.svg");
    const rootReadmeSrcPath = join(
      installRoot,
      zh ? "README.md" : (await pathExists(join(installRoot, "README.en.md"))) ? "README.en.md" : "README.md",
    );

    await mkdir(dirname(rulePath), { recursive: true });
    await mkdir(dirname(skillShortPath), { recursive: true });
    await mkdir(dirname(skillLegacyPath), { recursive: true });
    await mkdir(dirname(logoPath), { recursive: true });

    const pluginManifest = {
      author: "sanzi8",
      description: zh
        ? `v${CURRENT_VETOBOARD_VERSION} · 动态共享白板 + ELECTRE/QMV 数学裁决 + Borg 权重弹性配额池（结余回流/返工缩权）+ 2 席免批动态扩编 + 16 大专业角色 + 27 个治理技能包 + vetoboard_calc 0.5% 确定性核账。`
        : `v${CURRENT_VETOBOARD_VERSION} · Dynamic Shared Whiteboard, ELECTRE/QMV mathematical dominance, Borg Weighted Quota Pool & reflow, 2-seat dynamic peer expansion, 16 roles, 27 skills & deterministic vetoboard_calc.`,
      displayName: `VetoBoard Governance & Hard-Veto Whiteboard (v${CURRENT_VETOBOARD_VERSION})`,
      homepage: "https://github.com/sanzi8/vetoboard-mcp#readme",
      logo: "assets/logo.svg",
      name: "vetoboard-mcp",
      repository: "https://github.com/sanzi8/vetoboard-mcp",
      suggestedPrompts: [
        "/vetoboard 对拟立项的商业计划进行全维度残酷证伪、合规排雷与单位经济精算",
        "调用 vetoboard_calc 独立核验：单价 199 元、硬件成本 68 元、平台抽佣 12%、年固定成本 18 万，宣称 1200 单回本是否算错？",
        "/vetoboard 全栈设计与实现多租户权限与计费对账模块（启用 Borg 配额池与 7-Gate 审查）",
      ],
      version: CURRENT_VETOBOARD_VERSION,
    };

    await writeFile(pluginJsonPath, `${JSON.stringify(pluginManifest, null, 2)}\n`, "utf8");
    if (await pathExists(rootReadmeSrcPath)) {
      await copyFile(rootReadmeSrcPath, pluginReadmePath);
    }
    if (await pathExists(demoSvgSrcPath)) {
      await copyFile(demoSvgSrcPath, demoSvgDstPath);
    }

    // Antigravity automatically prefixes `<pluginDirName>_` onto keys in `<pluginRoot>/mcp_config.json`,
    // so key `"engine"` registers as `vetoboard-mcp_engine`! Remove any stale `"vetoboard-mcp_engine"` duplicate key first.
    const existingAgyMcp = await readTextFileStrict(mcpJsonPath);
    if (existingAgyMcp.kind === "present") {
      const parsedAgy = parseJsonOrJsoncObject(existingAgyMcp.raw);
      if (
        parsedAgy.ok &&
        parsedAgy.value.mcpServers &&
        typeof parsedAgy.value.mcpServers === "object" &&
        !Array.isArray(parsedAgy.value.mcpServers) &&
        "vetoboard-mcp_engine" in (parsedAgy.value.mcpServers as Record<string, unknown>)
      ) {
        const cleanedServers = { ...(parsedAgy.value.mcpServers as Record<string, unknown>) };
        delete cleanedServers["vetoboard-mcp_engine"];
        await writeFile(
          mcpJsonPath,
          `${JSON.stringify({ ...parsedAgy.value, mcpServers: cleanedServers }, null, 2)}\n`,
          "utf8",
        );
      }
    }

    const agyNodeEntry =
      useLocalNode && !options.platformOverride
        ? { args: mcpEntry.args, command: process.execPath }
        : mcpEntry;
    const agyMcpOut = await mergeJsonMcpServerConfig({
      backupDir,
      jsonFilePath: mcpJsonPath,
      mcpEntry: agyNodeEntry,
      serverKey: "engine",
      target: "antigravity",
    });
    files.push(pluginJsonPath, pluginReadmePath);
    recordConfigOutcome("antigravity", mcpJsonPath, agyMcpOut, files, targetBackups, targetSkipped);
    await writeFile(rulePath, buildAntigravityAgentsRule(), "utf8");
    const agySkillMd = buildCrossPlatformSkillMarkdown("vetoboard-mcp_engine");
    await writeFile(skillShortPath, agySkillMd, "utf8");
    await writeFile(
      skillLegacyPath,
      agySkillMd.replace(/^name: vetoboard$/m, "name: vetoboard-council"),
      "utf8",
    );
    await writeFile(logoPath, VETOBOARD_LOGO_SVG, "utf8");
    const agyBundledCount = shouldSyncSkills
      ? await syncBundledGovernanceSkills(bundledSkillsRoot, join(plugRoot, "skills"), true)
      : 0;

    files.push(rulePath, skillShortPath, logoPath);
    installed.push({
      backupsCreated: targetBackups,
      bundledSkillsInstalledCount: agyBundledCount,
      filesWritten: files,
      note: zh
        ? `已安装完整三位一体插件包（MCP 16 大角色 + 常驻护栏 AGENTS.md + /vetoboard + ${agyBundledCount} 个治理技能包）；在 Customizations 开启或点击 \`MCP Servers > Refresh\` 即可生效！`
        : `Installed full Antigravity plugin bundle (16 roles + AGENTS.md + /vetoboard + ${agyBundledCount} governance skills).`,
      skippedCorruptFiles: targetSkipped,
      target: "antigravity",
    });
  }

  // 2. Claude Code (`~/.claude.json` + `~/.claude/skills/vetoboard/SKILL.md` + `~/.claude/commands/vetoboard.md` + 27 bundled skills)
  if (selectedTargets.has("claude")) {
    const claudeJsonPath = join(home, ".claude.json");
    const claudeSkillPath = join(home, ".claude", "skills", "vetoboard", "SKILL.md");
    const claudeCmdPath = join(home, ".claude", "commands", "vetoboard.md");
    const files: string[] = [];
    const targetBackups: string[] = [];
    const targetSkipped: SkippedCorruptConfigNotice[] = [];

    const claudeMcpOut = await mergeJsonMcpServerConfig({
      backupDir,
      jsonFilePath: claudeJsonPath,
      mcpEntry,
      serverKey: "vetoboard",
      target: "claude",
    });
    recordConfigOutcome("claude", claudeJsonPath, claudeMcpOut, files, targetBackups, targetSkipped);
    await mkdir(dirname(claudeSkillPath), { recursive: true });
    await mkdir(dirname(claudeCmdPath), { recursive: true });
    await writeFile(claudeSkillPath, buildCrossPlatformSkillMarkdown("vetoboard"), "utf8");
    await writeFile(
      claudeCmdPath,
      [
        "---",
        "description: Launch VetoBoard Shared Whiteboard & Hard-Veto Mathematical Council on the given goal",
        "---",
        "",
        "Run VetoBoard (`vetoboard_plan_lineup` -> conversational confirmation -> `vetoboard_start_council`) on:",
        "",
        "$ARGUMENTS",
        "",
      ].join("\n"),
      "utf8",
    );
    files.push(claudeSkillPath, claudeCmdPath);
    const claudeBundledCount = shouldSyncSkills
      ? await syncBundledGovernanceSkills(bundledSkillsRoot, join(home, ".claude", "skills"), false)
      : 0;

    installed.push({
      backupsCreated: targetBackups,
      bundledSkillsInstalledCount: claudeBundledCount,
      filesWritten: files,
      note: zh
        ? targetSkipped.length > 0
          ? `已安装 \`/vetoboard\` 斜杠命令与 ${claudeBundledCount} 个治理技能包（检测到 \`~/.claude.json\` 原有语法异常，已保护性跳过未覆盖）！`
          : `已自动安全合并 MCP 配置（含 16 大角色）、\`/vetoboard\` 斜杠命令与 ${claudeBundledCount} 个专业治理技能包！`
        : targetSkipped.length > 0
          ? `Installed \`/vetoboard\` command & ${claudeBundledCount} skills (skipped corrupt \`.claude.json\` without overwriting)!`
          : `Safely merged \`.claude.json\` MCP server (16 roles), \`/vetoboard\` command, and ${claudeBundledCount} governance skills!`,
      skippedCorruptFiles: targetSkipped,
      target: "claude",
    });
  }

  // 3. Cursor (`~/.cursor/mcp.json` + `~/.cursor/skills/vetoboard/SKILL.md` + bundled skills)
  if (selectedTargets.has("cursor")) {
    const cursorMcpPath = join(home, ".cursor", "mcp.json");
    const cursorSkillPath = join(home, ".cursor", "skills", "vetoboard", "SKILL.md");
    const files: string[] = [];
    const targetBackups: string[] = [];
    const targetSkipped: SkippedCorruptConfigNotice[] = [];

    const cursorMcpOut = await mergeJsonMcpServerConfig({
      backupDir,
      jsonFilePath: cursorMcpPath,
      mcpEntry,
      serverKey: "vetoboard",
      target: "cursor",
    });
    recordConfigOutcome("cursor", cursorMcpPath, cursorMcpOut, files, targetBackups, targetSkipped);
    await mkdir(dirname(cursorSkillPath), { recursive: true });
    await writeFile(cursorSkillPath, buildCrossPlatformSkillMarkdown("vetoboard"), "utf8");
    files.push(cursorSkillPath);
    const cursorBundledCount = shouldSyncSkills
      ? await syncBundledGovernanceSkills(bundledSkillsRoot, join(home, ".cursor", "skills"), false)
      : 0;

    installed.push({
      backupsCreated: targetBackups,
      bundledSkillsInstalledCount: cursorBundledCount,
      filesWritten: files,
      note: zh
        ? targetSkipped.length > 0
          ? `已安装 \`vetoboard\` + ${cursorBundledCount} 个治理技能包（检测到 \`~/.cursor/mcp.json\` 原有语法异常，已保护性跳过未覆盖）！`
          : `已自动安全合并 \`~/.cursor/mcp.json\` 并安装 \`vetoboard\` + ${cursorBundledCount} 个专业治理技能包！`
        : targetSkipped.length > 0
          ? `Installed \`vetoboard\` + ${cursorBundledCount} skills (skipped corrupt \`~/.cursor/mcp.json\` without overwriting)!`
          : `Safely merged \`~/.cursor/mcp.json\` and installed \`vetoboard\` + ${cursorBundledCount} governance skills!`,
      skippedCorruptFiles: targetSkipped,
      target: "cursor",
    });
  }

  // 4. OpenAI Codex CLI (`~/.codex/config.toml` + `~/.codex/skills/vetoboard/SKILL.md` + bundled skills)
  if (selectedTargets.has("codex")) {
    const codexTomlPath = join(home, ".codex", "config.toml");
    const codexSkillPath = join(home, ".codex", "skills", "vetoboard", "SKILL.md");
    const files: string[] = [];
    const targetBackups: string[] = [];
    const targetSkipped: SkippedCorruptConfigNotice[] = [];

    await mkdir(dirname(codexSkillPath), { recursive: true });
    await writeFile(codexSkillPath, buildCrossPlatformSkillMarkdown("vetoboard"), "utf8");

    const codexRead = await readTextFileStrict(codexTomlPath);
    let codexOutcome: ConfigWriteOutcome;
    if (codexRead.kind === "io-error") {
      codexOutcome = { reason: codexRead.reason, status: "skipped-corrupt" };
    } else {
      const existingToml = codexRead.kind === "present" ? codexRead.raw : "";
      const tomlErr = codexRead.kind === "present" ? validateTomlSafeToAppend(existingToml) : undefined;
      if (tomlErr) {
        codexOutcome = { reason: tomlErr, status: "skipped-corrupt" };
      } else if (/\[mcp_servers\.vetoboard\]/i.test(existingToml)) {
        codexOutcome = { status: "unchanged" };
      } else {
        const argsToml = mcpEntry.args.map((a) => JSON.stringify(a)).join(", ");
        const block = `[mcp_servers.vetoboard]\ncommand = ${JSON.stringify(mcpEntry.command)}\nargs = [${argsToml}]\n`;
        const nextToml =
          existingToml.trim().length > 0 ? `${existingToml.trimEnd()}\n\n${block}` : block;
        codexOutcome = await backupAndWriteAtomic({
          backupDir,
          existingRaw: codexRead.kind === "present" ? codexRead.raw : undefined,
          filePath: codexTomlPath,
          nextContent: nextToml,
          target: "codex",
        });
      }
    }
    recordConfigOutcome("codex", codexTomlPath, codexOutcome, files, targetBackups, targetSkipped);
    files.push(codexSkillPath);

    const codexBundledCount = shouldSyncSkills
      ? await syncBundledGovernanceSkills(bundledSkillsRoot, join(home, ".codex", "skills"), false)
      : 0;

    installed.push({
      backupsCreated: targetBackups,
      bundledSkillsInstalledCount: codexBundledCount,
      filesWritten: files,
      note: zh
        ? targetSkipped.length > 0
          ? `已同步 \`vetoboard\` + ${codexBundledCount} 个治理技能包（检测到 \`~/.codex/config.toml\` 原有语法异常，已保护性跳过未覆盖）！`
          : `已自动安全写入 \`~/.codex/config.toml\` 并同步 \`vetoboard\` + ${codexBundledCount} 个专业治理技能包！`
        : targetSkipped.length > 0
          ? `Synced \`vetoboard\` + ${codexBundledCount} skills (skipped corrupt \`~/.codex/config.toml\` without overwriting)!`
          : `Safely configured \`~/.codex/config.toml\` and synced \`vetoboard\` + ${codexBundledCount} governance skills!`,
      skippedCorruptFiles: targetSkipped,
      target: "codex",
    });
  }

  // 5. Hermes Agent + DeepSeek (`~/.hermes/config.yaml` + `~/.hermes/skills/vetoboard/SKILL.md` + bundled skills)
  if (selectedTargets.has("hermes")) {
    const hermesYamlPath = join(home, ".hermes", "config.yaml");
    const hermesSkillPath = join(home, ".hermes", "skills", "vetoboard", "SKILL.md");
    const files: string[] = [];
    const targetBackups: string[] = [];
    const targetSkipped: SkippedCorruptConfigNotice[] = [];

    await mkdir(dirname(hermesSkillPath), { recursive: true });
    await writeFile(hermesSkillPath, buildCrossPlatformSkillMarkdown("vetoboard"), "utf8");

    const hermesRead = await readTextFileStrict(hermesYamlPath);
    let hermesOutcome: ConfigWriteOutcome;
    if (hermesRead.kind === "io-error") {
      hermesOutcome = { reason: hermesRead.reason, status: "skipped-corrupt" };
    } else {
      const existingYaml = hermesRead.kind === "present" ? hermesRead.raw : "";
      if (existingYaml.includes("\u0000")) {
        hermesOutcome = { reason: "Contains binary NUL bytes", status: "skipped-corrupt" };
      } else if (/^\s*vetoboard\s*:/m.test(existingYaml)) {
        hermesOutcome = { status: "unchanged" };
      } else {
        const yamlArgs = mcpEntry.args.map((a) => `      - ${JSON.stringify(a)}`).join("\n");
        const entryBlock = `  vetoboard:\n    command: ${JSON.stringify(mcpEntry.command)}\n    args:\n${yamlArgs}\n`;
        const headerMatch = /^mcp_servers\s*:(.*)$/m.exec(existingYaml);
        let nextYaml: string | undefined;
        let yamlErr: string | undefined;

        if (headerMatch) {
          const rest = headerMatch[1]!.trim();
          if (rest === "" || rest.startsWith("#")) {
            const normalized = existingYaml.endsWith("\n") ? existingYaml : `${existingYaml}\n`;
            nextYaml = normalized.replace(
              /^mcp_servers\s*:(?:\s*#.*)?\r?\n/m,
              (m) => `${m}${entryBlock}`,
            );
          } else if (/^(?:\{\s*\}|null|~)(?:\s*#.*)?$/i.test(rest)) {
            nextYaml = existingYaml.replace(
              /^mcp_servers\s*:.*(?:\r?\n|$)/m,
              `mcp_servers:\n${entryBlock}`,
            );
          } else {
            yamlErr = "`mcp_servers` in config.yaml is not a YAML mapping (refusing to overwrite)";
          }
        } else {
          const trimmedStart = existingYaml.trimStart();
          if (trimmedStart.startsWith("{") || trimmedStart.startsWith("[")) {
            yamlErr = "Unexpected JSON/array root in config.yaml (refusing to overwrite)";
          } else {
            const sep = existingYaml.trim().length > 0 ? `${existingYaml.trimEnd()}\n\n` : "";
            nextYaml = `${sep}mcp_servers:\n${entryBlock}`;
          }
        }

        if (yamlErr || nextYaml === undefined) {
          hermesOutcome = {
            reason: yamlErr ?? "Malformed config.yaml",
            status: "skipped-corrupt",
          };
        } else {
          hermesOutcome = await backupAndWriteAtomic({
            backupDir,
            existingRaw: hermesRead.kind === "present" ? hermesRead.raw : undefined,
            filePath: hermesYamlPath,
            nextContent: nextYaml,
            target: "hermes",
          });
        }
      }
    }
    recordConfigOutcome("hermes", hermesYamlPath, hermesOutcome, files, targetBackups, targetSkipped);
    files.push(hermesSkillPath);

    const hermesBundledCount = shouldSyncSkills
      ? await syncBundledGovernanceSkills(bundledSkillsRoot, join(home, ".hermes", "skills"), false)
      : 0;

    installed.push({
      backupsCreated: targetBackups,
      bundledSkillsInstalledCount: hermesBundledCount,
      filesWritten: files,
      note: zh
        ? targetSkipped.length > 0
          ? `已同步 \`vetoboard\` + ${hermesBundledCount} 个治理技能包（检测到 \`~/.hermes/config.yaml\` 原有格式异常，已保护性跳过未覆盖）！`
          : `已自动安全写入 \`~/.hermes/config.yaml\` 并同步 \`vetoboard\` + ${hermesBundledCount} 个专业治理技能包！`
        : targetSkipped.length > 0
          ? `Synced \`vetoboard\` + ${hermesBundledCount} skills (skipped corrupt \`~/.hermes/config.yaml\` without overwriting)!`
          : `Safely configured \`~/.hermes/config.yaml\` and synced \`vetoboard\` + ${hermesBundledCount} governance skills!`,
      skippedCorruptFiles: targetSkipped,
      target: "hermes",
    });
  }

  // 6. OpenCode & T3 Code Harness (`~/.config/opencode/opencode.json` + `~/.config/opencode/skills/vetoboard/SKILL.md` + bundled skills)
  if (selectedTargets.has("opencode")) {
    const opencodeJsonPath = join(home, ".config", "opencode", "opencode.json");
    const opencodeSkillPath = join(home, ".config", "opencode", "skills", "vetoboard", "SKILL.md");
    const files: string[] = [];
    const targetBackups: string[] = [];
    const targetSkipped: SkippedCorruptConfigNotice[] = [];

    const opencodeMcpOut = await mergeOpenCodeMcpConfig({
      backupDir,
      commandArray: [mcpEntry.command, ...mcpEntry.args],
      jsonFilePath: opencodeJsonPath,
      serverKey: "vetoboard",
      target: "opencode",
    });
    recordConfigOutcome("opencode", opencodeJsonPath, opencodeMcpOut, files, targetBackups, targetSkipped);
    await mkdir(dirname(opencodeSkillPath), { recursive: true });
    await writeFile(opencodeSkillPath, buildCrossPlatformSkillMarkdown("vetoboard"), "utf8");
    files.push(opencodeSkillPath);
    const opencodeBundledCount = shouldSyncSkills
      ? await syncBundledGovernanceSkills(
          bundledSkillsRoot,
          join(home, ".config", "opencode", "skills"),
          false,
        )
      : 0;

    installed.push({
      backupsCreated: targetBackups,
      bundledSkillsInstalledCount: opencodeBundledCount,
      filesWritten: files,
      note: zh
        ? targetSkipped.length > 0
          ? `已安装 ${opencodeBundledCount} 个治理技能包（检测到 \`opencode.json\` 原有语法异常，已保护性跳过未覆盖）！`
          : `已自动安全写入 OpenCode / T3 Code 专属 \`opencode.json\`（兼容 JSONC）与 ${opencodeBundledCount} 个治理技能包！`
        : targetSkipped.length > 0
          ? `Installed ${opencodeBundledCount} skills (skipped corrupt \`opencode.json\` without overwriting)!`
          : `Safely configured OpenCode / T3 Code \`opencode.json\` (\`mcp\` array schema) and ${opencodeBundledCount} governance skills!`,
      skippedCorruptFiles: targetSkipped,
      target: "opencode",
    });
  }

  if (selectedTargets.has("t3code")) {
    const t3SkillPath = join(home, ".t3code", "skills", "vetoboard", "SKILL.md");
    await mkdir(dirname(t3SkillPath), { recursive: true });
    await writeFile(t3SkillPath, buildCrossPlatformSkillMarkdown("vetoboard"), "utf8");
    const t3BundledCount = shouldSyncSkills
      ? await syncBundledGovernanceSkills(bundledSkillsRoot, join(home, ".t3code", "skills"), false)
      : 0;

    installed.push({
      backupsCreated: [],
      bundledSkillsInstalledCount: t3BundledCount,
      filesWritten: [t3SkillPath],
      note: zh
        ? `已就绪 T3 Code 多 Harness（Claude Code / Codex / Cursor / OpenCode）跨模型混编与 ${t3BundledCount} 个治理技能包！`
        : `Configured T3 Code multi-harness bundle and ${t3BundledCount} governance skills!`,
      skippedCorruptFiles: [],
      target: "t3code",
    });
  }

  // 7. Workspace-Local Bundle (`.mcp.json` + `.agents/skills/vetoboard/SKILL.md` + `.agents/rules/vetoboard.md` + bundled skills)
  if (selectedTargets.has("workspace")) {
    const wsMcpPath = join(ws, ".mcp.json");
    const wsSkillPath = join(ws, ".agents", "skills", "vetoboard", "SKILL.md");
    const wsRulePath = join(ws, ".agents", "rules", "vetoboard.md");
    const files: string[] = [];
    const targetBackups: string[] = [];
    const targetSkipped: SkippedCorruptConfigNotice[] = [];

    const wsMcpOut = await mergeJsonMcpServerConfig({
      backupDir,
      jsonFilePath: wsMcpPath,
      mcpEntry,
      serverKey: "vetoboard",
      target: "workspace",
    });
    recordConfigOutcome("workspace", wsMcpPath, wsMcpOut, files, targetBackups, targetSkipped);
    await mkdir(dirname(wsSkillPath), { recursive: true });
    await mkdir(dirname(wsRulePath), { recursive: true });
    const skillMd = buildCrossPlatformSkillMarkdown("vetoboard");
    await writeFile(wsSkillPath, skillMd, "utf8");
    await writeFile(wsRulePath, skillMd, "utf8");
    files.push(wsSkillPath, wsRulePath);
    const wsBundledCount = shouldSyncSkills
      ? await syncBundledGovernanceSkills(bundledSkillsRoot, join(ws, ".agents", "skills"), false)
      : 0;

    installed.push({
      backupsCreated: targetBackups,
      bundledSkillsInstalledCount: wsBundledCount,
      filesWritten: files,
      note: zh
        ? targetSkipped.length > 0
          ? `已在 \`${ws}\` 安装 \`.agents/\` 规则与 ${wsBundledCount} 个治理技能包（检测到 \`.mcp.json\` 原有语法异常，已保护性跳过未覆盖）！`
          : `已在当前项目目录 \`${ws}\` 安全生成 \`.mcp.json\` + \`.agents/\` 规则与 ${wsBundledCount} 个治理技能包！`
        : targetSkipped.length > 0
          ? `Installed workspace \`.agents/\` rule & ${wsBundledCount} skills in \`${ws}\` (skipped corrupt \`.mcp.json\` without overwriting)!`
          : `Installed workspace-scoped \`.mcp.json\` + \`.agents/\` rule & ${wsBundledCount} governance skills in \`${ws}\`!`,
      skippedCorruptFiles: targetSkipped,
      target: "workspace",
    });
  }

  const backupBannerLines =
    allBackupsCreated.length > 0
      ? zh
        ? [
            "",
            `💾 **修改前自动备份（共 ${allBackupsCreated.length} 份，随时可回滚）**：`,
            ...allBackupsCreated.map((b) => `- \`${b}\``),
          ]
        : [
            "",
            `💾 **Automatic Pre-Modification Backups (${allBackupsCreated.length} saved)**:`,
            ...allBackupsCreated.map((b) => `- \`${b}\``),
          ]
      : [];

  const corruptWarningLines =
    allSkippedCorruptFiles.length > 0
      ? zh
        ? [
            "",
            `⚠️ **保护性跳过提醒（检测到原配置文件存在语法损坏，已严格保留原文件未做覆盖！）**：`,
            ...allSkippedCorruptFiles.map(
              (s) => `- **${s.target.toUpperCase()}** \`${s.filePath}\`：${s.reason}`,
            ),
          ]
        : [
            "",
            `⚠️ **Fail-Closed Protection (Skipped corrupt config files without overwriting!)**:`,
            ...allSkippedCorruptFiles.map(
              (s) => `- **${s.target.toUpperCase()}** \`${s.filePath}\`: ${s.reason}`,
            ),
          ]
      : [];

  const lines = zh
    ? [
        `## 🚀 VetoBoard 满血三位一体安装完成（\`v${CURRENT_VETOBOARD_VERSION}\` · 启动模式：\`${commandMode}\`）`,
        "",
        ...installed.map(
          (item) =>
            `- ✅ **${item.target.toUpperCase()}**：${item.note}\n  - 写入文件：${item.filesWritten.map((f) => `\`${f}\``).join(" · ")}`,
        ),
        ...backupBannerLines,
        ...corruptWarningLines,
        "",
        "### ⚡ 下一步怎么直接开用？",
        "1. 在你的客户端点击一次 `MCP Servers > Refresh`（若是首次在 Antigravity 安装，在 Customizations 页面把 `vetoboard-mcp` 打开开关即可，免重启）；",
        "2. 在对话框直接输入 **`/vetoboard 评估你的创业方案或架构课题`**（或直接说 **「用 VetoBoard 审一下……」**），看到推荐表后回一句 **「开跑」** 即可！",
      ]
    : [
        `## 🚀 VetoBoard Full 3-in-1 Bundle Installed (\`v${CURRENT_VETOBOARD_VERSION}\` · Mode: \`${commandMode}\`)`,
        "",
        ...installed.map(
          (item) =>
            `- ✅ **${item.target.toUpperCase()}**: ${item.note}\n  - Files: ${item.filesWritten.map((f) => `\`${f}\``).join(" · ")}`,
        ),
        ...backupBannerLines,
        ...corruptWarningLines,
        "",
        "### ⚡ Ready to Use",
        "1. Click `MCP Servers > Refresh` in your IDE (or toggle `vetoboard-mcp` ON in Antigravity Customizations);",
        "2. Type **`/vetoboard <your business or engineering goal>`** and reply **\"Go\"**!",
      ];

  return {
    backupsCreated: allBackupsCreated,
    commandMode,
    installed,
    markdown: lines.join("\n"),
    skippedCorruptFiles: allSkippedCorruptFiles,
  };
}
