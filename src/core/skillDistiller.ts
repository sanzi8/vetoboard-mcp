import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { VetoBoardLocale } from "../i18n/locales.js";
import { persistRoleToLibrary } from "./assetLibrary.js";
import { synthesizeRoleFromSkill, type DiscoveredSkill } from "./skillRadar.js";
import type { VetoBoardTaskStore } from "./taskStore.js";
import type { RoleTemplate, VetoBoardTaskRecord } from "./types.js";

/**
 * Standardized Skill & Reusable Role Distiller (`skillDistiller.ts`).
 * Autonomously distills standardized `SKILL.md` & reusable role templates:
 * - Distills verified SOPs, Locked Whiteboard variables, `vetoboard_calc` verification checklists,
 *   and intercepted pitfalls from a Council Task (or structured inputs) into a standardized `SKILL.md`
 *   with clean YAML frontmatter (`name`, `description`).
 * - Optionally synthesizes & saves a companion standardized `RoleTemplate` JSON into `library/roles/`.
 */

export interface DistillStandardizedSkillInput {
  readonly dataRootDir?: string;
  readonly workspaceDir?: string;
  readonly scope?: "user" | "workspace";
  readonly locale: VetoBoardLocale;
  readonly store?: VetoBoardTaskStore;
  readonly task?: VetoBoardTaskRecord;
  readonly skillId?: string;
  readonly title?: string;
  readonly description?: string;
  readonly sopSteps?: readonly string[];
  readonly verificationChecklist?: readonly string[];
  readonly pitfalls?: readonly string[];
  readonly mustUseTools?: readonly string[];
  readonly alsoCreateRole?: boolean;
  readonly roleWeight?: number;
}

export interface DistillStandardizedSkillResult {
  readonly skillId: string;
  readonly skillFilePath: string;
  readonly skillMarkdown: string;
  readonly roleId?: string;
  readonly roleFilePath?: string;
  readonly roleTemplate?: RoleTemplate;
  readonly summaryMarkdown: string;
}

function slugifySkillId(raw: string): string {
  const ascii = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii.length >= 3) return ascii.slice(0, 48);
  // Deterministic hash suffix when input is pure CJK
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return `vetoboard-skill-${hash.toString(36).slice(0, 6)}`;
}

function extractBulletsFromArtifacts(texts: readonly string[], maxItems = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const txt of texts) {
    const lines = txt.split(/\r?\n/);
    for (const raw of lines) {
      const m = /^\s*[-*+]\s+(.{8,180})$/u.exec(raw.trim());
      if (!m) continue;
      const clean = m[1]!.replace(/\s+/g, " ").trim();
      if (seen.has(clean)) continue;
      seen.add(clean);
      out.push(clean);
      if (out.length >= maxItems) return out;
    }
  }
  return out;
}

