import type { VetoBoardLocale } from "../i18n/locales.js";
import type {
  RoleTemplate,
  VetoBoardTaskRecord,
  WhiteboardEntry,
  WhiteboardReaction,
} from "./types.js";

/**
 * VetoBoard Dynamic Shared Whiteboard & ELECTRE + QMV Mathematical Governance Engine (`whiteboardEngine.ts`).
 *
 * Grounded in three peer-reviewed & institutional governance standards:
 * 1. **ELECTRE Outranking Model (Bernard Roy, MCDA)**:
 *    - Global Concordance Index `C >= 2/3 (66.7%)`
 *    - Non-Compensatory Hard Veto `V` (only grounded statutory/compiler/negative-margin proofs block compensation)
 * 2. **Enterprise ARB & EU Council Double-Majority QMV**:
 *    - Contention Dominance `D = W+ / (W+ + W-) >= 60%` (`fast`) or `65%` (`deep`) — scale-invariant across 2..N roles!
 *    - Seat Support Floor `S_seats >= 50%` — prevents 1 high-weight oligarch from overriding 3+ dissenting specialists.
 * 3. **Multi-Agent Debate (MAD) Anti-Collapse Cap (ACL / arXiv 2025-2026)**:
 *    - Hard cap `R_max = 2` consultation rounds + `Belief-Delta = 0` immediate early stopping!
 *    - Dynamic Dimension-Driven Consultation Routing (`neededDimensions -> ownedDimensions`, zero hardcoded role names!).
 */

export const ELECTRE_GLOBAL_CONCORDANCE_THRESHOLD = 2 / 3; // 66.67%
export const ARB_FAST_DOMINANCE_THRESHOLD = 0.6; // 60.0% (e.g. 85 vs 55 -> 60.7% PASS!)
export const QMV_DEEP_DOMINANCE_THRESHOLD = 0.65; // 65.0%
export const EU_SEAT_SUPPORT_FLOOR = 0.5; // 50.0% seats (anti-oligarch)
export const MAD_MAX_CONSULTATION_ROUNDS = 2;

const DIMENSION_RULES: ReadonlyArray<{ readonly dim: string; readonly re: RegExp }> = [
  { dim: "market", re: /市场|需求|竞品|客群|转化|溢价|付费意愿|买单|选品|market|demand|wtp|competitor|buyer/iu },
  { dim: "cost", re: /成本|预算|精算|毛利|回本|盈利|单价|费用|财务|BEP|ROI|profit|cost|budget|margin|pricing|finance/iu },
  { dim: "legal", re: /法务|法律|合规|税务|牌照|隐私|封号|安全|风控|红线|GDPR|MoR|SOC2|legal|compliance|tax|privacy|security/iu },
  { dim: "technical", re: /技术|工程|架构|代码|接口|延迟|吞吐|数据库|并发|工时|BOM|Serverless|API|DTO|swe|tech|engineering|architecture|db/iu },
  { dim: "product", re: /产品|设计|交互|功能范围|体验|原型|UI|UX|product|design|scope|feature/iu },
  { dim: "sales", re: /销售|商务|渠道|客户诉求|签约|获客|sales|gtm|channel|deal/iu },
  { dim: "inspection", re: /质检|督察|测试|单测|复算|验真|编译|qa|test|inspector|verify|reconcil/iu },
];

export function inferOwnedDimensions(roleId: string, roleLabel: string, charterText = ""): string[] {
  const headCorpus = `${roleId} ${roleLabel}`;
  const dims = new Set<string>();
  for (const rule of DIMENSION_RULES) {
    if (rule.re.test(headCorpus)) dims.add(rule.dim);
  }
  // Only fall back to primary charter lead paragraph when roleId + roleLabel are generic
  if (dims.size === 0 && charterText) {
    const firstPara = charterText.split(/\r?\n\r?\n/)[0]?.slice(0, 280) ?? "";
    for (const rule of DIMENSION_RULES) {
      if (rule.re.test(firstPara)) dims.add(rule.dim);
    }
  }
  if (dims.size === 0) dims.add("general");
  return [...dims];
}

