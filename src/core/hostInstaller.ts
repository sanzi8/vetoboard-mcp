import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
}

export interface InstalledHostSummary {
  readonly target: HostInstallTarget;
  readonly filesWritten: readonly string[];
  readonly note: string;
}

export interface RunHostInitResult {
  readonly commandMode: "npx" | "local-node";
  readonly installed: readonly InstalledHostSummary[];
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
    "   - **Universal Live Web Search First + 20/60/20 Quota**: Every specialist across ALL domains (`commercial` & `swe`) MUST call `search_web` FIRST (`<= 5–8` searches on `board_post`, `<= 12–18` on `deliverable`, `<= 6` on inspector; stop as `[ASSUMPTION]` after 2 empty queries!).",
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
    "- Every topic (`commercial` & `swe`) MUST verify live primary facts via `search_web`/`WebSearch` BEFORE posting to the whiteboard (`<= 5–8` calls on `board_post`, `<= 12–18` on `deliverable`; stop after 2 empty queries as `[ASSUMPTION]`).",
    "- If child workers lack direct MCP access (e.g. Antigravity `swarm` workers or sandboxed subagents), do NOT ask workers to call MCP directly: have them write deliverables to `<workspaceDir>/.vetoboard-tmp/<taskId>/<trackId>.md` and submit from the coordinator via `vetoboard_submit_track_output({ markdownFilePath })`!",
    "",
    "## 3. 4-Step Execution -> Post-Task Menu -> Clean Exit",
    "1. `stage='board_post'` -> 2. `stage='board_review'` (`ELECTRE/QMV`) -> 3. `stage='deliverable'` (3-tier SKU + physical capacity utilization `%` + `vetoboard_calc`) -> 4. `quality-inspector` (`reconcile` + `[[Sx·§y]]` & `[[V1]]` citations).",
    "5. Link the 3 exported workspace `.md` files, preserve the 2–3 line **🎁 Post-Task Asset Export & Contribution Menu** at the bottom, and exit cleanly to normal chat.",
    "",
  ].join("\n");
}

async function mergeJsonMcpServerConfig(
  jsonFilePath: string,
  serverKey: string,
  mcpEntry: { readonly command: string; readonly args: readonly string[] },
): Promise<void> {
  let rootObj: Record<string, unknown> = {};
  try {
    const raw = await readFile(jsonFilePath, "utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      rootObj = parsed as Record<string, unknown>;
    }
  } catch {
    // File absent or empty -> initialize fresh object
  }

  const existingServers =
    rootObj.mcpServers && typeof rootObj.mcpServers === "object" && !Array.isArray(rootObj.mcpServers)
      ? (rootObj.mcpServers as Record<string, unknown>)
      : {};

  rootObj.mcpServers = {
    ...existingServers,
    [serverKey]: {
      args: [...mcpEntry.args],
      command: mcpEntry.command,
    },
  };

  await mkdir(dirname(jsonFilePath), { recursive: true });
  await writeFile(jsonFilePath, `${JSON.stringify(rootObj, null, 2)}\n`, "utf8");
}

async function mergeOpenCodeMcpConfig(
  jsonFilePath: string,
  serverKey: string,
  commandArray: readonly string[],
): Promise<void> {
  let rootObj: Record<string, unknown> = {};
  try {
    const raw = await readFile(jsonFilePath, "utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      rootObj = parsed as Record<string, unknown>;
    }
  } catch {
    // File absent or empty -> initialize fresh OpenCode config
  }

  if (!rootObj.$schema) {
    rootObj.$schema = "https://opencode.ai/config.json";
  }

  const existingMcp =
    rootObj.mcp && typeof rootObj.mcp === "object" && !Array.isArray(rootObj.mcp)
      ? (rootObj.mcp as Record<string, unknown>)
      : {};

  rootObj.mcp = {
    ...existingMcp,
    [serverKey]: {
      command: [...commandArray],
      enabled: true,
      type: "local",
    },
  };

  await mkdir(dirname(jsonFilePath), { recursive: true });
  await writeFile(jsonFilePath, `${JSON.stringify(rootObj, null, 2)}\n`, "utf8");
}

