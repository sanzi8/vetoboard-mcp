import type { VetoBoardLocale } from "../i18n/locales.js";
import type { DeliberationOpinion, RolePriorityTier, VetoBoardTaskRecord } from "./types.js";

/**
 * VetoBoard Two-Stage Serial-Clash -> Parallel-Execution Engine (`deliberationEngine.ts`).
 * - Stage A (Serial Short Clash, ~200 words/round): Round 1 (Baseline Claims) -> Round 2 (Peer Rebuttal & Constructive Restructure) -> Deterministic Weight Arbitration & Locked Shared Baseline Contract.
 * - Stage B (100% Parallel Heavy Execution): All persistent specialist subagents execute concurrently against the identical Locked Shared Contract!
 */

export interface RawDeliberationInput {
  readonly markdown: string;
  readonly stance?: "support" | "caution" | "challenge";
  readonly altersCorePremise?: boolean;
  readonly replyTo?: readonly string[];
  readonly constructiveAlternative?: string;
  readonly keyConstraints?: readonly string[];
}

export function inferPriorityTierFromTrack(tierLabel: string, weight: number): RolePriorityTier {
  if (/主导|primary|lead/iu.test(tierLabel) || weight >= 92) return "primary";
  if (/护栏|guardrail|督察/iu.test(tierLabel) || weight >= 80) return "guardrail";
  return "secondary";
}

export function parseDeliberationFromSubmission(input: RawDeliberationInput): {
  readonly stance: "support" | "caution" | "challenge";
  readonly altersCorePremise: boolean;
  readonly replyTo: string[];
  readonly constructiveAlternative?: string;
  readonly keyConstraints: string[];
  readonly summary: string;
} {
  let jsonBlock: Record<string, unknown> | undefined;
  const fenceMatch = /```json\s*([\s\S]*?)```/iu.exec(input.markdown);
  if (fenceMatch?.[1]) {
    try {
      jsonBlock = JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>;
    } catch {
      jsonBlock = undefined;
    }
  }

  const strippedText = input.markdown
    .replace(/```[\s\S]*?```/g, "")
    .trim();

  const rawLines = strippedText
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .filter(Boolean);

  const bulletLines = rawLines
    .filter((l) => /^[-*+]\s+/.test(l))
    .map((l) => l.replace(/^[-*+]\s+/, "").trim());

  const proseLead =
    rawLines.find((l) => !/^[-*+|]/.test(l) && l.length >= 8) ??
    bulletLines[0] ??
    strippedText.slice(0, 160);

  const summaryFromJson =
    typeof jsonBlock?.summary === "string" && jsonBlock.summary.trim()
      ? jsonBlock.summary.trim()
      : undefined;
  const summary = (summaryFromJson ?? proseLead).replace(/\s+/g, " ").slice(0, 180);

  const rawStance =
    input.stance ??
    (jsonBlock?.stance === "challenge" || jsonBlock?.stance === "caution" || jsonBlock?.stance === "support"
      ? jsonBlock.stance
      : /(?:违法|严禁|死穴|封号|不可行|推翻|否决|illegal|prohibit|fatal)/iu.test(strippedText)
        ? "challenge"
        : /(?:有条件|风险|预警|必须切换|替代|caution|conditional)/iu.test(strippedText)
          ? "caution"
          : "support");

  const altersCorePremise =
    input.altersCorePremise ??
    (typeof jsonBlock?.altersCorePremise === "boolean" ? jsonBlock.altersCorePremise : false);

  const replyTo =
    input.replyTo && input.replyTo.length > 0
      ? [...input.replyTo]
      : Array.isArray(jsonBlock?.replyTo)
        ? jsonBlock.replyTo.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : [];

  const constructiveAlternative =
    input.constructiveAlternative?.trim() ||
    (typeof jsonBlock?.constructiveAlternative === "string" && jsonBlock.constructiveAlternative.trim()
      ? jsonBlock.constructiveAlternative.trim()
      : undefined);

  const keyConstraints =
    input.keyConstraints && input.keyConstraints.length > 0
      ? [...input.keyConstraints]
      : Array.isArray(jsonBlock?.keyConstraints)
        ? jsonBlock.keyConstraints.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : bulletLines.slice(0, 3).map((b) => b.slice(0, 120));

  return {
    altersCorePremise,
    ...(constructiveAlternative ? { constructiveAlternative } : {}),
    keyConstraints,
    replyTo,
    stance: rawStance,
    summary,
  };
}

