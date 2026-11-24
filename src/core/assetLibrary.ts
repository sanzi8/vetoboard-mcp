import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { VetoBoardLocale } from "../i18n/locales.js";
import {
  retrieveRelevantKnowledge,
  type RetrievedKnowledgeAsset,
} from "./knowledgeLibrary.js";
import {
  BUILTIN_ROLE_TEMPLATES,
  groupHostModelsForDisplay,
  resolveTierLabel,
} from "./roleCatalog.js";
import {
  discoverNativeSkills,
  scoreSkillForGoal,
  type DiscoveredSkill,
} from "./skillRadar.js";
import {
  roleTemplateSchema,
  vetoboardAssetPackSchema,
  type ClarifyQuestion,
  type HostModelCandidate,
  type RolePriorityTier,
  type RoleTemplate,
} from "./types.js";

/**
 * VetoBoard Reusable Role & Skill Asset Library (`~/.vetoboard-mcp/library/` + Cross-IDE Native Agents & Skills).
 * Core 3-pillar reusable asset lifecycle:
 * 1. Retrieve existing reusable Roles & Skills first when any task starts;
 * 2. Only propose hatching a new role from a native skill when no saved role covers that skill yet;
 * 3. Persist newly hatched / customized roles into `~/.vetoboard-mcp/library/roles/` so future tasks reuse them directly!
 */

export type RoleAssetOrigin =
  | "vetoboard-library"
  | "vetoboard-pack"
  | "workspace-agent"
  | "ide-agent"
  | "builtin";

export interface RetrievedRoleAsset {
  readonly role: RoleTemplate;
  readonly origin: RoleAssetOrigin;
  readonly relevanceScore: number;
  readonly defaultSkillIds: readonly string[];
  readonly sourcePath?: string;
}

function parseMarkdownAgentFile(
  raw: string,
  fallbackId: string,
): { name: string; description: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(raw.trim());
  if (!match) {
    return {
      body: raw.trim(),
      description: raw.trim().slice(0, 140),
      name: fallbackId,
    };
  }
  const fm = match[1]!;
  const body = match[2]!.trim();
  const nameMatch = /^name:\s*(.+)$/mu.exec(fm);
  const descMatch = /^description:\s*(.+)$/mu.exec(fm);
  const name = nameMatch ? nameMatch[1]!.trim().replace(/^['"]|['"]$/g, "") : fallbackId;
  const description = descMatch
    ? descMatch[1]!.trim().replace(/^['"]|['"]$/g, "")
    : body.slice(0, 140);
  return { body: body || description, description, name };
}

interface RoleMapEntry {
  readonly role: RoleTemplate;
  readonly origin: RoleAssetOrigin;
  readonly sourcePath?: string | undefined;
  readonly savedSkills?: string[] | undefined;
}

async function scanMarkdownAgentsDir(
  dirPath: string,
  origin: "workspace-agent" | "ide-agent",
  out: Map<string, RoleMapEntry>,
): Promise<void> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const slug = basename(entry.name, ".md")
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .toLowerCase();
      if (!slug || out.has(slug)) continue;
      try {
        const fullPath = join(dirPath, entry.name);
        const raw = await readFile(fullPath, "utf8");
        const parsed = parseMarkdownAgentFile(raw, slug);
        const tpl: RoleTemplate = {
          allowedTools: ["Read", "Grep", "Glob", "WebSearch", "vetoboard_calc"],
          domain: "engineering",
          evidenceRequirements: [`Follow native agent mandate (${parsed.name})`],
          executableRules: [],
          kind: "professional",
          name: { en: parsed.name, zh: parsed.name },
          priorityTier: "guardrail",
          readOnly: false,
          roleId: `agent-${slug}`,
          systemCharter: {
            en: `${parsed.body}\n\n(Loaded from reusable native agent: \`${fullPath}\`)`,
            zh: `${parsed.body}\n\n（复用自本机已定义 Agent 角色：\`${fullPath}\`）`,
          },
          weight: 88,
        };
        out.set(tpl.roleId, { origin, role: tpl, sourcePath: fullPath });
      } catch {
        // Ignore unreadable markdown agent
      }
    }
  } catch {
    // Directory absent
  }
}

async function scanSavedLibraryRoles(
  libraryRolesDir: string,
  out: Map<string, RoleMapEntry>,
): Promise<void> {
  try {
    const files = await readdir(libraryRolesDir, { withFileTypes: true });
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith(".json")) continue;
      try {
        const fullPath = join(libraryRolesDir, f.name);
        const raw = JSON.parse((await readFile(fullPath, "utf8")).replace(/^\uFEFF/, "")) as {
          role?: unknown;
          boundSkillIds?: string[];
        };
        const candidate = raw.role ?? raw;
        const parsed = roleTemplateSchema.safeParse(candidate);
        if (!parsed.success) continue;
        out.set(parsed.data.roleId, {
          origin: "vetoboard-library",
          role: parsed.data,
          savedSkills: Array.isArray(raw.boundSkillIds) ? raw.boundSkillIds : undefined,
          sourcePath: fullPath,
        });
      } catch {
        // Ignore malformed JSON
      }
    }
  } catch {
    // Library dir not created yet
  }
}

