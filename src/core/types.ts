import { z } from "zod";

export const DELEGATE_TO_AGENT_OPTION_ID = "__delegate_to_agent__";

export const vetoboardLocaleInputSchema = z
  .enum(["auto", "en", "zh"])
  .default("auto")
  .describe("Output language: 'en' (English), 'zh' (Simplified Chinese), or 'auto' (detect from input/env).");

export const executionModeSchema = z
  .enum(["host-subscription", "byok", "cloud-pool"])
  .default("host-subscription")
  .describe(
    "Compute routing tier: 'host-subscription' (0 external API tokens — drives host IDE subagents on user's existing subscription), 'byok' (custom OpenAI-compatible/relay endpoint), or 'cloud-pool' (VetoBoard Cloud managed pool).",
  );

export type VetoBoardExecutionMode = z.infer<typeof executionModeSchema>;

export const effortProfileSchema = z
  .enum(["fast", "deep"])
  .default("fast")
  .describe(
    "'fast' (8-12m executive synthesis + 1 final reconcile audit) or 'deep' (25-40m multi-round adversarial step inspection, up to 3 retries/step).",
  );

export type VetoBoardEffortProfile = z.infer<typeof effortProfileSchema>;

export const candidateRouteSchema = z.object({
  buyerLogic: z.string().min(1),
  complianceRedline: z.string().min(1),
  entryBarrier: z.string().min(1),
  fitSummary: z.string().optional(),
  routeId: z.string().min(1),
  title: z.string().min(1),
});

export type CandidateRoute = z.infer<typeof candidateRouteSchema>;

export const clarifyQuestionSchema = z.object({
  options: z
    .array(
      z.object({
        description: z.string().optional(),
        label: z.string().min(1),
        optionId: z.string().min(1),
      }),
    )
    .min(2),
  question: z.string().min(1),
  questionId: z.string().min(1),
  selectionMode: z.enum(["single", "multiple"]).default("multiple"),
});

export type ClarifyQuestion = z.infer<typeof clarifyQuestionSchema>;

export const goalClarificationPlanSchema = z.object({
  assumptions: z.array(z.string()).default([]),
  candidateRoutes: z.array(candidateRouteSchema).default([]),
  constraints: z.array(z.string()).default([]),
  delegateOptionId: z.literal(DELEGATE_TO_AGENT_OPTION_ID),
  expectedOutcome: z.string().optional(),
  goal: z.string().min(1),
  locale: z.enum(["en", "zh"]),
  questions: z.array(clarifyQuestionSchema).default([]),
  taskMode: z.enum(["exploratory", "convergent"]),
  unresolved: z.array(z.string()).default([]),
});

export type GoalClarificationPlan = z.infer<typeof goalClarificationPlanSchema>;

export const executableRuleSchema = z.object({
  description: z.string().optional(),
  enforcement: z.enum(["hard", "soft"]).default("hard"),
  escalateOnTrigger: z.boolean().default(false),
  forbiddenPatterns: z.array(z.string()).default([]),
  mustIncludeKeywords: z.array(z.string()).default([]),
  mustInvokeSkills: z.array(z.string()).default([]),
  mustUseTools: z.array(z.string()).default([]),
  ruleId: z.string().min(1),
  title: z.string().min(1),
});

export type ExecutableRule = z.infer<typeof executableRuleSchema>;

export const rolePriorityTierSchema = z.enum(["primary", "guardrail", "secondary"]);
export type RolePriorityTier = z.infer<typeof rolePriorityTierSchema>;

export const roleModelBindingSchema = z.object({
  apiBaseUrl: z.string().min(1).optional(),
  hostModelTier: z.enum(["inherit", "pro", "flash", "flash_lite"]).optional(),
  kind: z.enum(["host-tier", "byok", "cloud-pool"]).default("host-tier"),
  modelId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  reasoningLevel: z.enum(["low", "medium", "high"]).optional(),
});

export type RoleModelBinding = z.infer<typeof roleModelBindingSchema>;

export const roleTemplateSchema = z.object({
  allowedTools: z.array(z.string()).default([]),
  domain: z.enum(["commercial", "engineering", "compliance", "swe", "inspection"]),
  evidenceRequirements: z.array(z.string()).default([]),
  executableRules: z.array(executableRuleSchema).default([]),
  kind: z.enum(["professional", "inspector"]),
  modelBinding: roleModelBindingSchema.optional(),
  name: z.object({ en: z.string(), zh: z.string() }),
  priorityTier: rolePriorityTierSchema,
  readOnly: z.boolean().default(false),
  roleId: z.string().min(1),
  systemCharter: z.object({ en: z.string(), zh: z.string() }),
  weight: z.number().int().min(10).max(100),
});

export type RoleTemplate = z.infer<typeof roleTemplateSchema>;