export function inferNeededDimensions(text: string, explicit?: readonly string[]): string[] {
  const dims = new Set<string>();
  for (const raw of explicit ?? []) {
    const clean = raw.trim().toLowerCase();
    if (!clean) continue;
    let matched = false;
    for (const rule of DIMENSION_RULES) {
      if (clean === rule.dim || rule.re.test(clean)) {
        dims.add(rule.dim);
        matched = true;
      }
    }
    if (!matched) dims.add(clean);
  }
  // When explicit `neededDimensions` were declared, honor them strictly without prose bleed; otherwise infer from note text
  if (dims.size > 0) return [...dims];

  for (const rule of DIMENSION_RULES) {
    if (rule.re.test(text)) dims.add(rule.dim);
  }
  return [...dims];
}

export function extractWhiteboardVariables(
  markdown: string,
  explicitVars?: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (explicitVars) {
    for (const [k, v] of Object.entries(explicitVars)) {
      if (k.trim() && String(v).trim()) out[k.trim()] = String(v).trim();
    }
  }
  if (Object.keys(out).length > 0) return out;

  for (const line of markdown.split(/\r?\n/)) {
    const m = /^\s*[-*+]?\s*\*\*([^*:：]{2,28})\*\*\s*[:：=]\s*(.{1,90})$/u.exec(line.trim());
    if (m && Object.keys(out).length < 6) {
      out[m[1]!.trim()] = m[2]!.trim();
    }
  }
  return out;
}

export function renderPublicWhiteboardSnapshot(task: VetoBoardTaskRecord, locale: VetoBoardLocale): string {
  const zh = locale === "zh";
  const entries = task.whiteboardEntries;

  const entryBlocks = entries.map((e) => {
    const varsStr =
      Object.keys(e.variables).length > 0
        ? Object.entries(e.variables)
            .map(([k, v]) => `\`${k}=${v}\``)
            .join(" · ")
        : "";
    return [
      `- **${e.roleLabel}** (\`${e.trackId}\` · W${e.weight} · ${zh ? "管辖维度" : "Dims"}: \`${e.ownedDimensions.join(",")}\`)${e.revision > 1 ? ` [Rev ${e.revision}]` : ""}：${e.summary}`,
      ...(varsStr ? [`  - ${zh ? "白板公开指标" : "Posted Variables"}: ${varsStr}`] : []),
    ].join("\n");
  });

  const domPct = Math.round(
    (task.effortProfile === "deep" ? QMV_DEEP_DOMINANCE_THRESHOLD : ARB_FAST_DOMINANCE_THRESHOLD) *
      100,
  );

  if (zh) {
    return [
      "## 📋 公开白板全员备课指标已上墙 —— 进入【全员阅板比对 & 动态协商裁决】",
      "",
      "### 当前办公室公开白板 (`Public Shared Whiteboard`)",
      ...entryBlocks,
      "",
      `### ⚡ 下一步宿主调度指令（复用同一批专员 \`conversationId\` 发送 \`send_message\` 阅板表态）：`,
      "请各在场角色审阅上方公开白板，留痕提交比对结果（调用 `vetoboard_submit_track_output`，传 `stage: \"board_review\"`）：",
      "1. **`decision: \"approve\"`（赞同 / 无关放过 / 有利吸收）**：与己无关直接放过，或对自身方案有利/可补充盲区时直接吸收（0 争吵直通定稿！）；",
      "2. **`decision: \"conditional\"`（单方自兼容）**：微调自身内部实现即可兼容，留痕备案不阻断；",
      `3. **\`decision: "oppose"\`（意见相反 / 冲突挂号）**：指明冲突对象 \`targetTrackIds\` 及解开死结缺失的 **\`neededDimensions\`（如 \`["market", "cost"]\`）**；系统将自动运行 **ELECTRE + QMV 数学支配公式（对决支配率 D ≥ ${domPct}% · 全场和谐度 C ≥ 66.7% · 席位比 ≥ 50%）**：高权重显著占优时直接带少数派备忘自动放行；势均力敌时仅精准唤醒对应维度的专员进场摆数据协商（最多 2 轮 + 零变化早停转人工）！`,
    ].join("\n");
  }

  return [
    "## 📋 Public Shared Whiteboard Populated -> Proceed to [Board Review & ELECTRE/QMV Evaluation]",
    "",
    "### Public Shared Whiteboard",
    ...entryBlocks,
    "",
    `### ⚡ Next Step for Host Agent (Send via \`send_message\` to existing subagents, submit \`stage: "board_review"\`):`,
    `- Mark \`decision: "approve"\` (irrelevant / beneficial / absorbed), \`"conditional"\` (self-adapted), or \`"oppose"\` (specifying \`targetTrackIds\` and \`neededDimensions\` like \`["market", "cost"]\`).`,
    `- Engine evaluates **ELECTRE Concordance (C >= 66.7%) + Contention Dominance (D >= ${domPct}%) + Seat Floor (>= 50%)** automatically!`,
  ].join("\n");
}