export async function runHostInit(options: RunHostInitOptions): Promise<RunHostInitResult> {
  const zh = options.locale === "zh";
  const home = options.homeDirOverride ? resolve(options.homeDirOverride) : homedir();
  const ws = options.workspaceDir ? resolve(options.workspaceDir) : process.cwd();
  const effectivePlatform = options.platformOverride ?? process.platform;

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const installRoot = resolve(moduleDir, "..", "..");
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

  const installed: InstalledHostSummary[] = [];

  // 1. Antigravity Full Plugin Bundle (`~/.gemini/config/plugins/vetoboard-mcp/`)
  if (selectedTargets.has("antigravity")) {
    const plugRoot = join(home, ".gemini", "config", "plugins", "vetoboard-mcp");
    const files: string[] = [];

    const pluginJsonPath = join(plugRoot, "plugin.json");
    const mcpJsonPath = join(plugRoot, "mcp_config.json");
    const rulePath = join(plugRoot, "rules", "AGENTS.md");
    const skillShortPath = join(plugRoot, "skills", "vetoboard", "SKILL.md");
    const skillLegacyPath = join(plugRoot, "skills", "vetoboard-council", "SKILL.md");
    const logoPath = join(plugRoot, "assets", "logo.svg");

    await mkdir(dirname(rulePath), { recursive: true });
    await mkdir(dirname(skillShortPath), { recursive: true });
    await mkdir(dirname(skillLegacyPath), { recursive: true });
    await mkdir(dirname(logoPath), { recursive: true });

    const pluginManifest = {
      author: "VetoBoard Contributors",
      description:
        "Dynamic Shared Whiteboard, ELECTRE/QMV mathematical dominance, non-compensatory Hard Veto gates, and zero-hallucination vetoboard_calc math verification (EN/ZH).",
      displayName: "VetoBoard Governance & Hard-Veto Whiteboard",
      logo: "assets/logo.svg",
      name: "vetoboard-mcp",
      suggestedPrompts: [
        "调用 vetoboard_calc 独立核验：单价 199 元、硬件成本 68 元、平台抽佣 12%、年固定成本 18 万，宣称 1200 单回本是否算错？",
        "用 VetoBoard 评估：零本金过渡至高校科研仪器维修的创业方案是否可持续盈利？",
        "Run a VetoBoard 7-Gate SWE council to design and audit a 10k req/s multi-tenant webhook engine",
      ],
      version: CURRENT_VETOBOARD_VERSION,
    };

    await writeFile(pluginJsonPath, `${JSON.stringify(pluginManifest, null, 2)}\n`, "utf8");
    await mergeJsonMcpServerConfig(mcpJsonPath, "vetoboard-mcp_engine", mcpEntry);
    await writeFile(rulePath, buildAntigravityAgentsRule(), "utf8");
    const agySkillMd = buildCrossPlatformSkillMarkdown("vetoboard-mcp_engine");
    await writeFile(skillShortPath, agySkillMd, "utf8");
    await writeFile(
      skillLegacyPath,
      agySkillMd.replace(/^name: vetoboard$/m, "name: vetoboard-council"),
      "utf8",
    );
    await writeFile(logoPath, VETOBOARD_LOGO_SVG, "utf8");

    files.push(pluginJsonPath, mcpJsonPath, rulePath, skillShortPath, logoPath);
    installed.push({
      filesWritten: files,
      note: zh
        ? "已安装完整三位一体插件包（MCP + 常驻护栏 AGENTS.md + /vetoboard 技能）；在 Customizations 开启或点击 `MCP Servers > Refresh` 即可生效！"
        : "Installed full 3-in-1 Antigravity plugin bundle (enable in Customizations or click `MCP Servers > Refresh`).",
      target: "antigravity",
    });
  }

  // 2. Claude Code (`~/.claude.json` + `~/.claude/skills/vetoboard/SKILL.md` + `~/.claude/commands/vetoboard.md`)
  if (selectedTargets.has("claude")) {
    const claudeJsonPath = join(home, ".claude.json");
    const claudeSkillPath = join(home, ".claude", "skills", "vetoboard", "SKILL.md");
    const claudeCmdPath = join(home, ".claude", "commands", "vetoboard.md");

    await mergeJsonMcpServerConfig(claudeJsonPath, "vetoboard", mcpEntry);
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

    installed.push({
      filesWritten: [claudeJsonPath, claudeSkillPath, claudeCmdPath],
      note: zh
        ? "已自动写入 MCP 配置、技能包与 `/vetoboard` 斜杠命令！"
        : "Configured `.claude.json` MCP server, `vetoboard` skill, and `/vetoboard` slash command!",
      target: "claude",
    });
  }

  // 3. Cursor (`~/.cursor/mcp.json` + `~/.cursor/skills/vetoboard/SKILL.md`)
  if (selectedTargets.has("cursor")) {
    const cursorMcpPath = join(home, ".cursor", "mcp.json");
    const cursorSkillPath = join(home, ".cursor", "skills", "vetoboard", "SKILL.md");

    await mergeJsonMcpServerConfig(cursorMcpPath, "vetoboard", mcpEntry);
    await mkdir(dirname(cursorSkillPath), { recursive: true });
    await writeFile(cursorSkillPath, buildCrossPlatformSkillMarkdown("vetoboard"), "utf8");

    installed.push({
      filesWritten: [cursorMcpPath, cursorSkillPath],
      note: zh
        ? "已自动合并 `~/.cursor/mcp.json` 并挂载 `vetoboard` 技能包！"
        : "Merged `~/.cursor/mcp.json` and installed `vetoboard` skill!",
      target: "cursor",
    });
  }

  // 4. OpenAI Codex CLI (`~/.codex/config.toml` + `~/.codex/skills/vetoboard/SKILL.md`)
  if (selectedTargets.has("codex")) {
    const codexTomlPath = join(home, ".codex", "config.toml");
    const codexSkillPath = join(home, ".codex", "skills", "vetoboard", "SKILL.md");
    await mkdir(dirname(codexSkillPath), { recursive: true });
    await writeFile(codexSkillPath, buildCrossPlatformSkillMarkdown("vetoboard"), "utf8");

    let existingToml = "";
    try {
      existingToml = await readFile(codexTomlPath, "utf8");
    } catch {
      // Create new config.toml
    }
    if (!/\[mcp_servers\.vetoboard\]/i.test(existingToml)) {
      const argsToml = mcpEntry.args.map((a) => JSON.stringify(a)).join(", ");
      const block = `\n[mcp_servers.vetoboard]\ncommand = ${JSON.stringify(mcpEntry.command)}\nargs = [${argsToml}]\n`;
      await writeFile(codexTomlPath, `${existingToml.trimEnd()}\n${block}`, "utf8");
    }

    installed.push({
      filesWritten: [codexTomlPath, codexSkillPath],
      note: zh
        ? "已自动写入 `~/.codex/config.toml` 与 `vetoboard` 技能包！"
        : "Configured `~/.codex/config.toml` and `vetoboard` skill!",
      target: "codex",
    });
  }

  // 5. Hermes Agent + DeepSeek (`~/.hermes/config.yaml` + `~/.hermes/skills/vetoboard/SKILL.md`)
  if (selectedTargets.has("hermes")) {
    const hermesYamlPath = join(home, ".hermes", "config.yaml");
    const hermesSkillPath = join(home, ".hermes", "skills", "vetoboard", "SKILL.md");
    await mkdir(dirname(hermesSkillPath), { recursive: true });
    await writeFile(hermesSkillPath, buildCrossPlatformSkillMarkdown("vetoboard"), "utf8");

    let existingYaml = "";
    try {
      existingYaml = await readFile(hermesYamlPath, "utf8");
    } catch {
      // Create fresh config.yaml
    }
    if (!/^\s*vetoboard\s*:/m.test(existingYaml)) {
      const yamlArgs = mcpEntry.args.map((a) => `      - ${JSON.stringify(a)}`).join("\n");
      const entryBlock = `  vetoboard:\n    command: ${JSON.stringify(mcpEntry.command)}\n    args:\n${yamlArgs}\n`;
      if (/^mcp_servers\s*:/m.test(existingYaml)) {
        const updated = existingYaml.replace(/^mcp_servers\s*:\s*\r?\n/m, (m) => `${m}${entryBlock}`);
        await writeFile(hermesYamlPath, updated, "utf8");
      } else {
        const sep = existingYaml.trim().length > 0 ? `${existingYaml.trimEnd()}\n\n` : "";
        await writeFile(hermesYamlPath, `${sep}mcp_servers:\n${entryBlock}`, "utf8");
      }
    }

    installed.push({
      filesWritten: [hermesYamlPath, hermesSkillPath],
      note: zh
        ? "已自动写入 `~/.hermes/config.yaml` 与 `~/.hermes/skills/vetoboard/SKILL.md`！"
        : "Configured `~/.hermes/config.yaml` and `~/.hermes/skills/vetoboard/SKILL.md`!",
      target: "hermes",
    });
  }

  // 6. OpenCode & T3 Code Harness (`~/.config/opencode/opencode.json` + `~/.config/opencode/skills/vetoboard/SKILL.md`)
  if (selectedTargets.has("opencode")) {
    const opencodeJsonPath = join(home, ".config", "opencode", "opencode.json");
    const opencodeSkillPath = join(home, ".config", "opencode", "skills", "vetoboard", "SKILL.md");

    await mergeOpenCodeMcpConfig(opencodeJsonPath, "vetoboard", [
      mcpEntry.command,
      ...mcpEntry.args,
    ]);
    await mkdir(dirname(opencodeSkillPath), { recursive: true });
    await writeFile(opencodeSkillPath, buildCrossPlatformSkillMarkdown("vetoboard"), "utf8");

    installed.push({
      filesWritten: [opencodeJsonPath, opencodeSkillPath],
      note: zh
        ? "已自动写入 OpenCode / T3 Code 专属 `opencode.json`（`mcp` 数组格式）与 `vetoboard` 技能包！"
        : "Configured OpenCode / T3 Code `opencode.json` (`mcp` array schema) and `vetoboard` skill!",
      target: "opencode",
    });
  }

  if (selectedTargets.has("t3code")) {
    const t3SkillPath = join(home, ".t3code", "skills", "vetoboard", "SKILL.md");
    await mkdir(dirname(t3SkillPath), { recursive: true });
    await writeFile(t3SkillPath, buildCrossPlatformSkillMarkdown("vetoboard"), "utf8");

    installed.push({
      filesWritten: [t3SkillPath],
      note: zh
        ? "已就绪 T3 Code 多 Harness（Claude Code / Codex / Cursor / OpenCode）跨模型混编与技能包！"
        : "Configured T3 Code multi-harness (Claude Code / Codex / Cursor / OpenCode) skill bundle!",
      target: "t3code",
    });
  }

  // 7. Workspace-Local Bundle (`.mcp.json` + `.agents/skills/vetoboard/SKILL.md` + `.agents/rules/vetoboard.md`)
  if (selectedTargets.has("workspace")) {
    const wsMcpPath = join(ws, ".mcp.json");
    const wsSkillPath = join(ws, ".agents", "skills", "vetoboard", "SKILL.md");
    const wsRulePath = join(ws, ".agents", "rules", "vetoboard.md");

    await mergeJsonMcpServerConfig(wsMcpPath, "vetoboard", mcpEntry);
    await mkdir(dirname(wsSkillPath), { recursive: true });
    await mkdir(dirname(wsRulePath), { recursive: true });
    const skillMd = buildCrossPlatformSkillMarkdown("vetoboard");
    await writeFile(wsSkillPath, skillMd, "utf8");
    await writeFile(wsRulePath, skillMd, "utf8");

    installed.push({
      filesWritten: [wsMcpPath, wsSkillPath, wsRulePath],
      note: zh
        ? `已在当前项目目录 \`${ws}\` 生成完整 \`.mcp.json\` + \`.agents/\` 规则与技能包！`
        : `Installed workspace-scoped \`.mcp.json\` + \`.agents/\` skill & rule in \`${ws}\`!`,
      target: "workspace",
    });
  }

  const lines = zh
    ? [
        `## 🚀 VetoBoard 满血三位一体安装完成（\`v${CURRENT_VETOBOARD_VERSION}\` · 启动模式：\`${commandMode}\`）`,
        "",
        ...installed.map(
          (item) =>
            `- ✅ **${item.target.toUpperCase()}**：${item.note}\n  - 写入文件：${item.filesWritten.map((f) => `\`${f}\``).join(" · ")}`,
        ),
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
        "",
        "### ⚡ Ready to Use",
        "1. Click `MCP Servers > Refresh` in your IDE (or toggle `vetoboard-mcp` ON in Antigravity Customizations);",
        "2. Type **`/vetoboard <your business or engineering goal>`** and reply **\"Go\"**!",
      ];

  return {
    commandMode,
    installed,
    markdown: lines.join("\n"),
  };
}
