import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { VetoBoardLocale } from "../i18n/locales.js";
import { extractKeyDigestLines, type StepDeliverableInput } from "./citedBriefing.js";
import { knowledgeCardSchema, type KnowledgeCard, type VetoBoardTaskRecord } from "./types.js";

/**
 * VetoBoard Verified Knowledge Base (`~/.vetoboard-mcp/library/knowledge/*.json`).
 * Completes VetoBoard's zero-friction multi-phase closed loop:
 * 1. Only `[V1]`-verified `completed` council tasks are distilled into compact (~1.5k char) Knowledge Cards;
 * 2. When the user later launches Phase 2 (in the same chat OR a brand-new window days later),
 *    `retrieveReusableAssets` automatically matches relevant Knowledge Cards alongside Roles & Skills!
 */

export interface RetrievedKnowledgeAsset {
  readonly card: KnowledgeCard;
  readonly relevanceScore: number;
  readonly sourcePath: string;
}

const TAG_SYNONYMS: ReadonlyArray<readonly string[]> = [
  ["market", "industry", "competitor", "市场", "行业", "渠道", "竞品", "选品", "客群"],
  ["profit", "pricing", "finance", "bep", "盈利", "财务", "定价", "成本", "回本", "精算"],
  ["legal", "compliance", "tax", "privacy", "法律", "法规", "合规", "税务", "隐私", "红线"],
  ["technical", "architecture", "engineering", "swe", "技术", "架构", "研发", "工程", "接口"],
  ["risk", "security", "audit", "风险", "风控", "安全", "审计"],
];

const STOPWORDS = new Set([
  "vetoboard",
  "audit",
  "plan",
  "evaluate",
  "design",
  "task",
  "审计",
  "评估",
  "分析",
  "方案",
  "设计",
  "实现",
  "帮我",
  "项目",
  "副业",
  "阶段",
  "继续",
  "推进",
]);

export function inferKnowledgeTags(text: string, domain: "commercial" | "swe" = "commercial"): string[] {
  const tags = new Set<string>([domain]);
  if (/市场|渠道|客群|行业|竞品|选品|转型|market|competitor|niche|buyer/iu.test(text)) {
    tags.add("market");
    tags.add("市场");
  }
  if (/盈利|回本|毛利|定价|成本|月费|年费|抽成|BEP|profit|pricing|margin|\$\d+/iu.test(text)) {
    tags.add("profit");
    tags.add("盈利");
  }
  if (/法规|法律|合规|税务|隐私|牌照|封号|MoR|GDPR|HIPAA|FDA|SOC2|legal|compliance|tax/iu.test(text)) {
    tags.add("legal");
    tags.add("法规");
  }
  if (/架构|代码|接口|工程|定时|集群|硬件|BOM|Serverless|GitHub|API|swe|architecture|infra/iu.test(text)) {
    tags.add("technical");
    tags.add("技术");
  }
  return [...tags];
}

export function extractKnowledgeKeywords(rawText: string): string[] {
  const clean = rawText.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out = new Set<string>();

  for (const m of clean.toLowerCase().match(/[a-z][a-z0-9._-]{2,}/g) ?? []) {
    if (!STOPWORDS.has(m)) out.add(m);
  }

  for (const run of clean.match(/[\u4e00-\u9fff]{2,}/gu) ?? []) {
    const stripped = run
      .replace(/^(?:请|帮我|开始|继续|进入|第一|第二|第\d+阶段|审计|评估|分析|设计)/u, "")
      .replace(/(?:方案|报告|任务|工具|产品|系统)$/u, "");
    if (stripped.length >= 2 && stripped.length <= 6 && !STOPWORDS.has(stripped)) {
      out.add(stripped);
    }
    if (stripped.length >= 4) {
      for (let i = 0; i <= stripped.length - 2 && out.size < 28; i += 2) {
        const bi = stripped.slice(i, i + 2);
        if (!STOPWORDS.has(bi)) out.add(bi);
      }
    }
  }
  return [...out].slice(0, 28);
}

function expandTags(tags: readonly string[]): Set<string> {
  const expanded = new Set<string>();
  for (const t of tags) {
    const low = t.trim().toLowerCase();
    if (!low) continue;
    expanded.add(low);
    for (const grp of TAG_SYNONYMS) {
      if (grp.some((x) => x.toLowerCase() === low)) {
        for (const alias of grp) expanded.add(alias.toLowerCase());
      }
    }
  }
  return expanded;
}

