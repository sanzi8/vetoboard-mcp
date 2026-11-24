import { t } from "../i18n/locales.js";
import { formatModelBindingLabel } from "./roleCatalog.js";
import type { VetoBoardTaskRecord, TaskTrackState } from "./types.js";

/**
 * `docker buildx`-style Multi-Track CLI Progress Tree + Live Catch Ticker (`en` + `zh`).
 * - Pure Markdown/plain-text compatible for universal IDE chat panes (Claude Code, Cursor, Antigravity, Codex)
 * - Optional ANSI color mode for `npx vetoboard-mcp watch <taskId>` in a dedicated terminal pane.
 */

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1_000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return mins > 0 ? `${mins}m ${String(secs).padStart(2, "0")}s` : `${secs}s`;
}

function trackGlyph(status: TaskTrackState["status"], ansi: boolean): string {
  const raw =
    status === "passed"
      ? "✔"
      : status === "skipped"
        ? "⊘"
        : status === "running"
          ? "⟳"
          : status === "reworking"
            ? "↻"
            : status === "failed"
              ? "✖"
              : status === "paused"
                ? "⏸"
                : "⏳";
  if (!ansi) return raw;
  if (status === "passed") return `\x1b[32m${raw}\x1b[0m`;
  if (status === "running" || status === "reworking") return `\x1b[36m${raw}\x1b[0m`;
  if (status === "failed") return `\x1b[31m${raw}\x1b[0m`;
  if (status === "paused") return `\x1b[33m${raw}\x1b[0m`;
  return `\x1b[90m${raw}\x1b[0m`;
}