export const catchEventSchema = z.object({
  category: z.enum(["math_mismatch", "compliance_redline", "rule_violation", "evidence_verified", "premise_conflict"]),
  detail: z.string().min(1),
  roleName: z.string().min(1),
  timestamp: z.string().min(1),
});

export type CatchEvent = z.infer<typeof catchEventSchema>;

export const customRoleInputSchema = z.object({
  charter: z.string().min(1).describe("System charter / auditing mandate for this custom specialist role."),
  forbiddenPatterns: z.array(z.string()).optional(),
  modelBinding: roleModelBindingSchema
    .optional()
    .describe("Optional per-role model binding (e.g. hostModelTier='pro'|'flash' or independent BYOK modelId/providerId)."),
  mustIncludeKeywords: z.array(z.string()).optional(),
  mustUseTools: z.array(z.string()).optional(),
  priorityTier: rolePriorityTierSchema.default("primary"),
  roleId: z.string().min(1).describe("Short slug id, e.g. 'cross-border-tax' or 'secops-auditor'."),
  title: z.string().min(1).describe("Display name of the custom role."),
  weight: z.number().int().min(10).max(100).default(90),
});

export type CustomRoleInput = z.infer<typeof customRoleInputSchema>;

export const taskTrackStateSchema = z.object({
  boundSkillIds: z.array(z.string()).default([]),
  catches: z.array(catchEventSchema).default([]),
  customCharter: z.string().optional(),
  customRules: z.array(executableRuleSchema).optional(),
  dependsOn: z.array(z.string()).default([]),
  durationMs: z.number().nonnegative().default(0),
  isTerminal: z.boolean().optional(),
  maxRetries: z.number().int().positive().default(3),
  modelBinding: roleModelBindingSchema.optional(),
  outputPath: z.string().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  roleId: z.string().min(1),
  roleLabel: z.string().min(1),
  startedAt: z.string().optional(),
  status: z.enum(["pending", "running", "reworking", "passed", "failed", "paused", "skipped"]),
  summaryLine: z.string().optional(),
  tierLabel: z.string().min(1),
  title: z.string().min(1),
  trackId: z.string().min(1),
  wave: z.number().int().positive(),
  weight: z.number().int().min(10).max(100),
});

export type TaskTrackState = z.infer<typeof taskTrackStateSchema>;

export const deliberationOpinionSchema = z.object({
  altersCorePremise: z.boolean().optional(),
  constructiveAlternative: z.string().optional(),
  keyConstraints: z.array(z.string()).default([]),
  priorityTier: rolePriorityTierSchema,
  replyTo: z.array(z.string()).default([]),
  roleId: z.string().min(1),
  roleLabel: z.string().min(1),
  round: z.union([z.literal(1), z.literal(2)]),
  stance: z.enum(["support", "caution", "challenge"]).default("support"),
  summary: z.string().min(1),
  trackId: z.string().min(1),
  updatedAt: z.string().min(1),
  weight: z.number().int().min(10).max(100),
});

export type DeliberationOpinion = z.infer<typeof deliberationOpinionSchema>;

export const knowledgeCardSchema = z.object({
  createdAt: z.string().min(1),
  domain: z.enum(["commercial", "swe"]).default("commercial"),
  goal: z.string().min(1),
  knowledgeId: z.string().min(1),
  lockedSharedContract: z.string().optional(),
  reportPath: z.string().optional(),
  tags: z.array(z.string()).default([]),
  taskId: z.string().min(1),
  title: z.string().min(1),
  verifiedDigest: z.string().min(1),
});

export type KnowledgeCard = z.infer<typeof knowledgeCardSchema>;

export const whiteboardEntrySchema = z.object({
  ownedDimensions: z.array(z.string()).default([]),
  revision: z.number().int().positive().default(1),
  roleId: z.string().min(1),
  roleLabel: z.string().min(1),
  summary: z.string().min(1),
  trackId: z.string().min(1),
  updatedAt: z.string().min(1),
  variables: z.record(z.string(), z.string()).default({}),
  weight: z.number().int().min(10).max(100),
});

export type WhiteboardEntry = z.infer<typeof whiteboardEntrySchema>;

export const whiteboardReactionSchema = z.object({
  decision: z.enum(["approve", "conditional", "oppose"]).default("approve"),
  hardVetoEvidence: z.string().optional(),
  neededDimensions: z.array(z.string()).default([]),
  note: z.string().min(1),
  reviewerLabel: z.string().min(1),
  reviewerRoleId: z.string().min(1),
  reviewerTrackId: z.string().min(1),
  round: z.number().int().positive().default(1),
  targetTrackIds: z.array(z.string()).default([]),
  updatedAt: z.string().min(1),
  weight: z.number().int().min(10).max(100),
});