export function renderRound1PeerBlackboard(task: VetoBoardTaskRecord, locale: VetoBoardLocale): string {
  const zh = locale === "zh";
  const r1 = task.deliberationOpinions.filter((o) => o.round === 1);

  const boardLines = r1.map((op) => {
    const stanceTag =
      op.stance === "challenge"
        ? zh
          ? "【风险质询】"
          : "[CHALLENGE]"
        : op.stance === "caution"
          ? zh
            ? "【审慎附条件】"
            : "[CAUTION]"
          : zh
            ? "【支持推进】"
            : "[SUPPORT]";
    const constraints =
      op.keyConstraints.length > 0
        ? `（${zh ? "硬约束" : "Constraints"}：${op.keyConstraints.join("；")}）`
        : "";
    return `- **${op.roleLabel}** [权重 ${op.weight}] ${stanceTag}：${op.summary}${constraints}`;
  });

  if (zh) {
    return [
      "## 📋 第 1 轮立项亮牌已完成 —— 进入【第 2 轮：串行横向质询与共享参数锁死】",
      "",
      "### 全员第 1 轮主张黑板 (`peerBoard`)",
      ...boardLines,
      "",
      "### ⚡ 下一步宿主调度指令（严禁新开 Subagent！请用 `send_message` 唤醒刚才那同一批专员 `conversationId`）：",
      "1. 将上方《全员第 1 轮主张黑板》通过 `send_message` 发送给每一个在场专员会话，要求在 **240 字内** 完成点名横向交锋：",
      "   - **合规/工程护栏席位**：直接点名审阅核心主导与精算席位的数字与路径假设，指出违规/过度工程化死穴并给出 **具体合法/极简替代参数 (`constructiveAlternative`)**；仅当替代方案彻底颠覆用户商业收费闭环时才将 `altersCorePremise` 设为 `true`。",
      "   - **核心主导/精算席位**：回应护栏席位的预警，吸收合理的替代费率/BOM 参数统一口径；若认为护栏阉割了核心商业闭环则设 `altersCorePremise: true` 上报用户裁决。",
      "2. 每个专员回复后，调用 `vetoboard_submit_track_output` 并传 `stage: \"round2\"`（可附 `replyTo`、`constructiveAlternative`、`keyConstraints`、`altersCorePremise`）。收齐后引擎将自动锁死《冻结共享参数契约》并解锁 100% 满并发重装干活！",
    ].join("\n");
  }

  return [
    "## 📋 Round 1 Claims Complete -> Proceed to [Round 2: Serial Cross-Examination & Contract Lock]",
    "",
    "### Round 1 Peer Blackboard",
    ...boardLines,
    "",
    "### ⚡ Next Step for Host Agent (Reuse existing subagent `conversationId`s via `send_message`!):",
    "1. Send the Round 1 Peer Blackboard above via `send_message` to each existing specialist subagent (`<= 240` words): challenge conflicting assumptions, propose `constructiveAlternative` parameters, and set `altersCorePremise: true` ONLY if the core revenue premise is reversed.",
    "2. Submit each Round 2 reply via `vetoboard_submit_track_output` with `stage: \"round2\"` to lock the Shared Baseline Contract and unlock 100% parallel execution!",
  ].join("\n");
}