export function renderDockerBuildProgress(
  task: VetoBoardTaskRecord,
  options?: { readonly ansi?: boolean; readonly includeUpsell?: boolean },
): string {
  const ansi = options?.ansi === true;
  const locale = task.locale;
  const zh = locale === "zh";
  const dict = t(locale);

  const activeTracks = task.tracks.filter((tr) => tr.status !== "skipped");
  const total = activeTracks.length;
  const done = activeTracks.filter((tr) => tr.status === "passed").length;
  const elapsedMs = Math.max(
    0,
    Date.parse(task.updatedAt) - Date.parse(task.createdAt) ||
      task.tracks.reduce((acc, item) => acc + item.durationMs, 0),
  );

  const delibLine =
    task.topologyMode === "whiteboard-electre" && task.deliberationPhase !== "skipped"
      ? task.deliberationPhase === "round1"
        ? zh
          ? "   📋 白板阶段: 100% 并发备课上板中 (stage='board_post')"
          : "   📋 Whiteboard: Concurrent Prep & Posting (stage='board_post')"
        : task.deliberationPhase === "round2"
          ? zh
            ? `   🔍 白板阶段: 阅板比对 & ELECTRE/QMV 数学裁决中 (第 ${Math.max(1, task.whiteboardRound)}/2 轮)`
            : `   🔍 Whiteboard: Review & ELECTRE/QMV Gate (Round ${Math.max(1, task.whiteboardRound)}/2)`
          : task.deliberationPhase === "paused_conflict"
            ? zh
              ? "   ⏸ 白板阶段: 超阈值僵局 / 客观死穴已熔断，等待人工干预拍板"
              : "   ⏸ Whiteboard: Escalated to Human Intervention"
            : task.status === "completed"
              ? zh
                ? "   ✅ 白板阶段: 已终检签发三件套并存入知识库 · 已退回普通对话"
                : "   ✅ Whiteboard: Signed, Distilled to Knowledge Base & Exited"
              : zh
                ? "   🚀 白板阶段: 数学裁决已锁板 · 全轨 100% 满并发收口定稿中"
                : "   🚀 Whiteboard: Contract Locked · 100% Parallel Finalization"
      : task.topologyMode === "deliberate-then-parallel" && task.deliberationPhase !== "skipped"
        ? task.deliberationPhase === "round1"
        ? zh
          ? "   ⚔️ 当前阶段: 串行短交锋 · 第 1 轮亮底牌"
          : "   ⚔️ Stage: Serial Clash · Round 1 Baseline Claims"
        : task.deliberationPhase === "round2"
          ? zh
            ? "   ⚔️ 当前阶段: 串行短交锋 · 第 2 轮横向质询锁契约"
            : "   ⚔️ Stage: Serial Clash · Round 2 Peer Rebuttal"
          : task.deliberationPhase === "paused_conflict"
            ? zh
              ? "   ⏸ 当前阶段: 重大路线冲突已刹停，等待用户拍板"
              : "   ⏸ Stage: Premise Conflict Paused for User Decision"
            : task.status === "completed"
              ? zh
                ? "   ✅ 当前阶段: 已签发三件套并沉淀入实战知识库 · 已退回普通对话"
                : "   ✅ Stage: Report Signed & Distilled to Knowledge Base · Exited to Normal Chat"
              : zh
                ? "   🚀 当前阶段: 共享契约已锁定 · 全轨 100% 满并发干重活中"
                : "   🚀 Stage: Shared Contract Locked · 100% Parallel Heavy Execution"
      : undefined;

  const header = dict.progressHeader(done, total, formatDuration(elapsedMs), task.executionMode);
  const lines: string[] = [
    ansi ? `\x1b[1m${header}\x1b[0m` : header,
    `   ${dict.progressAsyncHint}`,
    ...(task.lineupRationale && task.lineupRationale.length > 0
      ? [`   ${zh ? "⚖️ 定权依据" : "⚖️ Weighting"}: ${task.lineupRationale.join(" · ")}`]
      : []),
    ...(delibLine ? [delibLine] : []),
  ];

  task.tracks.forEach((tr, idx) => {
    const cappedRetry = Math.min(tr.retryCount, tr.maxRetries);
    const retrySuffix =
      cappedRetry > 0
        ? zh
          ? ` (督察打回重修 ${cappedRetry}/${tr.maxRetries})`
          : ` (rework ${cappedRetry}/${tr.maxRetries})`
        : "";
    const dur = tr.durationMs > 0 ? `  ${formatDuration(tr.durationMs)}` : "";
    const skillsBadge =
      tr.boundSkillIds && tr.boundSkillIds.length > 0
        ? ` {skills: ${tr.boundSkillIds.join(", ")}}`
        : "";
    const modelLabel = formatModelBindingLabel(tr.modelBinding);
    const modelBadge = modelLabel ? ` [model: ${modelLabel}]` : "";
    const statusLine = ` => ${trackGlyph(tr.status, ansi)} [${idx + 1}/${task.tracks.length} ${tr.tierLabel}·${tr.weight}] ${tr.title}${modelBadge}${skillsBadge}${retrySuffix}${dur}`;
    lines.push(statusLine);

    if (tr.summaryLine?.trim()) {
      lines.push(` │    └─ ${tr.summaryLine.trim()}`);
    }
    for (const c of tr.catches.slice(-3)) {
      const tag =
        c.category === "math_mismatch"
          ? zh
            ? "[算术拦截]"
            : "[MATH CATCH]"
          : c.category === "compliance_redline"
            ? zh
              ? "[红线排雷]"
              : "[REDLINE CATCH]"
            : c.category === "rule_violation"
              ? zh
                ? "[硬规则拦截]"
                : "[RULE GATE]"
              : c.category === "premise_conflict"
                ? zh
                  ? "[交锋纠偏]"
                  : "[PREMISE CLASH]"
                : zh
                  ? "[实证核验]"
                  : "[VERIFIED]";
      const formattedCatch = ` │    └─ ${tag} ${c.detail}`;
      lines.push(ansi ? `\x1b[33m${formattedCatch}\x1b[0m` : formattedCatch);
    }
  });

  if (options?.includeUpsell !== false && task.executionMode !== "cloud-pool") {
    lines.push("", `   ${dict.progressCloudUpsell}`);
  }

  return lines.join("\n");
}