async function scanPackRoles(
  packsDir: string,
  out: Map<string, RoleMapEntry>,
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
        for (const r of parsed.data.roles) {
          if (!out.has(r.roleId)) {
            out.set(r.roleId, { origin: "vetoboard-pack", role: r, sourcePath: fullPath });
          }
        }
      } catch {
        // Ignore
      }
    }
  } catch {
    // Ignore
  }
}

export async function persistRoleToLibrary(
  dataRootDir: string,
  role: RoleTemplate,
  boundSkillIds: readonly string[] = [],
): Promise<string> {
  const rolesDir = join(resolve(dataRootDir), "library", "roles");
  await mkdir(rolesDir, { recursive: true });
  const safeName = role.roleId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const targetPath = join(rolesDir, `${safeName}.json`);
  const payload = {
    boundSkillIds,
    role,
    savedAt: new Date().toISOString(),
  };
  await writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return targetPath;
}

function scoreRoleRelevance(role: RoleTemplate, goal: string, domain: "commercial" | "swe"): number {
  let score = 0;
  if (domain === "commercial" && (role.domain === "commercial" || role.domain === "compliance" || role.domain === "engineering")) {
    score += 5;
  }
  if (domain === "swe" && (role.domain === "swe" || role.domain === "engineering")) {
    score += 6;
  }
  const haystack = `${role.roleId} ${role.name.en} ${role.name.zh} ${role.systemCharter.en} ${role.systemCharter.zh}`.toLowerCase();
  const tokens = goal.toLowerCase().match(/[a-z0-9]{3,}|[\u4e00-\u9fff]{2}/gu) ?? [];
  for (const tok of new Set(tokens)) {
    if (haystack.includes(tok)) score += 2;
  }
  return score;
}

export interface RetrieveReusableAssetsResult {
  readonly roles: readonly RetrievedRoleAsset[];
  readonly skills: readonly DiscoveredSkill[];
  readonly unhatchedSkills: readonly { readonly skill: DiscoveredSkill; readonly score: number }[];
  readonly knowledge: readonly RetrievedKnowledgeAsset[];
}