export function evaluateDeliberationArbitration(
  task: VetoBoardTaskRecord,
  locale: VetoBoardLocale,
): {
  readonly status: "contract_locked" | "paused_conflict";
  readonly weightedConsensusScore: number;
  readonly lockedContractMarkdown: string;
  readonly nextStepPrompt: string;
} {
  const zh = locale === "zh";
  const r2 = task.deliberationOpinions.filter((o) => o.round === 2);
  const effective = r2.length > 0 ? r2 : task.deliberationOpinions;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const op of effective) {
    const factor = op.stance === "support" ? 1 : op.stance === "caution" ? 0.82 : 0.35;
    weightedSum += op.weight * factor;
    totalWeight += op.weight;
  }
  const weightedConsensusScore =
    totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 100;

  const premiseReversals = effective.filter((op) => op.altersCorePremise === true);

  const contractItems: string[] = [];
  const sortedByWeight = [...effective].sort((a, b) => b.weight - a.weight);
  for (const op of sortedByWeight) {
    const alt = op.constructiveAlternative ? ` → 替代/修正口径：${op.constructiveAlternative}` : "";
    const cons = op.keyConstraints.length > 0 ? ` [${op.keyConstraints.join("；")}]` : "";
    contractItems.push(`- **${op.roleLabel} (W${op.weight})**：${op.summary}${alt}${cons}`);
  }

  const lockedContractMarkdown = zh
    ? [
        `### 🔒 冻结共享参数与边界契约（加权共识分：${weightedConsensusScore}/100）`,
        "以下口径已历经两轮跨角色交锋锁定，**接下来并行撰写完整底稿与跑 `vetoboard_calc` 主表时，全员必须严格对齐本契约参数（严禁各算各的旧假定！）**：",
        ...contractItems,
      ].join("\n")
    : [
        `### 🔒 Locked Shared Baseline Contract (Weighted Consensus: ${weightedConsensusScore}/100)`,
        "All parallel execution tracks MUST align their primary tables & `vetoboard_calc` models with this post-clash contract:",
        ...contractItems,
      ].join("\n");

  if (premiseReversals.length > 0) {
    const conflictLines = premiseReversals.map(
      (p) =>
        `- **${p.roleLabel} (W${p.weight})**：${p.summary}${p.constructiveAlternative ? `（建议替代结构：${p.constructiveAlternative}）` : ""}`,
    );
    const nextStepPrompt = zh
      ? [
          "⏸ **[PREMISE_CONFLICT_USER_DECISION_REQUIRED] 交锋期检测到颠覆核心前提的重大路线冲突（已赶在消耗重活 Token 前紧急刹停！）**",
          `当前加权共识分：\`${weightedConsensusScore}/100\`。以下席位指出原商业/技术闭环存在根本性冲突：`,
          ...conflictLines,
          "",
          "请直接在普通聊天回复中向用户简要呈现上述冲突与替代路线，等待用户拍板后调用 `vetoboard_update_council`（传入 `resolvePremiseConflictChoice`）放行全员并行干活！",
        ].join("\n")
      : [
          "⏸ **[PREMISE_CONFLICT_USER_DECISION_REQUIRED] Major Premise Reversal Detected Before Heavy Execution!**",
          `Weighted Consensus: \`${weightedConsensusScore}/100\`. Conflicting tracks:`,
          ...conflictLines,
          "",
          "Present this route choice to the user in plain chat, then call `vetoboard_update_council` (`resolvePremiseConflictChoice`) to unlock parallel execution!",
        ].join("\n");

    return {
      lockedContractMarkdown,
      nextStepPrompt,
      status: "paused_conflict",
      weightedConsensusScore,
    };
  }

  const nextStepPrompt = zh
    ? [
        "## 🚀 两轮交锋收敛通过！现已解锁【全轨 100% 满并发干重活阶段】",
        lockedContractMarkdown,
        "",
        "### ⚡ 下一步宿主调度指令（满并发重装交付）：",
        "1. **复用同一批存活的专员 `conversationId`（同一回合并行发起全部 `send_message`！）**，将上方《🔒 冻结共享参数与边界契约》同时注入全部专员会话；",
        "2. 令所有专员**同时并发**完成深度查证、`vetoboard_calc`（传 `taskId`）全矩阵核算与完整 Markdown 底稿撰写，并在正文顶部附 `### 呈批摘要卡`；",
        "3. 每轨完成后调用 `vetoboard_submit_track_output`（`stage: \"deliverable\"`）提交底稿！",
      ].join("\n")
    : [
        "## 🚀 2-Round Clash Converged! Unlocked [100% Parallel Heavy Execution Stage]",
        lockedContractMarkdown,
        "",
        "### ⚡ Next Step for Host Agent (100% Parallel Execution):",
        "1. Send the `🔒 Locked Shared Baseline Contract` above via `send_message` to ALL existing specialist subagents **simultaneously in parallel**;",
        "2. Have all tracks write their full unabridged deliverables and invoke `vetoboard_calc` (`taskId`) concurrently, then submit each via `vetoboard_submit_track_output` (`stage: \"deliverable\"`).",
      ].join("\n");

  return {
    lockedContractMarkdown,
    nextStepPrompt,
    status: "contract_locked",
    weightedConsensusScore,
  };
}

export function formatDeliberationLogForReport(
  opinions: readonly DeliberationOpinion[],
  lockedSharedContract: string | undefined,
  locale: VetoBoardLocale,
): string {
  if (opinions.length === 0 && !lockedSharedContract) return "";
  const zh = locale === "zh";
  const lines: string[] = [];

  for (const op of opinions) {
    const stanceLabel =
      op.stance === "challenge"
        ? zh
          ? "风险质询"
          : "Challenge"
        : op.stance === "caution"
          ? zh
            ? "审慎约束"
            : "Conditional"
          : zh
            ? "支持推进"
            : "Support";
    const roundLabel = zh ? `第 ${op.round} 轮` : `Round ${op.round}`;
    lines.push(
      `- **${op.roleLabel}**（${roundLabel} · ${stanceLabel} · W${op.weight}）：${op.summary}`,
    );
    if (op.round === 2 && op.replyTo.length > 0) {
      lines.push(`  - ${zh ? "横向回应角色" : "Replied To"}: ${op.replyTo.join("、")}`);
    }
    if (op.constructiveAlternative) {
      lines.push(
        `  - ${zh ? "建设性合规/协同替代路径" : "Constructive Alternative"}: ${op.constructiveAlternative}`,
      );
    }
    if (op.keyConstraints.length > 0) {
      lines.push(`  - ${zh ? "关键约束" : "Key Constraints"}: ${op.keyConstraints.join("；")}`);
    }
  }

  if (lockedSharedContract) {
    lines.push("", lockedSharedContract);
  }
  return lines.join("\n");
}
