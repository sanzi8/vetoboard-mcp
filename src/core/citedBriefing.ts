import type { VetoBoardLocale } from "../i18n/locales.js";
import { formatDeliberationLogForReport } from "./deliberationEngine.js";
import { extractArtifactSections } from "./memorialCard.js";
import { extractVerifiedHttpUrls } from "./researchBudget.js";
import type { CatchEvent, DeliberationOpinion } from "./types.js";

/**
 * Bilingual (`en` + `zh`) Paper-Grade Citation Engine (`[[Sx·§y]](#ref-sx-secy)`) & First-Principles Briefing Assembler.
 * Preserves 100% of raw specialist deliverables intact while topping the report with clickable cross-section citations.
 */

export interface StepDeliverableInput {
  readonly stepId: string;
  readonly title: string;
  readonly roleLabel: string;
  readonly wave?: number;
  readonly isTerminal?: boolean;
  readonly markdown: string;
}

export interface IndexedStepEntry {
  readonly code: string;
  readonly anchorId: string;
  readonly stepId: string;
  readonly title: string;
  readonly roleLabel: string;
  readonly wave: number;
  readonly isTerminal: boolean;
  readonly subsections: readonly {
    readonly code: string;
    readonly anchorId: string;
    readonly heading: string;
  }[];
  readonly annotatedMarkdown: string;
  readonly rawMarkdown: string;
}

export interface CitationIndex {
  readonly entries: readonly IndexedStepEntry[];
  readonly validAnchors: ReadonlySet<string>;
  readonly stepAnchorByNum: ReadonlyMap<number, string>;
}

export function indexDeliverables(
  deliverables: readonly StepDeliverableInput[],
  hasVerification = false,
): CitationIndex {
  const validAnchors = new Set<string>(["ref-briefing-top"]);
  const stepAnchorByNum = new Map<number, string>();
  const entries: IndexedStepEntry[] = [];

  deliverables.forEach((item, idx) => {
    const num = idx + 1;
    const code = `S${num}`;
    const anchorId = `ref-s${num}`;
    validAnchors.add(anchorId);
    stepAnchorByNum.set(num, anchorId);

    const subsections: { code: string; anchorId: string; heading: string }[] = [];
    const lines = item.markdown.trim().split(/\r?\n/);
    const annotatedLines: string[] = [];
    let inFence = false;
    let secCount = 0;
    let seenFirstH1 = false;

    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        annotatedLines.push(line);
        continue;
      }
      if (!inFence && secCount < 12) {
        const match = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
        if (match) {
          // Skip redundant top-level `# Title` document banner so `[Sx·§1]` anchors the first real section
          if (match[1] === "#" && !seenFirstH1 && secCount === 0) {
            seenFirstH1 = true;
            annotatedLines.push(`#### ${match[2]!.trim()}`);
            continue;
          }
          const rawHeading = match[2]!.replace(/\s*\[S\d+·§\d+\]\s*/g, "").trim();
          if (rawHeading.length > 0 && rawHeading.length <= 100) {
            secCount += 1;
            const secCode = `${code}·§${secCount}`;
            const secAnchor = `ref-s${num}-sec${secCount}`;
            validAnchors.add(secAnchor);
            subsections.push({ anchorId: secAnchor, code: secCode, heading: rawHeading });
            const hashes = match[1]!.length < 3 ? "####" : match[1]!;
            annotatedLines.push(`<a id="${secAnchor}"></a>`, "", `${hashes} [${secCode}] ${rawHeading}`);
            continue;
          }
        }
      }
      annotatedLines.push(line);
    }

    entries.push({
      anchorId,
      annotatedMarkdown: annotatedLines.join("\n"),
      code,
      isTerminal: item.isTerminal ?? idx === deliverables.length - 1,
      rawMarkdown: item.markdown.trim(),
      roleLabel: item.roleLabel,
      stepId: item.stepId,
      subsections,
      title: item.title,
      wave: item.wave ?? 1,
    });
  });

  if (hasVerification) validAnchors.add("ref-v1");
  return { entries, stepAnchorByNum, validAnchors };
}