export async function retrieveReusableAssets(params: {
  readonly goal: string;
  readonly domain?: "commercial" | "swe";
  readonly locale?: VetoBoardLocale;
  readonly dataRootDir?: string;
  readonly workspaceDir?: string;
  readonly extraSkillDirs?: readonly string[];
  readonly hostSkills?: readonly { name: string; description: string; filePath?: string }[];
}): Promise<RetrieveReusableAssetsResult> {
  const locale = params.locale ?? "en";
  const domain = params.domain ?? "commercial";
  const home = homedir();
  const dataRoot = resolve(params.dataRootDir ?? process.env.VETOBOARD_DATA_DIR ?? join(home, ".vetoboard-mcp"));
  const ws = params.workspaceDir?.trim() ? resolve(params.workspaceDir) : process.cwd();

  // 1. Retrieve all reusable Skills first (including distilled `~/.vetoboard-mcp/library/skills`)
  const skills = await discoverNativeSkills({
    dataRootDir: dataRoot,
    extraSkillDirs: params.extraSkillDirs,
    hostSkills: params.hostSkills,
    locale,
    workspaceDir: ws,
  });

  // 2. Retrieve all reusable Roles (Saved VetoBoard Library -> Workspace Agents -> Global IDE Agents -> Packs -> Built-ins)
  const roleMap = new Map<string, RoleMapEntry>();

  await scanSavedLibraryRoles(join(dataRoot, "library", "roles"), roleMap);
  if (ws) {
    await scanMarkdownAgentsDir(join(ws, ".agents", "agents"), "workspace-agent", roleMap);
    await scanMarkdownAgentsDir(join(ws, ".agent", "agents"), "workspace-agent", roleMap);
    await scanMarkdownAgentsDir(join(ws, ".claude", "agents"), "workspace-agent", roleMap);
  }
  await scanMarkdownAgentsDir(join(home, ".gemini", "config", "agents"), "ide-agent", roleMap);
  await scanMarkdownAgentsDir(join(home, ".claude", "agents"), "ide-agent", roleMap);
  await scanMarkdownAgentsDir(join(home, ".hermes", "agents"), "ide-agent", roleMap);
  await scanMarkdownAgentsDir(join(home, ".codex", "agents"), "ide-agent", roleMap);
  await scanPackRoles(join(dataRoot, "packs"), roleMap);

  for (const builtin of BUILTIN_ROLE_TEMPLATES) {
    if (builtin.kind === "inspector") continue;
    if (!roleMap.has(builtin.roleId)) {
      roleMap.set(builtin.roleId, { origin: "builtin", role: builtin });
    }
  }

  const roles: RetrievedRoleAsset[] = [];
  const coveredSkillIds = new Set<string>();

  for (const entry of roleMap.values()) {
    if (entry.role.kind === "inspector") continue;
    const rel =
      scoreRoleRelevance(entry.role, params.goal, domain) +
      (entry.origin === "vetoboard-library" || entry.origin === "workspace-agent" ? 4 : 0);

    const defaultSkillIds = [...(entry.savedSkills ?? [])];
    if (entry.role.roleId.startsWith("skill-")) {
      coveredSkillIds.add(entry.role.roleId.slice(6).toLowerCase());
    }
    for (const s of defaultSkillIds) coveredSkillIds.add(s.toLowerCase());

    roles.push({
      defaultSkillIds,
      origin: entry.origin,
      relevanceScore: rel,
      role: entry.role,
      ...(entry.sourcePath ? { sourcePath: entry.sourcePath } : {}),
    });
  }

  roles.sort((a, b) => b.relevanceScore - a.relevanceScore || b.role.weight - a.role.weight);

  // 3. Identify native skills that do NOT yet have a saved role in the library ("缺口技能可孵化新角色并自动入库")
  const unhatchedSkills = skills
    .filter((sk) => sk.source !== "vetoboard-pack" && !coveredSkillIds.has(sk.skillId.toLowerCase()))
    .map((skill) => ({ score: scoreSkillForGoal(skill, params.goal), skill }))
    .sort((a, b) => b.score - a.score);

  // 4. Retrieve verified Knowledge Cards from previous completed phases/tasks (`~/.vetoboard-mcp/library/knowledge/`)
  const knowledge = await retrieveRelevantKnowledge({
    dataRootDir: dataRoot,
    domain,
    goal: params.goal,
    limit: 3,
  });

  return { knowledge, roles, skills, unhatchedSkills };
}