export type WhiteboardReaction = z.infer<typeof whiteboardReactionSchema>;

export const hostModelCandidateSchema = z.object({
  family: z.string().optional().describe("Model family/vendor e.g. 'claude', 'gemini', 'gpt', 'deepseek'."),
  id: z.string().min(1).describe("Model identifier accepted by the host platform (e.g. 'claude-opus-4-6-thinking', 'opus', 'gpt-5', 'gemini-3.8-flash-high')."),
  label: z.string().optional().describe("Human-readable display name."),
  quotaRemaining: z.string().optional().describe("Optional remaining quota indicator, e.g. '100%' or '79%'."),
  tier: z.enum(["frontier", "balanced", "fast"]).optional(),
});

export type HostModelCandidate = z.infer<typeof hostModelCandidateSchema>;

export const roleQuotaAllocationSchema = z.object({
  baseHelpers: z.number().int().nonnegative(),
  baseResearch: z.number().int().nonnegative(),
  burstEligible: z.boolean().default(false),
  burstFrozenByRework: z.boolean().default(false),
  burstHelpersCap: z.number().int().nonnegative(),
  burstHelpersUsed: z.number().int().nonnegative().default(0),
  burstResearchCap: z.number().int().nonnegative(),
  burstResearchUsed: z.number().int().nonnegative().default(0),
  helpersReflowed: z.number().int().nonnegative().default(0),
  helpersUsed: z.number().int().nonnegative().default(0),
  isDynamicPeer: z.boolean().optional(),
  maxModelSteps: z.number().int().positive(),
  maxSameDomainFetches: z.number().int().nonnegative(),
  priorityTier: rolePriorityTierSchema,
  researchReflowed: z.number().int().nonnegative().default(0),
  researchUsed: z.number().int().nonnegative().default(0),
  roleId: z.string().min(1),
  roleLabel: z.string().min(1),
  settledBoardPrep: z.boolean().optional(),
  settledDeliverable: z.boolean().optional(),
  trackId: z.string().min(1),
  webCapable: z.boolean().default(true),
  weight: z.number().int().min(10).max(100),
});

export type RoleQuotaAllocation = z.infer<typeof roleQuotaAllocationSchema>;

export const quotaPoolSnapshotSchema = z.object({
  allocations: z.array(roleQuotaAllocationSchema).default([]),
  baseHelpersPool: z.number().int().nonnegative(),
  baseResearchPool: z.number().int().nonnegative(),
  burstHelpersPool: z.number().int().nonnegative(),
  burstHelpersUsed: z.number().int().nonnegative().default(0),
  burstResearchPool: z.number().int().nonnegative(),
  burstResearchUsed: z.number().int().nonnegative().default(0),
  inspectorProtectedResearch: z.number().int().nonnegative().default(6),
  reflowedHelpersTotal: z.number().int().nonnegative().default(0),
  reflowedResearchTotal: z.number().int().nonnegative().default(0),
  sharedHelpersAvailable: z.number().int().nonnegative(),
  sharedResearchAvailable: z.number().int().nonnegative(),
  totalHelpersCap: z.number().int().nonnegative(),
  totalHelpersUsed: z.number().int().nonnegative().default(0),
  totalResearchCap: z.number().int().nonnegative(),
  totalResearchUsed: z.number().int().nonnegative().default(0),
  updatedAt: z.string().min(1),
});

export type QuotaPoolSnapshot = z.infer<typeof quotaPoolSnapshotSchema>;

export const peerRoleRequestInputSchema = z.object({
  charter: z
    .string()
    .optional()
    .describe("Optional custom charter if requesting a bespoke peer role not in the built-in 16-role catalog."),
  priorityTier: rolePriorityTierSchema
    .optional()
    .describe("Optional Borg priority tier ('primary' | 'guardrail' | 'secondary'); defaults to 'guardrail'."),
  reason: z
    .string()
    .min(1)
    .describe("Concrete cross-domain or cross-OWNERS gap requiring this peer specialist."),
  roleId: z
    .string()
    .min(1)
    .describe("Built-in roleId (e.g. 'legal-advisor', 'frontend-engineer'), 'spawn:<skillId>', or custom slug."),
  title: z.string().optional().describe("Optional display title when creating a bespoke custom peer role."),
  webCapable: z
    .boolean()
    .optional()
    .describe("Set false for pure local coding roles that need zero external web search quota."),
  weight: z.number().int().min(10).max(100).optional(),
});

export type PeerRoleRequestInput = z.infer<typeof peerRoleRequestInputSchema>;