export function normalizeCitationLinks(markdown: string, index: CitationIndex): string {
  let normalized = markdown.replace(
    /\]\(#(ref-s(\d+)(?:-sec\d+)?|ref-v1)\)/giu,
    (full, anchorRaw: string, stepNumRaw?: string) => {
      const lower = anchorRaw.toLowerCase();
      if (index.validAnchors.has(lower)) return `](#${lower})`;
      if (stepNumRaw) {
        const parent = index.stepAnchorByNum.get(Number(stepNumRaw));
        if (parent) return `](#${parent})`;
      }
      return full;
    },
  );

  normalized = normalized.replace(
    /(?<!\[)\[(S(\d+)(?:[·.\s]*§?(\d+))?|V1)\](?!\()/gu,
    (full, rawLabel: string, stepNumStr?: string, secNumStr?: string) => {
      if (rawLabel === "V1") {
        return index.validAnchors.has("ref-v1") ? "[[V1]](#ref-v1)" : full;
      }
      const stepNum = Number(stepNumStr);
      const stepAnchor = index.stepAnchorByNum.get(stepNum);
      if (!stepAnchor) return full;
      if (secNumStr) {
        const secNum = Number(secNumStr);
        const secAnchor = `ref-s${stepNum}-sec${secNum}`;
        if (index.validAnchors.has(secAnchor)) {
          return `[[S${stepNum}·§${secNum}]](#${secAnchor})`;
        }
      }
      return `[[S${stepNum}]](#${stepAnchor})`;
    },
  );

  return normalized;
}

export function countEmpiricalSources(markdownBlocks: readonly string[]): number {
  const uniqueUrls = new Set<string>();
  let statutoryOrVerifiedTags = 0;
  for (const block of markdownBlocks) {
    for (const m of block.matchAll(/https?:\/\/[^\s)\]>"']+/giu)) {
      uniqueUrls.add(m[0].replace(/[.,;:]+$/, ""));
    }
    const tags = block.match(/(?:\[VERIFIED\]|【已验证】)/gu);
    if (tags) statutoryOrVerifiedTags += tags.length;
  }
  return uniqueUrls.size > 0 ? uniqueUrls.size : Math.max(markdownBlocks.length, statutoryOrVerifiedTags);
}

export function countReconciledMathRows(verificationMarkdown: string | undefined, trackedCount: number): number {
  if (trackedCount > 0 && !verificationMarkdown) return trackedCount;
  if (!verificationMarkdown) return Math.max(trackedCount, 1);
  // Count table rows containing PASS / FAIL / formula backticks in inspector reconciliation tables
  const passRows = verificationMarkdown
    .split(/\r?\n/)
    .filter((l) => /^\s*\|.*\|\s*(?:PASS|FAIL|通过|不通过)\s*\|\s*$/iu.test(l)).length;
  return Math.max(trackedCount, passRows, 1);
}

const DIGEST_MEMORIAL_HEADING_RE =
  /(?:呈批摘要卡|核心参数呈批卡|呈批卡|核心定论|终局裁决|交锋结论|Executive\s+Memorial|Memorial\s+Card|Fact\s+Card|Core\s+Verdict|Executive\s+Summary)/iu;

const DIGEST_HIGH_SIGNAL_RE =
  /(?:\$?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:USD|EUR|CNY|RMB|元|万元|%|人|单|套|台|户|月|年|users?|units?|hrs?|mo|yr)|BEP|ROI|LTV|CAC|MoR|GDPR|HIPAA|FDA|SOC2|NO-GO|CONDITIONAL|PASS|FAIL|结论|定论|裁决|红线|死穴|毛利|盈亏|回本|天花板|替代|错配|偏差|修正|让步|通过|否决|verdict|conclusion|margin|break[- ]?even|redline|ceiling|reconcil)/iu;

function cleanDigestBullet(raw: string, maxLen = 220): string {
  const cleaned = raw
    .replace(/^\s*(?:[-*+>]|\d+[.)])\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1)}…`;
}

export function extractKeyDigestLines(markdown: string, maxLines = 4): string[] {
  const lines = markdown.trim().split(/\r?\n/);
  const sections = extractArtifactSections(lines);
  const picked: string[] = [];
  const seen = new Set<string>();

  const pushUnique = (raw: string) => {
    const cleaned = cleanDigestBullet(raw);
    if (cleaned.length < 10) return;
    const key = cleaned.slice(0, 48).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(cleaned);
  };

  // 1. Prefer explicit `### 呈批摘要卡` / `### Executive Memorial` bullets when present
  const memorialSec = sections.find((s) => DIGEST_MEMORIAL_HEADING_RE.test(s.heading));
  if (memorialSec) {
    let inFence = false;
    for (let i = memorialSec.startLine; i < Math.min(lines.length, memorialSec.endLine); i += 1) {
      const ln = lines[i]!.trim();
      if (/^```/.test(ln)) {
        inFence = !inFence;
        continue;
      }
      if (inFence || !ln || /^#{1,6}\s/.test(ln) || /^\|[\s:|-]+\|$/.test(ln)) continue;
      if (ln.startsWith("|") && ln.endsWith("|")) continue;
      pushUnique(ln);
      if (picked.length >= maxLines) return picked;
    }
  }

  // 2. Scan document for high-signal verdict/redline/numeric bullets
  let inFence = false;
  for (const rawLine of lines) {
    const ln = rawLine.trim();
    if (/^```/.test(ln)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !ln || /^#{1,6}\s/.test(ln) || /^\|[\s:|-]+\|$/.test(ln)) continue;
    if (ln.startsWith("|") && ln.endsWith("|")) continue;
    if (DIGEST_HIGH_SIGNAL_RE.test(ln)) {
      pushUnique(ln);
      if (picked.length >= maxLines) return picked;
    }
  }

  // 3. Fallback to any prose line or first data table row
  inFence = false;
  for (const rawLine of lines) {
    const ln = rawLine.trim();
    if (/^```/.test(ln)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !ln || /^#{1,6}\s/.test(ln) || /^\|[\s:|-]+\|$/.test(ln)) continue;
    if (ln.startsWith("|") && ln.endsWith("|")) {
      const cells = ln
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length >= 2) pushUnique(cells.join(" · "));
    } else {
      pushUnique(ln);
    }
    if (picked.length >= maxLines) break;
  }

  return picked;
}

/**
 * Deterministically extracts 1-2 structured CatchEvent highlights from a track's markdown
 * when a lightweight host LLM omits the optional `catchHighlights` field on `vetoboard_submit_track_output`.
 */
export function extractAutoCatchesFromMarkdown(
  markdown: string,
  roleId: string,
): { readonly category: CatchEvent["category"]; readonly detail: string }[] {
  const candidates = extractKeyDigestLines(markdown, 6);
  const out: { category: CatchEvent["category"]; detail: string }[] = [];

  for (const line of candidates) {
    const plain = line.replace(/\*\*/g, "").replace(/\\\$/g, "$").trim();
    const detail = plain.length <= 130 ? plain : `${plain.slice(0, 129)}…`;
    let category: CatchEvent["category"] = "evidence_verified";

    if (
      /(?:红线|违规|违法|死穴|严禁|禁止|封号|吊销|侵权|隐私|合规|MoR|GDPR|HIPAA|FDA|SOC2|redline|violation|prohibit|forbid|statutory|compliance|liability)/iu.test(
        plain,
      )
    ) {
      category = "compliance_redline";
    } else if (
      /(?:数学矛盾|算术|幻觉|偏差|漏算|低估|高估|实为|而非|重算|复算|mismatch|discrepancy|understat|overstat|instead\s+of|reconcil)/iu.test(
        plain,
      ) ||
      ((roleId === "profit-modeler" || roleId === "quality-inspector") &&
        /(?:BEP|盈亏|回本|毛利|成本|break[- ]?even|margin|\$\d+)/iu.test(plain))
    ) {
      category = "math_mismatch";
    } else if (
      /(?:交锋|互撕|质询|让步|错配|伪需求|伪捆绑|天花板|免费替代|冲突|clash|concession|ceiling|conflict|free\s+alternative|premise)/iu.test(
        plain,
      )
    ) {
      category = "premise_conflict";
    }

    if (!out.some((x) => x.category === category && x.detail.slice(0, 32) === detail.slice(0, 32))) {
      out.push({ category, detail });
    }
    if (out.length >= 2) break;
  }

  return out;
}

/**
 * Zero-token deterministic Executive Briefing synthesizer used whenever the host agent omits
 * `executiveBriefingMarkdown` on the final `vetoboard_submit_track_output` call.
 * Combines `[V1]` (Inspector's reconciliation verdict) + every track `[S1·§1]..[Sn·§1]` in authority weight order!
 */
function escapeBareCurrencyDollars(text: string): string {
  // Escape unescaped `$` before digits outside inline code spans so KaTeX viewers don't treat `$9 ... $2.2` as math
  return text
    .split(/(`[^`]*`)/g)
    .map((part, idx) => (idx % 2 === 1 ? part : part.replace(/(?<!\\)\$(?=\d)/g, "\\$")))
    .join("");
}

function foldMachineJsonBlocks(markdown: string, zh: boolean): string {
  return markdown.replace(/```json\s*([\s\S]*?)```/gu, (fullMatch, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed.length <= 400 && !/"checks"|"mode"\s*:\s*"reconcile"|"unitContribution"/u.test(trimmed)) {
      return fullMatch;
    }
    return [
      "<details>",
      `<summary>${zh ? "展开查看机器复算参数与结构化审计 JSON 底稿" : "Expand machine reconciliation parameters & JSON audit payload"}</summary>`,
      "",
      fullMatch,
      "",
      "</details>",
    ].join("\n");
  });
}

function matchBestSubsectionCode(entry: IndexedStepEntry, bullet: string, fallbackIdx: number): string {
  if (entry.subsections.length === 0) return entry.code;
  // Match keywords from bullet against subsection headings for surgical `[Sx·§y]` provenance
  let bestScore = -1;
  let bestCode = entry.subsections[Math.min(fallbackIdx, entry.subsections.length - 1)]!.code;
  for (const sec of entry.subsections) {
    const tokens = sec.heading
      .toLowerCase()
      .match(/[a-z0-9]{3,}|[\u4e00-\u9fff]{2}/gu) ?? [];
    let score = 0;
    for (const tok of tokens) {
      if (bullet.toLowerCase().includes(tok)) score += 1;
    }
    if (score > bestScore && score > 0) {
      bestScore = score;
      bestCode = sec.code;
    }
  }
  return bestCode;
}

/**
 * Emits the exact valid `[Sx·§y]` Citation Anchor Catalog + VetoBoard First-Principles Anatomy Prompt
 * right when all specialist waves finish so the final Inspector/Synthesizer writes paper-grade inline citations!
 */
export function buildCitedBriefingPromptAndCatalog(params: {
  readonly goal: string;
  readonly deliverables: readonly StepDeliverableInput[];
  readonly locale?: VetoBoardLocale;
}): string {
  const locale = params.locale ?? "en";
  const zh = locale === "zh";
  const index = indexDeliverables(params.deliverables, true);

  const catalogLines: string[] = [];
  for (const entry of index.entries) {
    const badge = entry.isTerminal
      ? zh
        ? "【★终局收敛定稿·权威口径】"
        : "[★ Final Converged Baseline]"
      : zh
        ? `【第${entry.wave}波·前序推演底稿】`
        : `[Wave ${entry.wave} · Upstream Draft]`;
    catalogLines.push(`- \`[[${entry.code}]](#${entry.anchorId})\` — ${badge} ${entry.title} (${entry.roleLabel})`);
    for (const sec of entry.subsections) {
      catalogLines.push(`  - \`[[${sec.code}]](#${sec.anchorId})\` — ${sec.heading}`);
    }
  }
  catalogLines.push(
    zh
      ? "- `[[V1]](#ref-v1)` — 【终审独立复检】独立只读铁面督察官（你本轮提交的复算正文将自动挂载于 `#ref-v1`）"
      : "- `[[V1]](#ref-v1)` — [Final Independent Reconciliation] Quality & Math Inspector (`#ref-v1`)",
  );

  if (zh) {
    return [
      "## 📌 终局复算与《VetoBoard 论文级角标溯源深度解读》合成强制规范",
      "前序全部专业波次已完成因果交锋！在提交最后一轨 `quality-inspector` 时，你必须同时传入 **`executiveBriefingMarkdown`** 参数，严格按 VetoBoard《第一性原理终局穿透模板》撰写顶部深度解读：",
      "",
      "### 1. 可引用的真实页内锚点清单（严禁编造清单以外的角标！全文不少于 10 处内联角标）",
      ...catalogLines,
      "",
      "### 2. `executiveBriefingMarkdown` 强制行文与溯源体例",
      "- **句末内联论文角标**：凡出现金额、成本、费率、BEP、产能、法规红线或跨波次推翻结论，**必须在数字或句末紧跟可点击角标**，如 `真实经济 BEP 实为 136.37 户[[S4·§2]](#ref-s4-sec2)[[V1]](#ref-v1)`；当前序底稿被后波次推翻修正时，以【★终局收敛定稿】为准并点明为何修正（如 `[S1]` 原假设如何被 `[S2]` 合规红线与 `[S3]` 工程底数重构为 `[S4]`）。",
      "- **强制四段骨架（用 `---` 分隔）**：",
      "  1. `### 先厘清一个说法`：一针见血拆开『表面会计可行/跑通流程』与『扣除创始人机会成本及合规摩擦后的真实资本回报』之间的错位，摆出最刺眼的 2 组数字对撞（附角标）。",
      "  2. `### 跨波次角色交锋与口径演进实录`：还原『第1波破题 → 第2波合规/工程横向质询拆台 → 第3波吸收合流定稿 → V1独立复算』中哪些初始假设被当场推翻或重修（附角标）。",
      "  3. `### 核心维度第一性原理穿透解剖`：覆盖 **收入天花板与定价权归属**、**产能吞吐与生死 BEP 脆弱度**、**增加值切分表（Markdown 表：营收 / 变动成本 / 增加值100% / 机会成本工资占比 / 合规通道损耗 / 企业主净利）**、**竞争均衡价与两头堵风险**，每节末尾以一句加粗 `**结论：…**` 收束本质。",
      "  4. `### 收口：初始选择已经写好了结局`：输出三列 **生死元变量宿命表**（`生死元变量 | 当前拍板设定 | 对终局模型的数学锁定影响`）+ **『换方程』破局路径**（计费原语 / 交付形态 / 客群定位重构）。",
    ].join("\n");
  }

  return [
    "## 📌 Mandatory Final Reconciliation & Paper-Grade Cited Executive Briefing Guide",
    "All upstream causal waves have completed! When submitting `quality-inspector`, you MUST populate **`executiveBriefingMarkdown`** with inline clickable provenance badges (`>= 10` citations):",
    "",
    "### 1. Valid Citation Anchor Directory (Do NOT invent anchors outside this list)",
    ...catalogLines,
    "",
    "### 2. Required First-Principles Structure for `executiveBriefingMarkdown`",
    "- Attach inline citations (`[[S2·§1]](#ref-s2-sec1)`, `[[V1]](#ref-v1)`) directly onto every number, statutory redline, and parameter revision.",
    "- Cover: (1) `### Core Premise vs Capital Reality Collision`, (2) `### Cross-Wave Role Clash & Parameter Revisions`, (3) `### First-Principles Breakdown & Value-Added Split Table`, and (4) `### Meta-Variable Lock-in Table & Equation-Shift Levers`.",
  ].join("\n");
}

export function buildAutoExecutiveBriefing(params: {
  readonly goal: string;
  readonly deliverables: readonly StepDeliverableInput[];
  readonly verificationMarkdown?: string;
  readonly locale?: VetoBoardLocale;
}): string {
  const locale = params.locale ?? "en";
  const zh = locale === "zh";
  const hasVerify = Boolean(params.verificationMarkdown?.trim());
  const index = indexDeliverables(params.deliverables, hasVerify);
  const blocks: string[] = [];

  const terminals = index.entries.filter((e) => e.isTerminal);
  const leadTerminal = terminals.at(-1) ?? index.entries.at(-1);

  if (hasVerify && params.verificationMarkdown) {
    const vBullets = extractKeyDigestLines(params.verificationMarkdown, 4);
    blocks.push(
      zh
        ? "### 一、终局独立核账与跨波次收敛定论 [V1]"
        : "### 1. Final Independent Verdict & Post-Clash Baseline [V1]",
    );
    if (leadTerminal) {
      const termCode = leadTerminal.subsections[0]?.code ?? leadTerminal.code;
      blocks.push(
        zh
          ? `- **权威收敛口径锚定**：历经多波次角色因果交锋后，最终拍板底数以 ★ 终局收敛定稿《${leadTerminal.title}》[${termCode}] 与独立终验复检 [V1] 联立口径为准。`
          : `- **Authoritative Post-Clash Baseline**: Anchored on ★ Final Converged Deliverable "${leadTerminal.title}" [${termCode}] and Independent Audit [V1].`,
      );
    }
    for (const b of vBullets) {
      const safe = escapeBareCurrencyDollars(b);
      blocks.push(`- ${safe}${safe.includes("[V1]") ? "" : " [V1]"}`);
    }
    blocks.push("", "---", "");
  }

  blocks.push(
    zh
      ? "### 二、跨波次角色交锋与小节级证据溯源（点击角标直达原文）"
      : "### 2. Cross-Wave Role Clash & Section-Level Provenance",
  );

  for (const entry of index.entries) {
    const bullets = extractKeyDigestLines(entry.rawMarkdown, 4);
    const waveTag = zh
      ? entry.isTerminal
        ? `第${entry.wave}波 · ★终局收敛定稿`
        : `第${entry.wave}波 · 前序推演与质询`
      : entry.isTerminal
        ? `Wave ${entry.wave} · ★ Final Converged`
        : `Wave ${entry.wave} · Upstream Challenge`;
    const headerLabel = entry.roleLabel.startsWith(entry.title)
      ? entry.roleLabel
      : `${entry.title} (${entry.roleLabel})`;
    const primaryTag = `[${entry.subsections[0]?.code ?? entry.code}]`;
    blocks.push("", `#### ${headerLabel}（${waveTag}） ${primaryTag}`);
    if (bullets.length > 0) {
      bullets.forEach((b, i) => {
        const safe = escapeBareCurrencyDollars(b);
        const matchedCode = matchBestSubsectionCode(entry, b, i);
        blocks.push(`- ${safe}${safe.includes("[S") ? "" : ` [${matchedCode}]`}`);
      });
    } else {
      blocks.push(`- ${entry.title} ${primaryTag}`);
    }
  }

  return blocks.join("\n");
}

function buildClashDeliberationSection(
  index: CitationIndex,
  verificationMarkdown: string | undefined,
  zh: boolean,
): string {
  const lines: string[] = [];
  for (const entry of index.entries) {
    const digest = extractKeyDigestLines(entry.rawMarkdown, 2);
    const lead = escapeBareCurrencyDollars(digest[0] ?? entry.title);
    const secondary = digest[1] ? escapeBareCurrencyDollars(digest[1]) : undefined;
    const sec1 = entry.subsections[0] ? `[[${entry.subsections[0].code}]](#${entry.subsections[0].anchorId})` : `[[${entry.code}]](#${entry.anchorId})`;
    const waveBadge = zh
      ? entry.isTerminal
        ? `第 ${entry.wave} 波 · ★吸收合流定稿`
        : entry.wave === 1
          ? `第 1 波 · 核心破题立论`
          : `第 ${entry.wave} 波 · 横向质询与护栏重构`
      : entry.isTerminal
        ? `Wave ${entry.wave} · ★ Final Convergence`
        : entry.wave === 1
          ? `Wave 1 · Lead Framing`
          : `Wave ${entry.wave} · Cross-Challenge & Guardrail`;
    lines.push(`- **${entry.roleLabel}**（${waveBadge} · ${sec1}）：${lead}`);
    if (secondary) {
      lines.push(`  - ${zh ? "关键约束 / 横向修正" : "Key Constraint / Revision"}：${secondary}`);
    }
  }
  if (verificationMarkdown?.trim()) {
    const vDigest = extractKeyDigestLines(verificationMarkdown, 1)[0];
    if (vDigest) {
      lines.push(
        `- **${zh ? "独立只读铁面督察官" : "Independent Math & Rule Inspector"}**（${zh ? "终审独立复检" : "Final Audit"} · [[V1]](#ref-v1)）：${escapeBareCurrencyDollars(vDigest)}`,
      );
    }
  }
  return lines.join("\n");
}

export function assembleDualLayerReport(params: {
  readonly goal: string;
  readonly briefingMarkdown: string;
  readonly deliverables: readonly StepDeliverableInput[];
  readonly verificationMarkdown?: string;
  readonly deliberationOpinions?: readonly DeliberationOpinion[];
  readonly whiteboardLedgerMarkdown?: string;
  readonly lockedSharedContract?: string;
  readonly mountedKnowledgeMarkdown?: string;
  readonly quotaPoolMarkdown?: string;
  readonly auditSealStats?: {
    readonly rolesCount: number;
    readonly sourcesCount: number;
    readonly calcChecksCount: number;
    readonly catchesCount: number;
  };
  readonly locale?: VetoBoardLocale;
}): {
  readonly combinedReport: string;
  readonly briefingReport: string;
  readonly originalReport: string;
} {
  const locale = params.locale ?? "en";
  const zh = locale === "zh";
  const hasVerify = Boolean(params.verificationMarkdown?.trim());
  const index = indexDeliverables(params.deliverables, hasVerify);
  const normalizedBriefing = normalizeCitationLinks(params.briefingMarkdown.trim(), index);

  const seal = params.auditSealStats;
  const sealBanner = seal
    ? zh
      ? `> **VetoBoard 审计工作量钢印**：本报告历经 **${seal.rolesCount} 席角色因果交锋** · 核验 **${seal.sourcesCount} 份外部/基准凭证** · \`vetoboard_calc\` 确定性复算 **${seal.calcChecksCount} 项指标** · 当场拦截并修正 **${seal.catchesCount} 处潜在偏差**。`
      : `> **VetoBoard Audit Seal**: Stress-tested across **${seal.rolesCount} causal role tracks** · verified **${seal.sourcesCount} empirical references** · reconciled **${seal.calcChecksCount} deterministic math checks via \`vetoboard_calc\`** · intercepted **${seal.catchesCount} risks/discrepancies**.`
    : "";

  const terminalRefs = index.entries
    .filter((e) => e.isTerminal)
    .map((e) => `[[${e.code} · ${e.title}]](#${e.anchorId})`)
    .join("、");
  const provenanceGuide = zh
    ? `> **阅读与溯源导览**：本节对下方**全部原始专员底稿**做第一性原理穿透拆解（专员原始底稿一字不删完整保留于后文）。${terminalRefs ? `跨波次交锋后的权威定稿口径以 ${terminalRefs}${hasVerify ? " 及 [[V1 · 最终独立复算]](#ref-v1)" : ""} 为准；` : ""}点击文中任意角标（如 \`[S1·§1]\`、\`[V1]\`）可直接平滑跳转至对应原文段落核查底数。`
    : `> **Provenance & Citation Guide**: Every quantitative claim and redline below links directly to the 100% unabridged specialist deliverables preserved below.${terminalRefs ? ` Authoritative post-clash baseline: ${terminalRefs}${hasVerify ? " + [[V1]](#ref-v1)" : ""}.` : ""} Click any \`[Sx·§y]\` or \`[V1]\` badge to jump straight to the exact source section.`;

  const indexTableHeader = zh
    ? [
        "### 📚 原始产出文献索引（点击角标直达下方原文）",
        "",
        "| 来源编号 | 原始产出章节 | 负责角色 | 定稿属性 | 关键小节直达 |",
        "| :--- | :--- | :--- | :--- | :--- |",
      ]
    : [
        "### 📚 Source Deliverables Index (Click citations to jump to raw sections)",
        "",
        "| Ref | Deliverable Title | Role | Status | Subsections |",
        "| :--- | :--- | :--- | :--- | :--- |",
      ];

  const indexRows = index.entries.map((entry) => {
    const statusBadge = entry.isTerminal
      ? zh
        ? "★ 终局收敛定稿"
        : "★ Final Converged"
      : zh
        ? `第${entry.wave}波·前序底稿`
        : `Wave ${entry.wave} Draft`;
    const subs = entry.subsections
      .slice(0, 5)
      .map((s) => `[[${s.code}]](#${s.anchorId}) ${s.heading.replace(/\|/g, "／").slice(0, 22)}`)
      .join(" · ");
    return `| [[${entry.code}]](#${entry.anchorId}) | ${entry.title.replace(/\|/g, "／")} | ${entry.roleLabel.replace(/\|/g, "／")} | ${statusBadge} | ${subs || "—"} |`;
  });

  if (hasVerify) {
    indexRows.push(
      zh
        ? "| [[V1]](#ref-v1) | 最终独立算术复算与验收结论 | 独立只读铁面督察官 | 终审复检 | — |"
        : "| [[V1]](#ref-v1) | Final Independent Math & Rule Reconciliation | Adversarial Inspector | Final Audit | — |",
    );
  }

  // Place ★ Final Converged deliverables first (just like VetoBoard Desktop!), followed by upstream wave drafts, keeping exact `#ref-sx` anchors!
  const orderedEntries = [
    ...index.entries.filter((e) => e.isTerminal),
    ...index.entries.filter((e) => !e.isTerminal),
  ];

  const renderEntryBlock = (entry: IndexedStepEntry) => {
    const prefix = entry.isTerminal
      ? zh
        ? `★ 终局收敛定稿 [${entry.code}]`
        : `★ Final Converged [${entry.code}]`
      : zh
        ? `前序第 ${entry.wave} 波底稿 [${entry.code}]`
        : `Wave ${entry.wave} Upstream Draft [${entry.code}]`;
    return [
      `<a id="${entry.anchorId}"></a>`,
      "",
      `### ${prefix}: ${entry.title} (${entry.roleLabel}) · [↑ ${zh ? "返回解读总汇" : "Top"}](#ref-briefing-top)`,
      "",
      foldMachineJsonBlocks(entry.annotatedMarkdown, zh),
    ].join("\n");
  };

  const rawBlocks = orderedEntries.map(renderEntryBlock);
  const chronologicalRawBlocks = index.entries.map(
    (entry) => `### [${entry.code}] ${entry.title} (${entry.roleLabel})\n\n${entry.rawMarkdown}`,
  );

  if (hasVerify) {
    const verifyClean = foldMachineJsonBlocks(params.verificationMarkdown!.trim(), zh);
    rawBlocks.push(
      [
        `<a id="ref-v1"></a>`,
        "",
        zh
          ? "### [V1] 独立终局复算与验收结论 · [↑ 返回解读总汇](#ref-briefing-top)"
          : "### [V1] Final Independent Reconciliation & Audit Verdict · [↑ Top](#ref-briefing-top)",
        "",
        verifyClean,
      ].join("\n"),
    );
    chronologicalRawBlocks.push(
      `### [V1] ${zh ? "独立终局复算与验收结论" : "Final Independent Reconciliation"}\n\n${params.verificationMarkdown!.trim()}`,
    );
  }

  const allDeliveredText = [
    ...index.entries.map((e) => e.rawMarkdown),
    params.verificationMarkdown ?? "",
  ].join("\n\n");
  const verifiedWebUrlsCount = extractVerifiedHttpUrls(allDeliveredText).length;

  const readinessRating =
    verifiedWebUrlsCount >= 3 && seal && seal.calcChecksCount >= 1 && hasVerify
      ? zh
        ? "`已验证（Verified · 具备实时联网一手信源 + 确定性复算 + 独立终验闭环）`"
        : "`Verified (Live Web Sources + Deterministic Calc + Independent Audit)`"
      : seal && seal.calcChecksCount >= 1
        ? zh
          ? `\`模型推算（Model-Derived · 已完成确定性算账，但实时外部信源仅 ${verifiedWebUrlsCount} 条，含待确认假设）\``
          : `\`Model-Derived (Deterministic Calc verified; ${verifiedWebUrlsCount} live external URLs)\``
        : verifiedWebUrlsCount >= 1 && hasVerify
          ? zh
            ? "`条件性建议（Conditional · 已具备联网核验信源与督察复核）`"
            : "`Conditional Advisory (Web-grounded & inspected)`"
          : zh
            ? "`待确认（Unverified · 缺少实时联网外部信源支撑）`"
            : "`Unverified (Missing live external web sources)`";

  const readinessSection = zh
    ? [
        "## 决策可用度与核验覆盖审计",
        "",
        `- **四级决策可用度评级**: ${readinessRating}`,
        `- **实时联网外部信源（\`WebSearch / search_web\`）**: 已采集 **${verifiedWebUrlsCount} 条真实外部 URL 凭证**（法规/文档基准共 **${seal?.sourcesCount ?? index.entries.length} 项**）`,
        `- **确定性定量引擎核算（\`vetoboard_calc\`）**: 已复算 **${seal?.calcChecksCount ?? 1} 项公式与敏感度指标**`,
        `- **独立终验与偏差拦截**: ${hasVerify ? "已通过 `[V1]` 独立只读复核" : "已完成规则门禁校验"}（累计拦截修正 **${seal?.catchesCount ?? 0} 处潜在偏差**）`,
      ].join("\n")
    : [
        "## Decision Readiness & Verification Coverage Audit",
        "",
        `- **Readiness Tier**: ${readinessRating}`,
        `- **Live External Web URLs (\`WebSearch / search_web\`)**: **${verifiedWebUrlsCount} verified external URLs** (**${seal?.sourcesCount ?? index.entries.length} total references**)`,
        `- **Deterministic Math (\`vetoboard_calc\`)**: **${seal?.calcChecksCount ?? 1} reconciled metrics**`,
        `- **Independent Audit**: ${hasVerify ? "Passed `[V1]` read-only reconciliation" : "Passed rule gate"} (**${seal?.catchesCount ?? 0} catches**)`,
      ].join("\n");

  const hasWhiteboardLedger = Boolean(params.whiteboardLedgerMarkdown?.trim());
  const hasExplicitDeliberation =
    hasWhiteboardLedger ||
    (params.deliberationOpinions?.length ?? 0) > 0 ||
    Boolean(params.lockedSharedContract);
  const deliberationBody = hasWhiteboardLedger
    ? params.whiteboardLedgerMarkdown!.trim()
    : hasExplicitDeliberation
      ? formatDeliberationLogForReport(
          params.deliberationOpinions ?? [],
          params.lockedSharedContract,
          locale,
        )
      : buildClashDeliberationSection(index, params.verificationMarkdown, zh);

  const deliberationSection = [
    zh
      ? hasWhiteboardLedger
        ? "## 公开白板指标台账与 ELECTRE/QMV 数学裁决留痕"
        : hasExplicitDeliberation
          ? "## 多角色立项会商纪要（串行交锋锁契约 → 并行干重活）"
          : "## 多角色因果交锋与横向回应纪要"
      : hasWhiteboardLedger
        ? "## Public Whiteboard Ledger & ELECTRE/QMV Mathematical Ruling"
        : hasExplicitDeliberation
          ? "## Multi-Role Deliberation Log (2-Round Serial Clash -> Locked Contract)"
          : "## Cross-Wave Role Clash & Deliberation Log",
    "",
    deliberationBody,
  ].join("\n");

  const knowledgeProvenanceSection = params.mountedKnowledgeMarkdown?.trim()
    ? [
        zh ? "## 知识库引用与前序阶段继承溯源" : "## Mounted Knowledge Base & Prior-Phase Provenance",
        "",
        params.mountedKnowledgeMarkdown.trim(),
      ].join("\n")
    : "";

  const originalSectionTitle = zh
    ? "## 专员原始执行底稿（100% 无删减保留）"
    : "## Raw Specialist Deliverables (100% Unabridged)";

  const rawTopNote = zh
    ? "> 📌 **终局收敛定稿置顶导读**：以下 100% 一字不删保留全部专员原始底稿，优先置顶展示吸收前序交锋约束后的 **★ 终局收敛定稿**，其后附各前序波次推演原稿与 `[V1]` 独立复算底稿。"
    : "> 📌 **Unabridged Deliverables Guide**: `★ Final Converged` deliverables are placed first, followed by upstream wave drafts and `[V1]` reconciliation.";

  const originalReport = [
    `# ${params.goal}`,
    "",
    originalSectionTitle,
    "",
    ...chronologicalRawBlocks,
  ].join("\n\n");

  const briefingBlock = [
    "<!-- VETOBOARD_EXECUTIVE_BRIEFING_BEGIN -->",
    `<a id="ref-briefing-top"></a>`,
    "",
    zh ? "## 决策总汇与第一性原理穿透解读" : "## Executive Synthesis & First-Principles Breakdown",
    "",
    provenanceGuide,
    "",
    "---",
    "",
    normalizedBriefing,
    "",
    "---",
    "",
    ...indexTableHeader,
    ...indexRows,
    "<!-- VETOBOARD_EXECUTIVE_BRIEFING_END -->",
  ].join("\n");

  const briefingReport = [
    `# ${zh ? "第一性原理穿透解读与溯源简报" : "First-Principles Cited Briefing"}: ${params.goal}`,
    ...(sealBanner ? ["", sealBanner] : []),
    "",
    briefingBlock,
  ].join("\n");

  const quotaPoolSection = params.quotaPoolMarkdown?.trim()
    ? [
        zh
          ? "## Borg 权重算力配额池与动态扩编台账"
          : "## Borg Weighted Quota Pool & Dynamic Peer Ledger",
        "",
        params.quotaPoolMarkdown.trim(),
      ].join("\n")
    : "";

  const combinedReport = [
    `# ${zh ? "任务过程与决策审计报告" : "Decision Audit Report"}: ${params.goal}`,
    ...(sealBanner ? ["", sealBanner] : []),
    "",
    briefingBlock,
    "",
    readinessSection,
    ...(quotaPoolSection ? ["", quotaPoolSection] : []),
    ...(knowledgeProvenanceSection ? ["", knowledgeProvenanceSection] : []),
    "",
    deliberationSection,
    "",
    originalSectionTitle,
    "",
    rawTopNote,
    "",
    ...rawBlocks,
  ].join("\n");

  return { briefingReport, combinedReport, originalReport };
}
