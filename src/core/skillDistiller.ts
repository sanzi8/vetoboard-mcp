import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { VetoBoardLocale } from "../i18n/locales.js";
import { persistRoleToLibrary } from "./assetLibrary.js";
import { findRoleTemplate, formatModelBindingLabel } from "./roleCatalog.js";
import { synthesizeRoleFromSkill, type DiscoveredSkill } from "./skillRadar.js";
import type { VetoBoardTaskStore } from "./taskStore.js";
import {
  vetoboardAssetPackSchema,
  type RoleTemplate,
  type VetoBoardAssetPack,
  type VetoBoardTaskRecord,
} from "./types.js";

/**
 * Multi-Target Standardized Asset Distiller (`skillDistiller.ts`).
 * Autonomously distills verified runs into ANY combination of 4 standardized cross-agent formats:
 * 1. `"skill"` -> Standardized `SKILL.md` (`library/skills/` or `<workspace>/.agents/skills/` + optional Host IDE `~/.gemini`/`~/.claude`/`~/.codex` sync)
 * 2. `"role"` -> Standardized `RoleTemplate` JSON (`library/roles/`) + Cross-IDE Markdown Subagent `.md`
 * 3. `"rule"` -> Idempotent Global or Workspace Guardrail Rule (`.agents/rules/<id>.md`, `library/rules/<id>.md`, or custom `AGENTS.md`/`GEMINI.md`/`CLAUDE.md`)
 * 4. `"project-pack"` -> Full Reusable Project Council Template (`.vetoboard-pack.json` preserving lineup, weights, `modelBinding`, rules & whiteboard baseline!)
 */

export type DistillExportTarget = "skill" | "role" | "rule" | "project-pack";

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
  readonly exportTargets?: readonly DistillExportTarget[];
  readonly syncToHostIde?: boolean;
  readonly hostIdeRootOverride?: string;
  readonly customRuleFilePath?: string;
  readonly roleWeight?: number;
}

export interface DistillStandardizedSkillResult {
  readonly skillId: string;
  readonly skillFilePath?: string;
  readonly syncedIdeSkillPaths?: readonly string[];
  readonly skillMarkdown: string;
  readonly roleId?: string;
  readonly roleFilePath?: string;
  readonly nativeAgentFilePath?: string;
  readonly roleTemplate?: RoleTemplate;
  readonly ruleFilePath?: string;
  readonly packFilePath?: string;
  readonly summaryMarkdown: string;
}

function slugifySkillId(raw: string): string {
  const ascii = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii.length >= 3) return ascii.slice(0, 48);
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

async function dirExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function upsertMarkedRuleSection(
  filePath: string,
  ruleId: string,
  sectionMarkdown: string,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const beginMarker = `<!-- vetoboard-rule:${ruleId}:begin -->`;
  const endMarker = `<!-- vetoboard-rule:${ruleId}:end -->`;
  const wrapped = `${beginMarker}\n${sectionMarkdown.trim()}\n${endMarker}\n`;

  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, wrapped, "utf8");
    return;
  }

  const startIdx = existing.indexOf(beginMarker);
  const endIdx = existing.indexOf(endMarker);
  if (startIdx >= 0 && endIdx > startIdx) {
    const updated =
      existing.slice(0, startIdx) +
      wrapped.trim() +
      existing.slice(endIdx + endMarker.length);
    await writeFile(filePath, `${updated.trim()}\n`, "utf8");
    return;
  }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  await writeFile(filePath, `${existing}${sep}${wrapped}`, "utf8");
}