export const WEIGHT_TIER_OPTIONS: ReadonlyArray<{
  readonly tierId: string;
  readonly weight: number;
  readonly priorityTier: RolePriorityTier;
  readonly labelZh: string;
  readonly labelEn: string;
  readonly descZh: string;
  readonly descEn: string;
}> = [
  {
    descEn: "Highest decisive authority when tracks disagree",
    descZh: "各轨结论分歧时拥有一票主裁权",
    labelEn: "👑 Decisive Lead · Weight 98",
    labelZh: "👑 主裁拍板 · 权重 98",
    priorityTier: "primary",
    tierId: "w98",
    weight: 98,
  },
  {
    descEn: "Core plan & quantitative baseline author",
    descZh: "核心方案设计与底数主笔",
    labelEn: "⭐ Core Co-Lead · Weight 92",
    labelZh: "⭐ 核心主责 · 权重 92",
    priorityTier: "primary",
    tierId: "w92",
    weight: 92,
  },
  {
    descEn: "Redline guardrail & adversarial stress-tester",
    descZh: "负责红线把关与对抗挑刺，不越权改主方向",
    labelEn: "🛡️ Guardrail · Weight 85",
    labelZh: "🛡️ 风控护栏 · Weight 85",
    priorityTier: "guardrail",
    tierId: "w85",
    weight: 85,
  },
  {
    descEn: "Execution & engineering support",
    descZh: "提供工程/交付支撑数据",
    labelEn: "🔧 Support · Weight 75",
    labelZh: "🔧 辅助支撑 · 权重 75",
    priorityTier: "secondary",
    tierId: "w75",
    weight: 75,
  },
  {
    descEn: "Lightweight advisory perspective",
    descZh: "仅补充边缘盲区参考，低权重不主导结论",
    labelEn: "👁️ Advisory · Weight 60",
    labelZh: "👁️ 轻量参谋 · 权重 60",
    priorityTier: "secondary",
    tierId: "w60",
    weight: 60,
  },
];

/**
 * Stage 2 Pure-Click Weight Builder:
 * Generates 1 single-select radio card per chosen role so the user sets exact weights with 1 click per role (ZERO typing!).
 */
export function buildPerRoleWeightClickQuestions(params: {
  readonly selectedRoles: readonly {
    readonly roleId: string;
    readonly title: string;
    readonly recommendedWeight: number;
  }[];
  readonly locale?: VetoBoardLocale;
}): ClarifyQuestion[] {
  const locale = params.locale ?? "en";
  const zh = locale === "zh";

  return params.selectedRoles.map((item, idx) => {
    // Put the closest matching weight tier FIRST as `(Recommended)`!
    const sortedTiers = [...WEIGHT_TIER_OPTIONS].sort(
      (a, b) =>
        Math.abs(a.weight - item.recommendedWeight) -
        Math.abs(b.weight - item.recommendedWeight),
    );

    return {
      options: sortedTiers.map((tier, tIdx) => ({
        description: zh ? tier.descZh : tier.descEn,
        label: `${tIdx === 0 ? "(Recommended) " : ""}${zh ? tier.labelZh.replace("Weight 85", "权重 85") : tier.labelEn}`,
        optionId: `${item.roleId}:${tier.weight}:${tier.priorityTier}`,
      })),
      question: zh
        ? `权重 ${idx + 1}/${params.selectedRoles.length}：点击选择「${item.title}」的裁决权重档位（单选，点一下即走）`
        : `Weight ${idx + 1}/${params.selectedRoles.length}: Click authority weight for "${item.title}"`,
      questionId: `q_weight_${item.roleId}`,
      selectionMode: "single" as const,
    };
  });
}

/**
 * Parses Stage 2 single-click weight answers (either `roleId:98:primary` optionIds or label strings like `👑 主裁拍板 · 权重 98`).
 */
export function parsePerRoleWeightSelections(
  selections: Readonly<Record<string, string>> | readonly string[] | undefined,
): {
  readonly weightOverrides: Record<string, number>;
  readonly tierOverrides: Record<string, RolePriorityTier>;
  readonly primaryRoleIds: string[];
} {
  const weightOverrides: Record<string, number> = {};
  const tierOverrides: Record<string, RolePriorityTier> = {};
  const primaryRoleIds: string[] = [];
  if (!selections) return { primaryRoleIds, tierOverrides, weightOverrides };

  const applyOne = (roleHint: string | undefined, rawVal: string) => {
    const colonMatch = /^([a-zA-Z0-9_-]+):(\d{2,3}):(primary|guardrail|secondary)$/i.exec(
      rawVal.trim(),
    );
    if (colonMatch) {
      const rid = colonMatch[1]!;
      const w = Number(colonMatch[2]);
      const tier = colonMatch[3] as RolePriorityTier;
      weightOverrides[rid] = w;
      tierOverrides[rid] = tier;
      if (tier === "primary") primaryRoleIds.push(rid);
      return;
    }
    if (!roleHint) return;
    const cleanRoleId = roleHint.replace(/^q_weight_/, "");
    const numMatch = /(?:权重|Weight)\s*(\d{2,3})/iu.exec(rawVal) ?? /\b(98|92|85|75|60)\b/.exec(rawVal);
    if (numMatch) {
      const w = Number(numMatch[1]);
      weightOverrides[cleanRoleId] = w;
      const tier: RolePriorityTier = w >= 90 ? "primary" : w >= 80 ? "guardrail" : "secondary";
      tierOverrides[cleanRoleId] = tier;
      if (tier === "primary") primaryRoleIds.push(cleanRoleId);
    }
  };

  if (Array.isArray(selections)) {
    for (const item of selections) applyOne(undefined, item);
  } else {
    for (const [k, v] of Object.entries(selections)) {
      if (typeof v === "string") applyOne(k, v);
    }
  }

  return { primaryRoleIds, tierOverrides, weightOverrides };
}

