import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  listAssetContributions,
  previewOrSubmitAssetContribution,
  withdrawAssetContribution,
} from "../core/assetContribution.js";
import {
  persistRoleToLibrary,
  renderConversationalPreflightBriefing,
  retrieveReusableAssets,
} from "../core/assetLibrary.js";
import {
  assembleDualLayerReport,
  buildAutoExecutiveBriefing,
  buildCitedBriefingPromptAndCatalog,
  countEmpiricalSources,
  countReconciledMathRows,
  extractAutoCatchesFromMarkdown,
} from "../core/citedBriefing.js";
import {
  buildHostNativeWorktreeIsolationDirective,
  buildHostSubscriptionPlaybook,
  resolveExternalModelConfig,
  runExternalChatCompletion,
} from "../core/computeRouter.js";
import {
  computeInitialBorgQuotaPool,
  formatBorgQuotaLedgerForReport,
  freezeTrackBurstOnRework,
  isRoleTemplateWebCapable,
  rebalanceBorgPoolWeights,
  registerDynamicRoleInBorgPool,
  renderBorgRoleCharterBadge,
  settleBorgStageCompletion,
} from "../core/borgQuotaPool.js";
import {
  evaluateDeliberationArbitration,
  inferPriorityTierFromTrack,
  parseDeliberationFromSubmission,
  renderRound1PeerBlackboard,
} from "../core/deliberationEngine.js";
import { buildDivergeConvergeClarification } from "../core/divergeClarify.js";
import {
  distillAndSaveTaskKnowledge,
  formatMountedKnowledgeForPrompt,
} from "../core/knowledgeLibrary.js";
import { buildArtifactMemorialCard } from "../core/memorialCard.js";
import { renderDockerBuildProgress } from "../core/progressRenderer.js";
import { runQuantitativeCalc } from "../core/quantitativeCalc.js";
import {
  BUILTIN_ROLE_TEMPLATES,
  buildLineupSelectorPlan,
  CROSS_EXAMINER_ROLE_TEMPLATE,
  customRoleToTemplate,
  DYNAMIC_TOPIC_ARCHETYPE_ROLE_IDS,
  findRoleTemplate,
  normalizeRoleModelBinding,
  parseCustomWeightText,
  parseNaturalLanguageModelOverrides,
  renderRoleCharterPrompt,
  resolveCouncilLineup,
  resolveTierLabel,
  WEIGHT_PRESET_COMPLIANCE_FIRST,
  WEIGHT_PRESET_EQUAL,
  WEIGHT_PRESET_FINANCE_FIRST,
  WEIGHT_PRESET_SINGLE_DICTATOR,
} from "../core/roleCatalog.js";
import {
  detectPremiseReversal,
  evaluateRuleGate,
  preserveBaselineOnIncrementalPatch,
} from "../core/ruleGate.js";
import { distillStandardizedSkill } from "../core/skillDistiller.js";
import {
  checkLatestVersionNonBlocking,
  CURRENT_VETOBOARD_VERSION,
  runSelfUpdate,
} from "../core/selfUpdater.js";
import {
  attachSkillsToRole,
  discoverNativeSkills,
  synthesizeRoleFromSkill,
} from "../core/skillRadar.js";
import { VetoBoardTaskStore } from "../core/taskStore.js";
import {
  extractVerifiedHttpUrls,
  hasInvokedWebResearchTool,
  resolveTurnResearchBudget,
} from "../core/researchBudget.js";
import {
  evaluateWhiteboardConvergence,
  extractWhiteboardVariables,
  formatWhiteboardLedgerForReport,
  inferNeededDimensions,
  inferOwnedDimensions,
  renderPublicWhiteboardSnapshot,
} from "../core/whiteboardEngine.js";
import {
  customRoleInputSchema,
  effortProfileSchema,
  executableRuleSchema,
  executionModeSchema,
  hostModelCandidateSchema,
  peerRoleRequestInputSchema,
  roleModelBindingSchema,
  rolePriorityTierSchema,
  vetoboardLocaleInputSchema,
  type DeliberationOpinion,
  type PeerRoleRequestInput,
  type PeerRoleRequestRecord,
  type QuotaPoolSnapshot,
  type RoleModelBinding,
  type RoleTemplate,
  type VetoBoardTaskRecord,
} from "../core/types.js";
import { resolveLocale, type VetoBoardLocale, t } from "../i18n/locales.js";
import { applyUniversalSchemaSanitizer } from "./schemaCompat.js";

export interface CreateVetoBoardMcpServerOptions {
  readonly store?: VetoBoardTaskStore;
  readonly defaultLocale?: "auto" | "en" | "zh";
  readonly version?: string;
}

function textResult(text: string, isError = false) {
  return {
    content: [{ text, type: "text" as const }],
    ...(isError ? { isError: true } : {}),
  };
}

function isWritableRoleTemplate(tpl: RoleTemplate | undefined, roleId: string): boolean {
  if (!tpl) {
    return roleId === "backend-engineer" || roleId === "frontend-engineer";
  }
  if (tpl.kind === "inspector") return false;
  if (tpl.readOnly === false) return true;
  return tpl.allowedTools.some((tool) => {
    const low = tool.trim().toLowerCase();
    return low === "edit" || low === "write" || low === "edit_file" || low === "write_file";
  });
}

async function resolvePeerRoleTemplate(params: {
  readonly req: Pick<
    PeerRoleRequestInput,
    "roleId" | "title" | "charter" | "reason" | "priorityTier" | "weight" | "webCapable"
  >;
  readonly locale: VetoBoardLocale;
  readonly dataRootDir: string;
  readonly workspaceDir?: string;
}): Promise<{ readonly tpl: RoleTemplate; readonly boundSkillIds: string[] }> {
  const { req, locale, dataRootDir, workspaceDir } = params;
  const rawId = req.roleId.trim();
  const cleanId = rawId.replace(/^spawn:/i, "").trim();
  const lowerId = cleanId.toLowerCase();

  let baseTpl = findRoleTemplate(lowerId);
  let boundSkillIds: string[] = [];

  if (!baseTpl) {
    const retrieved = await retrieveReusableAssets({
      dataRootDir,
      goal: req.reason,
      locale,
      workspaceDir,
    });
    baseTpl = retrieved.roles.find((r) => r.role.roleId.toLowerCase() === lowerId)?.role;
  }

  if (!baseTpl) {
    const discovered = await discoverNativeSkills({
      dataRootDir,
      locale,
      workspaceDir,
    });
    const strippedSkillId = lowerId.replace(/^skill-/, "");
    const matchedSkill = discovered.find(
      (s) => s.skillId.toLowerCase() === lowerId || s.skillId.toLowerCase() === strippedSkillId,
    );
    if (matchedSkill) {
      baseTpl = synthesizeRoleFromSkill(matchedSkill, locale, req.weight ?? 88);
      boundSkillIds = [matchedSkill.skillId];
    }
  }

  if (!baseTpl) {
    const custom = customRoleToTemplate({
      charter: req.charter?.trim() || req.reason,
      priorityTier: req.priorityTier ?? "guardrail",
      roleId: lowerId,
      title: req.title?.trim() || cleanId,
      weight: req.weight ?? 85,
    });
    baseTpl =
      req.webCapable === false
        ? {
            ...custom,
            allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "vetoboard_calc"],
            domain: "swe",
            readOnly: false,
          }
        : custom;
  }

  const finalWeight =
    req.weight !== undefined ? Math.max(10, Math.min(100, Math.round(req.weight))) : baseTpl.weight;
  const finalTier =
    req.priorityTier ??
    (req.weight !== undefined
      ? finalWeight >= 90
        ? "primary"
        : finalWeight >= 70
          ? "guardrail"
          : "secondary"
      : baseTpl.priorityTier);

  return {
    boundSkillIds,
    tpl: {
      ...baseTpl,
      priorityTier: finalTier,
      weight: finalWeight,
      ...(req.webCapable === false
        ? {
            allowedTools: baseTpl.allowedTools.filter(
              (tName) => !["websearch", "webfetch", "search_web"].includes(tName.toLowerCase()),
            ),
          }
        : {}),
    },
  };
}

function refreshMultiWaveDependencies(
  tracks: VetoBoardTaskRecord["tracks"],
  now: string,
): VetoBoardTaskRecord["tracks"] {
  const doneSet = new Set(
    tracks
      .filter((tr) => tr.status === "passed" || tr.status === "skipped")
      .map((tr) => tr.trackId),
  );
  return tracks.map((tr) => {
    if (tr.wave <= 1) return tr;
    const nextDeps = tracks
      .filter((u) => u.wave < tr.wave && u.status !== "skipped")
      .map((u) => u.trackId);
    const ready = nextDeps.every((d) => doneSet.has(d));
    let nextStatus = tr.status;
    if (tr.status === "pending" && ready) {
      nextStatus = "running";
    } else if (tr.status === "running" && !ready) {
      // Hold downstream inspector until newly hot-inserted peer specialist finishes!
      nextStatus = "pending";
    }
    return {
      ...tr,
      dependsOn: nextDeps,
      ...(nextStatus === "running" && !tr.startedAt ? { startedAt: now } : {}),
      status: nextStatus,
    };
  });
}

function hotInsertApprovedPeerIntoTask(params: {
  readonly task: VetoBoardTaskRecord;
  readonly reqRecord: PeerRoleRequestRecord;
  readonly tpl: RoleTemplate;
  readonly boundSkillIds: readonly string[];
  readonly now: string;
}): {
  readonly task: VetoBoardTaskRecord;
  readonly spawnedTrackId: string;
  readonly pairedInspectorRoleId: string;
  readonly spawnPromptMarkdown: string;
} {
  const { task, reqRecord, tpl, boundSkillIds, now } = params;
  const locale = task.locale;
  const zh = locale === "zh";

  const existingActive = task.tracks.find(
    (tr) => tr.roleId === tpl.roleId && tr.status !== "skipped",
  );
  const isWritableSwe =
    (tpl.domain === "swe" || task.domain === "swe") && isWritableRoleTemplate(tpl, tpl.roleId);
  const pairedInspectorRoleId = isWritableSwe ? "code-reviewer" : "quality-inspector";

  if (existingActive) {
    return {
      pairedInspectorRoleId,
      spawnPromptMarkdown: "",
      spawnedTrackId: existingActive.trackId,
      task,
    };
  }

  let tracks = task.tracks.slice();
  const nonInspWaves = tracks
    .filter((tItem) => tItem.roleId !== "quality-inspector" && tItem.roleId !== "code-reviewer")
    .map((tItem) => tItem.wave);
  const targetWave = nonInspWaves.length > 0 ? Math.max(...nonInspWaves) : 1;
  const newTrackId = `track-${tracks.length + 1}-${tpl.roleId}`;

  const contractAddendum = [
    zh
      ? `\n\n## ⚡ 动态增援使命（由 \`${reqRecord.requestedByTrackId}\` 发起 · 配对督察：\`${pairedInspectorRoleId}\`）\n- **增援事由**：${reqRecord.reason}`
      : `\n\n## ⚡ Dynamic Peer Mandate (Requested by \`${reqRecord.requestedByTrackId}\` · Paired Inspector: \`${pairedInspectorRoleId}\`)\n- **Scope Gap**: ${reqRecord.reason}`,
    ...(task.lockedSharedContract ? ["", task.lockedSharedContract] : []),
    ...(task.mountedKnowledgeMarkdown ? ["", task.mountedKnowledgeMarkdown] : []),
  ].join("\n");

  const fullCharter = `${renderRoleCharterPrompt(tpl, locale)}${contractAddendum}`;
  const newTrack: VetoBoardTaskRecord["tracks"][number] = {
    boundSkillIds: [...boundSkillIds],
    catches: [],
    customCharter: fullCharter,
    ...(tpl.executableRules.length > 0 ? { customRules: [...tpl.executableRules] } : {}),
    dependsOn: [],
    durationMs: 0,
    maxRetries: task.effortProfile === "deep" ? 3 : 1,
    ...(tpl.modelBinding ? { modelBinding: tpl.modelBinding } : {}),
    retryCount: 0,
    roleId: tpl.roleId,
    roleLabel: tpl.name[locale],
    startedAt: now,
    status: "running",
    tierLabel: resolveTierLabel(tpl, locale),
    title: tpl.name[locale],
    trackId: newTrackId,
    wave: targetWave,
    weight: tpl.weight,
  };

  const insertBeforeIdx = tracks.findIndex(
    (tItem) =>
      tItem.wave > targetWave ||
      tItem.roleId === "code-reviewer" ||
      tItem.roleId === "quality-inspector",
  );
  if (insertBeforeIdx >= 0) {
    tracks.splice(insertBeforeIdx, 0, newTrack);
  } else {
    tracks.push(newTrack);
  }

  let quotaPool: QuotaPoolSnapshot =
    task.quotaPool ??
    computeInitialBorgQuotaPool({
      effortProfile: task.effortProfile,
      nowIso: now,
      tracks: tracks
        .filter((tr) => tr.trackId !== newTrackId)
        .map((tr) => ({
          kind: tr.roleId === "quality-inspector" ? "inspector" : "professional",
          roleId: tr.roleId,
          roleLabel: tr.roleLabel,
          trackId: tr.trackId,
          webCapable: isRoleTemplateWebCapable(findRoleTemplate(tr.roleId)),
          weight: tr.weight,
        })),
    });

  quotaPool = registerDynamicRoleInBorgPool(quotaPool, {
    effortProfile: task.effortProfile,
    nowIso: now,
    seed: {
      isDynamicPeer: true,
      kind: "professional",
      priorityTier: tpl.priorityTier,
      roleId: tpl.roleId,
      roleLabel: tpl.name[locale],
      trackId: newTrackId,
      webCapable: isRoleTemplateWebCapable(tpl, reqRecord.webCapable),
      weight: tpl.weight,
    },
  });

  const addedReviewerPrompts: string[] = [];
  // Auto-pair SWE writable coding specialists with a read-only `code-reviewer` gate if absent!
  if (
    isWritableSwe &&
    !tracks.some((tr) => tr.roleId === "code-reviewer" && tr.status !== "skipped")
  ) {
    const reviewerTpl = findRoleTemplate("code-reviewer")!;
    const revWave = targetWave + 1;
    const revTrackId = `track-${tracks.length + 1}-code-reviewer`;
    const revCharter = renderRoleCharterPrompt(reviewerTpl, locale);
    const revTrack: VetoBoardTaskRecord["tracks"][number] = {
      boundSkillIds: [],
      catches: [],
      customCharter: revCharter,
      dependsOn: [],
      durationMs: 0,
      maxRetries: 1,
      retryCount: 0,
      roleId: reviewerTpl.roleId,
      roleLabel: reviewerTpl.name[locale],
      status: "pending",
      tierLabel: resolveTierLabel(reviewerTpl, locale),
      title: reviewerTpl.name[locale],
      trackId: revTrackId,
      wave: revWave,
      weight: reviewerTpl.weight,
    };

    tracks = tracks.map((tr) =>
      tr.roleId === "quality-inspector" && tr.wave <= revWave ? { ...tr, wave: revWave + 1 } : tr,
    );
    const inspIdx = tracks.findIndex((tr) => tr.roleId === "quality-inspector");
    if (inspIdx >= 0) {
      tracks.splice(inspIdx, 0, revTrack);
    } else {
      tracks.push(revTrack);
    }
    quotaPool = registerDynamicRoleInBorgPool(quotaPool, {
      effortProfile: task.effortProfile,
      nowIso: now,
      seed: {
        isDynamicPeer: true,
        kind: "professional",
        priorityTier: "guardrail",
        roleId: reviewerTpl.roleId,
        roleLabel: reviewerTpl.name[locale],
        trackId: revTrackId,
        webCapable: true,
        weight: reviewerTpl.weight,
      },
    });
    addedReviewerPrompts.push(
      `#### Paired Read-Only Critique Gate \`${revTrackId}\` (Wave ${revWave})\n${revCharter}`,
    );
  }

  tracks = refreshMultiWaveDependencies(tracks, now);

  const alloc = quotaPool.allocations.find((a) => a.trackId === newTrackId);
  const borgBadge = alloc
    ? `${renderBorgRoleCharterBadge(alloc, task.effortProfile, locale)}\n\n`
    : "";

  const writableTrackIds = tracks
    .filter((tr) => tr.status !== "skipped" && isWritableRoleTemplate(findRoleTemplate(tr.roleId), tr.roleId))
    .map((tr) => tr.trackId);
  const worktreeNotice = buildHostNativeWorktreeIsolationDirective({
    locale,
    writableTrackIds,
  });

  const spawnPromptMarkdown = [
    zh
      ? `### ⚡ 动态平级专员已热插就绪：\`${newTrackId}\`（配对只读督察：\`${pairedInspectorRoleId}\` · 已完成轨道零重跑！）`
      : `### ⚡ Dynamic Peer Hot-Inserted: \`${newTrackId}\` (Paired Inspector: \`${pairedInspectorRoleId}\` · Zero Re-Run of Passed Tracks!)`,
    ...(worktreeNotice ? [worktreeNotice] : []),
    `#### New Track \`${newTrackId}\` (${newTrack.tierLabel} · Weight ${newTrack.weight})\n${borgBadge}${fullCharter}`,
    ...addedReviewerPrompts,
  ].join("\n\n");

  return {
    pairedInspectorRoleId,
    spawnPromptMarkdown,
    spawnedTrackId: newTrackId,
    task: {
      ...task,
      quotaPool,
      tracks,
      updatedAt: now,
    },
  };
}