export interface ContentionClusterResult {
  readonly targetTrackId: string;
  readonly targetLabel: string;
  readonly supportWeight: number;
  readonly opposeWeight: number;
  readonly dominanceRatio: number;
  readonly dominatedPass: boolean;
  readonly hasGroundedHardVeto: boolean;
  readonly neededDimensions: readonly string[];
  readonly opposingReactions: readonly WhiteboardReaction[];
}

export interface WhiteboardConvergenceEvaluation {
  readonly outcome:
    | "CONVERGED_UNANIMOUS"
    | "CONVERGED_DOMINATED_PASS"
    | "CONSULTATION_REQUIRED"
    | "HUMAN_INTERVENTION_REQUIRED";
  readonly round: number;
  readonly globalConcordance: number;
  readonly seatSupportRatio: number;
  readonly dominanceThreshold: number;
  readonly clusters: readonly ContentionClusterResult[];
  readonly consultInRoomTracks: readonly { readonly trackId: string; readonly roleLabel: string; readonly matchedDimensions: readonly string[] }[];
  readonly suggestedLibraryRoles: readonly { readonly roleId: string; readonly title: string; readonly matchedDimensions: readonly string[] }[];
  readonly earlyStoppedZeroDelta: boolean;
  readonly lockedContractMarkdown: string;
  readonly minorityReportMarkdown?: string;
  readonly nextStepPrompt: string;
}

const HARD_VETO_PROOF_RE =
  /(?:vetoboard_calc|负毛利|亏损|卖一单亏|negative\s+margin|loss|违法|刑法|封号|吊销|侵权|illegal|statutory|ban|编译报错|不存在该字段|单测失败|compile\s+error|type\s+error|non[- ]?existent)/iu;