function explainRoleScore(
  roleId: string,
  tier: RolePriorityTier,
  weight: number,
  locale: VetoBoardLocale,
  rationaleList: readonly string[],
): string {
  const zh = locale === "zh";
  if (roleId === "quality-inspector") {
    return zh
      ? "第 2 波独立只读核账，调用 vetoboard_calc 逐项复算上游数字并把关硬门禁"
      : "Wave 2 independent read-only auditor reconciling all math via vetoboard_calc";
  }
  if (roleId === "profit-modeler") {
    const boosted = rationaleList.some((r) => r.includes("精算") || r.includes("Profit"));
    return zh
      ? boosted
        ? `课题含明确价格/成本/回本诉求，提拔为 ${weight} 分主裁严查真实经济 BEP 与 LTV/CAC`
        : "负责零心算核算单位经济模型、机会成本与盈亏平衡点"
      : boosted
        ? `Promoted to W${weight} Primary Lead to stress-test BEP, churn & unit economics`
        : "Models deterministic BEP, contribution margin & founder opportunity cost";
  }
  if (roleId === "legal-advisor") {
    const boosted = rationaleList.some((r) => r.includes("合规") || r.includes("Legal"));
    return zh
      ? boosted
        ? `课题涉高敏监管/隐私合规风险，提拔为 ${weight} 分主裁一票把关红线与合法替代结构`
        : "排查无证执业、数据隐私与赔偿敞口红线，设计合法替代结构"
      : boosted
        ? `Promoted to W${weight} Primary Lead due to regulatory/privacy redline exposure`
        : "Audits statutory redlines, data privacy & liability caps";
  }
  if (roleId === "market-analyst") {
    return zh
      ? "核查真实买单原语、竞品真实定价与免费/低价替代品的重置成本天花板"
      : "Benchmarks real buyer budget primitives & replacement-cost ceilings";
  }
  if (roleId === "tech-feasibility" || roleId === "software-architect") {
    return zh
      ? tier === "primary"
        ? `技术/架构构成核心交付瓶颈，设为 ${weight} 分主导把控契约与架构边界`
        : "拆解极简可落地 BOM 成本、工时定额与防过度工程化止损线"
      : tier === "primary"
        ? `Set to W${weight} Primary Lead to govern core architecture & delivery bottlenecks`
        : "Scopes lean MVP BOM, labor hours & anti-overengineering stop-loss gates";
  }
  if (roleId.startsWith("skill-")) {
    const skName = roleId.slice(6);
    return zh
      ? `由本机原生技能 \`${skName}\` 孵化（运行后自动存入角色复用库供后续项目直接复用）`
      : `Hatched from native skill "${skName}" (auto-saved to reusable Role Library upon launch)`;
  }
  return zh
    ? `复用自本地角色资产库（当前定位权重 ${weight} 分）`
    : `Retrieved from reusable Role Library (authority weight W${weight})`;
}

/**
 * Renders a crisp, human-friendly Conversational Pre-Flight Briefing in Markdown
 * so any coding agent can explain retrieved reusable roles/skills + recommended weights
 * and let the user confirm or tweak in 1 natural-language reply!
 */