export async function distillAndSaveTaskKnowledge(params: {
  readonly dataRootDir?: string;
  readonly task: VetoBoardTaskRecord;
  readonly deliverables: readonly StepDeliverableInput[];
  readonly verificationMarkdown?: string;
  readonly reportPath: string;
}): Promise<KnowledgeCard> {
  const root = resolve(
    params.dataRootDir ?? process.env.VETOBOARD_DATA_DIR ?? join(homedir(), ".vetoboard-mcp"),
  );
  const kbDir = join(root, "library", "knowledge");
  await mkdir(kbDir, { recursive: true });

  const { task, deliverables, verificationMarkdown, reportPath } = params;
  const zh = task.locale === "zh";
  const cleanGoal = task.goal.replace(/\s+/g, " ").replace(/[。！!？?]+$/u, "").trim();
  const shortGoal = cleanGoal.length > 44 ? `${cleanGoal.slice(0, 44)}…` : cleanGoal;
  const title = zh ? `【实战结论】${shortGoal}` : `[Verified Insight] ${shortGoal}`;

  const digestLines: string[] = [];
  if (verificationMarkdown?.trim()) {
    const vLines = extractKeyDigestLines(verificationMarkdown, 3);
    for (const vl of vLines) {
      digestLines.push(`- [${zh ? "终验核定" : "Verified"}] ${vl}`);
    }
  }
  for (const d of deliverables) {
    const topBullets = extractKeyDigestLines(d.markdown, 2);
    if (topBullets[0]) {
      digestLines.push(`- [${d.title}] ${topBullets[0]}`);
    }
  }

  const rawDigest = digestLines.join("\n").slice(0, 1_800);
  const verifiedDigest =
    rawDigest || (zh ? `- 已完成审计：${cleanGoal}` : `- Completed audit: ${cleanGoal}`);

  const tags = inferKnowledgeTags(`${task.goal}\n${verifiedDigest}`, task.domain);
  const knowledgeId = `kb_${task.taskId.replace(/[^a-zA-Z0-9_-]+/g, "_")}`;

  const card: KnowledgeCard = {
    createdAt: new Date().toISOString(),
    domain: task.domain,
    goal: task.goal,
    knowledgeId,
    ...(task.lockedSharedContract ? { lockedSharedContract: task.lockedSharedContract } : {}),
    reportPath,
    tags,
    taskId: task.taskId,
    title,
    verifiedDigest,
  };

  const targetPath = join(kbDir, `${knowledgeId}.json`);
  await writeFile(targetPath, `${JSON.stringify(card, null, 2)}\n`, "utf8");
  return card;
}

export async function retrieveRelevantKnowledge(params: {
  readonly goal: string;
  readonly domain?: "commercial" | "swe";
  readonly dataRootDir?: string;
  readonly limit?: number;
}): Promise<RetrievedKnowledgeAsset[]> {
  const root = resolve(
    params.dataRootDir ?? process.env.VETOBOARD_DATA_DIR ?? join(homedir(), ".vetoboard-mcp"),
  );
  const kbDir = join(root, "library", "knowledge");
  const keywords = extractKnowledgeKeywords(params.goal);
  const queryTags = expandTags(inferKnowledgeTags(params.goal, params.domain ?? "commercial"));

  const matched: RetrievedKnowledgeAsset[] = [];
  try {
    const files = await readdir(kbDir, { withFileTypes: true });
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith(".json")) continue;
      try {
        const fullPath = join(kbDir, f.name);
        const raw = JSON.parse((await readFile(fullPath, "utf8")).replace(/^\uFEFF/, ""));
        const parsed = knowledgeCardSchema.safeParse(raw);
        if (!parsed.success) continue;
        const card = parsed.data;

        const metaText = `${card.title} ${card.goal} ${card.tags.join(" ")}`.toLowerCase();
        const bodyText = `${card.verifiedDigest} ${card.lockedSharedContract ?? ""}`.toLowerCase();

        let score = 0;
        for (const kw of keywords) {
          const k = kw.toLowerCase();
          if (metaText.includes(k)) score += k.length >= 3 ? 5 : 3;
          else if (bodyText.includes(k)) score += k.length >= 3 ? 2 : 1;
        }
        let tagHits = 0;
        for (const ct of card.tags) {
          if (queryTags.has(ct.toLowerCase())) tagHits += 1;
        }
        // Require either keyword overlap or strong domain+followup signal ("阶段2" / "基于上轮")
        const isExplicitFollowup =
          /(?:阶段\s*2|下一阶段|上轮|上一阶段|继续推进|phase\s*2|next\s*phase|follow[- ]?up)/iu.test(
            params.goal,
          );
        if (score > 0 || (isExplicitFollowup && tagHits >= 1)) {
          score += tagHits * 2 + (isExplicitFollowup ? 6 : 0);
          matched.push({ card, relevanceScore: score, sourcePath: fullPath });
        }
      } catch {
        // Ignore unreadable knowledge file
      }
    }
  } catch {
    // Knowledge dir does not exist yet
  }

  matched.sort(
    (a, b) =>
      b.relevanceScore - a.relevanceScore ||
      b.card.createdAt.localeCompare(a.card.createdAt),
  );
  return matched.slice(0, params.limit ?? 3);
}

export function formatMountedKnowledgeForPrompt(
  cards: readonly KnowledgeCard[],
  locale: VetoBoardLocale = "en",
): string {
  if (cards.length === 0) return "";
  const zh = locale === "zh";
  const blocks: string[] = [
    zh
      ? "## 📖 已挂载的前序实战知识库基线（跨阶段继承——请直接复用已核定底数，勿重做已验证工作）"
      : "## 📖 Mounted Verified Knowledge Base Cards (Inherit validated baselines; do NOT redo solved work)",
  ];

  cards.forEach((c, idx) => {
    const fileUrl = c.reportPath ? `file:///${c.reportPath.replace(/\\/g, "/")}` : undefined;
    blocks.push(
      "",
      `### [KB-${idx + 1}] ${c.title} (\`${c.knowledgeId}\`)`,
      ...(fileUrl
        ? [zh ? `- 前序完整报告溯源：[点击查看前序报告](${fileUrl})` : `- Source Report: [Open Phase Report](${fileUrl})`]
        : []),
      ...(c.lockedSharedContract ? [`- ${zh ? "前序锁定契约" : "Locked Contract"}: ${c.lockedSharedContract.replace(/\s+/g, " ").slice(0, 360)}`] : []),
      c.verifiedDigest,
    );
  });

  return blocks.join("\n");
}