export function evaluateWhiteboardConvergence(params: {
  readonly task: VetoBoardTaskRecord;
  readonly currentRound: number;
  readonly availableCatalogRoles?: readonly RoleTemplate[];
  readonly locale: VetoBoardLocale;
}): WhiteboardConvergenceEvaluation {
  const { task, currentRound, locale } = params;
  const zh = locale === "zh";
  const dominanceThreshold =
    task.effortProfile === "deep" ? QMV_DEEP_DOMINANCE_THRESHOLD : ARB_FAST_DOMINANCE_THRESHOLD;

  const activeSpecs = task.tracks.filter(
    (tr) => tr.roleId !== "quality-inspector" && tr.status !== "skipped",
  );

  // Latest reaction per active specialist in `currentRound` (fallback to latest prior round if unchanged)
  const latestByReviewer = new Map<string, WhiteboardReaction>();
  for (const r of task.whiteboardReactions) {
    if (r.round <= currentRound) {
      const prev = latestByReviewer.get(r.reviewerTrackId);
      if (!prev || r.round >= prev.round) {
        latestByReviewer.set(r.reviewerTrackId, r);
      }
    }
  }

  let totalWeight = 0;
  let concordantWeight = 0;
  let supportiveSeats = 0;

  for (const tr of activeSpecs) {
    totalWeight += tr.weight;
    const rx = latestByReviewer.get(tr.trackId);
    const dec = rx?.decision ?? "approve";
    if (dec === "approve") {
      concordantWeight += tr.weight;
      supportiveSeats += 1;
    } else if (dec === "conditional") {
      concordantWeight += tr.weight * 0.5;
      supportiveSeats += 1;
    }
  }

  const globalConcordance = totalWeight > 0 ? concordantWeight / totalWeight : 1;
  const seatSupportRatio = activeSpecs.length > 0 ? supportiveSeats / activeSpecs.length : 1;

  // Detect `Belief-Delta = 0` across Round 1 -> Round 2 (Anti-Debate-Collapse Early Stopping!)
  let earlyStoppedZeroDelta = false;
  if (currentRound >= 2) {
    const r1Sig = activeSpecs
      .map((tr) => {
        const r1 = task.whiteboardReactions.find(
          (x) => x.round === currentRound - 1 && x.reviewerTrackId === tr.trackId,
        );
        return `${tr.trackId}:${r1?.decision ?? "approve"}:${(r1?.targetTrackIds ?? []).join(",")}`;
      })
      .join("|");
    const r2Sig = activeSpecs
      .map((tr) => {
        const rx = latestByReviewer.get(tr.trackId);
        return `${tr.trackId}:${rx?.decision ?? "approve"}:${(rx?.targetTrackIds ?? []).join(",")}`;
      })
      .join("|");
    const anyEntryRevised = task.whiteboardEntries.some((e) => e.revision > 1);
    if (r1Sig === r2Sig && !anyEntryRevised) {
      earlyStoppedZeroDelta = true;
    }
  }

  // Group opposing reactions into contention clusters by target track (defaulting to highest-weight non-opposing lead)
  const opposingList = [...latestByReviewer.values()].filter((r) => r.decision === "oppose");
  const defaultLeadTrack =
    activeSpecs.find((tr) => latestByReviewer.get(tr.trackId)?.decision !== "oppose") ??
    activeSpecs[0]!;

  const opponentsByTarget = new Map<string, WhiteboardReaction[]>();
  for (const opp of opposingList) {
    const targets =
      opp.targetTrackIds.length > 0
        ? opp.targetTrackIds.filter((tid) => activeSpecs.some((s) => s.trackId === tid))
        : [defaultLeadTrack.trackId];
    const effectiveTargets = targets.length > 0 ? targets : [defaultLeadTrack.trackId];
    for (const tid of effectiveTargets) {
      const arr = opponentsByTarget.get(tid) ?? [];
      arr.push(opp);
      opponentsByTarget.set(tid, arr);
    }
  }

  const clusters: ContentionClusterResult[] = [];
  for (const [targetId, opps] of opponentsByTarget.entries()) {
    const targetTrack = activeSpecs.find((s) => s.trackId === targetId) ?? defaultLeadTrack;
    const oppIds = new Set(opps.map((o) => o.reviewerTrackId));
    // Support coalition = target track + any active specialists that explicitly approved (when contesting global board item)
    // For crisp pairwise/coalition dominance: Proposing/Approving side vs Opposing coalition!
    const approveCoalitionWeight = activeSpecs
      .filter((s) => !oppIds.has(s.trackId) && (s.trackId === targetId || latestByReviewer.get(s.trackId)?.decision === "approve"))
      .reduce((acc, s) => acc + s.weight, 0);
    // Also evaluate direct target + explicit endorsers vs opponents so uninvolved bystanders don't mask a 1v1 tie in R1,
    // while consulted specialists who explicitly endorse `targetId` in R2 add their coalition weight!
    const explicitEndorsersWeight = activeSpecs
      .filter((s) => {
        if (s.trackId === targetId || oppIds.has(s.trackId)) return false;
        const rx = latestByReviewer.get(s.trackId);
        return rx?.decision === "approve" && (rx.targetTrackIds ?? []).includes(targetId);
      })
      .reduce((acc, s) => acc + s.weight, 0);
    const directProposerWeight = targetTrack.weight + explicitEndorsersWeight;
    const opposeWeight = opps.reduce((acc, o) => acc + o.weight, 0);

    // Use direct target weight when a specific targetTrackId was named; coalition weight when contesting board-wide direction
    const hasExplicitTarget = opps.some((o) => o.targetTrackIds.length > 0);
    const supportWeight = hasExplicitTarget ? directProposerWeight : approveCoalitionWeight;
    const denom = supportWeight + opposeWeight;
    const dominanceRatio = denom > 0 ? supportWeight / denom : 1;

    const hasGroundedHardVeto = opps.some(
      (o) => Boolean(o.hardVetoEvidence?.trim()) && HARD_VETO_PROOF_RE.test(o.hardVetoEvidence!),
    );
    const neededDims = inferNeededDimensions(
      opps.map((o) => o.note).join(" "),
      opps.flatMap((o) => o.neededDimensions),
    );

    clusters.push({
      dominatedPass: dominanceRatio >= dominanceThreshold && !hasGroundedHardVeto,
      dominanceRatio,
      hasGroundedHardVeto,
      neededDimensions: neededDims,
      opposeWeight,
      opposingReactions: opps,
      supportWeight,
      targetLabel: targetTrack.roleLabel,
      targetTrackId: targetId,
    });
  }

  const anyHardVeto = clusters.some((c) => c.hasGroundedHardVeto);
  const allClustersDominated = clusters.every((c) => c.dominatedPass);
  const passesGlobalGates =
    globalConcordance >= ELECTRE_GLOBAL_CONCORDANCE_THRESHOLD &&
    seatSupportRatio >= EU_SEAT_SUPPORT_FLOOR &&
    !anyHardVeto &&
    allClustersDominated;

  // Build Minority Report for outvoted opposing / conditional specialists
  const minorityItems = [...latestByReviewer.values()].filter(
    (r) => r.decision === "oppose" || r.decision === "conditional",
  );
  const minorityReportMarkdown =
    minorityItems.length > 0
      ? [
          zh
            ? "### 📌 少数派保留意见与风险备忘（虽经加权支配放行，仍完整留痕备查）"
            : "### 📌 Minority Dissent & Residual Risk Log (Preserved under Weighted Dominance Pass)",
          ...minorityItems.map(
            (m) =>
              `- **${m.reviewerLabel} (W${m.weight} · ${m.decision === "oppose" ? (zh ? "保留反对" : "Dissent") : zh ? "有条件兼容" : "Conditional"})**：${m.note}`,
          ),
        ].join("\n")
      : undefined;

  // Build Locked Shared Contract from Whiteboard Entries + Math Receipt
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const entrySummaryLines = task.whiteboardEntries.map((e) => {
    const kv = Object.entries(e.variables)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    return `- **${e.roleLabel} (W${e.weight})**：${e.summary}${kv ? ` [${kv}]` : ""}`;
  });
  const mathReceiptLine = zh
    ? `- **📊 ELECTRE + QMV 数学裁决凭证**：全场和谐度 \`C = ${pct(globalConcordance)}\` (阈值 ≥66.7%) · 支持席位比 \`S = ${pct(seatSupportRatio)}\` (阈值 ≥50%)${clusters.length > 0 ? ` · 焦点支配率 \`D = ${clusters.map((c) => pct(c.dominanceRatio)).join(", ")}\` (阈值 ≥${pct(dominanceThreshold)})` : ""}`
    : `- **📊 ELECTRE + QMV Math Receipt**: Global Concordance \`C = ${pct(globalConcordance)}\` (>=66.7%) · Seat Ratio \`S = ${pct(seatSupportRatio)}\` (>=50%)${clusters.length > 0 ? ` · Contention Dominance \`D = ${clusters.map((c) => pct(c.dominanceRatio)).join(", ")}\` (>=${pct(dominanceThreshold)})` : ""}`;

  const lockedContractMarkdown = [
    zh ? "### 🔒 公开白板数学裁决锁死契约" : "### 🔒 Locked Whiteboard Baseline Contract",
    mathReceiptLine,
    ...entrySummaryLines,
    ...(minorityReportMarkdown ? ["", minorityReportMarkdown] : []),
  ].join("\n");

  if (passesGlobalGates) {
    const outcome =
      opposingList.length === 0 ? "CONVERGED_UNANIMOUS" : "CONVERGED_DOMINATED_PASS";
    const nextStepPrompt = zh
      ? [
          outcome === "CONVERGED_UNANIMOUS"
            ? "## ✅ 白板全员赞同通过（0 冲突秒过！）—— 解锁【100% 满并发定稿阶段】"
            : `## ✅ 白板加权支配裁决放行（主导方权重占优满足 D ≥ ${pct(dominanceThreshold)} & C ≥ 66.7%，无需全员一致，少数派意见已自动留痕！）`,
          lockedContractMarkdown,
          "",
          "### ⚡ 下一步宿主调度指令（100% 并发收口定稿）：",
          "请通过 `send_message` 同时唤醒全部专员会话，严格对齐上方锁死白板指标并发提交完整底稿（`vetoboard_submit_track_output`，`stage: \"deliverable\"`），随后交由质量检查官 `[V1]` 终验并签发全角标报告！",
        ].join("\n")
      : [
          `## ✅ Whiteboard Converged (${outcome}) -> Unlocked [100% Parallel Finalization]`,
          lockedContractMarkdown,
          "",
          "Wake all specialist subagents in parallel via `send_message` to submit full deliverables (`stage: \"deliverable\"`).",
        ].join("\n");

    return {
      clusters,
      consultInRoomTracks: [],
      dominanceThreshold,
      earlyStoppedZeroDelta: false,
      globalConcordance,
      lockedContractMarkdown,
      ...(minorityReportMarkdown ? { minorityReportMarkdown } : {}),
      nextStepPrompt,
      outcome,
      round: currentRound,
      seatSupportRatio,
      suggestedLibraryRoles: [],
    };
  }

  // Unresolved contention! Match `neededDimensions` dynamically against in-room specialists & library catalog (ZERO hardcoded role names!)
  const unresolvedClusters = clusters.filter((c) => !c.dominatedPass);
  const allNeededDims = new Set(unresolvedClusters.flatMap((c) => c.neededDimensions));
  const disputantIds = new Set([
    ...unresolvedClusters.map((c) => c.targetTrackId),
    ...unresolvedClusters.flatMap((c) => c.opposingReactions.map((o) => o.reviewerTrackId)),
  ]);

  const consultInRoomTracks: { trackId: string; roleLabel: string; matchedDimensions: string[] }[] = [];
  const coveredInRoomDims = new Set<string>();

  for (const tr of activeSpecs) {
    const entry = task.whiteboardEntries.find((e) => e.trackId === tr.trackId);
    const owned = entry?.ownedDimensions ?? inferOwnedDimensions(tr.roleId, tr.roleLabel);
    const hits = owned.filter((d) => allNeededDims.has(d));
    if (hits.length > 0 && !disputantIds.has(tr.trackId)) {
      consultInRoomTracks.push({
        matchedDimensions: hits,
        roleLabel: tr.roleLabel,
        trackId: tr.trackId,
      });
      for (const h of hits) coveredInRoomDims.add(h);
    }
  }

  const missingDims = [...allNeededDims].filter((d) => !coveredInRoomDims.has(d));
  const suggestedLibraryRoles: { roleId: string; title: string; matchedDimensions: string[] }[] = [];
  if (missingDims.length > 0 && params.availableCatalogRoles) {
    const activeRoleIds = new Set(activeSpecs.map((s) => s.roleId));
    for (const cand of params.availableCatalogRoles) {
      if (cand.kind === "inspector" || activeRoleIds.has(cand.roleId)) continue;
      const owned = inferOwnedDimensions(
        cand.roleId,
        `${cand.name.zh} ${cand.name.en}`,
        `${cand.systemCharter.zh} ${cand.systemCharter.en}`,
      );
      const hits = owned.filter((d) => missingDims.includes(d));
      if (hits.length > 0) {
        suggestedLibraryRoles.push({
          matchedDimensions: hits,
          roleId: cand.roleId,
          title: cand.name[locale],
        });
      }
    }
  }

  // Check if we must escalate to Human Intervention (`round >= 2` OR `earlyStoppedZeroDelta` OR `anyHardVeto && round >= 2`)
  const mustEscalateToHuman =
    currentRound >= MAD_MAX_CONSULTATION_ROUNDS ||
    earlyStoppedZeroDelta ||
    (anyHardVeto && consultInRoomTracks.length === 0 && currentRound >= 1 && task.deliberationOpinions.some((o) => o.altersCorePremise));

  const clusterDiagLines = unresolvedClusters.map((c) =>
    zh
      ? `- 焦点对象 **${c.targetLabel}** (支持权重 ${c.supportWeight} vs 反对权重 ${c.opposeWeight} → 支配率 \`D = ${pct(c.dominanceRatio)}\` < ${pct(dominanceThreshold)}${c.hasGroundedHardVeto ? " · ⚠️ 触发非补偿性客观死穴锁" : ""})：${c.opposingReactions.map((o) => `${o.reviewerLabel}: "${o.note}"`).join("；")}`
      : `- Target **${c.targetLabel}** (W+ ${c.supportWeight} vs W- ${c.opposeWeight} -> \`D = ${pct(c.dominanceRatio)}\` < ${pct(dominanceThreshold)}${c.hasGroundedHardVeto ? " · ⚠️ Hard Veto" : ""}): ${c.opposingReactions.map((o) => `${o.reviewerLabel}: "${o.note}"`).join("; ")}`,
  );

  if (mustEscalateToHuman) {
    const reasonTag = earlyStoppedZeroDelta
      ? zh
        ? "检测到票型零变化（Belief-Delta = 0），触发防辩论坍缩早停！"
        : "Belief-Delta = 0 detected -> Anti-Debate-Collapse Early Stop!"
      : anyHardVeto
        ? zh
          ? "触发非补偿性客观硬死穴（ELECTRE Veto）或颠覆核心前提！"
          : "Triggered Non-Compensatory Hard Veto!"
        : zh
          ? `已达最大协商轮次上限 (R = ${MAD_MAX_CONSULTATION_ROUNDS}) 仍处于势均力敌僵局！`
          : `Reached max consultation cap (R = ${MAD_MAX_CONSULTATION_ROUNDS}) without supermajority dominance!`;

    const nextStepPrompt = zh
      ? [
          `⏸ **[PREMISE_CONFLICT_USER_DECISION_REQUIRED] 白板数学仲裁触发人工干预门禁（${reasonTag}）**`,
          mathReceiptLine,
          ...clusterDiagLines,
          "",
          "请直接在普通聊天中向用户展示上方权重对决得分表与双方核心依据，待用户一句话拍板后调用 `vetoboard_update_council`（传入 `resolvePremiseConflictChoice`）立即解锁并发定稿！",
        ].join("\n")
      : [
          `⏸ **[PREMISE_CONFLICT_USER_DECISION_REQUIRED] Whiteboard Escalated to Human Intervention (${reasonTag})**`,
          mathReceiptLine,
          ...clusterDiagLines,
          "",
          "Present this mathematical deadlock scorecard to the user in chat, then call `vetoboard_update_council` (`resolvePremiseConflictChoice`) to unlock parallel execution!",
        ].join("\n");

    return {
      clusters,
      consultInRoomTracks,
      dominanceThreshold,
      earlyStoppedZeroDelta,
      globalConcordance,
      lockedContractMarkdown,
      ...(minorityReportMarkdown ? { minorityReportMarkdown } : {}),
      nextStepPrompt,
      outcome: "HUMAN_INTERVENTION_REQUIRED",
      round: currentRound,
      seatSupportRatio,
      suggestedLibraryRoles,
    };
  }

  // Otherwise -> Round 1 Dynamic Dimension-Driven Consultation!
  const consultLines =
    consultInRoomTracks.length > 0
      ? consultInRoomTracks.map(
          (c) =>
            `- **在场专员点名会诊**：请唤醒 **${c.roleLabel}** (\`${c.trackId}\`，匹配缺失维度：\`${c.matchedDimensions.join(", ")}\`) 提供关键数据协助破局！`,
        )
      : suggestedLibraryRoles.length > 0
        ? suggestedLibraryRoles.map(
            (s) =>
              `- **可从角色库临时传唤外援**：\`${s.title}\` (\`${s.roleId}\`，覆盖缺失维度：\`${s.matchedDimensions.join(", ")}\`) —— 可调 \`vetoboard_update_council\` 动态拉入或由当事方补齐该维度测算！`,
          )
        : [
            zh
              ? "- 请仅唤醒冲突当事双方围绕上方分歧点做 **最后 1 轮数据修正**（其余已签赞同的角色静默休眠，严禁群聊混战）！"
              : "- Wake ONLY the disputing tracks for **1 final targeted revision** (all other approved tracks stay silent)!",
          ];

  const nextStepPrompt = zh
    ? [
        `## 🔍 白板局部僵局（D < ${pct(dominanceThreshold)} 或 C < 66.7%）—— 启动【动态维度拉人精准协商（第 ${currentRound}/${MAD_MAX_CONSULTATION_ROUNDS} 轮）】`,
        mathReceiptLine,
        ...clusterDiagLines,
        "",
        "### 🎯 动态寻址匹配结果（无关角色已静默放过，严禁拉群混战！）：",
        ...consultLines,
        "",
        "请通过 `send_message` 仅让上述点名角色补充数据/修改白板指标（`stage: \"board_post\"` 更新白板后，再由相关方传 `stage: \"board_review\"` 复核；若下一轮仍无法过线将自动早停转交人工拍板）！",
      ].join("\n")
    : [
        `## 🔍 Contention Below Dominance Threshold -> [Targeted Dimension Consultation (Round ${currentRound}/${MAD_MAX_CONSULTATION_ROUNDS})]`,
        mathReceiptLine,
        ...clusterDiagLines,
        "",
        "### 🎯 Dynamic Dimension Match (Approved bystanders stay silent!):",
        ...consultLines,
      ].join("\n");

  return {
    clusters,
    consultInRoomTracks,
    dominanceThreshold,
    earlyStoppedZeroDelta: false,
    globalConcordance,
    lockedContractMarkdown,
    ...(minorityReportMarkdown ? { minorityReportMarkdown } : {}),
    nextStepPrompt,
    outcome: "CONSULTATION_REQUIRED",
    round: currentRound,
    seatSupportRatio,
    suggestedLibraryRoles,
  };
}