async function applyIncomingPeerRoleRequests(params: {
  readonly task: VetoBoardTaskRecord;
  readonly requests: readonly PeerRoleRequestInput[] | undefined;
  readonly requestedByTrackId: string;
  readonly requestedByRoleLabel: string;
  readonly dataRootDir: string;
  readonly workspaceDir?: string;
  readonly now: string;
}): Promise<{
  readonly task: VetoBoardTaskRecord;
  readonly peerNoticeMarkdown: string;
  readonly pausedForPeerApproval: boolean;
}> {
  if (!params.requests || params.requests.length === 0) {
    return { pausedForPeerApproval: false, peerNoticeMarkdown: "", task: params.task };
  }

  let currentTask = params.task;
  const zh = currentTask.locale === "zh";
  const notices: string[] = [];
  const pendingApprovalLines: string[] = [];
  let pausedForPeerApproval = false;

  for (const req of params.requests) {
    const cleanRoleId = req.roleId.trim().replace(/^spawn:/i, "").toLowerCase();
    const alreadyOnBench = currentTask.tracks.some(
      (tr) => tr.roleId.toLowerCase() === cleanRoleId && tr.status !== "skipped",
    );
    const alreadyPending = currentTask.peerRoleRequests.some(
      (r) => r.roleId.toLowerCase() === cleanRoleId && r.status === "pending_user_approval",
    );
    if (alreadyOnBench || alreadyPending) continue;

    const requestId = `peer_req_${currentTask.peerRoleRequests.length + 1}`;
    const maxSeats = currentTask.maxDynamicPeerRoles ?? 2;
    const usedSeats = currentTask.dynamicPeerRolesUsed ?? 0;

    if (usedSeats < maxSeats) {
      const resolved = await resolvePeerRoleTemplate({
        dataRootDir: params.dataRootDir,
        locale: currentTask.locale,
        req,
        workspaceDir: params.workspaceDir ?? currentTask.workspaceDir,
      });
      const baseRecord: PeerRoleRequestRecord = {
        ...(req.charter ? { charter: req.charter } : {}),
        createdAt: params.now,
        decidedAt: params.now,
        priorityTier: resolved.tpl.priorityTier,
        reason: req.reason,
        requestId,
        requestedByRoleLabel: params.requestedByRoleLabel,
        requestedByTrackId: params.requestedByTrackId,
        roleId: resolved.tpl.roleId,
        status: "auto_approved",
        ...(req.title ? { title: req.title } : {}),
        ...(req.webCapable !== undefined ? { webCapable: req.webCapable } : {}),
        weight: resolved.tpl.weight,
      };
      const inserted = hotInsertApprovedPeerIntoTask({
        boundSkillIds: resolved.boundSkillIds,
        now: params.now,
        reqRecord: baseRecord,
        task: currentTask,
        tpl: resolved.tpl,
      });
      const nextUsed = usedSeats + 1;
      const finalizedRecord: PeerRoleRequestRecord = {
        ...baseRecord,
        pairedInspectorRoleId: inserted.pairedInspectorRoleId,
        spawnedTrackId: inserted.spawnedTrackId,
      };
      currentTask = {
        ...inserted.task,
        dynamicPeerRolesUsed: nextUsed,
        lineupRationale: [
          ...(inserted.task.lineupRationale ?? []),
          zh
            ? `⚡ 动态免批热插 (${nextUsed}/${maxSeats}): 新增「${resolved.tpl.name.zh}」(配对 ${inserted.pairedInspectorRoleId})`
            : `⚡ Auto-Approved Dynamic Peer (${nextUsed}/${maxSeats}): Added "${resolved.tpl.name.en}" (paired ${inserted.pairedInspectorRoleId})`,
        ],
        peerRoleRequests: [...inserted.task.peerRoleRequests, finalizedRecord],
      };
      if (inserted.spawnPromptMarkdown) {
        notices.push(
          zh
            ? `> ⚡ **[DYNAMIC_PEER_AUTO_APPROVED · 免批名额 ${nextUsed}/${maxSeats}]** 已自动从 Borg 公共回流池划拨配额并热插新专员轨道，请立即并行启动下方新轨道（已完成轨道 0 重跑！）：\n\n${inserted.spawnPromptMarkdown}`
            : `> ⚡ **[DYNAMIC_PEER_AUTO_APPROVED · Seat ${nextUsed}/${maxSeats}]** Drawn quota from Borg shared/reflow pool and hot-inserted peer track — spawn immediately (zero re-runs on passed tracks!):\n\n${inserted.spawnPromptMarkdown}`,
        );
      }
    } else {
      pausedForPeerApproval = true;
      const pendingRec: PeerRoleRequestRecord = {
        ...(req.charter ? { charter: req.charter } : {}),
        createdAt: params.now,
        priorityTier: req.priorityTier ?? "guardrail",
        reason: req.reason,
        requestId,
        requestedByRoleLabel: params.requestedByRoleLabel,
        requestedByTrackId: params.requestedByTrackId,
        roleId: cleanRoleId,
        status: "pending_user_approval",
        ...(req.title ? { title: req.title } : {}),
        ...(req.webCapable !== undefined ? { webCapable: req.webCapable } : {}),
        weight: req.weight ?? 85,
      };
      currentTask = {
        ...currentTask,
        deliberationPhase: "awaiting_peer_approval",
        peerRoleRequests: [...currentTask.peerRoleRequests, pendingRec],
        status: "paused",
        updatedAt: params.now,
      };
      pendingApprovalLines.push(
        zh
          ? `- **申请单 \`${requestId}\`**：增补平级角色 \`${req.title || cleanRoleId}\`（由 \`${params.requestedByRoleLabel}\` 发起 · 权重 ${pendingRec.weight}）\n  - **跨界缺口原因**：${req.reason}`
          : `- **Request \`${requestId}\`**: Add peer role \`${req.title || cleanRoleId}\` (requested by \`${params.requestedByRoleLabel}\` · W${pendingRec.weight})\n  - **Reason**: ${req.reason}`,
      );
    }
  }

  if (pausedForPeerApproval) {
    const maxSeats = currentTask.maxDynamicPeerRoles ?? 2;
    const usedSeats = currentTask.dynamicPeerRolesUsed ?? 0;
    notices.push(
      zh
        ? [
            `⏸ **[PEER_ROLE_APPROVAL_REQUIRED] 免批动态增援名额（${usedSeats}/${maxSeats}）已用满 · 待统帅在聊天流拍板确认（严禁调用 \`ask_question\` 弹窗！）**`,
            "当前步骤产物已 100% 安全落盘保存，零进度损失。请直接在普通对话中向用户展示下方申请单并结束本轮：",
            ...pendingApprovalLines,
            "",
            `- 回复 **「批准」**：调用 \`vetoboard_update_council({ taskId: "${currentTask.taskId}", approvePendingPeerRoles: true })\` 原地热插续跑（已完成步骤零重跑）；`,
            `- 回复 **「驳回」**：调用 \`vetoboard_update_council({ taskId: "${currentTask.taskId}", rejectPendingPeerRoles: true })\` 按当前原阵容继续推进。`,
          ].join("\n")
        : [
            `⏸ **[PEER_ROLE_APPROVAL_REQUIRED] Auto-Approve Dynamic Peer Quota (${usedSeats}/${maxSeats}) Reached — Ask User in Plain Chat (Do NOT call \`ask_question\`!)**`,
            "Current step output is safely saved with zero progress loss. Present the pending request(s) below in chat and end your turn:",
            ...pendingApprovalLines,
            "",
            `- On **"Approve"**: call \`vetoboard_update_council({ taskId: "${currentTask.taskId}", approvePendingPeerRoles: true })\` to hot-insert & resume (zero re-runs);`,
            `- On **"Reject"**: call \`vetoboard_update_council({ taskId: "${currentTask.taskId}", rejectPendingPeerRoles: true })\` to continue with the existing lineup.`,
          ].join("\n"),
    );
  }

  return {
    pausedForPeerApproval,
    peerNoticeMarkdown: notices.length > 0 ? `\n\n${notices.join("\n\n")}` : "",
    task: currentTask,
  };
}