export async function distillStandardizedSkill(
  input: DistillStandardizedSkillInput,
): Promise<DistillStandardizedSkillResult> {
  const { locale, task, store } = input;
  const zh = locale === "zh";
  const home = homedir();
  const dataRoot = resolve(input.dataRootDir ?? store?.rootDir ?? process.env.VETOBOARD_DATA_DIR ?? join(home, ".vetoboard-mcp"));
  const scope = input.scope ?? "user";

  const rawNameSource =
    input.skillId?.trim() ||
    input.title?.trim() ||
    (task ? `${task.domain}-${task.goal.slice(0, 28)}` : "distilled-governance-sop");
  const skillId = slugifySkillId(rawNameSource);

  const displayTitle =
    input.title?.trim() ||
    (task
      ? zh
        ? `${task.goal.slice(0, 32)} · 标准化核验技能`
        : `${task.goal.slice(0, 40)} Verification Skill`
      : skillId);

  // Collect artifacts if distilling from a task
  const artifactTexts: string[] = [];
  if (task && store) {
    for (const tr of task.tracks) {
      const md = await store.readTrackArtifact(task.taskId, tr.trackId);
      if (md) artifactTexts.push(md);
    }
  }

  // 1. SOP Steps (from explicit input OR Whiteboard variables + track summaries)
  const sopSteps: string[] = [...(input.sopSteps ?? [])];
  if (sopSteps.length === 0 && task) {
    for (const e of task.whiteboardEntries) {
      const kv = Object.entries(e.variables)
        .map(([k, v]) => `\`${k}=${v}\``)
        .join(", ");
      sopSteps.push(
        `${e.roleLabel}: ${e.summary}${kv ? ` (${zh ? "关键基准变量" : "Baseline Vars"}: ${kv})` : ""}`,
      );
    }
    if (sopSteps.length === 0) {
      sopSteps.push(...extractBulletsFromArtifacts(artifactTexts, 5));
    }
  }
  if (sopSteps.length === 0) {
    sopSteps.push(
      zh
        ? "先锚定真实买单方、重置成本天花板与核心架构约束，再并发推进分项核算。"
        : "Anchor real buyer budget, replacement-cost ceiling, and core interface contracts before parallel execution.",
    );
  }

  // 2. Verification Checklist
  const mustTools = input.mustUseTools && input.mustUseTools.length > 0
    ? [...input.mustUseTools]
    : ["vetoboard_calc"];
  const checklist: string[] = [...(input.verificationChecklist ?? [])];
  if (checklist.length === 0) {
    checklist.push(
      zh
        ? `必调确定性工具 \`${mustTools.join(", ")}\`：严禁心算回本周期（BEP）、净毛利或加权评分，所有关键算式须经 \`mode='reconcile'\` 复算零偏差（<0.5%）。`
        : `Invoke deterministic tool(s) \`${mustTools.join(", ")}\`: never mental-math BEP, net margin, or weighted scores; reconcile within <0.5% tolerance.`,
    );
    checklist.push(
      zh
        ? "严格隔离【已验证】客观信源与【待确认】假设项，禁止无出处编造行业均价或转化率。"
        : "Strictly separate [VERIFIED] empirical sources from [ASSUMPTION] items.",
    );
  }

  // 3. Pitfalls & Guardrails (from task catches + minority dissent + explicit pitfalls)
  const pitfalls: string[] = [...(input.pitfalls ?? [])];
  if (pitfalls.length === 0 && task) {
    for (const tr of task.tracks) {
      for (const c of tr.catches) {
        pitfalls.push(`[${c.category}] ${tr.roleLabel}: ${c.detail}`);
      }
    }
    if (task.minorityReportMarkdown) {
      for (const line of task.minorityReportMarkdown.split(/\r?\n/)) {
        if (line.trim().startsWith("- ")) pitfalls.push(line.trim().slice(2));
      }
    }
  }
  if (pitfalls.length === 0) {
    pitfalls.push(
      zh
        ? "严防漏算创始人机会成本、渠道综合税费（如 MoR / VAT）或过度工程化固定云成本。"
        : "Guard against omitting founder opportunity cost, MoR/VAT fees, or over-engineered fixed infra cost.",
    );
  }

  const descriptionClean = (
    input.description?.trim() ||
    (zh
      ? `${displayTitle} —— 提炼自 VetoBoard 实战任务的标准化执行 SOP、确定性验算清单与避坑红线。遇到同类课题时激活复用。`
      : `${displayTitle} — Standardized SOP, deterministic verification checklist, and guardrail pitfalls distilled by VetoBoard.`)
  )
    .replace(/\r?\n/g, " ")
    .slice(0, 220);

  const skillMarkdown = zh
    ? [
        "---",
        `name: ${skillId}`,
        "description: >-",
        `  ${descriptionClean}`,
        "---",
        "",
        `# ${displayTitle}`,
        "",
        "## 1. 适用场景与激活条件",
        `- 当课题涉及 **${displayTitle}** 同类商业精算、合规风控或架构评审时自动挂载或孵化为独立专员角色。`,
        `- 必用核验工具：\`${mustTools.join("`, `")}\``,
        "",
        "## 2. 标准化执行 SOP 与关键参数基线",
        ...sopSteps.map((s, idx) => `${idx + 1}. ${s}`),
        "",
        "## 3. 确定性核验清单（Executable Checklist）",
        ...checklist.map((c) => `- [ ] ${c}`),
        "",
        "## 4. 实战踩坑防线与保留风险备忘",
        ...pitfalls.map((p) => `- ⚠️ ${p}`),
        "",
      ].join("\n")
    : [
        "---",
        `name: ${skillId}`,
        "description: >-",
        `  ${descriptionClean}`,
        "---",
        "",
        `# ${displayTitle}`,
        "",
        "## 1. When to Activate",
        `- Activate when auditing or building workflows related to **${displayTitle}**.`,
        `- Required deterministic tools: \`${mustTools.join("`, `")}\``,
        "",
        "## 2. Standard Operating Procedure (SOP) & Baseline Contracts",
        ...sopSteps.map((s, idx) => `${idx + 1}. ${s}`),
        "",
        "## 3. Deterministic Verification Checklist",
        ...checklist.map((c) => `- [ ] ${c}`),
        "",
        "## 4. Guardrail Pitfalls & Residual Risks",
        ...pitfalls.map((p) => `- ⚠️ ${p}`),
        "",
      ].join("\n");

  const baseSkillsDir =
    scope === "workspace" && (input.workspaceDir?.trim() || task?.workspaceDir?.trim())
      ? join(resolve((input.workspaceDir ?? task!.workspaceDir)!), ".agents", "skills")
      : join(dataRoot, "library", "skills");

  const skillDir = join(baseSkillsDir, skillId);
  await mkdir(skillDir, { recursive: true });
  const skillFilePath = join(skillDir, "SKILL.md");
  await writeFile(skillFilePath, skillMarkdown, "utf8");

  let roleTemplate: RoleTemplate | undefined;
  let roleFilePath: string | undefined;
  if (input.alsoCreateRole) {
    const discoveredObj: DiscoveredSkill = {
      description: descriptionClean,
      filePath: skillFilePath,
      inlineContent: skillMarkdown,
      name: skillId,
      skillId,
      source: scope === "workspace" ? "workspace" : "vetoboard-library",
    };
    roleTemplate = synthesizeRoleFromSkill(discoveredObj, locale, input.roleWeight ?? 90);
    roleFilePath = await persistRoleToLibrary(dataRoot, roleTemplate, [skillId]);
  }

  const summaryMarkdown = zh
    ? [
        `## ✨ 标准化技能提炼完成（\`${skillId}\`）`,
        `- **标准 \`SKILL.md\` 已落盘**：\`${skillFilePath}\`（下次 \`vetoboard_plan_lineup\` 将自动检索命中！）`,
        ...(roleTemplate && roleFilePath
          ? [`- **配套标准化角色已同步落盘**：\`${roleTemplate.roleId}\` → \`${roleFilePath}\``]
          : []),
        `- **包含模块**：YAML 标准头 + ${sopSteps.length} 步 SOP + ${checklist.length} 项核验清单 + ${pitfalls.length} 条实战防坑红线。`,
        "",
        `> 💡 **可选社区共享（方法 A）**：若您愿意将该标准化技能/角色回馈官方库，可调用 \`vetoboard_contribute_asset\` 先查看脱敏预览单（收录进库后**仅用于项目升级或体验优化，且支持凭单号随时撤回**）。`,
      ].join("\n")
    : [
        `## ✨ Standardized Skill Distilled (\`${skillId}\`)`,
        `- **Saved \`SKILL.md\`**: \`${skillFilePath}\` (auto-discoverable in future \`vetoboard_plan_lineup\` runs!)`,
        ...(roleTemplate && roleFilePath
          ? [`- **Companion Standardized Role Saved**: \`${roleTemplate.roleId}\` -> \`${roleFilePath}\``]
          : []),
        "",
        `> 💡 **Optional Community Contribution (Method A)**: Call \`vetoboard_contribute_asset\` to preview sanitized sharing (stored in library **solely for project upgrades/optimization, and withdrawable anytime**).`,
      ].join("\n");

  return {
    ...(roleFilePath ? { roleFilePath } : {}),
    ...(roleTemplate ? { roleId: roleTemplate.roleId, roleTemplate } : {}),
    skillFilePath,
    skillId,
    skillMarkdown,
    summaryMarkdown,
  };
}