export function formatWhiteboardLedgerForReport(
  task: VetoBoardTaskRecord,
  locale: VetoBoardLocale,
): string {
  if (task.whiteboardEntries.length === 0 && task.whiteboardReactions.length === 0) {
    return "";
  }
  const zh = locale === "zh";
  const lines: string[] = [];

  if (task.whiteboardEntries.length > 0) {
    lines.push(zh ? "### 1. 公开白板关键指标定稿台账" : "### 1. Public Whiteboard Final Variables");
    for (const e of task.whiteboardEntries) {
      const vars = Object.entries(e.variables)
        .map(([k, v]) => `\`${k}=${v}\``)
        .join(" · ");
      lines.push(
        `- **${e.roleLabel} (W${e.weight}${e.revision > 1 ? ` · Rev ${e.revision}` : ""})**：${e.summary}${vars ? ` — ${vars}` : ""}`,
      );
    }
    lines.push("");
  }

  if (task.whiteboardReactions.length > 0) {
    lines.push(
      zh
        ? "### 2. 全员阅板比对与放行/交锋留痕记录"
        : "### 2. Specialist Review, Diff & Approval Ledger",
    );
    for (const r of task.whiteboardReactions) {
      const badge =
        r.decision === "approve"
          ? zh
            ? "✅ 赞同/吸收放过"
            : "✅ Approved/Absorbed"
          : r.decision === "conditional"
            ? zh
              ? "🟡 单方自兼容"
              : "🟡 Self-Adapted"
            : zh
              ? "⚡ 意见相反/发起协商"
              : "⚡ Opposed";
      const dims =
        r.neededDimensions.length > 0
          ? ` (${zh ? "寻址维度" : "Needed Dims"}: \`${r.neededDimensions.join(",")}\`)`
          : "";
      lines.push(`- [R${r.round}] **${r.reviewerLabel} (W${r.weight})** — ${badge}${dims}：${r.note}`);
    }
    lines.push("");
  }

  if (task.lockedSharedContract) {
    lines.push(task.lockedSharedContract);
  }
  return lines.join("\n");
}