export function createVetoBoardMcpServer(options?: CreateVetoBoardMcpServerOptions): McpServer {
  const store = options?.store ?? new VetoBoardTaskStore();
  const defaultLang = options?.defaultLocale ?? "auto";
  const server = new McpServer(
    {
      name: "vetoboard-mcp",
      version: options?.version ?? CURRENT_VETOBOARD_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // 1. Deterministic Quantitative & Reconciliation Engine (0 LLM tokens)
  server.registerTool(
    "vetoboard_calc",
    {
      description:
        "Zero-hallucination deterministic math, unit-economics (BEP/margin/sensitivity), weighted_score ranking, and independent inspector 'reconcile' engine. Always use this instead of mental math.",
      inputSchema: z.object({
        checks: z
          .array(
            z.object({
              claimedValue: z.number(),
              formula: z.string(),
              label: z.string(),
              unit: z.string().optional(),
              variables: z.record(z.string(), z.number()).optional(),
            }),
          )
          .optional(),
        costDeltasPct: z.array(z.number()).optional(),
        criteria: z
          .array(
            z.object({
              id: z.string(),
              name: z.string().optional(),
              weight: z.number(),
            }),
          )
          .optional(),
        expressions: z
          .array(
            z.object({
              formula: z.string(),
              name: z.string(),
              unit: z.string().optional(),
            }),
          )
          .optional(),
        fixedCostAnnual: z.number().optional(),
        lang: vetoboardLocaleInputSchema,
        mode: z.enum(["expression", "unit_economics", "weighted_score", "reconcile"]),
        options: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              scores: z.record(z.string(), z.number()),
            }),
          )
          .optional(),
        priceDeltasPct: z.array(z.number()).optional(),
        taskId: z
          .string()
          .optional()
          .describe("Optional council taskId to record verified calculation metrics in the VetoBoard Audit Seal."),
        tolerancePct: z.number().optional(),
        unitCogs: z.number().optional(),
        unitLabel: z.string().optional(),
        unitPrice: z.number().optional(),
        unitVariableExtra: z.number().optional(),
        variableRatePct: z.number().optional(),
        variables: z.record(z.string(), z.number()).optional(),
        volumes: z.array(z.number()).optional(),
      }),
      title: "VetoBoard Deterministic Math & Reconcile",
    },
    async (args) => {
      const locale = resolveLocale(args.lang === "auto" ? defaultLang : args.lang, args.unitLabel);
      let result;
      if (args.mode === "expression") {
        result = runQuantitativeCalc(
          {
            expressions: args.expressions ?? [],
            mode: "expression",
            ...(args.variables ? { variables: args.variables } : {}),
          },
          locale,
        );
      } else if (args.mode === "unit_economics") {
        result = runQuantitativeCalc(
          {
            fixedCostAnnual: args.fixedCostAnnual ?? 0,
            mode: "unit_economics",
            unitCogs: args.unitCogs ?? 0,
            unitPrice: args.unitPrice ?? 0,
            ...(args.variableRatePct !== undefined ? { variableRatePct: args.variableRatePct } : {}),
            ...(args.unitVariableExtra !== undefined ? { unitVariableExtra: args.unitVariableExtra } : {}),
            ...(args.unitLabel ? { unitLabel: args.unitLabel } : {}),
            ...(args.volumes ? { volumes: args.volumes } : {}),
            ...(args.priceDeltasPct ? { priceDeltasPct: args.priceDeltasPct } : {}),
            ...(args.costDeltasPct ? { costDeltasPct: args.costDeltasPct } : {}),
          },
          locale,
        );
      } else if (args.mode === "weighted_score") {
        result = runQuantitativeCalc(
          {
            criteria: args.criteria ?? [],
            mode: "weighted_score",
            options: args.options ?? [],
          },
          locale,
        );
      } else {
        result = runQuantitativeCalc(
          {
            checks: args.checks ?? [],
            mode: "reconcile",
            ...(args.tolerancePct !== undefined ? { tolerancePct: args.tolerancePct } : {}),
            ...(args.variables ? { variables: args.variables } : {}),
          },
          locale,
        );
      }
      if (args.taskId) {
        await store
          .mutateTaskSerial(args.taskId, async () => {
            const existingTask = await store.getTask(args.taskId!);
            if (!existingTask) return;
            const delta =
              args.mode === "reconcile"
                ? Math.max(1, args.checks?.length ?? 1)
                : args.mode === "expression"
                  ? Math.max(1, args.expressions?.length ?? 1)
                  : args.mode === "weighted_score"
                    ? Math.max(1, args.options?.length ?? 1)
                    : 4;
            await store.saveTask({
              ...existingTask,
              calcChecksVerifiedCount: (existingTask.calcChecksVerifiedCount ?? 0) + delta,
            });
          })
          .catch(() => undefined);
      }
      return textResult(JSON.stringify(result, null, 2), !result.ok);
    },
  );

  // 2. Diverge-Then-Converge Route Matrix & Concrete Category Anchor
  server.registerTool(
    "vetoboard_clarify_routes",
    {
      description:
        "Diverge-then-converge strategic pre-flight: generates 4 differentiated candidate routes (buyer logic, entry barrier, compliance redline) for open-ended goals without locking prematurely, and anchors concrete target categories.",
      inputSchema: z.object({
        constraints: z.array(z.string()).optional(),
        expectedOutcome: z.string().optional(),
        goal: z.string().min(1),
        lang: vetoboardLocaleInputSchema,
      }),
      title: "VetoBoard Diverge-Then-Converge Route Clarifier",
    },
    async (args) => {
      const locale = resolveLocale(args.lang === "auto" ? defaultLang : args.lang, args.goal);
      const plan = buildDivergeConvergeClarification({
        constraints: args.constraints,
        expectedOutcome: args.expectedOutcome,
        goal: args.goal,
        locale,
      });
      return textResult(JSON.stringify(plan, null, 2));
    },
  );

  // 3. Weighted Role Charters & Starter Asset Pack Inspector
  server.registerTool(
    "vetoboard_get_role_charter",
    {
      description:
        "Fetch weighted specialist & adversarial inspector role charters (Primary 95 / Guardrail 85 / Support 75 / 7-Gate SWE) in English or Chinese.",
      inputSchema: z.object({
        lang: vetoboardLocaleInputSchema,
        roleId: z
          .string()
          .optional()
          .describe("Optional roleId (e.g. 'market-analyst', 'profit-modeler', 'legal-advisor', 'tech-feasibility', 'software-architect', 'quality-inspector'). Omit to list all."),
      }),
      title: "VetoBoard Weighted Role Charter",
    },
    async (args) => {
      const locale = resolveLocale(args.lang === "auto" ? defaultLang : args.lang);
      if (!args.roleId) {
        const list = BUILTIN_ROLE_TEMPLATES.map((r) => ({
          domain: r.domain,
          kind: r.kind,
          name: r.name[locale],
          priorityTier: r.priorityTier,
          roleId: r.roleId,
          weight: r.weight,
        }));
        return textResult(JSON.stringify({ locale, roles: list }, null, 2));
      }
      const found = findRoleTemplate(args.roleId);
      if (!found) {
        return textResult(`Unknown roleId: "${args.roleId}"`, true);
      }
      return textResult(renderRoleCharterPrompt(found, locale));
    },
  );

  // 4. Lossless Structured Memorial Card Compressor (0 LLM tokens)
  server.registerTool(
    "vetoboard_compress_memorial",
    {
      description:
        "Compress long upstream markdown reports (15k-40k+ chars) by 75%-90% at 0 token cost into a <workflow_memorial_card> preserving all section Read(offset, limit) coordinates, table schemas, and key numbers/redlines.",
      inputSchema: z.object({
        detailTier: z.enum(["direct", "compact"]).default("direct"),
        label: z.string().min(1),
        lang: vetoboardLocaleInputSchema,
        markdown: z.string().min(1),
        readableFilePath: z.string().optional(),
        relativePath: z.string().default("artifacts/step.md"),
      }),
      title: "VetoBoard Structured Memorial Compressor",
    },
    async (args) => {
      const locale = resolveLocale(args.lang === "auto" ? defaultLang : args.lang, args.markdown);
      const card = buildArtifactMemorialCard({
        detailTier: args.detailTier,
        label: args.label,
        locale,
        markdown: args.markdown,
        readableFilePath: args.readableFilePath,
        relativePath: args.relativePath,
      });
      return textResult(card);
    },
  );

  // 5. Code-Level Rule Gate & Optional Heterogeneous External Audit (`git diff` or deliverable)
  server.registerTool(
    "vetoboard_audit_output",
    {
      description:
        "Audit a code diff or specialist deliverable against deterministic ExecutableRules, premise-reversal guards, and (when BYOK/Cloud is configured) a cross-model adversarial inspector.",
      inputSchema: z.object({
        apiBaseUrl: z.string().optional(),
        apiKey: z.string().optional(),
        executionMode: z.enum(["host-subscription", "byok", "cloud-pool"]).optional(),
        goal: z.string().min(1),
        invokedSkills: z.array(z.string()).optional(),
        invokedTools: z.array(z.string()).optional(),
        lang: vetoboardLocaleInputSchema,
        modelId: z.string().optional(),
        outputText: z.string().min(1),
        roleId: z.string().optional(),
        rules: z.array(executableRuleSchema).optional(),
        taskId: z.string().optional().describe("Optional active taskId to automatically inherit the track's bound modelBinding."),
        trackId: z.string().optional().describe("Optional trackId within taskId whose modelBinding should be used."),
      }),
      title: "VetoBoard Deterministic & Heterogeneous Auditor",
    },
    async (args) => {
      const locale = resolveLocale(
        args.lang === "auto" ? defaultLang : args.lang,
        `${args.goal}\n${args.outputText.slice(0, 400)}`,
      );
      let boundRoleModel: RoleModelBinding | undefined;
      if (args.taskId) {
        const linkedTask = await store.getTask(args.taskId);
        const matchedTrack = linkedTask?.tracks.find(
          (tItem) =>
            (args.trackId && tItem.trackId === args.trackId) ||
            (args.roleId && tItem.roleId === args.roleId),
        );
        boundRoleModel = matchedTrack?.modelBinding;
      }
      if (!boundRoleModel && args.roleId) {
        boundRoleModel = findRoleTemplate(args.roleId)?.modelBinding;
      }
      const roleRules = args.roleId ? (findRoleTemplate(args.roleId)?.executableRules ?? []) : [];
      const combinedRules = [...roleRules, ...(args.rules ?? [])];

      const gate = evaluateRuleGate({
        invokedSkills: args.invokedSkills,
        invokedTools: args.invokedTools,
        locale,
        outputText: args.outputText,
        rules: combinedRules,
      });
      const premiseReversed = detectPremiseReversal(args.goal, args.outputText);

      const effectiveExecMode =
        args.executionMode ??
        (boundRoleModel?.kind === "byok" || boundRoleModel?.kind === "cloud-pool"
          ? boundRoleModel.kind
          : undefined);
      const extConfig = resolveExternalModelConfig(effectiveExecMode, {
        apiBaseUrl: args.apiBaseUrl ?? boundRoleModel?.apiBaseUrl,
        apiKey: args.apiKey,
        modelId: args.modelId ?? boundRoleModel?.modelId,
      });

      let externalCritique: { model?: string; verdict?: string; error?: string } | undefined;
      if (extConfig.mode === "byok" || extConfig.mode === "cloud-pool") {
        const inspector = findRoleTemplate("quality-inspector")!;
        const sys = renderRoleCharterPrompt(inspector, locale);
        const usr =
          locale === "zh"
            ? `【用户原始目标】：\n${args.goal}\n\n【待审查变更 / 报告正文】：\n${args.outputText}`
            : `[Original Goal]:\n${args.goal}\n\n[Deliverable / Git Diff to Audit]:\n${args.outputText}`;
        const completion = await runExternalChatCompletion({
          config: extConfig,
          systemPrompt: sys,
          userPrompt: usr,
        });
        externalCritique = completion.ok
          ? { model: completion.model, verdict: completion.content }
          : { error: completion.error };
      }

      const payload = {
        executionMode: extConfig.mode,
        ...(externalCritique ? { externalCritique } : {}),
        locale,
        needsUserDecision: gate.needsUserDecision || premiseReversed,
        passed: gate.passed && !premiseReversed,
        premiseReversed,
        ruleGate: gate,
      };
      return textResult(JSON.stringify(payload, null, 2), !payload.passed);
    },
  );

  // 5b. Pre-Flight Smart Lineup, Native Skill Radar & Interactive Role/Skill Selector
  server.registerTool(
    "vetoboard_plan_lineup",
    {
      description:
        "Scan native skills across the host IDE & workspace, auto-tune Primary Lead weights for the goal, and emit 3 interactive ask_question cards (1: Primary Leads, 2: Active Roles + Spawn New Specialist Roles from Native Skills, 3: Skill Mounting per Role).",
      inputSchema: z.object({
        activeHostModel: z
          .string()
          .optional()
          .describe(
            "Optional ID or display name of the model running the current host conversation (e.g. 'Gemini 4 Carbon' or 'gemini-4-carbon-high') so VetoBoard marks ★active and prioritizes it among same-family peers.",
          ),
        customRoles: z
          .array(customRoleInputSchema)
          .optional()
          .describe(
            "Optional topic-tailored specialist roles designed for open-domain / non-standard goals (e.g. socio-economic mobility, policy, academic research, medical/scientific inquiry, or career decisions). Pass `roleIds: []` alongside `customRoles` when built-in startup/SWE roles do not fit the topic!",
          ),
        domain: z.enum(["commercial", "swe"]).default("commercial"),
        extraSkillDirs: z.array(z.string()).optional(),
        goal: z.string().min(1),
        hostModels: z
          .array(hostModelCandidateSchema)
          .optional()
          .describe(
            "COMPLETE list of models available on the current host platform (NEVER cherry-pick or omit models! Or pass the verbatim JSON output from `swarm(action='models', all=true)` in `rawHostModelsJson`).",
          ),
        hostPlatform: z
          .string()
          .optional()
          .describe("Optional host IDE identifier e.g. 'antigravity', 'claude-code', 'codex', 't3code', 'hermes', 'cursor'."),
        hostSkills: z
          .array(
            z.object({
              description: z.string(),
              filePath: z.string().optional(),
              name: z.string(),
            }),
          )
          .optional(),
        lang: vetoboardLocaleInputSchema,
        rawHostModelsJson: z
          .string()
          .optional()
          .describe(
            "Verbatim JSON string returned by the host's model-discovery tool (e.g. Antigravity `swarm({ action: 'models', all: true })` or `/v1/models`) so 100% of model families & quotas are parsed and grouped automatically with zero omission.",
          ),
        roleIds: z
          .array(z.string())
          .optional()
          .describe(
            "Optional explicit built-in `roleIds` subset (pass `[]` together with `customRoles` to build a 100% custom topic-specific council).",
          ),
        workspaceDir: z.string().optional(),
      }),
      title: "VetoBoard Pre-Flight Role, Model & Native Skill Bench",
    },
    async (args) => {
      const locale: VetoBoardLocale = resolveLocale(
        args.lang === "auto" ? defaultLang : args.lang,
        args.goal,
      );
      const retrieved = await retrieveReusableAssets({
        dataRootDir: store.rootDir,
        domain: args.domain,
        extraSkillDirs: args.extraSkillDirs,
        goal: args.goal,
        hostSkills: args.hostSkills,
        locale,
        workspaceDir: args.workspaceDir,
      });
      const plan = buildLineupSelectorPlan({
        activeHostModel: args.activeHostModel,
        customRoles: args.customRoles,
        discoveredSkills: retrieved.skills,
        domain: args.domain,
        goal: args.goal,
        hostModels: args.hostModels,
        hostPlatform: args.hostPlatform,
        locale,
        rawHostModelsJson: args.rawHostModelsJson,
        roleIds: args.roleIds,
      });
      const briefingMarkdown = renderConversationalPreflightBriefing({
        activeHostModel: args.activeHostModel,
        goal: args.goal,
        hostModels: plan.availableHostModels,
        hostPlatform: args.hostPlatform,
        locale,
        rationale: plan.rationale,
        recommendedLineup: plan.recommendedLineup,
        retrieved,
      });
      return textResult(
        JSON.stringify(
          {
            ...plan,
            briefingMarkdown,
            matchedKnowledge: retrieved.knowledge.map((k) => ({
              knowledgeId: k.card.knowledgeId,
              relevanceScore: k.relevanceScore,
              reportPath: k.card.reportPath,
              title: k.card.title,
            })),
            reusableKnowledgeCount: retrieved.knowledge.length,
            reusableRolesCount: retrieved.roles.length,
          },
          null,
          2,
        ),
      );
    },
  );

  // 6. Start Isolated Multi-Role Council Task (Unskippable Role/Skill Bench Gate + Native Skill Synthesis + Docker-Build Progress)
  server.registerTool(
    "vetoboard_start_council",
    {
      description:
        "Initialize a session-isolated multi-role council task. By default (`lineupConfirmed=false`), returns an interactive Role + Native-Skill Selection Bench so the user can choose Primary Leads, active roles, and native-skill specialists via `ask_question` before execution starts. Pass `lineupConfirmed=true` once confirmed.",
      inputSchema: z.object({
        allowOfflineAssumptions: z
          .boolean()
          .default(false)
          .describe(
            "Default false (ALL domains must verify live primary web sources first). Set true ONLY for air-gapped offline environments.",
          ),
        autoTuneWeights: z
          .boolean()
          .default(true)
          .describe(
            "Automatically promote domain-critical roles (e.g. Legal/Compliance or Profit Actuary) to Primary Lead based on goal risk signals when primaryRoleIds is not explicitly set.",
          ),
        confirmedNotes: z.string().optional(),
        customRoles: z
          .array(customRoleInputSchema)
          .optional()
          .describe("Ad-hoc custom specialist roles injected by the user (e.g. 'Cross-Border Tax Advisor' W90)."),
        domain: z.enum(["commercial", "swe"]).default("commercial"),
        effortProfile: effortProfileSchema,
        enableCrossDebate: z
          .boolean()
          .default(false)
          .describe(
            "When true, inserts a Wave 2 Cross-Role Adversarial Clash track ('cross-examiner') between Wave 1 independent proposals and Wave 3 final inspector so conflicting role assumptions confront and revise each other directly.",
          ),
        enforceHardSkillGate: z.boolean().default(false),
        excludeKnowledgeIds: z
          .array(z.string())
          .optional()
          .describe("Knowledge Card IDs to exclude from automatic baseline mounting."),
        excludeRoleIds: z
          .array(z.string())
          .optional()
          .describe("Built-in roleIds to exclude (e.g. ['tech-feasibility'])."),
        executionMode: executionModeSchema,
        extraSkillDirs: z.array(z.string()).optional(),
        globalSkillIds: z
          .array(z.string())
          .optional()
          .describe("Skill IDs discovered by Native Skill Radar to mount across council tracks."),
        goal: z.string().min(1),
        hostSkills: z
          .array(
            z.object({
              description: z.string(),
              filePath: z.string().optional(),
              name: z.string(),
            }),
          )
          .optional(),
        includeInspector: z.boolean().default(true),
        lang: vetoboardLocaleInputSchema,
        lineupConfirmed: z
          .boolean()
          .default(false)
          .describe(
            "Set to true ONLY AFTER the user has reviewed/answered the Role & Native-Skill Selection card (or explicitly asked to skip selection and run immediately).",
          ),
        maxDynamicPeerRoles: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe(
            "Max auto-approved dynamic peer specialist seats before pausing for user confirmation (default 2).",
          ),
        mountKnowledge: z
          .boolean()
          .default(true)
          .describe("Automatically mount relevant verified Knowledge Cards from previous completed tasks/phases."),
        modelOverrides: z
          .record(z.string(), z.union([z.string(), roleModelBindingSchema]))
          .optional()
          .describe(
            "Per-role model bindings keyed by roleId (e.g. { 'profit-modeler': 'pro', 'tech-feasibility': 'flash', 'quality-inspector': 'deepseek/deepseek-reasoner' }).",
          ),
        primaryRoleIds: z
          .array(z.string())
          .optional()
          .describe(
            "Explicit roleIds chosen as Primary Lead (e.g. ['legal-advisor', 'profit-modeler']). Non-selected default primaries step down to guardrail.",
          ),
        roleIds: z
          .array(z.string())
          .optional()
          .describe("Explicit ordered subset of specialist roleIds (supports 'spawn:<skillId>' items too)."),
        roleSkillBindings: z
          .record(z.string(), z.array(z.string()))
          .optional()
          .describe("Explicit map of roleId -> skillIds to mount onto each role."),
        selectedRouteIds: z.array(z.string()).optional(),
        sessionId: z.string().optional(),
        spawnRoleFromSkillIds: z
          .array(z.string())
          .optional()
          .describe(
            "Native skill IDs (e.g. ['generative_ui', 'mcp-app-development']) to dynamically synthesize into standalone Specialist Roles!",
          ),
        tierOverrides: z.record(z.string(), rolePriorityTierSchema).optional(),
        topologyMode: z
          .enum(["whiteboard-electre", "deliberate-then-parallel", "causal-dag", "flat"])
          .default("whiteboard-electre")
          .describe(
            "Execution mode: 'whiteboard-electre' (default: Concurrent Whiteboard Prep -> ELECTRE+QMV Mathematical Dominance & Dynamic Dimension Consultation -> 100% Parallel Finalize -> [V1] Audit & Knowledge Save), 'deliberate-then-parallel', 'causal-dag', or 'flat'.",
          ),
        weightOverrides: z
          .record(z.string(), z.number().int().min(10).max(100))
          .optional()
          .describe("Explicit 10-100 authority weight overrides keyed by roleId."),
        weightPresetOrCustomText: z
          .string()
          .optional()
          .describe(
            "Answer from q_role_weights: either a preset ID ('__weight_single_99__', '__weight_finance_98__', '__weight_compliance_98__', '__weight_equal_90__') or free-text custom weights like '精算=98, automation=92, 市场=70'.",
          ),
        workspaceDir: z.string().optional(),
      }),
      title: "VetoBoard Start Multi-Role Council",
    },
    async (args) => {
      const locale: VetoBoardLocale = resolveLocale(
        args.lang === "auto" ? defaultLang : args.lang,
        args.goal,
      );
      const zh = locale === "zh";
      const retrieved = await retrieveReusableAssets({
        dataRootDir: store.rootDir,
        domain: args.domain,
        extraSkillDirs: args.extraSkillDirs,
        goal: args.goal,
        hostSkills: args.hostSkills,
        locale,
        workspaceDir: args.workspaceDir,
      });
      const discoveredSkills = retrieved.skills;

      const hasExplicitUserCustomization =
        Boolean(args.primaryRoleIds?.length) ||
        Boolean(args.roleIds?.length) ||
        Boolean(args.excludeRoleIds?.length) ||
        Boolean(args.customRoles?.length) ||
        Boolean(args.spawnRoleFromSkillIds?.length) ||
        Boolean(args.roleSkillBindings) ||
        Boolean(args.globalSkillIds?.length) ||
        Boolean(args.weightOverrides) ||
        Boolean(args.weightPresetOrCustomText);

      // Pre-Flight Preparation Gate: Retrieve reusable roles/skills, explain recommended scores in chat, and confirm naturally!
      if (!args.lineupConfirmed && !hasExplicitUserCustomization) {
        const plan = buildLineupSelectorPlan({
          discoveredSkills,
          domain: args.domain,
          goal: args.goal,
          locale,
        });
        const briefingMd = renderConversationalPreflightBriefing({
          goal: args.goal,
          locale,
          rationale: plan.rationale,
          recommendedLineup: plan.recommendedLineup,
          retrieved,
        });
        const gateHeader = zh
          ? [
              "⏸ **[PREFLIGHT_BENCH_CONFIRMATION_REQUIRED] 战前资产库检索已完成（请直接在聊天流输出下方准备单，严禁调用 ask_question 弹窗！）**",
              "重要指令：调用 `ask_question` 会遮挡正文表格导致用户看不到检索结果与打分解释！请**直接将下方《VetoBoard 战前检索与推荐阵容准备单》原样输出为普通聊天回复并结束本轮**，等待用户用自然语言回复确认或微调分数后再携带 `\"lineupConfirmed\": true` 调用 `vetoboard_start_council`。",
              "",
              briefingMd,
            ]
          : [
              "⏸ **[PREFLIGHT_BENCH_CONFIRMATION_REQUIRED] Pre-Flight Asset Retrieval Complete (Output in Chat — Do NOT call ask_question!)**",
              "IMPORTANT: Calling `ask_question` hides prose tables! Output the Pre-Flight Briefing below **directly as your normal chat message and end your turn** so the user can read the retrieved roles/skills & score rationale and reply in plain conversation.",
              "",
              briefingMd,
            ];
        return textResult(gateHeader.join("\n"));
      }

      const clarify = buildDivergeConvergeClarification({ goal: args.goal, locale });
      const now = new Date().toISOString();
      const taskId = `vb_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;

      // Specific selected roles ALWAYS win even if an umbrella option was left checked!
      const cleanPrimaryIds = args.primaryRoleIds?.filter((id) => !id.startsWith("__"));
      const rawRoleSelections = args.roleIds?.filter((id) => !id.startsWith("__"));
      const spawnFromRoleSelections = (rawRoleSelections ?? [])
        .filter((id) => id.toLowerCase().startsWith("spawn:"))
        .map((id) => id.slice(6));
      const keptBuiltinRoleIds = rawRoleSelections?.filter(
        (id) => !id.toLowerCase().startsWith("spawn:"),
      );
      const cleanGlobalSkills = args.globalSkillIds?.filter((id) => !id.startsWith("__"));

      // Merge weight presets & free-text custom weights ("精算=98, automation=92")
      const mergedWeightOverrides: Record<string, number> = { ...(args.weightOverrides ?? {}) };
      const allCandidateRoleRefs = [
        ...retrieved.roles.map((r) => ({ roleId: r.role.roleId, title: r.role.name[locale] })),
        ...discoveredSkills.map((s) => ({ roleId: `skill-${s.skillId}`, title: s.name })),
      ];
      const presetRaw = args.weightPresetOrCustomText?.trim();
      if (presetRaw) {
        if (presetRaw === WEIGHT_PRESET_FINANCE_FIRST || presetRaw.includes("财务/ROI")) {
          for (const r of allCandidateRoleRefs) mergedWeightOverrides[r.roleId] = 82;
          mergedWeightOverrides["profit-modeler"] = 98;
        } else if (presetRaw === WEIGHT_PRESET_COMPLIANCE_FIRST || presetRaw.includes("法务合规")) {
          for (const r of allCandidateRoleRefs) mergedWeightOverrides[r.roleId] = 82;
          mergedWeightOverrides["legal-advisor"] = 98;
        } else if (presetRaw === WEIGHT_PRESET_EQUAL || presetRaw.includes("全员平权")) {
          for (const r of allCandidateRoleRefs) mergedWeightOverrides[r.roleId] = 90;
        } else if (presetRaw === WEIGHT_PRESET_SINGLE_DICTATOR || presetRaw.includes("强主裁一票制")) {
          const topLead = cleanPrimaryIds?.[0] ?? "profit-modeler";
          for (const r of allCandidateRoleRefs) mergedWeightOverrides[r.roleId] = 75;
          mergedWeightOverrides[topLead] = 99;
        } else {
          Object.assign(
            mergedWeightOverrides,
            parseCustomWeightText(presetRaw, allCandidateRoleRefs),
          );
        }
      }
      if (args.confirmedNotes) {
        Object.assign(
          mergedWeightOverrides,
          parseCustomWeightText(args.confirmedNotes, allCandidateRoleRefs),
        );
      }

      const mergedModelOverrides: Record<string, string | RoleModelBinding> = {
        ...parseNaturalLanguageModelOverrides(args.confirmedNotes),
        ...(args.modelOverrides ?? {}),
      };

      const lineup = resolveCouncilLineup({
        autoTuneWeights: args.autoTuneWeights,
        customRoles: args.customRoles,
        discoveredSkills,
        domain: args.domain,
        enforceHardSkillGate: args.enforceHardSkillGate,
        excludeRoleIds: args.excludeRoleIds,
        globalSkillIds: cleanGlobalSkills,
        goal: args.goal,
        includeInspector: args.includeInspector,
        locale,
        modelOverrides:
          Object.keys(mergedModelOverrides).length > 0 ? mergedModelOverrides : undefined,
        primaryRoleIds: cleanPrimaryIds && cleanPrimaryIds.length > 0 ? cleanPrimaryIds : undefined,
        reusableRoles: retrieved.roles.map((r) => r.role),
        roleIds:
          keptBuiltinRoleIds && keptBuiltinRoleIds.length > 0
            ? keptBuiltinRoleIds
            : args.roleIds !== undefined &&
                !args.roleIds.includes("__default_full_lineup__") &&
                spawnFromRoleSelections.length > 0
              ? []
              : undefined,
        roleSkillBindings: args.roleSkillBindings,
        spawnRoleFromSkillIds: [
          ...(args.spawnRoleFromSkillIds ?? []),
          ...spawnFromRoleSelections,
        ],
        tierOverrides: args.tierOverrides,
        weightOverrides:
          Object.keys(mergedWeightOverrides).length > 0 ? mergedWeightOverrides : undefined,
      });

      // Automatically persist any newly hatched skill-roles or user custom roles into `~/.vetoboard-mcp/library/roles/` for future reuse!
      for (const r of lineup.roles) {
        if (
          r.kind !== "inspector" &&
          !findRoleTemplate(r.roleId) &&
          !DYNAMIC_TOPIC_ARCHETYPE_ROLE_IDS.has(r.roleId)
        ) {
          await persistRoleToLibrary(
            store.rootDir,
            r,
            lineup.boundSkillsByRoleId[r.roleId] ?? [],
          ).catch(() => undefined);
        }
      }

      const selectedRoles = lineup.roles;
      const roleByTrackId = new Map<string, RoleTemplate>();
      const maxRetries = args.effortProfile === "deep" ? 3 : 1;
      const crossDebateRequested =
        args.enableCrossDebate === true ||
        /(?:角色交锋|开启交锋|交叉质询|辩论模式|互撕|正面交锋|cross[- ]?debate|adversarial\s+clash)/iu.test(
          `${args.confirmedNotes ?? ""} ${args.weightPresetOrCustomText ?? ""}`,
        );
      const hasExplicitPrimary = Boolean(cleanPrimaryIds && cleanPrimaryIds.length > 0);
      const isWhiteboard = args.topologyMode === "whiteboard-electre";
      const isDeliberateThenParallel = args.topologyMode === "deliberate-then-parallel";
      const isParallelStage = isWhiteboard || isDeliberateThenParallel;
      const useCausalDag = args.topologyMode === "causal-dag";

      // Resolve Knowledge Cards to mount automatically (unless opted out)
      const optOutKnowledge =
        args.mountKnowledge === false ||
        /(?:不挂.*知识|不用.*知识|忽略.*旧知识|全新重算|no\s+knowledge|without.*knowledge|ignore\s+kb)/iu.test(
          `${args.confirmedNotes ?? ""}`,
        );
      const excludeKbSet = new Set(
        (args.excludeKnowledgeIds ?? []).map((x) => x.trim().toLowerCase()),
      );
      const mountedKnowledgeCards = optOutKnowledge
        ? []
        : retrieved.knowledge
            .filter((k) => !excludeKbSet.has(k.card.knowledgeId.toLowerCase()))
            .map((k) => k.card);
      const mountedKnowledgeMarkdown = formatMountedKnowledgeForPrompt(
        mountedKnowledgeCards,
        locale,
      );

      const specialistRoles = selectedRoles.filter((r) => r.kind !== "inspector");
      const inspectorRole = selectedRoles.find((r) => r.kind === "inspector");

      interface ScheduledSpecialist {
        readonly role: RoleTemplate;
        readonly wave: number;
        readonly isTerminal: boolean;
      }
      const scheduledSpecialists: ScheduledSpecialist[] = [];

      if (isParallelStage || !useCausalDag || specialistRoles.length <= 1) {
        // Default: ALL specialists run in Wave 1 (100% Parallel Prep & Parallel Finalization!)
        const terminalRoleId =
          specialistRoles.find((r) => r.roleId === "profit-modeler")?.roleId ??
          specialistRoles[0]?.roleId;
        specialistRoles.forEach((role) => {
          scheduledSpecialists.push({
            isTerminal: role.roleId === terminalRoleId && !crossDebateRequested,
            role,
            wave: 1,
          });
        });
      } else if (specialistRoles.length === 2) {
        scheduledSpecialists.push({ isTerminal: false, role: specialistRoles[0]!, wave: 1 });
        scheduledSpecialists.push({
          isTerminal: !crossDebateRequested,
          role: specialistRoles[1]!,
          wave: 2,
        });
      } else {
        const hasMarket = specialistRoles.some((r) => r.roleId === "market-analyst");
        const hasProfit = specialistRoles.some((r) => r.roleId === "profit-modeler");
        let wave1Role: RoleTemplate;
        let wave3Role: RoleTemplate;

        if (!hasExplicitPrimary && args.domain === "commercial" && hasMarket && hasProfit) {
          wave1Role = specialistRoles.find((r) => r.roleId === "market-analyst")!;
          wave3Role = specialistRoles.find((r) => r.roleId === "profit-modeler")!;
        } else {
          wave1Role = specialistRoles[0]!;
          const profitCandidate = specialistRoles.find(
            (r) => r.roleId === "profit-modeler" && r.roleId !== wave1Role.roleId,
          );
          wave3Role = profitCandidate ?? specialistRoles.at(-1)!;
        }

        const wave2Roles = specialistRoles.filter(
          (r) => r.roleId !== wave1Role.roleId && r.roleId !== wave3Role.roleId,
        );
        scheduledSpecialists.push({ isTerminal: false, role: wave1Role, wave: 1 });
        for (const r2 of wave2Roles) {
          scheduledSpecialists.push({ isTerminal: false, role: r2, wave: 2 });
        }
        scheduledSpecialists.push({
          isTerminal: !crossDebateRequested,
          role: wave3Role,
          wave: 3,
        });
      }

      if (!isParallelStage && crossDebateRequested && specialistRoles.length >= 2) {
        const maxSpecWave = Math.max(...scheduledSpecialists.map((s) => s.wave));
        scheduledSpecialists.push({
          isTerminal: true,
          role: { ...CROSS_EXAMINER_ROLE_TEMPLATE },
          wave: useCausalDag ? maxSpecWave + 1 : 2,
        });
      }

      const rawTracks: VetoBoardTaskRecord["tracks"] = scheduledSpecialists.map((item, idx) => {
        const { role, wave, isTerminal } = item;
        const trackId = `track-${idx + 1}-${role.roleId}`;
        roleByTrackId.set(trackId, role);
        const tierLabel = resolveTierLabel(role, locale);
        const boundSkillIds = [...(lineup.boundSkillsByRoleId[role.roleId] ?? [])];
        const needsSavedCharter =
          !findRoleTemplate(role.roleId) ||
          boundSkillIds.length > 0 ||
          Boolean(mountedKnowledgeMarkdown);
        const charterWithKb = [
          renderRoleCharterPrompt(role, locale),
          ...(mountedKnowledgeMarkdown ? ["", mountedKnowledgeMarkdown] : []),
        ].join("\n");
        return {
          boundSkillIds,
          catches: [],
          ...(needsSavedCharter ? { customCharter: charterWithKb } : {}),
          ...(needsSavedCharter && role.executableRules.length > 0
            ? { customRules: [...role.executableRules] }
            : {}),
          dependsOn: [],
          durationMs: 0,
          ...(isTerminal ? { isTerminal: true } : {}),
          maxRetries,
          ...(role.modelBinding ? { modelBinding: role.modelBinding } : {}),
          retryCount: 0,
          roleId: role.roleId,
          roleLabel: role.name[locale],
          ...(wave === 1 ? { startedAt: now } : {}),
          status: wave === 1 ? ("running" as const) : ("pending" as const),
          tierLabel,
          title: role.name[locale],
          trackId,
          wave,
          weight: role.weight,
        };
      });

      const maxSpecialistWave =
        rawTracks.length > 0 ? Math.max(...rawTracks.map((tItem) => tItem.wave)) : 0;

      if (inspectorRole) {
        const inspTrackId = `track-${rawTracks.length + 1}-${inspectorRole.roleId}`;
        roleByTrackId.set(inspTrackId, inspectorRole);
        const inspWave = maxSpecialistWave + 1;
        rawTracks.push({
          boundSkillIds: [],
          catches: [],
          dependsOn: [],
          durationMs: 0,
          maxRetries,
          ...(inspectorRole.modelBinding ? { modelBinding: inspectorRole.modelBinding } : {}),
          retryCount: 0,
          roleId: inspectorRole.roleId,
          roleLabel: inspectorRole.name[locale],
          ...(inspWave === 1 ? { startedAt: now } : {}),
          status: inspWave === 1 ? ("running" as const) : ("pending" as const),
          tierLabel: resolveTierLabel(inspectorRole, locale),
          title: inspectorRole.name[locale],
          trackId: inspTrackId,
          wave: inspWave,
          weight: inspectorRole.weight,
        });
      }

      const tracks: VetoBoardTaskRecord["tracks"] = rawTracks.map((tr) => ({
        ...tr,
        dependsOn: rawTracks.filter((u) => u.wave < tr.wave).map((u) => u.trackId),
      }));

      const totalWaves = Math.max(...tracks.map((tItem) => tItem.wave));
      const lineupRationale = [...lineup.rationale];
      if (isWhiteboard && specialistRoles.length >= 2) {
        lineupRationale.push(
          zh
            ? "已启用动态共享白板 + ELECTRE/QMV 数学支配引擎（D≥60%/65% · C≥66.7% · 席位≥50% · R≤2 零变化早停）"
            : "Enabled Dynamic Shared Whiteboard & ELECTRE/QMV Engine (D>=60%/65%, C>=66.7%, Seats>=50%, R<=2 Early Stop)",
        );
      } else if (isDeliberateThenParallel && specialistRoles.length >= 2) {
        lineupRationale.push(
          zh
            ? "已启用两段式架构（2 轮串行短交锋锁契约 → 全轨 100% 满并发干重活 → [V1] 终验存知识库）"
            : "Enabled Two-Stage Loop (2-Round Serial Clash -> 100% Parallel Execution -> [V1] Audit & Knowledge Save)",
        );
      } else if (useCausalDag && specialistRoles.length >= 2) {
        lineupRationale.push(
          zh
            ? `已编排 ${totalWaves} 波次因果交锋 DAG`
            : `Scheduled ${totalWaves}-Wave Causal Clash DAG`,
        );
      }
      if (mountedKnowledgeCards.length > 0) {
        lineupRationale.push(
          zh
            ? `已自动挂载 ${mountedKnowledgeCards.length} 条前序实战知识卡 (${mountedKnowledgeCards.map((c) => c.title).join("、")})`
            : `Mounted ${mountedKnowledgeCards.length} prior Knowledge Card(s)`,
        );
      }

      const maxDynamicPeerRoles = args.maxDynamicPeerRoles ?? 2;
      const quotaPool = computeInitialBorgQuotaPool({
        effortProfile: args.effortProfile,
        nowIso: now,
        tracks: tracks.map((tr) => {
          const tpl = roleByTrackId.get(tr.trackId) ?? findRoleTemplate(tr.roleId);
          return {
            kind: tpl?.kind ?? (tr.roleId === "quality-inspector" ? "inspector" : "professional"),
            priorityTier: tpl?.priorityTier,
            roleId: tr.roleId,
            roleLabel: tr.roleLabel,
            trackId: tr.trackId,
            webCapable: isRoleTemplateWebCapable(tpl),
            weight: tr.weight,
          };
        }),
      });
      lineupRationale.push(
        zh
          ? `已激活 Borg 权重弹性配额池（外网总上限 ${quotaPool.totalResearchCap} 次 · 25% 抢占池 + 结余回流 · ${maxDynamicPeerRoles} 席免批动态扩编）`
          : `Activated Borg Weighted Quota Pool (web cap ${quotaPool.totalResearchCap}, +25% burst & reflow, ${maxDynamicPeerRoles} auto-approved dynamic peer seats)`,
      );

      const record: VetoBoardTaskRecord = {
        allowOfflineAssumptions: args.allowOfflineAssumptions,
        calcChecksVerifiedCount: 0,
        candidateRoutes: clarify.candidateRoutes,
        ...(args.confirmedNotes ? { confirmedNotes: args.confirmedNotes } : {}),
        createdAt: now,
        deliberationOpinions: [],
        deliberationPhase:
          isParallelStage && specialistRoles.length >= 2 ? "round1" : "skipped",
        domain: args.domain,
        dynamicPeerRolesUsed: 0,
        effortProfile: args.effortProfile,
        executionMode: args.executionMode,
        goal: args.goal,
        lineupRationale,
        locale,
        maxDynamicPeerRoles,
        mountedKnowledgeIds: mountedKnowledgeCards.map((c) => c.knowledgeId),
        ...(mountedKnowledgeMarkdown ? { mountedKnowledgeMarkdown } : {}),
        peerRoleRequests: [],
        quotaPool,
        selectedRouteIds:
          args.selectedRouteIds ?? clarify.candidateRoutes.map((r) => r.routeId),
        ...(args.sessionId ? { sessionId: args.sessionId } : {}),
        status: "running",
        taskId,
        taskMode: clarify.taskMode,
        topologyMode: args.topologyMode,
        tracks,
        updatedAt: now,
        whiteboardEntries: [],
        whiteboardReactions: [],
        whiteboardRound: 0,
        ...(args.workspaceDir ? { workspaceDir: args.workspaceDir } : {}),
      };

      await store.saveTask(record);
      const progressTree = renderDockerBuildProgress(record);
      const playbook = buildHostSubscriptionPlaybook({
        locale,
        roleByTrackId,
        task: record,
      });

      const watchCmd = `npx vetoboard-mcp watch ${taskId}`;
      const out = [
        "```text",
        progressTree,
        `   ${zh ? "独立终端实时监控命令" : "Live terminal watcher"}: ${watchCmd}`,
        "```",
        "",
        playbook,
      ].join("\n");

      return textResult(out);
    },
  );

  // 6b. Mid-Flight Live Re-Weighting, Lead Switching & Track Mutation on Active Council
  server.registerTool(
    "vetoboard_update_council",
    {
      description:
        "Modify an active council task mid-flight: promote/switch Primary Leads, adjust 10-100 role weights, skip/drop unwanted tracks, or inject new custom specialist tracks on the fly.",
      inputSchema: z.object({
        addCustomRoles: z.array(customRoleInputSchema).optional(),
        approvePendingPeerRoles: z
          .boolean()
          .optional()
          .describe(
            "Set true when the user approves pending 3rd+ dynamic peer role requests (`awaiting_peer_approval`) to hot-insert them and resume without re-running passed tracks.",
          ),
        maxDynamicPeerRoles: z.number().int().min(0).max(10).optional(),
        modelOverrides: z
          .record(z.string(), z.union([z.string(), roleModelBindingSchema]))
          .optional()
          .describe("Mid-flight per-role model binding overrides keyed by roleId or trackId."),
        primaryRoleIds: z
          .array(z.string())
          .optional()
          .describe("Role IDs (or track IDs) to promote to Primary Lead (W>=95)."),
        reason: z.string().optional(),
        rejectPendingPeerRoles: z
          .boolean()
          .optional()
          .describe(
            "Set true when the user rejects pending 3rd+ dynamic peer role requests (`awaiting_peer_approval`) to resume execution with the existing lineup.",
          ),
        resolvePremiseConflictChoice: z
          .string()
          .optional()
          .describe(
            "User's decision resolving a Round 2 `altersCorePremise` route conflict, unlocking 100% Parallel Heavy Execution.",
          ),
        skipRoleOrTrackIds: z
          .array(z.string())
          .optional()
          .describe("Role IDs or Track IDs to skip/remove from active blocking."),
        spawnRoleFromSkillIds: z
          .array(z.string())
          .optional()
          .describe("Native skill IDs to dynamically spawn as new Wave 1 Specialist Tracks mid-flight."),
        taskId: z.string().min(1),
        tierOverrides: z.record(z.string(), rolePriorityTierSchema).optional(),
        weightOverrides: z.record(z.string(), z.number().int().min(10).max(100)).optional(),
        workspaceDir: z.string().optional(),
      }),
      title: "VetoBoard Live Update Council Weights & Tracks",
    },
    async (args) =>
      store.mutateTaskSerial(args.taskId, async () => {
      const task = await store.getTask(args.taskId);
      if (!task) {
        return textResult(`Task not found: "${args.taskId}"`, true);
      }
      const locale = task.locale;
      const dict = t(locale);
      const zh = locale === "zh";
      const now = new Date().toISOString();

      const skipSet = new Set((args.skipRoleOrTrackIds ?? []).map((x) => x.trim().toLowerCase()));
      const primarySet = new Set((args.primaryRoleIds ?? []).map((x) => x.trim().toLowerCase()));
      const hasPrimaryChange = primarySet.size > 0;

      let tracks = task.tracks.map((tr) => {
        const matchKey =
          skipSet.has(tr.trackId.toLowerCase()) || skipSet.has(tr.roleId.toLowerCase());
        let status = tr.status;
        if (matchKey && status !== "passed") {
          status = "skipped";
        }

        let weight = tr.weight;
        let tierLabel = tr.tierLabel;
        const isInspector = tr.roleId === "quality-inspector";

        if (!isInspector && hasPrimaryChange) {
          if (primarySet.has(tr.roleId.toLowerCase()) || primarySet.has(tr.trackId.toLowerCase())) {
            tierLabel = dict.tierPrimary;
            weight = Math.max(weight, 95);
          } else if (tierLabel === dict.tierPrimary) {
            tierLabel = dict.tierGuardrailLegal;
            weight = Math.min(weight, 86);
          }
        }

        const tierOv = args.tierOverrides?.[tr.roleId] ?? args.tierOverrides?.[tr.trackId];
        if (tierOv) {
          tierLabel =
            tierOv === "primary"
              ? dict.tierPrimary
              : tierOv === "guardrail"
                ? dict.tierGuardrailLegal
                : dict.tierSupport;
        }

        const weightOv = args.weightOverrides?.[tr.roleId] ?? args.weightOverrides?.[tr.trackId];
        if (weightOv !== undefined) {
          weight = Math.max(10, Math.min(100, Math.round(weightOv)));
        }

        const rawModelOv = args.modelOverrides?.[tr.roleId] ?? args.modelOverrides?.[tr.trackId];
        const modelBinding = rawModelOv
          ? normalizeRoleModelBinding(rawModelOv)
          : tr.modelBinding;

        return {
          ...tr,
          ...(modelBinding ? { modelBinding } : {}),
          status,
          tierLabel,
          weight,
        };
      });

      const addedCharters: string[] = [];
      let nextQuotaPool: QuotaPoolSnapshot | undefined = task.quotaPool
        ? rebalanceBorgPoolWeights(task.quotaPool, {
            effortProfile: task.effortProfile,
            nowIso: now,
            tracks: tracks.map((tr) => {
              const tpl = findRoleTemplate(tr.roleId);
              return {
                kind: tpl?.kind ?? (tr.roleId === "quality-inspector" ? "inspector" : "professional"),
                priorityTier: tpl?.priorityTier,
                roleId: tr.roleId,
                roleLabel: tr.roleLabel,
                trackId: tr.trackId,
                webCapable: isRoleTemplateWebCapable(tpl),
                weight: tr.weight,
              };
            }),
          })
        : undefined;

      const appendRoleTemplate = (tpl: RoleTemplate, boundSkillIds: string[] = []) => {
        const newIdx = tracks.length + 1;
        const trackId = `track-${newIdx}-${tpl.roleId}`;
        const charter = renderRoleCharterPrompt(tpl, locale);
        const nonInspWaves = tracks
          .filter((tItem) => tItem.roleId !== "quality-inspector")
          .map((tItem) => tItem.wave);
        const maxSpecWave = nonInspWaves.length > 0 ? Math.max(...nonInspWaves) : 1;
        const targetWave = task.topologyMode === "flat" || maxSpecWave <= 1 ? 1 : 2;
        const newTrack: VetoBoardTaskRecord["tracks"][number] = {
          boundSkillIds,
          catches: [],
          customCharter: charter,
          ...(tpl.executableRules.length > 0 ? { customRules: [...tpl.executableRules] } : {}),
          dependsOn: [],
          durationMs: 0,
          maxRetries: task.effortProfile === "deep" ? 3 : 1,
          ...(tpl.modelBinding ? { modelBinding: tpl.modelBinding } : {}),
          retryCount: 0,
          roleId: tpl.roleId,
          roleLabel: tpl.name[locale],
          ...(targetWave === 1 ? { startedAt: now } : {}),
          status: targetWave === 1 ? "running" : "pending",
          tierLabel: resolveTierLabel(tpl, locale),
          title: tpl.name[locale],
          trackId,
          wave: targetWave,
          weight: tpl.weight,
        };
        const insertBeforeIdx = tracks.findIndex(
          (tItem) => tItem.wave > targetWave || tItem.roleId === "quality-inspector",
        );
        if (insertBeforeIdx >= 0) {
          tracks.splice(insertBeforeIdx, 0, newTrack);
        } else {
          tracks.push(newTrack);
        }
        if (nextQuotaPool) {
          nextQuotaPool = registerDynamicRoleInBorgPool(nextQuotaPool, {
            effortProfile: task.effortProfile,
            nowIso: now,
            seed: {
              isDynamicPeer: true,
              kind: "professional",
              priorityTier: tpl.priorityTier,
              roleId: tpl.roleId,
              roleLabel: tpl.name[locale],
              trackId,
              webCapable: isRoleTemplateWebCapable(tpl),
              weight: tpl.weight,
            },
          });
        }
        addedCharters.push(`#### New Track \`${trackId}\` (Wave ${targetWave})\n${charter}`);
      };

      for (const custom of args.addCustomRoles ?? []) {
        appendRoleTemplate(customRoleToTemplate(custom));
      }

      if (args.spawnRoleFromSkillIds && args.spawnRoleFromSkillIds.length > 0) {
        const discovered = await discoverNativeSkills({
          locale,
          workspaceDir: args.workspaceDir,
        });
        const byId = new Map(discovered.map((s) => [s.skillId.toLowerCase(), s]));
        for (const sid of args.spawnRoleFromSkillIds) {
          const cleanId = sid.trim().replace(/^spawn:/i, "").toLowerCase();
          const sk = byId.get(cleanId);
          if (sk) {
            appendRoleTemplate(synthesizeRoleFromSkill(sk, locale, 90), [sk.skillId]);
          }
        }
      }

      let nextDynamicUsed = task.dynamicPeerRolesUsed ?? 0;
      const nextMaxPeers = args.maxDynamicPeerRoles ?? task.maxDynamicPeerRoles ?? 2;
      let nextPeerRequests = task.peerRoleRequests.slice();
      let workingTaskState: VetoBoardTaskRecord = {
        ...task,
        dynamicPeerRolesUsed: nextDynamicUsed,
        maxDynamicPeerRoles: nextMaxPeers,
        peerRoleRequests: nextPeerRequests,
        ...(nextQuotaPool ? { quotaPool: nextQuotaPool } : {}),
        tracks,
      };

      let peerDecisionNote: string | undefined;
      if (args.approvePendingPeerRoles) {
        const pendingList = nextPeerRequests.filter((r) => r.status === "pending_user_approval");
        for (const pending of pendingList) {
          const resolved = await resolvePeerRoleTemplate({
            dataRootDir: store.rootDir,
            locale,
            req: pending,
            workspaceDir: args.workspaceDir ?? task.workspaceDir,
          });
          const inserted = hotInsertApprovedPeerIntoTask({
            boundSkillIds: resolved.boundSkillIds,
            now,
            reqRecord: pending,
            task: workingTaskState,
            tpl: resolved.tpl,
          });
          workingTaskState = inserted.task;
          nextDynamicUsed += 1;
          nextPeerRequests = nextPeerRequests.map((r) =>
            r.requestId === pending.requestId
              ? {
                  ...r,
                  decidedAt: now,
                  pairedInspectorRoleId: inserted.pairedInspectorRoleId,
                  spawnedTrackId: inserted.spawnedTrackId,
                  status: "user_approved" as const,
                }
              : r,
          );
          if (inserted.spawnPromptMarkdown) {
            addedCharters.push(inserted.spawnPromptMarkdown);
          }
        }
        tracks = workingTaskState.tracks;
        nextQuotaPool = workingTaskState.quotaPool;
        peerDecisionNote = zh
          ? `统帅已批准 ${pendingList.length} 席超额平级增援热插续跑`
          : `User approved ${pendingList.length} pending peer role request(s)`;
      } else if (args.rejectPendingPeerRoles) {
        const pendingCount = nextPeerRequests.filter((r) => r.status === "pending_user_approval").length;
        nextPeerRequests = nextPeerRequests.map((r) =>
          r.status === "pending_user_approval"
            ? { ...r, decidedAt: now, status: "user_rejected" as const }
            : r,
        );
        peerDecisionNote = zh
          ? `统帅已驳回 ${pendingCount} 席超额增援申请，维持原阵容继续执行`
          : `User rejected ${pendingCount} pending peer role request(s); continuing with current lineup`;
      }

      tracks = refreshMultiWaveDependencies(tracks, now);

      const conflictResolvedText = args.resolvePremiseConflictChoice?.trim();
      const peerApprovalResolved = Boolean(args.approvePendingPeerRoles || args.rejectPendingPeerRoles);
      const restoredDelibPhaseAfterPeer =
        task.lockedSharedContract
          ? ("contract_locked" as const)
          : task.topologyMode === "whiteboard-electre" || task.topologyMode === "deliberate-then-parallel"
            ? (task.whiteboardEntries.length > 0 ? ("round2" as const) : ("round1" as const))
            : ("skipped" as const);
      const nextDelibPhase =
        conflictResolvedText && task.deliberationPhase === "paused_conflict"
          ? ("contract_locked" as const)
          : peerApprovalResolved && task.deliberationPhase === "awaiting_peer_approval"
            ? restoredDelibPhaseAfterPeer
            : task.deliberationPhase;
      const nextLockedContract = conflictResolvedText
        ? [
            task.lockedSharedContract ?? "",
            `- **${zh ? "用户拍板裁决" : "User Conflict Resolution"}**：${conflictResolvedText}`,
          ]
            .filter(Boolean)
            .join("\n")
        : task.lockedSharedContract;
      const nextTaskStatus =
        (conflictResolvedText || peerApprovalResolved) && task.status === "paused"
          ? ("running" as const)
          : task.status;

      const rationaleNote =
        peerDecisionNote ??
        (conflictResolvedText
          ? `${zh ? "用户裁决路线冲突放行并行执行" : "User resolved premise conflict"}: ${conflictResolvedText}`
          : args.reason?.trim() ||
            (zh ? "运行中动态调整主导席位与权重" : "Mid-flight role weight & lead update"));
      const updatedTask: VetoBoardTaskRecord = {
        ...task,
        deliberationPhase: nextDelibPhase,
        dynamicPeerRolesUsed: nextDynamicUsed,
        lineupRationale: [...(task.lineupRationale ?? []), rationaleNote],
        ...(nextLockedContract ? { lockedSharedContract: nextLockedContract } : {}),
        maxDynamicPeerRoles: nextMaxPeers,
        peerRoleRequests: nextPeerRequests,
        ...(nextQuotaPool ? { quotaPool: nextQuotaPool } : {}),
        status: nextTaskStatus,
        tracks,
        updatedAt: now,
      };
      await store.saveTask(updatedTask);

      const out = [
        "```text",
        renderDockerBuildProgress(updatedTask),
        "```",
        ...(conflictResolvedText && nextLockedContract
          ? [
              "",
              nextLockedContract,
              "",
              zh
                ? "🚀 **路线冲突已拍板放行**：请立即通过 `send_message` 同时唤醒全部存活专员会话，按上方更新后的契约 100% 满并发撰写完整底稿（`stage: \"deliverable\"`）！"
                : "🚀 **Premise Conflict Resolved**: Wake all specialist subagents in parallel via `send_message` to submit full deliverables (`stage: \"deliverable\"`)!",
            ]
          : []),
        ...(addedCharters.length > 0 ? ["", ...addedCharters] : []),
      ].join("\n");
      return textResult(out);
    }),
  );

  // 7. Submit Track Whiteboard / Deliberation / Deliverable (Dynamic Shared Whiteboard + ELECTRE/QMV -> 100% Parallel Deliverables -> Knowledge Distillation & Clean Exit)
  server.registerTool(
    "vetoboard_submit_track_output",
    {
      description:
        "Submit a specialist's Public Whiteboard post (`stage='board_post'`), ELECTRE+QMV review & dynamic dimension reaction (`stage='board_review'`), classic clash turn (`stage='round1'|'round2'`), or full parallel deliverable (`stage='deliverable'`, default). Automatically arbitrates shared baseline contracts, runs Rule Gate, signs the 3-file workspace report bundle, distills verified conclusions into the Knowledge Base, and exits cleanly to normal chat.",
      inputSchema: z.object({
        altersCorePremise: z.boolean().optional(),
        catchHighlights: z
          .array(
            z.object({
              category: z.enum([
                "math_mismatch",
                "compliance_redline",
                "rule_violation",
                "evidence_verified",
                "premise_conflict",
              ]),
              detail: z.string().min(1),
            }),
          )
          .optional(),
        constructiveAlternative: z.string().optional(),
        decision: z
          .enum(["approve", "conditional", "oppose"])
          .optional()
          .describe("For stage='board_review': 'approve' (irrelevant/beneficial/absorbed), 'conditional' (self-adapted), or 'oppose' (contention)."),
        durationMs: z.number().nonnegative().optional(),
        executiveBriefingFilePath: z
          .string()
          .optional()
          .describe("Optional UTF-8 file path to executiveBriefingMarkdown written on disk by an inspector worker."),
        executiveBriefingMarkdown: z.string().optional(),
        hardVetoEvidence: z
          .string()
          .optional()
          .describe("ELECTRE Non-Compensatory Hard Veto proof (ONLY for grounded negative-margin vetoboard_calc math, compiler/test error, or statutory violation)."),
        helpersUsed: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Optional count of read-only Explore helpers used in this stage for Borg Quota Pool tracking."),
        invokedSkills: z.array(z.string()).optional(),
        invokedTools: z.array(z.string()).optional(),
        keyConstraints: z.array(z.string()).optional(),
        markdown: z
          .string()
          .optional()
          .describe("Track output Markdown (required unless markdownFilePath is provided)."),
        markdownFilePath: z
          .string()
          .optional()
          .describe("UTF-8 Markdown file path written by a MCP-less worker (e.g. Swarm worker) so Coordinator submits with zero copy-paste tokens."),
        neededDimensions: z
          .array(z.string())
          .optional()
          .describe("Missing capability dimensions needed to break a deadlock (e.g. ['market', 'cost'])."),
        replyTo: z.array(z.string()).optional(),
        requestPeerRoles: z
          .array(peerRoleRequestInputSchema)
          .optional()
          .describe(
            "Dynamically request peer specialist role(s) when discovering a cross-domain or cross-OWNERS gap mid-run (first 2 seats auto-approved with Borg reflow quota; 3rd+ pauses safely for user confirmation).",
          ),
        researchCallsUsed: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Optional count of external web searches/fetches executed in this stage for Borg Quota Pool settlement & reflow."),
        stage: z
          .enum(["board_post", "board_review", "round1", "round2", "deliverable"])
          .default("deliverable")
          .describe(
            "'board_post' (concurrent whiteboard variable post), 'board_review' (ELECTRE+QMV review & dynamic consult), 'round1'/'round2' (classic 2-round clash), or 'deliverable' (full parallel markdown report).",
          ),
        stance: z.enum(["support", "caution", "challenge"]).optional(),
        summaryLine: z.string().optional(),
        targetTrackIds: z
          .array(z.string())
          .optional()
          .describe("Contested track IDs when decision='oppose'."),
        taskId: z.string().min(1),
        trackId: z.string().min(1),
        variables: z
          .record(z.string(), z.string())
          .optional()
          .describe("Structured key variables / interface contracts posted onto the Public Whiteboard."),
      }),
      title: "VetoBoard Submit Track Clash or Deliverable",
    },
    async (args, ctx) =>
      store.mutateTaskSerial(args.taskId, async () => {
      const task = await store.getTask(args.taskId);
      if (!task) {
        return textResult(`Task not found: "${args.taskId}"`, true);
      }
      const locale = task.locale;
      const zh = locale === "zh";
      const trackIdx = task.tracks.findIndex((tr) => tr.trackId === args.trackId);
      if (trackIdx < 0) {
        return textResult(`Track "${args.trackId}" not found in task "${args.taskId}"`, true);
      }
      const targetTrack = task.tracks[trackIdx]!;
      const roleTpl = findRoleTemplate(targetTrack.roleId);
      const now = new Date().toISOString();

      let resolvedMarkdown = args.markdown?.trim() ?? "";
      if (!resolvedMarkdown && args.markdownFilePath?.trim()) {
        try {
          resolvedMarkdown = (await readFile(resolve(args.markdownFilePath.trim()), "utf8")).trim();
        } catch (err) {
          return textResult(
            `Failed to read markdownFilePath "${args.markdownFilePath}": ${err instanceof Error ? err.message : String(err)}`,
            true,
          );
        }
      }
      if (!resolvedMarkdown) {
        return textResult(
          "Either non-empty `markdown` or readable `markdownFilePath` must be provided to `vetoboard_submit_track_output`.",
          true,
        );
      }

      let resolvedBriefingMd = args.executiveBriefingMarkdown?.trim();
      if (!resolvedBriefingMd && args.executiveBriefingFilePath?.trim()) {
        try {
          resolvedBriefingMd = (
            await readFile(resolve(args.executiveBriefingFilePath.trim()), "utf8")
          ).trim();
        } catch (err) {
          return textResult(
            `Failed to read executiveBriefingFilePath "${args.executiveBriefingFilePath}": ${err instanceof Error ? err.message : String(err)}`,
            true,
          );
        }
      }

      // Stage W1: Dynamic Shared Whiteboard Concurrent Post (`stage === "board_post"`)
      if (args.stage === "board_post") {
        // Universal Web-Grounding Gate: BEFORE locking assumptions onto the Shared Whiteboard,
        // non-actuary roles across ALL domains (`commercial` & `swe`) MUST verify live primary facts via web search!
        const prepBudget = resolveTurnResearchBudget({
          effortProfile: task.effortProfile,
          roleId: targetTrack.roleId,
          tier: "board_prep",
        });
        const postCorpus = `${resolvedMarkdown}\n${Object.values(args.variables ?? {}).join("\n")}`;
        const postUrls = extractVerifiedHttpUrls(postCorpus);
        const postWebGrounded =
          hasInvokedWebResearchTool(args.invokedTools) || postUrls.length >= 1;

        if (
          !task.allowOfflineAssumptions &&
          prepBudget.minExternalWebSources >= 1 &&
          !postWebGrounded
        ) {
          return textResult(
            zh
              ? [
                  `⛔ **白板前置联网实证硬门禁拦截（Track: \`${targetTrack.trackId}\` · ${targetTrack.roleLabel}）**`,
                  `- **拒绝原因**：任何课题（无论商业还是软件架构）上白板锁指标前，严禁零检索拍脑袋编数据！检测不到 \`search_web / WebSearch\` 调用记录，且提交内容中无任何真实外部 \`https://\` 来源链接。`,
                  `- **整改与防死循环配额要求**：请立即在 **≤ ${prepBudget.maxExternalResearchCalls} 次查询上限（单域名 ≤ ${prepBudget.maxSameDomainFetches} 次；若连续 2 次检索无果立刻标 \`[ASSUMPTION]\` 止损收口！）** 内执行联网检索，锚定真实在售具体品牌型号现价 / 现行法规字号 / 最新官方文档，并在 \`markdown\` 或 \`variables\` 中附至少 1 条真实 \`https://\` URL（或将 \`"search_web"\` 传入 \`invokedTools\`）重新提交 \`stage: "board_post"\`！`,
                ].join("\n")
              : [
                  `⛔ **Whiteboard Web-Grounding Hard Gate Blocked (\`${targetTrack.trackId}\`)**`,
                  `- Every council topic MUST verify live primary facts BEFORE locking whiteboard variables! Neither \`WebSearch/search_web\` was invoked nor was any external \`https://\` URL cited.`,
                  `- Run live web search within your quota (\`<= ${prepBudget.maxExternalResearchCalls}\` calls; stop after 2 empty queries as \`[ASSUMPTION]\`) and resubmit \`stage: "board_post"\` with \`>= 1\` real \`https://\` source URL.`,
                ].join("\n"),
            true,
          );
        }

        const activeSpecs = task.tracks.filter(
          (tItem) => tItem.roleId !== "quality-inspector" && tItem.status !== "skipped",
        );
        const prevEntry = task.whiteboardEntries.find((e) => e.trackId === targetTrack.trackId);
        const extractedVars = extractWhiteboardVariables(resolvedMarkdown, args.variables);
        const mergedVars = { ...(prevEntry?.variables ?? {}), ...extractedVars };
        const summaryClean =
          args.summaryLine?.trim() ||
          resolvedMarkdown
            .replace(/```[\s\S]*?```/g, "")
            .split(/\r?\n/)
            .map((l) => l.replace(/^#+\s*/, "").replace(/^[-*+]\s+/, "").trim())
            .find((l) => l.length >= 6)
            ?.slice(0, 200) ||
          targetTrack.title;

        const ownedDimensions = inferOwnedDimensions(
          targetTrack.roleId,
          targetTrack.roleLabel,
          `${roleTpl?.systemCharter.zh ?? ""} ${roleTpl?.systemCharter.en ?? ""} ${targetTrack.customCharter ?? ""}`,
        );

        const nextEntry = {
          ownedDimensions,
          revision: prevEntry ? prevEntry.revision + 1 : 1,
          roleId: targetTrack.roleId,
          roleLabel: targetTrack.roleLabel,
          summary: summaryClean,
          trackId: targetTrack.trackId,
          updatedAt: now,
          variables: mergedVars,
          weight: targetTrack.weight,
        };

        const mergedEntries = [
          ...task.whiteboardEntries.filter((e) => e.trackId !== targetTrack.trackId),
          nextEntry,
        ];

        const settledPrepPool = task.quotaPool
          ? settleBorgStageCompletion(task.quotaPool, {
              helpersUsedInStage: args.helpersUsed ?? 0,
              nowIso: now,
              researchUsedInStage: args.researchCallsUsed ?? postUrls.length,
              stage: "board_post",
              trackId: targetTrack.trackId,
            }).pool
          : undefined;

        const basePrepTask: VetoBoardTaskRecord = {
          ...task,
          ...(settledPrepPool ? { quotaPool: settledPrepPool } : {}),
          updatedAt: now,
          whiteboardEntries: mergedEntries,
        };
        const peerPrepRes = await applyIncomingPeerRoleRequests({
          dataRootDir: store.rootDir,
          now,
          requestedByRoleLabel: targetTrack.roleLabel,
          requestedByTrackId: targetTrack.trackId,
          requests: args.requestPeerRoles,
          task: basePrepTask,
          workspaceDir: task.workspaceDir,
        });

        const updatedSpecs = peerPrepRes.task.tracks.filter(
          (tItem) => tItem.roleId !== "quality-inspector" && tItem.status !== "skipped",
        );
        const postedIds = new Set(mergedEntries.map((e) => e.trackId));
        const allPosted =
          !peerPrepRes.pausedForPeerApproval &&
          updatedSpecs.every((s) => postedIds.has(s.trackId));

        const nextTask: VetoBoardTaskRecord = {
          ...peerPrepRes.task,
          deliberationPhase: peerPrepRes.pausedForPeerApproval
            ? "awaiting_peer_approval"
            : allPosted
              ? "round2"
              : "round1",
          whiteboardRound: allPosted
            ? Math.max(1, peerPrepRes.task.whiteboardRound)
            : peerPrepRes.task.whiteboardRound,
        };
        await store.saveTask(nextTask);
        const treeBlock = ["```text", renderDockerBuildProgress(nextTask), "```"].join("\n");
        if (allPosted) {
          return textResult(
            `${treeBlock}\n\n${renderPublicWhiteboardSnapshot(nextTask, locale)}${peerPrepRes.peerNoticeMarkdown}`,
          );
        }
        return textResult(
          `${treeBlock}\n\n${
            zh
              ? `⏳ 公开白板已上墙 ${postedIds.size}/${updatedSpecs.length} 席（刚上板：${targetTrack.roleLabel}）。待全员并发上板齐备后自动开启阅板裁决！`
              : `⏳ Whiteboard posts collected: ${postedIds.size}/${updatedSpecs.length}.`
          }${peerPrepRes.peerNoticeMarkdown}`,
        );
      }

      // Stage W2: Dynamic Shared Whiteboard Review & ELECTRE+QMV Mathematical Gate (`stage === "board_review"`)
      if (args.stage === "board_review") {
        const activeSpecs = task.tracks.filter(
          (tItem) => tItem.roleId !== "quality-inspector" && tItem.status !== "skipped",
        );
        const postedSet = new Set(task.whiteboardEntries.map((e) => e.trackId));
        const missingPosts = activeSpecs.filter((s) => !postedSet.has(s.trackId));
        if (missingPosts.length > 0) {
          return textResult(
            zh
              ? `白板门禁拦截：尚有 ${missingPosts.length} 席（${missingPosts.map((x) => x.trackId).join(", ")}）未提交白板指标 (board_post)，请先完成上板再阅板表态！`
              : `Whiteboard Gate: Missing board_post from ${missingPosts.map((x) => x.trackId).join(", ")}.`,
            true,
          );
        }

        const currentRound = Math.max(1, task.whiteboardRound || 1);
        const decision =
          args.decision ??
          (args.stance === "challenge"
            ? "oppose"
            : args.stance === "caution"
              ? "conditional"
              : "approve");
        const neededDims = inferNeededDimensions(resolvedMarkdown, args.neededDimensions);
        const hardVeto =
          args.hardVetoEvidence?.trim() ||
          (args.altersCorePremise ? `altersCorePremise: ${resolvedMarkdown.slice(0, 140)}` : undefined);

        const newReaction = {
          decision,
          ...(hardVeto ? { hardVetoEvidence: hardVeto } : {}),
          neededDimensions: neededDims,
          note: resolvedMarkdown.replace(/\s+/g, " ").trim().slice(0, 220),
          reviewerLabel: targetTrack.roleLabel,
          reviewerRoleId: targetTrack.roleId,
          reviewerTrackId: targetTrack.trackId,
          round: currentRound,
          targetTrackIds: args.targetTrackIds ?? [],
          updatedAt: now,
          weight: targetTrack.weight,
        };

        const mergedReactions = [
          ...task.whiteboardReactions.filter(
            (r) => !(r.round === currentRound && r.reviewerTrackId === targetTrack.trackId),
          ),
          newReaction,
        ];

        // In Round 1, wait for all active specialists to review; in Round >= 2, ONLY wait for prior-round opposers (approved bystanders stay silent!)
        const requiredReviewerIds =
          currentRound === 1
            ? activeSpecs.map((s) => s.trackId)
            : task.whiteboardReactions
                .filter((r) => r.round === currentRound - 1 && r.decision === "oppose")
                .map((r) => r.reviewerTrackId);
        const submittedThisRound = new Set(
          mergedReactions.filter((r) => r.round === currentRound).map((r) => r.reviewerTrackId),
        );
        const reviewRoundComplete =
          requiredReviewerIds.length === 0 ||
          requiredReviewerIds.every((id) => submittedThisRound.has(id));

        const tempTask: VetoBoardTaskRecord = {
          ...task,
          updatedAt: now,
          whiteboardReactions: mergedReactions,
          whiteboardRound: currentRound,
        };

        if (!reviewRoundComplete) {
          await store.saveTask(tempTask);
          const treeBlock = ["```text", renderDockerBuildProgress(tempTask), "```"].join("\n");
          return textResult(
            `${treeBlock}\n\n${
              zh
                ? `⏳ 白板阅览留痕已收齐 ${submittedThisRound.size}/${requiredReviewerIds.length} 席（刚表态：${targetTrack.roleLabel} → ${decision}）。`
                : `⏳ Whiteboard reviews collected: ${submittedThisRound.size}/${requiredReviewerIds.length}.`
            }`,
          );
        }

        const evalRes = evaluateWhiteboardConvergence({
          availableCatalogRoles: BUILTIN_ROLE_TEMPLATES,
          currentRound,
          locale,
          task: tempTask,
        });

        const nextPhase =
          evalRes.outcome === "CONVERGED_UNANIMOUS" || evalRes.outcome === "CONVERGED_DOMINATED_PASS"
            ? ("contract_locked" as const)
            : evalRes.outcome === "HUMAN_INTERVENTION_REQUIRED"
              ? ("paused_conflict" as const)
              : ("round2" as const);

        const evaluatedBaseTask: VetoBoardTaskRecord = {
          ...tempTask,
          deliberationPhase: nextPhase,
          lockedSharedContract: evalRes.lockedContractMarkdown,
          ...(evalRes.minorityReportMarkdown
            ? { minorityReportMarkdown: evalRes.minorityReportMarkdown }
            : {}),
          status: evalRes.outcome === "HUMAN_INTERVENTION_REQUIRED" ? "paused" : "running",
          whiteboardRound:
            evalRes.outcome === "CONSULTATION_REQUIRED" ? currentRound + 1 : currentRound,
        };
        const peerReviewRes = await applyIncomingPeerRoleRequests({
          dataRootDir: store.rootDir,
          now,
          requestedByRoleLabel: targetTrack.roleLabel,
          requestedByTrackId: targetTrack.trackId,
          requests: args.requestPeerRoles,
          task: evaluatedBaseTask,
          workspaceDir: task.workspaceDir,
        });
        const evaluatedTask = peerReviewRes.task;
        await store.saveTask(evaluatedTask);
        const treeBlock = ["```text", renderDockerBuildProgress(evaluatedTask), "```"].join("\n");
        return textResult(`${treeBlock}\n\n${evalRes.nextStepPrompt}${peerReviewRes.peerNoticeMarkdown}`);
      }

      // Stage A: Serial Short Deliberation (`round1` -> `round2` -> `contract_locked` / `paused_conflict`)
      if (args.stage === "round1" || args.stage === "round2") {
        const roundNum: 1 | 2 = args.stage === "round1" ? 1 : 2;
        if (roundNum === 2) {
          const activeSpecsForCheck = task.tracks.filter(
            (tItem) => tItem.roleId !== "quality-inspector" && tItem.status !== "skipped",
          );
          const r1SubmittedSet = new Set(
            task.deliberationOpinions.filter((o) => o.round === 1).map((o) => o.trackId),
          );
          const missingR1 = activeSpecsForCheck.filter((tItem) => !r1SubmittedSet.has(tItem.trackId));
          if (missingR1.length > 0) {
            return textResult(
              zh
                ? `交锋轮次串行门禁拦截：第 1 轮尚有 ${missingR1.length} 席（${missingR1.map((x) => x.trackId).join(", ")}）未提交，严禁跨轮并行抢跑第 2 轮！`
                : `Serial Deliberation Gate: Cannot submit Round 2 until all Round 1 claims are complete (missing: ${missingR1.map((x) => x.trackId).join(", ")}).`,
              true,
            );
          }
        }

        const parsedOp = parseDeliberationFromSubmission({
          altersCorePremise: args.altersCorePremise,
          constructiveAlternative: args.constructiveAlternative,
          keyConstraints: args.keyConstraints,
          markdown: resolvedMarkdown,
          replyTo: args.replyTo,
          stance: args.stance,
        });

        const newOp: DeliberationOpinion = {
          ...(parsedOp.altersCorePremise ? { altersCorePremise: true } : {}),
          ...(parsedOp.constructiveAlternative
            ? { constructiveAlternative: parsedOp.constructiveAlternative }
            : {}),
          keyConstraints: parsedOp.keyConstraints,
          priorityTier:
            roleTpl?.priorityTier ??
            inferPriorityTierFromTrack(targetTrack.tierLabel, targetTrack.weight),
          replyTo: parsedOp.replyTo,
          roleId: targetTrack.roleId,
          roleLabel: targetTrack.roleLabel,
          round: roundNum,
          stance: parsedOp.stance,
          summary: parsedOp.summary,
          trackId: targetTrack.trackId,
          updatedAt: now,
          weight: targetTrack.weight,
        };

        const mergedOpinions = [
          ...task.deliberationOpinions.filter(
            (o) => !(o.round === roundNum && o.trackId === targetTrack.trackId),
          ),
          newOp,
        ];

        const activeSpecs = task.tracks.filter(
          (tItem) => tItem.roleId !== "quality-inspector" && tItem.status !== "skipped",
        );
        const submittedInRound = new Set(
          mergedOpinions.filter((o) => o.round === roundNum).map((o) => o.trackId),
        );
        const roundComplete = activeSpecs.every((tItem) => submittedInRound.has(tItem.trackId));

        if (roundNum === 1) {
          const nextTask: VetoBoardTaskRecord = {
            ...task,
            deliberationOpinions: mergedOpinions,
            deliberationPhase: roundComplete ? "round2" : "round1",
            updatedAt: now,
          };
          await store.saveTask(nextTask);
          const treeBlock = ["```text", renderDockerBuildProgress(nextTask), "```"].join("\n");
          if (roundComplete) {
            return textResult(`${treeBlock}\n\n${renderRound1PeerBlackboard(nextTask, locale)}`);
          }
          return textResult(
            `${treeBlock}\n\n${
              zh
                ? `⏳ 第 1 轮亮牌已收齐 ${submittedInRound.size}/${activeSpecs.length} 席（刚收录：${targetTrack.roleLabel}）。请继续收齐本轮其余专员后再串行进入第 2 轮！`
                : `⏳ Round 1 claims collected: ${submittedInRound.size}/${activeSpecs.length}. Complete remaining Round 1 claims before starting Round 2.`
            }`,
          );
        }

        // Round 2 submission
        const tempTask: VetoBoardTaskRecord = {
          ...task,
          deliberationOpinions: mergedOpinions,
          updatedAt: now,
        };
        if (!roundComplete) {
          await store.saveTask(tempTask);
          const treeBlock = ["```text", renderDockerBuildProgress(tempTask), "```"].join("\n");
          return textResult(
            `${treeBlock}\n\n${
              zh
                ? `⏳ 第 2 轮横向交锋已收齐 ${submittedInRound.size}/${activeSpecs.length} 席（刚收录：${targetTrack.roleLabel}）。`
                : `⏳ Round 2 rebuttals collected: ${submittedInRound.size}/${activeSpecs.length}.`
            }`,
          );
        }

        const arb = evaluateDeliberationArbitration(tempTask, locale);
        const arbitratedTask: VetoBoardTaskRecord = {
          ...tempTask,
          deliberationPhase: arb.status,
          lockedSharedContract: arb.lockedContractMarkdown,
          status: arb.status === "paused_conflict" ? "paused" : "running",
        };
        await store.saveTask(arbitratedTask);
        const treeBlock = ["```text", renderDockerBuildProgress(arbitratedTask), "```"].join("\n");
        return textResult(`${treeBlock}\n\n${arb.nextStepPrompt}`);
      }

      // Stage B: Full Deliverable Submission (`stage === "deliverable"`)
      const prevDraft = await store.readTrackArtifact(task.taskId, targetTrack.trackId);
      const safeMarkdown = preserveBaselineOnIncrementalPatch(resolvedMarkdown, prevDraft, locale);
      const savedPath = await store.writeTrackArtifact(task.taskId, targetTrack.trackId, safeMarkdown);

      const gateTools = task.allowOfflineAssumptions
        ? [...(args.invokedTools ?? []), "WebSearch"]
        : args.invokedTools;
      const gate = evaluateRuleGate({
        invokedSkills: args.invokedSkills,
        invokedTools: gateTools,
        locale,
        outputText: safeMarkdown,
        rules: [...(roleTpl?.executableRules ?? []), ...(targetTrack.customRules ?? [])],
      });
      const effectiveCatchInputs =
        args.catchHighlights && args.catchHighlights.length > 0
          ? args.catchHighlights
          : gate.passed
            ? extractAutoCatchesFromMarkdown(safeMarkdown, targetTrack.roleId)
            : [];

      const newCatches = [
        ...targetTrack.catches,
        ...effectiveCatchInputs.map((c) => ({
          category: c.category,
          detail: c.detail,
          roleName: targetTrack.roleLabel,
          timestamp: now,
        })),
        ...gate.hardViolations.map((v) => ({
          category: "rule_violation" as const,
          detail: `${v.ruleTitle}: ${v.reason}`,
          roleName: targetTrack.roleLabel,
          timestamp: now,
        })),
      ];

      const nextRetry = gate.passed ? targetTrack.retryCount : targetTrack.retryCount + 1;
      const exhausted = !gate.passed && nextRetry >= targetTrack.maxRetries;
      const nextTrackStatus = gate.passed
        ? ("passed" as const)
        : exhausted
          ? ("paused" as const)
          : ("reworking" as const);

      const nowMs = Date.parse(now);
      const startedMs = Date.parse(targetTrack.startedAt ?? task.createdAt);
      const measuredDurationMs =
        args.durationMs ??
        (Number.isFinite(startedMs) ? Math.max(1_000, nowMs - startedMs) : 1_000);

      const updatedTracks = task.tracks.map((tr, i) => {
        if (i !== trackIdx) return tr;
        return {
          ...tr,
          catches: newCatches,
          durationMs:
            args.durationMs !== undefined ? tr.durationMs + args.durationMs : measuredDurationMs,
          outputPath: savedPath,
          retryCount: Math.min(nextRetry, tr.maxRetries),
          ...(nextTrackStatus === "reworking" ? { startedAt: now } : {}),
          status: nextTrackStatus,
          ...(args.summaryLine ? { summaryLine: args.summaryLine } : {}),
        };
      });

      // Settle Borg Quota Pool (reflow unspent base quota on pass, or freeze burst on SRE rework/gate failure!)
      let nextDelivPool = task.quotaPool;
      if (nextDelivPool && targetTrack.roleId !== "quality-inspector") {
        if (!gate.passed) {
          nextDelivPool = freezeTrackBurstOnRework(nextDelivPool, targetTrack.trackId, now);
        } else {
          nextDelivPool = settleBorgStageCompletion(nextDelivPool, {
            helpersUsedInStage: args.helpersUsed ?? 0,
            isReworkAttempt: targetTrack.retryCount > 0,
            nowIso: now,
            researchUsedInStage:
              args.researchCallsUsed ?? extractVerifiedHttpUrls(safeMarkdown).length,
            stage: "deliverable",
            trackId: targetTrack.trackId,
          }).pool;
        }
      }

      // Promote Wave 2 tracks from pending -> running once all dependencies pass or are skipped
      const passedSet = new Set(
        updatedTracks
          .filter((tr) => tr.status === "passed" || tr.status === "skipped")
          .map((tr) => tr.trackId),
      );
      const promotedTracks = updatedTracks.map((tr) => {
        if (
          tr.status === "pending" &&
          tr.dependsOn.every((dep) => passedSet.has(dep))
        ) {
          return { ...tr, startedAt: now, status: "running" as const };
        }
        return tr;
      });

      const prePeerTask: VetoBoardTaskRecord = {
        ...task,
        ...(nextDelivPool ? { quotaPool: nextDelivPool } : {}),
        tracks: promotedTracks,
        updatedAt: now,
      };
      const peerDelivRes = await applyIncomingPeerRoleRequests({
        dataRootDir: store.rootDir,
        now,
        requestedByRoleLabel: targetTrack.roleLabel,
        requestedByTrackId: targetTrack.trackId,
        requests: args.requestPeerRoles,
        task: prePeerTask,
        workspaceDir: task.workspaceDir,
      });

      const finalTracks = peerDelivRes.task.tracks;
      const activeTracks = finalTracks.filter((tr) => tr.status !== "skipped");
      const allPassed =
        !peerDelivRes.pausedForPeerApproval &&
        activeTracks.length > 0 &&
        activeTracks.every((tr) => tr.status === "passed");
      const anyPaused =
        peerDelivRes.pausedForPeerApproval || activeTracks.some((tr) => tr.status === "paused");
      const updatedTask: VetoBoardTaskRecord = {
        ...peerDelivRes.task,
        status: allPassed ? "completed" : anyPaused ? "paused" : "running",
        tracks: finalTracks,
        updatedAt: now,
      };
      await store.saveTask(updatedTask);

      // Emit standard MCP notifications/progress when progressToken is supplied by the IDE client
      const progressToken = ctx.mcpReq._meta?.progressToken;
      if (progressToken !== undefined) {
        const doneCount = activeTracks.filter((tr) => tr.status === "passed").length;
        await ctx.mcpReq
          .notify({
            method: "notifications/progress",
            params: {
              message: `${targetTrack.roleLabel}: ${nextTrackStatus}`,
              progress: doneCount,
              progressToken,
              total: activeTracks.length,
            },
          })
          .catch(() => undefined);
      }

      const memorialCard = buildArtifactMemorialCard({
        detailTier: "direct",
        label: targetTrack.title,
        locale,
        markdown: safeMarkdown,
        readableFilePath: savedPath,
        relativePath: `tracks/${targetTrack.trackId}.md`,
      });

      let reportNotice = "";
      const specialistTracks = activeTracks.filter((tr) => tr.roleId !== "quality-inspector");
      const inspectorTrack = activeTracks.find((tr) => tr.roleId === "quality-inspector");

      const loadSpecialistDeliverables = async () => {
        const hasExplicitTerminal = specialistTracks.some((tr) => tr.isTerminal);
        const list = [];
        for (let idx = 0; idx < specialistTracks.length; idx += 1) {
          const tr = specialistTracks[idx]!;
          const content = (await store.readTrackArtifact(task.taskId, tr.trackId)) ?? "";
          list.push({
            isTerminal: hasExplicitTerminal
              ? Boolean(tr.isTerminal)
              : idx === specialistTracks.length - 1,
            markdown: content,
            roleLabel: `${tr.roleLabel} [${tr.tierLabel}·${tr.weight}]`,
            stepId: tr.trackId,
            title: tr.title,
            wave: tr.wave,
          });
        }
        return list;
      };

      // Right when all specialist waves finish and `quality-inspector` unlocks, emit the exact `[Sx·§y]` Citation Catalog!
      if (
        !allPassed &&
        inspectorTrack?.status === "running" &&
        specialistTracks.length > 0 &&
        specialistTracks.every((tr) => tr.status === "passed")
      ) {
        const preDeliverables = await loadSpecialistDeliverables();
        reportNotice = `\n\n${buildCitedBriefingPromptAndCatalog({
          deliverables: preDeliverables,
          goal: task.goal,
          locale,
        })}`;
      }

      if (allPassed) {
        const deliverables = await loadSpecialistDeliverables();
        const verifyMd = inspectorTrack
          ? ((await store.readTrackArtifact(task.taskId, inspectorTrack.trackId)) ?? undefined)
          : undefined;
        const totalCatches = activeTracks.reduce((acc, tr) => acc + tr.catches.length, 0);
        const briefingBody =
          resolvedBriefingMd ||
          buildAutoExecutiveBriefing({
            deliverables,
            goal: task.goal,
            locale,
            verificationMarkdown: verifyMd,
          });

        const realSourcesCount = countEmpiricalSources([
          ...deliverables.map((d) => d.markdown),
          ...(verifyMd ? [verifyMd] : []),
        ]);
        const realCalcCount = countReconciledMathRows(
          verifyMd,
          task.calcChecksVerifiedCount ?? 0,
        );

        const assembled = assembleDualLayerReport({
          auditSealStats: {
            calcChecksCount: realCalcCount,
            catchesCount: totalCatches,
            rolesCount: activeTracks.length,
            sourcesCount: realSourcesCount,
          },
          briefingMarkdown: briefingBody,
          ...(updatedTask.deliberationOpinions.length > 0
            ? { deliberationOpinions: updatedTask.deliberationOpinions }
            : {}),
          deliverables,
          goal: task.goal,
          locale,
          ...(updatedTask.lockedSharedContract
            ? { lockedSharedContract: updatedTask.lockedSharedContract }
            : {}),
          ...(updatedTask.mountedKnowledgeMarkdown
            ? { mountedKnowledgeMarkdown: updatedTask.mountedKnowledgeMarkdown }
            : {}),
          ...(updatedTask.quotaPool
            ? {
                quotaPoolMarkdown: formatBorgQuotaLedgerForReport(updatedTask.quotaPool, locale, {
                  maxAutoApprove: updatedTask.maxDynamicPeerRoles ?? 2,
                  totalRequests: updatedTask.peerRoleRequests.length,
                  used: updatedTask.dynamicPeerRolesUsed ?? 0,
                }),
              }
            : {}),
          verificationMarkdown: verifyMd,
          ...(updatedTask.whiteboardEntries.length > 0 || updatedTask.whiteboardReactions.length > 0
            ? { whiteboardLedgerMarkdown: formatWhiteboardLedgerForReport(updatedTask, locale) }
            : {}),
        });
        const written = await store.writeFinalReports(task.taskId, {
          ...assembled,
          goal: task.goal,
          ...(task.workspaceDir ? { workspaceDir: task.workspaceDir } : {}),
        });
        // Auto-clean temporary worker file-drop folder `<workspaceDir>/.vetoboard-tmp/<taskId>` if used
        if (task.workspaceDir) {
          await rm(join(resolve(task.workspaceDir), ".vetoboard-tmp", task.taskId), {
            force: true,
            recursive: true,
          }).catch(() => undefined);
        }
        const primaryReportPath = written.workspaceReportPath ?? written.reportPath;
        const primaryBriefingPath = written.workspaceBriefingPath ?? written.briefingPath;
        const primaryOriginalPath = written.workspaceOriginalPath ?? written.originalPath;
        const fileUrl = `file:///${primaryReportPath.replace(/\\/g, "/")}`;

        // Automatically distill verified conclusions into `~/.vetoboard-mcp/library/knowledge/` so Phase 2 / future chats inherit seamlessly!
        const savedKb = await distillAndSaveTaskKnowledge({
          dataRootDir: store.rootDir,
          deliverables,
          reportPath: primaryReportPath,
          task: updatedTask,
          verificationMarkdown: verifyMd,
        }).catch(() => undefined);

        // Non-blocking 24h cached version check (1,500ms hard timeout; silent when up-to-date or offline)
        const updateNotice = await checkLatestVersionNonBlocking({
          currentVersion: options?.version ?? CURRENT_VETOBOARD_VERSION,
          dataRootDir: store.rootDir,
          locale,
        });

        reportNotice = zh
          ? [
              "",
              "### ✅ 终局双层角标溯源报告已签发 & 实战知识卡已入库（现已退出 VetoBoard 模式回到普通对话）",
              `- 完整过程与溯源报告 (\`-report.md\`): \`${primaryReportPath}\``,
              `- 第一性原理穿透解读 (\`-briefing.md\`): \`${primaryBriefingPath}\``,
              `- 100% 专员原始底稿 (\`-original-report.md\`): \`${primaryOriginalPath}\``,
              ...(savedKb
                ? [
                    `- 📖 已自动沉淀入实战知识库: **${savedKb.title}** (\`${savedKb.knowledgeId}\`) —— 后续进入下一阶段再次调用 VetoBoard 时将自动检索挂载！`,
                  ]
                : []),
              "",
              "---",
              `### 🎁 实战资产沉淀与社区共享菜单（任务号：\`${task.taskId}\` · 必须在最终回复末尾原样附带）`,
              `- 💾 **沉淀为本地可复用资产**：直接回复 **「存为技能」 / 「存为角色」 / 「存为全局规则」 / 「存为项目模板」**（可多选，默认存全局库并同步宿主 IDE；若仅对当前项目生效请补充“存当前项目”，系统将调用 \`vetoboard_distill_skill\` 自动落盘）；`,
              `- 🌍 **脱敏共享至官方资产库（方法 A）**：回复 **「预览推送」**（调用 \`vetoboard_contribute_asset({ action: "preview" })\` 先在本地剥离路径/密钥并展示预览单——收录进库后**仅用于项目升级或体验优化，且凭单号 100% 随时可撤回**）；`,
              ...(updateNotice.updateAvailable && updateNotice.bannerMarkdown
                ? [updateNotice.bannerMarkdown]
                : []),
              "",
              `> **⚠️ 给宿主 Agent 的聊天输出与退场铁律（禁止调用 \`ask_question\` 弹窗！）**：`,
              `> 1. 向用户汇报本轮结论时，必须保留 **跨角色交锋修正链**、**句末可点击文件内联角标**（如 \`[[S1·§1]](${fileUrl}#ref-s1-sec1)\`、\`[[V1]](${fileUrl}#ref-v1)\`）与上述三份 Markdown 文件链接；`,
              `> 2. **必须在汇报最末尾保留上方 2–3 行「🎁 实战资产沉淀与社区共享菜单」**（若有新版本提醒一并附带），让用户想存技能/模板、预览推送或一键更新时只需回一句话即可办理；`,
              `> 3. **输出完毕后立即干净退出 VetoBoard 多角色模式，回到普通对话模式**！`,
            ].join("\n")
          : [
              "",
              "### ✅ Dual-Layer Cited Audit Report Signed & Knowledge Card Saved (Exited VetoBoard Mode -> Back to Normal Chat)",
              `- Full Cited Report (\`-report.md\`): \`${primaryReportPath}\``,
              `- Cited Executive Briefing (\`-briefing.md\`): \`${primaryBriefingPath}\``,
              `- Raw Deliverables (\`-original-report.md\`): \`${primaryOriginalPath}\``,
              ...(savedKb
                ? [`- 📖 Distilled to Knowledge Base: **${savedKb.title}** (\`${savedKb.knowledgeId}\`)`]
                : []),
              "",
              "---",
              `### 🎁 Post-Task Asset Export & Community Contribution Menu (Task \`${task.taskId}\` · Append at Bottom of Final Reply)`,
              `- 💾 **Save as Reusable Local Assets**: Reply **"Save as skill" / "Save as role" / "Save as rule" / "Save as project template"** (defaults to global library + host IDE sync; say "workspace scope" for repo-local \`.agents/\`);`,
              `- 🌍 **Contribute to Official Library (Method A)**: Reply **"Preview contribution"** (runs local privacy scrubber first — collected into library **solely for project upgrades/optimization, and 100% withdrawable anytime**);`,
              ...(updateNotice.updateAvailable && updateNotice.bannerMarkdown
                ? [updateNotice.bannerMarkdown]
                : []),
              "",
              `> **⚠️ Host Chat Output & Clean-Exit Mandate (Do NOT call \`ask_question\`!)**: Preserve clickable inline citations (\`[[S1·§1]](${fileUrl}#ref-s1-sec1)\`, \`[[V1]](${fileUrl}#ref-v1)\`), include the concise 2–3 line **🎁 Post-Task Menu** at the very end of your reply, and **exit VetoBoard mode cleanly back to normal chat**!`,
            ].join("\n");
      }

      const progressBlock = ["```text", renderDockerBuildProgress(updatedTask), "```"].join("\n");
      const gateFeedback = gate.passed
        ? ""
        : `\n\n**${gate.summary}**:\n${gate.hardViolations.map((v) => `- ${v.ruleTitle}: ${v.reason}`).join("\n")}`;

      return textResult(
        `${progressBlock}${gateFeedback}\n\n${memorialCard}${peerDelivRes.peerNoticeMarkdown}${reportNotice}`,
        !gate.passed,
      );
      }),
  );

  // 8. Query Live Task Progress & Final Cited Report
  server.registerTool(
    "vetoboard_task_status",
    {
      description:
        "Inspect the live docker-build style multi-track progress tree, Catch Ticker, and final dual-layer cited report for an isolated taskId.",
      inputSchema: z.object({
        includeReport: z.boolean().default(false),
        taskId: z.string().min(1),
      }),
      title: "VetoBoard Task Status & Progress Tree",
    },
    async (args) => {
      const task = await store.getTask(args.taskId);
      if (!task) {
        return textResult(`Task not found: "${args.taskId}"`, true);
      }
      const tree = renderDockerBuildProgress(task);
      if (!args.includeReport) {
        return textResult(["```text", tree, "```"].join("\n"));
      }
      const finalReport = await store.readFinalReport(args.taskId);
      return textResult(
        finalReport
          ? `${["```text", tree, "```"].join("\n")}\n\n---\n\n${finalReport}`
          : ["```text", tree, "```"].join("\n"),
      );
    },
  );

  // 9. Multi-Target Standardized Asset Distiller (`SKILL.md` / `Role` / `Rule` / `.vetoboard-pack.json`)
  server.registerTool(
    "vetoboard_distill_skill",
    {
      description:
        "Autonomously distill a completed/active VetoBoard task (or structured SOP & pitfalls) into any combination of standardized cross-agent assets: `skill` (`SKILL.md` + optional host IDE sync), `role` (`RoleTemplate` JSON + `.md` agent), `rule` (idempotent guardrail rule `.md`), and `project-pack` (`.vetoboard-pack.json` full council lineup & model template).",
      inputSchema: z.object({
        alsoCreateRole: z
          .boolean()
          .default(false)
          .describe("Also hatch and save a companion standardized RoleTemplate JSON into library/roles/."),
        customRuleFilePath: z
          .string()
          .optional()
          .describe("Optional explicit file path (e.g. workspace AGENTS.md / GEMINI.md / CLAUDE.md) when 'rule' is in exportTargets."),
        description: z.string().optional(),
        exportTargets: z
          .array(z.enum(["skill", "role", "rule", "project-pack"]))
          .optional()
          .describe("Target asset formats to generate (defaults to ['skill']; supports any combination of 'skill', 'role', 'rule', 'project-pack')."),
        hostIdeRootOverride: z.string().optional(),
        lang: vetoboardLocaleInputSchema,
        mustUseTools: z.array(z.string()).optional(),
        pitfalls: z.array(z.string()).optional(),
        roleWeight: z.number().int().min(10).max(100).default(90),
        scope: z
          .enum(["user", "workspace"])
          .default("user")
          .describe("'user' saves globally to ~/.vetoboard-mcp/library/ (and optional host IDE config); 'workspace' saves to <workspaceDir>/.agents/."),
        skillId: z.string().optional().describe("Slug ID for the distilled asset, e.g. 'saas-mor-bep-audit'."),
        sopSteps: z.array(z.string()).optional(),
        syncToHostIde: z
          .boolean()
          .default(false)
          .describe("When true and scope='user', also syncs SKILL.md into existing ~/.gemini/config/skills, ~/.claude/skills, and ~/.codex/skills."),
        taskId: z.string().optional().describe("Completed or active VetoBoard taskId to distill from."),
        title: z.string().optional(),
        verificationChecklist: z.array(z.string()).optional(),
        workspaceDir: z.string().optional(),
      }),
      title: "VetoBoard Multi-Target Asset Distiller (Skill / Role / Rule / Project Pack)",
    },
    async (args) => {
      const task = args.taskId ? await store.getTask(args.taskId) : undefined;
      if (args.taskId && !task) {
        return textResult(`Task not found: "${args.taskId}"`, true);
      }
      const locale = resolveLocale(
        args.lang === "auto" ? defaultLang : args.lang,
        `${args.title ?? ""} ${args.description ?? ""} ${task?.goal ?? ""}`,
      );
      const res = await distillStandardizedSkill({
        alsoCreateRole: args.alsoCreateRole,
        customRuleFilePath: args.customRuleFilePath,
        dataRootDir: store.rootDir,
        description: args.description,
        exportTargets: args.exportTargets,
        hostIdeRootOverride: args.hostIdeRootOverride,
        locale,
        mustUseTools: args.mustUseTools,
        pitfalls: args.pitfalls,
        roleWeight: args.roleWeight,
        scope: args.scope,
        skillId: args.skillId,
        sopSteps: args.sopSteps,
        store,
        syncToHostIde: args.syncToHostIde,
        task: task ?? undefined,
        title: args.title,
        verificationChecklist: args.verificationChecklist,
        workspaceDir: args.workspaceDir,
      });
      return textResult(res.summaryMarkdown);
    },
  );

  // 10. Method A Standardized Asset Contribution & 1-Click Unconditional Withdrawal
  server.registerTool(
    "vetoboard_contribute_asset",
    {
      description:
        "Contribute a standardized Role, Skill, or Project Council Pack (`pack`) via Method A (privacy-scrubbed GitHub Issue/PR bundle) or withdraw a previous contribution. Enforces mandatory transparency: informs the user it will be collected into the VetoBoard library SOLELY for project upgrades/optimization, and can be withdrawn at any time.",
      inputSchema: z.object({
        action: z
          .enum(["preview", "submit", "withdraw", "list"])
          .default("preview")
          .describe("'preview' (default: scrub privacy & display mandatory library/upgrade-only/withdrawable notice), 'submit' (requires confirmedConsent=true), 'withdraw' (by submissionId), or 'list'."),
        assetId: z
          .string()
          .optional()
          .describe("Role ID, Skill ID, or Pack ID to preview/submit (required for 'preview' and 'submit')."),
        assetType: z.enum(["role", "skill", "pack"]).default("skill"),
        authorHandle: z.string().optional().describe("Optional GitHub handle for creator attribution."),
        autoRunGhCli: z
          .boolean()
          .default(false)
          .describe("When true, attempts to invoke local `gh` CLI automatically (falls back cleanly to 1-click GitHub URL)."),
        confirmedConsent: z
          .boolean()
          .default(false)
          .describe("Set true ONLY AFTER the user has read the preview notice (library collection, upgrade/optimization-only purpose, unconditional withdrawal right) and explicitly consented."),
        lang: vetoboardLocaleInputSchema,
        reason: z.string().optional().describe("Optional reason when action='withdraw'."),
        submissionId: z
          .string()
          .optional()
          .describe("Receipt ID (e.g. 'sub_...') required when action='withdraw'."),
        targetRepo: z.string().optional(),
        workspaceDir: z.string().optional(),
      }),
      title: "VetoBoard Method A Asset Contribution & Withdrawal",
    },
    async (args) => {
      const locale = resolveLocale(
        args.lang === "auto" ? defaultLang : args.lang,
        `${args.assetId ?? ""} ${args.reason ?? "中文"}`,
      );
      if (args.action === "list") {
        return textResult(
          await listAssetContributions({ dataRootDir: store.rootDir, locale }),
        );
      }
      if (args.action === "withdraw") {
        if (!args.submissionId?.trim()) {
          return textResult(
            locale === "zh"
              ? "撤回操作需要提供投递凭证号 `submissionId`（可先传 `action: \"list\"` 查看本地台账）。"
              : "Parameter `submissionId` is required for `action: \"withdraw\"`.",
            true,
          );
        }
        const wRes = await withdrawAssetContribution({
          autoRunGhCli: args.autoRunGhCli,
          dataRootDir: store.rootDir,
          locale,
          reason: args.reason,
          submissionId: args.submissionId,
        });
        return textResult(wRes.markdown, Boolean(wRes.isError));
      }

      if (!args.assetId?.trim()) {
        return textResult(
          locale === "zh"
            ? "请提供要预览或推送的标准化角色/技能 ID（`assetId`）。"
            : "Parameter `assetId` is required for `preview` / `submit`.",
          true,
        );
      }
      const res = await previewOrSubmitAssetContribution({
        action: args.action,
        assetId: args.assetId,
        assetType: args.assetType,
        authorHandle: args.authorHandle,
        autoRunGhCli: args.autoRunGhCli,
        confirmedConsent: args.confirmedConsent,
        dataRootDir: store.rootDir,
        locale,
        targetRepo: args.targetRepo,
        workspaceDir: args.workspaceDir,
      });
      return textResult(res.markdown, Boolean(res.isError));
    },
  );

  // 11. Non-Blocking Version Check & 1-Sentence Self-Updater (`git pull` + build OR `npm i -g vetoboard-mcp@latest`)
  server.registerTool(
    "vetoboard_self_update",
    {
      description:
        "Check for a newer `vetoboard-mcp` release or automatically pull & rebuild the latest version (supports both Git clone installs with dirty-tree protection and global npm installs). Call with `action: 'apply'` when the user says '更新 VetoBoard' / 'Update VetoBoard'.",
      inputSchema: z.object({
        action: z
          .enum(["check", "apply"])
          .default("check")
          .describe("'check' queries latest version; 'apply' pulls & builds (Git clone) or runs `npm install -g vetoboard-mcp@latest`."),
        dryRun: z
          .boolean()
          .default(false)
          .describe("When true with action='apply', verifies git cleanliness / install mode without mutating files."),
        lang: vetoboardLocaleInputSchema,
        registryUrlOverride: z.string().optional(),
        repoDirOverride: z.string().optional(),
      }),
      title: "VetoBoard Version Check & 1-Click Self-Updater",
    },
    async (args) => {
      const locale = resolveLocale(args.lang === "auto" ? defaultLang : args.lang, "中文");
      const res = await runSelfUpdate({
        action: args.action,
        currentVersion: options?.version ?? CURRENT_VETOBOARD_VERSION,
        dataRootDir: store.rootDir,
        dryRun: args.dryRun,
        locale,
        registryUrlOverride: args.registryUrlOverride,
        repoDirOverride: args.repoDirOverride,
      });
      return textResult(res.markdown, Boolean(res.isError));
    },
  );

  // Strip Zod v4 Draft-2020-12 `propertyNames` / union `additionalProperties` so DeepSeek API, OpenAI Codex, Gemini & Hermes parse all 13 tools with zero HTTP 400 errors!
  applyUniversalSchemaSanitizer(server);

  return server;
}