export function renderConversationalPreflightBriefing(params: {
  readonly goal: string;
  readonly locale: VetoBoardLocale;
  readonly retrieved: RetrieveReusableAssetsResult;
  readonly hostModels?: readonly HostModelCandidate[];
  readonly activeHostModel?: string;
  readonly hostPlatform?: string;
  readonly recommendedLineup: readonly {
    readonly roleId: string;
    readonly title: string;
    readonly priorityTier: RolePriorityTier;
    readonly tierLabel: string;
    readonly weight: number;
    readonly wave: number;
    readonly boundSkills: readonly string[];
    readonly recommendedModelId?: string;
    readonly recommendedModelLabel?: string;
  }[];
  readonly rationale: readonly string[];
}): string {
  const { locale, retrieved, recommendedLineup, rationale, hostModels, activeHostModel, hostPlatform } = params;
  const zh = locale === "zh";

  const savedLibCount = retrieved.roles.filter((r) => r.origin === "vetoboard-library").length;
  const ideAgentCount = retrieved.roles.filter(
    (r) => r.origin === "workspace-agent" || r.origin === "ide-agent",
  ).length;
  const builtinCount = retrieved.roles.filter(
    (r) => r.origin === "builtin" || r.origin === "vetoboard-pack",
  ).length;

  const originMap = new Map(retrieved.roles.map((r) => [r.role.roleId, r.origin]));
  const originLabel = (roleId: string): string => {
    if (roleId === "quality-inspector") return zh ? "内置殿后督察" : "Built-in Inspector";
    const o = originMap.get(roleId);
    if (o === "vetoboard-library") return zh ? "📚 已沉淀复用角色库" : "📚 Saved Role Library";
    if (o === "workspace-agent" || o === "ide-agent") return zh ? "🤖 本机原生 Agent" : "🤖 Native IDE Agent";
    if (roleId.startsWith("skill-")) return zh ? "✨ 原生技能新孵化" : "✨ Skill-Hatched";
    return zh ? "🏛️ 标准复用角色" : "🏛️ Core Reusable Role";
  };

  const rows = recommendedLineup.map((item, i) => {
    const skillsStr =
      item.boundSkills.length > 0
        ? item.boundSkills.map((s) => `\`${s}\``).join(", ")
        : item.roleId === "quality-inspector"
          ? "`vetoboard_calc`"
          : "—";
    const modelStr = item.recommendedModelLabel
      ? `\`${item.recommendedModelLabel}\``
      : "`inherit`";
    const reason = explainRoleScore(
      item.roleId,
      item.priorityTier,
      item.weight,
      locale,
      rationale,
    );
    return `| ${i + 1}. **${item.title}** (\`${item.roleId}\`) | ${originLabel(item.roleId)} | ${skillsStr} | ${modelStr} | **${item.tierLabel} · \`${item.weight}\` 分** | ${reason} |`;
  });

  const groupedPills =
    hostModels && hostModels.length > 0
      ? groupHostModelsForDisplay(hostModels, activeHostModel, locale)
      : [];
  const modelMenuLine =
    groupedPills.length > 0
      ? groupedPills.join(" · ")
      : zh
        ? "通用档位 `pro` (旗舰强推理) · `inherit` (均衡主力) · `flash` (高速轻量) · 或任意具体模型名（如 `opus`/`sonnet`/`haiku`、`gpt-5`/`o3`、或 BYOK `deepseek-reasoner`）"
        : "Universal tiers `pro` (Frontier) · `inherit` (Balanced) · `flash` (Fast) · or any concrete model ID (`opus`/`sonnet`/`haiku`, `gpt-5`/`o3`, or BYOK `deepseek-reasoner`)";

  const gapSkills = retrieved.unhatchedSkills.slice(0, 6);
  const gapLine =
    gapSkills.length > 0
      ? gapSkills
          .map((g) => `\`${g.skill.name}\` (${g.skill.source})`)
          .join(" · ")
      : zh
        ? "无未入库缺口技能"
        : "None";

  const matchedKb = retrieved.knowledge ?? [];
  const kbLines =
    matchedKb.length > 0
      ? matchedKb.map((k, idx) => {
          const snippet = k.card.verifiedDigest.split(/\r?\n/)[0]?.replace(/^- /, "") ?? k.card.goal;
          return zh
            ? `  - \`[KB-${idx + 1}]\` **${k.card.title}**（\`${k.card.knowledgeId}\`）：${snippet.slice(0, 110)}`
            : `  - \`[KB-${idx + 1}]\` **${k.card.title}** (\`${k.card.knowledgeId}\`): ${snippet.slice(0, 110)}`;
        })
      : [];

  if (zh) {
    return [
      "### 🛠️ VetoBoard 战前检索与推荐阵容准备单",
      "",
      "> ⚡ **极速开跑（零表单 · 直接说人话即可）**：",
      "> - **认可推荐阵容**：直接回复 **「开跑」**（或 **「只留前 2 个角色开跑」**）；",
      "> - **自由换模型 / 改分数 / 临时加人**：直接回复如 **「精算用 Opus，督察用 Carbon，再加一个财务与人效 ROI 专员，开跑」**。",
      "",
      "| 拟上场席位 | 资产来源 | 自动挂载技能 | 推荐运行模型（可改） | 推荐定位 & 权重分 | 为什么推荐这个分数？（定权依据） |",
      "| :--- | :--- | :--- | :--- | :--- | :--- |",
      ...rows,
      "",
      `- **🎯 当前平台可选模型池${hostPlatform ? ` (${hostPlatform})` : ""}**：${modelMenuLine}`,
      `- **✨ 可一键孵化为新角色的本机原生技能**（用后自动沉淀进复用库）：${gapLine}`,
      ...(kbLines.length > 0
        ? [
            `- **📖 命中的前序实战知识库（默认自动挂载继承底数；若想重算回复「不挂旧知识卡」）**：`,
            ...kbLines,
          ]
        : []),
      "",
      "---",
      `- **📚 三大复用资产库检索完成**：共命中 **${retrieved.roles.length} 个可复用角色**（已沉淀自定义库 \`${savedLibCount}\` 个 · 本机 Agent \`${ideAgentCount}\` 个 · 标准角色 \`${builtinCount}\` 个）+ **${retrieved.skills.length} 个可复用技能包** + **${matchedKb.length} 条历史实战知识卡**${rationale.length > 0 ? `（${rationale.join("；")}）` : ""}。`,
      `- **🛡️ 已激活底座硬门禁**：全课题先联网实证（白板 ≤5~8 次 / 定稿 ≤12~18 次配额封顶，2 次无果标 \`【待确认】\` 止损） + **动态共享白板 ELECTRE+QMV 数学裁决**（D ≥ 60%/65% · C ≥ 66.7% · R≤2 早停） + \`[V1]\` 0.5% 容差独立核账。`,
    ].join("\n");
  }

  return [
    "### 🛠️ VetoBoard Pre-Flight Library Retrieval & Recommended Lineup",
    "",
    "> ⚡ **Quick Start (Plain Language · Zero Forms)**:",
    "> - **Accept defaults**: Reply **\"Go\"** (or **\"Run only #1 and #2\"**);",
    "> - **Customize freely**: Reply naturally (e.g. **\"Use opus for profit-modeler, add an ROI efficiency specialist, and go\"**).",
    "",
    "| Proposed Seat | Asset Origin | Mounted Skills | Recommended Model (Editable) | Tier & Score | Why This Score? |",
    "| :--- | :--- | :--- | :--- | :--- | :--- |",
    ...rows,
    "",
    `- **🎯 Available Models${hostPlatform ? ` (${hostPlatform})` : ""}**: ${modelMenuLine}`,
    `- **✨ Native Skills Available to Hatch into Reusable Roles**: ${gapLine}`,
    ...(kbLines.length > 0
      ? [
          `- **📖 Matched Historical Knowledge Cards (Mounted automatically; say "no knowledge" to start fresh)**:`,
          ...kbLines,
        ]
      : []),
    "",
    "---",
    `- **📚 3-Pillar Asset Library Scan**: Retrieved **${retrieved.roles.length} reusable roles** (${savedLibCount} saved custom · ${ideAgentCount} native IDE agents · ${builtinCount} core) + **${retrieved.skills.length} skills** + **${matchedKb.length} Knowledge Cards**${rationale.length > 0 ? ` (${rationale.join("; ")})` : ""}.`,
    `- **🛡️ Active Governance Guardrails**: Mandatory live web grounding with 20/60/20 search quotas + **Dynamic Shared Whiteboard ELECTRE+QMV Gate** (D >= 60%/65%, C >= 66.7%, R<=2 Early Stop) + \`[V1]\` 0.5% deterministic math reconciliation.`,
  ].join("\n");
}
