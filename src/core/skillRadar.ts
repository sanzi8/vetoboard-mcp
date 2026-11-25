import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { VetoBoardLocale } from "../i18n/locales.js";
import { vetoboardAssetPackSchema, type RoleTemplate } from "./types.js";

/**
 * Cross-IDE Native Skill Radar & Skill-to-Role Synthesizer (`en` + `zh`).
 * Discovers existing `SKILL.md` & `.vetoboard-pack.json` skills across:
 * - Workspace (`.agents/skills`, `.agent/skills`, `.claude/skills`)
 * - Antigravity (`~/.gemini/config/skills`, `~/.gemini/config/plugins/<p>/skills`, `~/.gemini/antigravity/builtin/skills`)
 * - Claude Code & Codex (`~/.claude/skills`, `~/.codex/skills`)
 * - VetoBoard Governance Asset Packs (`packs/*.vetoboard-pack.json`, `~/.vetoboard-mcp/packs/*.vetoboard-pack.json`)
 *
 * Allows users both to:
 * 1. Bind native skills onto existing Council Roles (`roleSkillBindings`), AND
 * 2. Dynamically synthesize brand-new Specialist Roles directly from any native skill (`spawnRoleFromSkillIds`)!
 */

export type NativeSkillSource =
  | "vetoboard-library"
  | "workspace"
  | "antigravity-user"
  | "antigravity-plugin"
  | "antigravity-builtin"
  | "claude-code"
  | "codex"
  | "hermes"
  | "cursor"
  | "opencode"
  | "vetoboard-pack"
  | "host-injected";

export interface DiscoveredSkill {
  readonly skillId: string;
  readonly name: string;
  readonly description: string;
  readonly source: NativeSkillSource;
  readonly filePath?: string;
  readonly inlineContent?: string;
}

const INTERNAL_META_SKILLS = new Set([
  "vetoboard",
  "vetoboard-council",
  "swarm_monitor",
  "swarm_narrator",
  "swarm_pane",
  "migrate-agent-settings",
  "migrate-workflows",
  "ui-plugin-navigation",
]);

function isInternalMetaSkill(name: string): boolean {
  return INTERNAL_META_SKILLS.has(name) || /-council$/i.test(name);
}