export async function distillStandardizedSkill(
  input: DistillStandardizedSkillInput,
): Promise<DistillStandardizedSkillResult> {
  const { locale, task, store } = input;
  const zh = locale === "zh";
  const home = homedir();
  const dataRoot = resolve(
    input.dataRootDir ?? store?.rootDir ?? process.env.VETOBOARD_DATA_DIR ?? join(home, ".vetoboard-mcp"),
  );
  const scope = input.scope ?? "user";
  const effectiveWs = input.workspaceDir?.trim() || task?.workspaceDir?.trim();

  const targetSet = new Set<DistillExportTarget>(
    input.exportTargets && input.exportTargets.length > 0 ? input.exportTargets : ["skill"],
  );
  if (input.alsoCreateRole) {
    targetSet.add("role");
  }

  const rawNameSource =
    input.skillId?.trim() ||
    input.title?.trim() ||
    (task ? `${task.domain}-${task.goal.slice(0, 28)}` : "distilled-governance-sop");
  const skillId = slugifySkillId(rawNameSource);

  const displayTitle =
    input.title?.trim() ||
    (task
      ? zh
        ? `${task.goal.slice(0, 32)} · 标准化治理资产`
        : `${task.goal.slice(0, 40)} Governance Asset`
      : skillId);

  const artifactTexts: string[] = [];
  if (task && store) {
    for (const tr of task.tracks) {
      const md = await store.readTrackArtifact(task.taskId, tr.trackId);
      if (md) artifactTexts.push(md);
    }
  }

  // 1. SOP Steps
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
        ? "先联网核实三档真实具体型号现价与现行法规，锚定重置成本天花板后再并发推进核算。"
        : "Verify live 3-tier SKU prices & statutory baselines via web search before parallel execution.",
    );
  }

  // 2. Verification Checklist
  const mustTools =
    input.mustUseTools && input.mustUseTools.length > 0
      ? [...input.mustUseTools]
      : ["WebSearch", "vetoboard_calc"];
  const checklist: string[] = [...(input.verificationChecklist ?? [])];
  if (checklist.length === 0) {
    checklist.push(
      zh
        ? `必调确定性工具 \`${mustTools.join(", ")}\`：先联网抓一手链接，再用 \`vetoboard_calc (mode='reconcile')\` 独立复算三档损益与单人物理产能利用率（偏差 <0.5%）。`
        : `Invoke \`${mustTools.join(", ")}\`: verify live primary URLs first, then reconcile tiered margins & physical capacity utilization (<0.5% tolerance).`,
    );
    checklist.push(
      zh
        ? "严格标注四级结论状态（【已验证】/【模型推算】/【条件性建议】/【待确认】），禁止用单一平均值掩盖低端亏损黑洞。"
        : "Tag every core claim with 4-tier readiness status and never mask low-end loss tiers behind a single average.",
    );
  }

  // 3. Pitfalls & Guardrails
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
        ? "严防漏算创始人机会成本、返修摊销、渠道综合税费或单人物理极限产能上限。"
        : "Guard against omitting founder opportunity cost, rework amortization, channel fees, or solo physical capacity limits.",
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

  let skillFilePath: string | undefined;
  const syncedIdeSkillPaths: string[] = [];

  // Target A: Standardized `SKILL.md`
  if (targetSet.has("skill")) {
    const baseSkillsDir =
      scope === "workspace" && effectiveWs
        ? join(resolve(effectiveWs), ".agents", "skills")
        : join(dataRoot, "library", "skills");

    const skillDir = join(baseSkillsDir, skillId);
    await mkdir(skillDir, { recursive: true });
    skillFilePath = join(skillDir, "SKILL.md");
    await writeFile(skillFilePath, skillMarkdown, "utf8");

    // Optional sync into native Host IDE global skill directories (`~/.gemini/config/skills`, `~/.claude/skills`, `~/.codex/skills`, `~/.hermes/skills`, `~/.cursor/skills`)
    if (input.syncToHostIde && scope === "user") {
      const hostBase = input.hostIdeRootOverride ? resolve(input.hostIdeRootOverride) : home;
      const candidateIdeRoots = [
        join(hostBase, ".gemini", "config"),
        join(hostBase, ".claude"),
        join(hostBase, ".codex"),
        join(hostBase, ".hermes"),
        join(hostBase, ".cursor"),
      ];
      for (const ideRoot of candidateIdeRoots) {
        if (await dirExists(ideRoot)) {
          const ideSkillFile = join(ideRoot, "skills", skillId, "SKILL.md");
          await mkdir(dirname(ideSkillFile), { recursive: true });
          await writeFile(ideSkillFile, skillMarkdown, "utf8");
          syncedIdeSkillPaths.push(ideSkillFile);
        }
      }
    }
  }

  // Target B: Standardized Reusable Role (`RoleTemplate` JSON + Cross-IDE Markdown Agent `.md`)
  let roleTemplate: RoleTemplate | undefined;
  let roleFilePath: string | undefined;
  let nativeAgentFilePath: string | undefined;
  if (targetSet.has("role")) {
    const discoveredObj: DiscoveredSkill = {
      description: descriptionClean,
      ...(skillFilePath ? { filePath: skillFilePath } : {}),
      inlineContent: skillMarkdown,
      name: skillId,
      skillId,
      source: scope === "workspace" ? "workspace" : "vetoboard-library",
    };
    roleTemplate = synthesizeRoleFromSkill(discoveredObj, locale, input.roleWeight ?? 90);
    roleFilePath = await persistRoleToLibrary(dataRoot, roleTemplate, [skillId]);

    const agentMd = [
      "---",
      `name: ${roleTemplate.roleId}`,
      `description: ${descriptionClean}`,
      "---",
      "",
      roleTemplate.systemCharter[locale],
      "",
    ].join("\n");

    const agentsDir =
      scope === "workspace" && effectiveWs
        ? join(resolve(effectiveWs), ".agents", "agents")
        : input.syncToHostIde && input.hostIdeRootOverride
          ? join(resolve(input.hostIdeRootOverride), ".gemini", "config", "agents")
          : undefined;
    if (agentsDir) {
      await mkdir(agentsDir, { recursive: true });
      nativeAgentFilePath = join(agentsDir, `${roleTemplate.roleId}.md`);
      await writeFile(nativeAgentFilePath, agentMd, "utf8");
    }
  }

  // Target C: Global or Workspace Guardrail Rule (`rule`)
  let ruleFilePath: string | undefined;
  if (targetSet.has("rule")) {
    const ruleBody = zh
      ? [
          `## 🛡️ VetoBoard 实战提炼护栏规则：${displayTitle} (\`${skillId}\`)`,
          ...checklist.map((c) => `- **硬核验要求**：${c}`),
          ...pitfalls.slice(0, 6).map((p) => `- **避坑红线**：${p}`),
        ].join("\n")
      : [
          `## 🛡️ VetoBoard Distilled Guardrail Rule: ${displayTitle} (\`${skillId}\`)`,
          ...checklist.map((c) => `- **Verification Gate**: ${c}`),
          ...pitfalls.slice(0, 6).map((p) => `- **Redline**: ${p}`),
        ].join("\n");

    ruleFilePath = input.customRuleFilePath?.trim()
      ? resolve(input.customRuleFilePath)
      : scope === "workspace" && effectiveWs
        ? join(resolve(effectiveWs), ".agents", "rules", `${skillId}.md`)
        : join(dataRoot, "library", "rules", `${skillId}.md`);
    await upsertMarkedRuleSection(ruleFilePath, skillId, ruleBody);
  }

  // Target D: Reusable Project Council Pack Template (`project-pack` -> `.vetoboard-pack.json`)
  let packFilePath: string | undefined;
  if (targetSet.has("project-pack")) {
    const packRoles: RoleTemplate[] = [];
    if (task) {
      for (const tr of task.tracks) {
        if (tr.status === "skipped") continue;
        const baseTpl = findRoleTemplate(tr.roleId);
        const tpl: RoleTemplate = baseTpl
          ? {
              ...baseTpl,
              ...(tr.modelBinding ? { modelBinding: tr.modelBinding } : {}),
              weight: tr.weight,
            }
          : {
              allowedTools: ["Read", "Grep", "Glob", "WebSearch", "vetoboard_calc"],
              domain: task.domain,
              evidenceRequirements: ["Live web verification + deterministic vetoboard_calc receipt"],
              executableRules: tr.customRules ?? [],
              kind: tr.roleId === "quality-inspector" ? "inspector" : "professional",
              ...(tr.modelBinding ? { modelBinding: tr.modelBinding } : {}),
              name: { en: tr.roleLabel, zh: tr.roleLabel },
              priorityTier: tr.weight >= 92 ? "primary" : tr.weight >= 80 ? "guardrail" : "secondary",
              readOnly: true,
              roleId: tr.roleId,
              systemCharter: {
                en: tr.customCharter ?? tr.title,
                zh: tr.customCharter ?? tr.title,
              },
              weight: tr.weight,
            };
        packRoles.push(tpl);
      }
    } else if (roleTemplate) {
      packRoles.push(roleTemplate);
    }

    const modelSummary = task
      ? task.tracks
          .filter((tItem) => tItem.modelBinding)
          .map((tItem) => `${tItem.roleId}=${formatModelBindingLabel(tItem.modelBinding)}`)
          .join(", ")
      : "";

    const packObj: VetoBoardAssetPack = vetoboardAssetPackSchema.parse({
      author: "Local Distilled Project Template",
      description: {
        en: `Reusable Project Council Template for "${displayTitle}"${modelSummary ? ` (Models: ${modelSummary})` : ""}`,
        zh: `可一键复刻的项目委员会阵容与规则模板：「${displayTitle}」${modelSummary ? `（绑定模型：${modelSummary}）` : ""}`,
      },
      exportedAt: new Date().toISOString(),
      format: "vetoboard-asset-pack",
      name: {
        en: `${displayTitle} Template Pack`,
        zh: `${displayTitle} · 项目模板包`,
      },
      packId: `pack-${skillId}`,
      roles: packRoles,
      schemaVersion: 1,
      skills: [
        {
          content: { en: skillMarkdown, zh: skillMarkdown },
          skillId,
          title: { en: displayTitle, zh: displayTitle },
        },
      ],
    });

    const packsDir =
      scope === "workspace" && effectiveWs
        ? resolve(effectiveWs)
        : join(dataRoot, "packs");
    await mkdir(packsDir, { recursive: true });
    packFilePath = join(packsDir, `${skillId}.vetoboard-pack.json`);
    await writeFile(packFilePath, `${JSON.stringify(packObj, null, 2)}\n`, "utf8");
  }

  const exportedLines: string[] = [];
  if (skillFilePath) {
    exportedLines.push(
      zh
        ? `- **标准技能 (\`SKILL.md\`) 已落盘**：\`${skillFilePath}\`（下次 \`vetoboard_plan_lineup\` 将自动检索命中！）`
        : `- **Saved \`SKILL.md\`**: \`${skillFilePath}\``,
    );
  }
  for (const ideP of syncedIdeSkillPaths) {
    exportedLines.push(
      zh ? `- **已同步挂载至宿主 IDE 全局技能目录**：\`${ideP}\`` : `- **Synced to Host IDE Skills**: \`${ideP}\``,
    );
  }
  if (roleTemplate && roleFilePath) {
    exportedLines.push(
      zh
        ? `- **配套标准化角色已落盘**：\`${roleTemplate.roleId}\` → \`${roleFilePath}\`${nativeAgentFilePath ? `（及原生 Agent \`${nativeAgentFilePath}\`）` : ""}`
        : `- **Saved Standardized Role**: \`${roleTemplate.roleId}\` -> \`${roleFilePath}\``,
    );
  }
  if (ruleFilePath) {
    exportedLines.push(
      zh
        ? `- **防坑护栏规则 (\`Rule\`) 已写入**：\`${ruleFilePath}\``
        : `- **Saved Guardrail Rule**: \`${ruleFilePath}\``,
    );
  }
  if (packFilePath) {
    exportedLines.push(
      zh
        ? `- **整套项目委员会阵容模板 (\`.vetoboard-pack.json\`) 已落盘**：\`${packFilePath}\`（含全员权重、模型绑定与技能契约，同类课题可直接整套复刻！）`
        : `- **Saved Project Council Pack Template**: \`${packFilePath}\``,
    );
  }

  const summaryMarkdown = zh
    ? [
        `## ✨ 标准化技能提炼完成（\`${skillId}\`）`,
        ...exportedLines,
        `- **提炼要素**：${sopSteps.length} 步 SOP + ${checklist.length} 项确定性核验清单 + ${pitfalls.length} 条实战避坑红线。`,
        "",
        `> 💡 **可选社区共享（方法 A）**：若您愿意将该资产回馈官方库，只需回复 **「预览推送」**（调用 \`vetoboard_contribute_asset\`），系统会先展示本地脱敏预览单（收录进库后**仅用于项目升级或体验优化，且凭单号 100% 随时可撤回**）。`,
      ].join("\n")
    : [
        `## ✨ Standardized Assets Saved (\`${skillId}\`)`,
        ...exportedLines,
        "",
        `> 💡 **Optional Community Contribution (Method A)**: Reply **"Preview contribution"** (\`vetoboard_contribute_asset\`) to inspect the privacy-scrubbed payload (stored in library **solely for project upgrades/optimization, and withdrawable anytime**).`,
      ].join("\n");

  return {
    ...(nativeAgentFilePath ? { nativeAgentFilePath } : {}),
    ...(packFilePath ? { packFilePath } : {}),
    ...(roleFilePath ? { roleFilePath } : {}),
    ...(roleTemplate ? { roleId: roleTemplate.roleId, roleTemplate } : {}),
    ...(ruleFilePath ? { ruleFilePath } : {}),
    ...(skillFilePath ? { skillFilePath } : {}),
    skillId,
    skillMarkdown,
    summaryMarkdown,
    ...(syncedIdeSkillPaths.length > 0 ? { syncedIdeSkillPaths } : {}),
  };
}