export const peerRoleRequestRecordSchema = z.object({
  charter: z.string().optional(),
  createdAt: z.string().min(1),
  decidedAt: z.string().optional(),
  pairedInspectorRoleId: z.string().optional(),
  priorityTier: rolePriorityTierSchema.default("guardrail"),
  reason: z.string().min(1),
  requestId: z.string().min(1),
  requestedByRoleLabel: z.string().min(1),
  requestedByTrackId: z.string().min(1),
  roleId: z.string().min(1),
  spawnedTrackId: z.string().optional(),
  status: z.enum(["auto_approved", "pending_user_approval", "user_approved", "user_rejected"]),
  title: z.string().optional(),
  webCapable: z.boolean().optional(),
  weight: z.number().int().min(10).max(100).default(85),
});

export type PeerRoleRequestRecord = z.infer<typeof peerRoleRequestRecordSchema>;

export const vetoboardTaskRecordSchema = z.object({
  allowOfflineAssumptions: z.boolean().default(false),
  calcChecksVerifiedCount: z.number().int().nonnegative().default(0),
  candidateRoutes: z.array(candidateRouteSchema).default([]),
  confirmedNotes: z.string().optional(),
  createdAt: z.string().min(1),
  deliberationOpinions: z.array(deliberationOpinionSchema).default([]),
  deliberationPhase: z
    .enum([
      "round1",
      "round2",
      "paused_conflict",
      "awaiting_peer_approval",
      "contract_locked",
      "skipped",
    ])
    .default("round1"),
  domain: z.enum(["commercial", "swe"]).default("commercial"),
  dynamicPeerRolesUsed: z.number().int().nonnegative().default(0),
  effortProfile: effortProfileSchema,
  executionMode: executionModeSchema,
  goal: z.string().min(1),
  lineupRationale: z.array(z.string()).default([]),
  locale: z.enum(["en", "zh"]),
  lockedSharedContract: z.string().optional(),
  maxDynamicPeerRoles: z.number().int().nonnegative().default(2),
  minorityReportMarkdown: z.string().optional(),
  mountedKnowledgeIds: z.array(z.string()).default([]),
  mountedKnowledgeMarkdown: z.string().optional(),
  peerRoleRequests: z.array(peerRoleRequestRecordSchema).default([]),
  quotaPool: quotaPoolSnapshotSchema.optional(),
  selectedRouteIds: z.array(z.string()).default([]),
  sessionId: z.string().optional(),
  status: z.enum(["clarifying", "running", "paused", "completed", "failed"]),
  taskId: z.string().min(1),
  taskMode: z.enum(["exploratory", "convergent"]),
  topologyMode: z
    .enum(["whiteboard-electre", "deliberate-then-parallel", "causal-dag", "flat"])
    .default("whiteboard-electre"),
  tracks: z.array(taskTrackStateSchema).default([]),
  updatedAt: z.string().min(1),
  whiteboardEntries: z.array(whiteboardEntrySchema).default([]),
  whiteboardReactions: z.array(whiteboardReactionSchema).default([]),
  whiteboardRound: z.number().int().nonnegative().default(0),
  workspaceDir: z.string().optional(),
});

export type VetoBoardTaskRecord = z.infer<typeof vetoboardTaskRecordSchema>;

export const vetoboardAssetPackSchema = z.object({
  author: z.string().optional(),
  description: z.object({ en: z.string(), zh: z.string() }),
  exportedAt: z.string().min(1),
  format: z.literal("vetoboard-asset-pack").default("vetoboard-asset-pack"),
  name: z.object({ en: z.string(), zh: z.string() }),
  packId: z.string().min(1),
  roles: z.array(roleTemplateSchema).default([]),
  schemaVersion: z.literal(1),
  skills: z
    .array(
      z.object({
        content: z.object({ en: z.string(), zh: z.string() }),
        skillId: z.string().min(1),
        title: z.object({ en: z.string(), zh: z.string() }),
      }),
    )
    .default([]),
});

export type VetoBoardAssetPack = z.infer<typeof vetoboardAssetPackSchema>;

export const contributionReceiptSchema = z.object({
  assetId: z.string().min(1),
  assetType: z.enum(["role", "skill", "pack"]),
  authorHandle: z.string().optional(),
  bundlePath: z.string().min(1),
  createdAt: z.string().min(1),
  issueUrl: z.string().optional(),
  prefilledIssueUrl: z.string().min(1),
  purposeScope: z.literal("project_upgrade_and_optimization_only"),
  redactedCount: z.number().int().nonnegative().default(0),
  status: z.enum(["submitted", "withdrawn"]).default("submitted"),
  submissionId: z.string().min(1),
  targetRepo: z.string().min(1),
  title: z.string().min(1),
  withdrawIssueUrl: z.string().optional(),
  withdrawReason: z.string().optional(),
  withdrawable: z.literal(true),
  withdrawnAt: z.string().optional(),
});

export type ContributionReceipt = z.infer<typeof contributionReceiptSchema>;