function parseSkillFrontmatter(markdown: string, fallbackName: string): { name: string; description: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(markdown.trim());
  if (!match) {
    const firstPara = markdown
      .split(/\r?\n/)
      .find((l) => l.trim() && !l.trim().startsWith("#"))
      ?.trim();
    return {
      description: (firstPara ?? fallbackName).slice(0, 220),
      name: fallbackName,
    };
  }
  const yamlBlock = match[1]!;
  const nameMatch = /^name:\s*(.+)$/mu.exec(yamlBlock);
  const rawName = nameMatch ? nameMatch[1]!.trim().replace(/^['"]|['"]$/g, "") : fallbackName;

  let desc = "";
  const foldedMatch = /^description:\s*[>|]-?\s*\r?\n((?:[ \t]+.+\r?\n?)+)/mu.exec(yamlBlock);
  if (foldedMatch) {
    desc = foldedMatch[1]!
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ");
  } else {
    const singleMatch = /^description:\s*(.+)$/mu.exec(yamlBlock);
    if (singleMatch) {
      desc = singleMatch[1]!.trim().replace(/^['"]|['"]$/g, "");
    }
  }

  return {
    description: (desc || rawName).slice(0, 240),
    name: rawName || fallbackName,
  };
}

async function scanFlatSkillSubdirs(
  parentDir: string,
  source: NativeSkillSource,
  out: Map<string, DiscoveredSkill>,
): Promise<void> {
  try {
    const entries = await readdir(parentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (isInternalMetaSkill(entry.name)) continue;
      const skillMdPath = join(parentDir, entry.name, "SKILL.md");
      try {
        const raw = await readFile(skillMdPath, "utf8");
        const parsed = parseSkillFrontmatter(raw, entry.name);
        if (isInternalMetaSkill(parsed.name)) continue;
        const id = parsed.name.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
        if (!out.has(id)) {
          out.set(id, {
            description: parsed.description,
            filePath: skillMdPath,
            name: parsed.name,
            skillId: id,
            source,
          });
        }
      } catch {
        // Ignore directories without SKILL.md
      }
    }
  } catch {
    // Root does not exist on this machine
  }
}

async function scanAntigravityPluginSkills(
  pluginsRoot: string,
  out: Map<string, DiscoveredSkill>,
): Promise<void> {
  try {
    const plugins = await readdir(pluginsRoot, { withFileTypes: true });
    for (const plug of plugins) {
      if (!plug.isDirectory()) continue;
      await scanFlatSkillSubdirs(join(pluginsRoot, plug.name, "skills"), "antigravity-plugin", out);
    }
  } catch {
    // Ignore if plugins root absent
  }
}

async function scanVetoBoardPacksDir(
  packsDir: string,
  locale: VetoBoardLocale,
  out: Map<string, DiscoveredSkill>,
): Promise<void> {
  try {
    const files = await readdir(packsDir);
    for (const f of files) {
      if (!f.endsWith(".vetoboard-pack.json")) continue;
      try {
        const fullPath = join(packsDir, f);
        const raw = await readFile(fullPath, "utf8");
        const parsed = vetoboardAssetPackSchema.safeParse(JSON.parse(raw.replace(/^\uFEFF/, "")));
        if (!parsed.success) continue;
        for (const sk of parsed.data.skills) {
          const id = sk.skillId.trim().toLowerCase();
          if (!out.has(id)) {
            out.set(id, {
              description: sk.title[locale],
              filePath: fullPath,
              inlineContent: sk.content[locale],
              name: sk.skillId,
              skillId: id,
              source: "vetoboard-pack",
            });
          }
        }
      } catch {
        // Ignore malformed pack
      }
    }
  } catch {
    // Ignore missing dir
  }
}

export interface DiscoverNativeSkillsOptions {
  readonly dataRootDir?: string;
  readonly workspaceDir?: string;
  readonly homeDirOverride?: string;
  readonly extraSkillDirs?: readonly string[];
  readonly hostSkills?: readonly {
    readonly name: string;
    readonly description: string;
    readonly filePath?: string;
  }[];
  readonly includeBuiltinIdeSkills?: boolean;
  readonly locale?: VetoBoardLocale;
}

export async function discoverNativeSkills(
  options?: DiscoverNativeSkillsOptions,
): Promise<DiscoveredSkill[]> {
  const locale = options?.locale ?? "en";
  const home = options?.homeDirOverride ? resolve(options.homeDirOverride) : homedir();
  const dataRoot = resolve(options?.dataRootDir ?? process.env.VETOBOARD_DATA_DIR ?? join(home, ".vetoboard-mcp"));
  const discovered = new Map<string, DiscoveredSkill>();

  // 1. Host-injected skills (highest precedence if explicitly passed by caller)
  for (const hs of options?.hostSkills ?? []) {
    if (isInternalMetaSkill(hs.name)) continue;
    const id = hs.name.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
    discovered.set(id, {
      description: hs.description.slice(0, 240),
      ...(hs.filePath ? { filePath: hs.filePath } : {}),
      name: hs.name,
      skillId: id,
      source: "host-injected",
    });
  }

  // 1b. Distilled reusable skills in VetoBoard's own library (`~/.vetoboard-mcp/library/skills/<id>/SKILL.md`)
  await scanFlatSkillSubdirs(join(dataRoot, "library", "skills"), "vetoboard-library", discovered);

  // 2. Workspace-scoped skills (`.agents/skills`, `.agent/skills`, `.claude/skills`, `.hermes/skills`, `.cursor/skills`, `.opencode/skills`)
  const ws = options?.workspaceDir?.trim() || process.cwd();
  if (ws) {
    const resolvedWs = resolve(ws);
    await scanFlatSkillSubdirs(join(resolvedWs, ".agents", "skills"), "workspace", discovered);
    await scanFlatSkillSubdirs(join(resolvedWs, ".agent", "skills"), "workspace", discovered);
    await scanFlatSkillSubdirs(join(resolvedWs, ".claude", "skills"), "workspace", discovered);
    await scanFlatSkillSubdirs(join(resolvedWs, ".hermes", "skills"), "workspace", discovered);
    await scanFlatSkillSubdirs(join(resolvedWs, ".cursor", "skills"), "workspace", discovered);
    await scanFlatSkillSubdirs(join(resolvedWs, ".opencode", "skills"), "workspace", discovered);
  }

  // 3. Extra custom skill directories
  for (const extra of options?.extraSkillDirs ?? []) {
    await scanFlatSkillSubdirs(resolve(extra), "workspace", discovered);
  }

  // 4. VetoBoard bundled pure-text governance skills (`<packageRoot>/skills/<id>/SKILL.md`) & `.vetoboard-pack.json` packs
  // Scanned BEFORE host IDE dirs as `vetoboard-pack` so all 27 bundled skills work zero-config on every MCP client
  // AND never trigger duplicate `skill-*` role auto-spawns when synced into host IDE skill folders!
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const bundledSkillsDir = resolve(moduleDir, "..", "..", "skills");
  await scanFlatSkillSubdirs(bundledSkillsDir, "vetoboard-pack", discovered);
  const builtinPacksDir = resolve(moduleDir, "..", "..", "packs");
  await scanVetoBoardPacksDir(builtinPacksDir, locale, discovered);
  await scanVetoBoardPacksDir(join(home, ".vetoboard-mcp", "packs"), locale, discovered);

  // 5. User & Plugin skills across Antigravity, Claude Code, Codex, Hermes Agent, Cursor & OpenCode (T3 Code)
  await scanFlatSkillSubdirs(join(home, ".gemini", "config", "skills"), "antigravity-user", discovered);
  await scanAntigravityPluginSkills(join(home, ".gemini", "config", "plugins"), discovered);
  await scanFlatSkillSubdirs(join(home, ".claude", "skills"), "claude-code", discovered);
  await scanFlatSkillSubdirs(join(home, ".codex", "skills"), "codex", discovered);
  await scanFlatSkillSubdirs(join(home, ".hermes", "skills"), "hermes", discovered);
  await scanFlatSkillSubdirs(join(home, ".cursor", "skills"), "cursor", discovered);
  await scanFlatSkillSubdirs(join(home, ".config", "opencode", "skills"), "opencode", discovered);

  // 6. Antigravity built-in capability skills (filtered to real task-execution skills)
  if (options?.includeBuiltinIdeSkills !== false) {
    await scanFlatSkillSubdirs(
      join(home, ".gemini", "antigravity", "builtin", "skills"),
      "antigravity-builtin",
      discovered,
    );
  }

  return [...discovered.values()];
}

function tokenizeKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9]{3,}/g) ?? [];
  const cjkChunks = lower.match(/[\u4e00-\u9fff]{2,}/gu) ?? [];
  const cjkBigrams: string[] = [];
  for (const chunk of cjkChunks) {
    if (chunk.length <= 4) {
      cjkBigrams.push(chunk);
    } else {
      for (let i = 0; i < chunk.length - 1; i++) {
        cjkBigrams.push(chunk.slice(i, i + 2));
      }
    }
  }
  return [...new Set([...latin, ...cjkBigrams])];
}

export function scoreSkillForGoal(skill: DiscoveredSkill, goal: string): number {
  const goalTokens = tokenizeKeywords(goal);
  if (goalTokens.length === 0) return 0;
  const haystack = `${skill.skillId} ${skill.name} ${skill.description}`.toLowerCase();
  let score = 0;
  for (const tok of goalTokens) {
    if (haystack.includes(tok)) {
      score += tok.length >= 4 ? 3 : 2;
    }
  }
  // Cross-lingual Chinese <-> English capability boost so Chinese prompts rank English native SKILL.md accurately
  const crossMap: ReadonlyArray<readonly [RegExp, RegExp]> = [
    [/(?:可视化|看板|图表|界面|组件|交互|大屏)/u, /(?:generative_ui|widget|visualization|chart|interactive|ui)/iu],
    [/(?:定时|自动|周报|日报|巡检|排程|cron)/u, /(?:automation|schedule|recurring|cron)/iu],
    [/(?:github|仓库|pr\b|pull\s*request|issue)/iu, /(?:github)/iu],
    [/(?:工作流|流水线|并发编排)/u, /(?:workflow|pipeline)/iu],
  ];
  for (const [goalRe, skillRe] of crossMap) {
    if (goalRe.test(goal) && skillRe.test(haystack)) {
      score += 6;
    }
  }
  if (
    score > 0 &&
    (skill.source === "workspace" ||
      skill.source === "antigravity-plugin" ||
      skill.source === "antigravity-user" ||
      skill.source === "claude-code" ||
      skill.source === "codex" ||
      skill.source === "hermes" ||
      skill.source === "cursor" ||
      skill.source === "opencode")
  ) {
    score += 4;
  }
  return score;
}

/**
 * Synthesizes a dedicated Specialist `RoleTemplate` directly from a discovered native `SKILL.md` or pack skill!
 */
export function synthesizeRoleFromSkill(
  skill: DiscoveredSkill,
  locale: VetoBoardLocale = "en",
  customWeight = 90,
): RoleTemplate {
  const roleId = `skill-${skill.skillId}`.slice(0, 48);
  const titleEn = `${skill.name} Specialist (Native Skill)`;
  const titleZh = `原生技能专员 · ${skill.name}`;

  const readInstructionEn = skill.inlineContent
    ? `\n\n### Embedded Skill Playbook (\`${skill.name}\`)\n${skill.inlineContent}`
    : skill.filePath
      ? `\n\n### Mandatory Native Skill Activation\nBefore drafting your deliverable, you MUST read and strictly follow the native skill instructions at: \`${skill.filePath}\`.`
      : "";

  const readInstructionZh = skill.inlineContent
    ? `\n\n### 内嵌技能作业规范（\`${skill.name}\`）\n${skill.inlineContent}`
    : skill.filePath
      ? `\n\n### 强制挂载本机原生技能\n动笔前你**必须**先调用 \`read_file\` 读取并严格遵循本机原生技能规范：\`${skill.filePath}\`。`
      : "";

  return {
    allowedTools: ["Read", "Grep", "Glob", "WebSearch", "vetoboard_calc"],
    domain: "engineering",
    evidenceRequirements: [
      `Explicit application of native skill "${skill.name}" (${skill.description})`,
    ],
    executableRules: [
      {
        description: `Must load and apply native skill "${skill.skillId}".`,
        enforcement: "hard",
        escalateOnTrigger: false,
        forbiddenPatterns: [],
        mustIncludeKeywords: [],
        mustInvokeSkills: [skill.skillId],
        mustUseTools: [],
        ruleId: `rule-native-skill-${skill.skillId}`,
        title: `Native Skill Gate: ${skill.name}`,
      },
    ],
    kind: "professional",
    name: { en: titleEn, zh: titleZh },
    priorityTier: customWeight >= 94 ? "primary" : "guardrail",
    readOnly: false,
    roleId,
    systemCharter: {
      en: `You are the [${titleEn} · Weight ${customWeight}/100], dynamically instantiated from the host's installed "${skill.name}" skill (${skill.description}). Audit, design, and stress-test the user's goal strictly through the specialized patterns, constraints, and scripts of this skill.${readInstructionEn}`,
      zh: `你是【${titleZh} · 权重 ${customWeight}/100】，由本机已安装的原生技能 \`${skill.name}\`（${skill.description}）动态孵化生成。请严格依据该技能包内的专业准则、架构范式与避坑清单对当前目标进行专项穿透审查与方案设计。${readInstructionZh}`,
    },
    weight: customWeight,
  };
}

/**
 * Attaches selected `DiscoveredSkill`s onto an existing `RoleTemplate` (injecting skill instructions + `mustInvokeSkills` gate).
 */
export function attachSkillsToRole(
  role: RoleTemplate,
  skills: readonly DiscoveredSkill[],
  enforceHardSkillGate = false,
): RoleTemplate {
  if (skills.length === 0) return role;

  const enBlocks = skills.map((sk) =>
    sk.inlineContent
      ? `- **Bound Skill \`${sk.name}\`**:\n${sk.inlineContent}`
      : `- **Bound Native Skill \`${sk.name}\`** (${sk.description}): Read and apply \`${sk.filePath ?? sk.name}\` before finalizing.`,
  );
  const zhBlocks = skills.map((sk) =>
    sk.inlineContent
      ? `- **已挂载技能 \`${sk.name}\`**：\n${sk.inlineContent}`
      : `- **已挂载本机原生技能 \`${sk.name}\`**（${sk.description}）：执行时请读取并遵循 \`${sk.filePath ?? sk.name}\`。`,
  );

  const skillRule = {
    description: `Bound skills for ${role.roleId}: ${skills.map((s) => s.skillId).join(", ")}`,
    enforcement: enforceHardSkillGate ? ("hard" as const) : ("soft" as const),
    escalateOnTrigger: false,
    forbiddenPatterns: [],
    mustIncludeKeywords: [],
    mustInvokeSkills: skills.map((s) => s.skillId),
    mustUseTools: [],
    ruleId: `rule-bound-skills-${role.roleId}`,
    title: `Bound Skills (${skills.map((s) => s.name).join(", ")})`,
  };

  return {
    ...role,
    executableRules: [...role.executableRules, skillRule],
    systemCharter: {
      en: `${role.systemCharter.en}\n\n## Mounted Specialist Skills\n${enBlocks.join("\n\n")}`,
      zh: `${role.systemCharter.zh}\n\n## 本角色已挂载专业技能包\n${zhBlocks.join("\n\n")}`,
    },
  };
}

const ROLE_DEFAULT_SKILL_IDS: Readonly<Record<string, readonly string[]>> = {
  "backend-engineer": [
    "karpathy-guidelines",
    "systematic-debugging",
    "verification-before-completion",
    "investigate-first",
    "surgical-patch",
    "receiving-code-review",
    "delivery-check",
    "mcp-builder",
  ],
  "code-reviewer": [
    "verification-before-completion",
    "security-audit",
    "requesting-code-review",
    "verify-and-stop",
    "delivery-check",
    "caveman-review",
  ],
  "frontend-engineer": [
    "karpathy-guidelines",
    "verification-before-completion",
    "frontend-design",
    "agent-product-design",
    "surgical-patch",
    "receiving-code-review",
    "delivery-check",
    "chrome-extensions",
  ],
  "hr-roi-analyst": ["first-principles-unit-sanity", "discernment-nudge"],
  "legal-advisor": ["contract-review", "discernment-nudge"],
  "market-analyst": ["first-principles-unit-sanity", "content-research-writer", "discernment-nudge"],
  "operations-sop": ["writing-plans", "delivery-check", "content-research-writer"],
  "plg-growth-strategist": ["product-manager-toolkit", "content-research-writer", "grilling"],
  "product-strategist": ["product-manager-toolkit", "brainstorming", "grill-with-docs"],
  "profit-modeler": ["first-principles-unit-sanity", "discernment-nudge"],
  "risk-assessor": ["security-audit", "discernment-nudge", "grilling"],
  "saas-billing-architect": ["domain-modeling", "security-audit", "karpathy-guidelines"],
  "software-architect": [
    "7-gate-swe-verification",
    "karpathy-guidelines",
    "security-audit",
    "product-manager-toolkit",
    "domain-modeling",
    "writing-plans",
    "improve-codebase-architecture",
  ],
  "task-delegation-advisor": ["delegating-work", "writing-plans"],
  "tech-feasibility": [
    "karpathy-guidelines",
    "investigate-first",
    "systematic-debugging",
    "security-audit",
  ],
};

/**
 * Recommends default skill bindings for built-in roles + top candidate native skills that can spawn new specialist roles.
 */
export function recommendSkillBindingsAndCandidates(params: {
  readonly goal: string;
  readonly roles: readonly RoleTemplate[];
  readonly discoveredSkills: readonly DiscoveredSkill[];
}): {
  readonly recommendedBindings: Record<string, string[]>;
  readonly candidateSkillRoles: readonly {
    readonly skill: DiscoveredSkill;
    readonly score: number;
  }[];
} {
  const { goal, roles, discoveredSkills } = params;
  const byId = new Map(discoveredSkills.map((s) => [s.skillId, s]));
  const recommendedBindings: Record<string, string[]> = {};

  for (const role of roles) {
    if (role.kind === "inspector") continue;
    const bound: string[] = [];
    for (const defId of ROLE_DEFAULT_SKILL_IDS[role.roleId] ?? []) {
      if (byId.has(defId) && !bound.includes(defId)) {
        bound.push(defId);
      }
    }

    // Also match non-pack native skills that align strongly with both goal and role
    for (const sk of discoveredSkills) {
      if (sk.source === "vetoboard-pack") continue;
      const goalScore = scoreSkillForGoal(sk, goal);
      const roleScore = scoreSkillForGoal(sk, `${role.roleId} ${role.name.en} ${role.name.zh}`);
      if (goalScore >= 5 && roleScore >= 2 && !bound.includes(sk.skillId)) {
        bound.push(sk.skillId);
      }
    }

    if (bound.length > 0) {
      recommendedBindings[role.roleId] = bound;
    }
  }

  // Candidate native skills that can be turned into standalone Specialist Roles!
  const nonPackSkills = discoveredSkills.filter((s) => s.source !== "vetoboard-pack");
  const scored = nonPackSkills
    .map((skill) => ({ score: scoreSkillForGoal(skill, goal), skill }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Prioritize workspace/user/plugin skills over generic IDE built-ins
      const rank = (src: NativeSkillSource) =>
        src === "workspace" || src === "host-injected"
          ? 3
          : src === "antigravity-user" || src === "antigravity-plugin" || src === "claude-code"
            ? 2
            : 1;
      return rank(b.skill.source) - rank(a.skill.source);
    });

  return {
    candidateSkillRoles: scored.slice(0, 8),
    recommendedBindings,
  };
}
