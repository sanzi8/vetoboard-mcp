import type { VetoBoardLocale } from "../i18n/locales.js";
import type {
  QuotaPoolSnapshot,
  RolePriorityTier,
  RoleQuotaAllocation,
  RoleTemplate,
  VetoBoardEffortProfile,
} from "./types.js";

/**
 * Google Borg-Style Weighted Elastic Quota Pool + Stage Reflow + SRE Rework Freeze (`borgQuotaPool.ts`).
 *
 * Bridges role authority weights (`95` Primary / `85` Guardrail / `55` Secondary) directly into
 * execution compute, web-research quotas, and read-only Explore helper budgets:
 *   1. Task-level Base Pool + `+25%` Preemptible Burst Pool (pure local coding roles with no web tools
 *      are excluded from the web-research pool denominator so they never dilute research seats).
 *   2. Weight-proportional QoS envelopes (`Q_i = Q_pool * (w_i / sum(w_j))`):
 *      - `primary (w >= 90)`: absorbs secondary surplus; `deep` mode grants `4–5` base + `1–2` burst = `5–6`
 *        read-only helpers, `20–26` base + `8` burst = `28–34` (`25+`) web calls, `34` model steps (`fast` mode
 *        keeps Swarm lean at `<=2` optional helpers & `14–18` + `6` = `20–24` web calls, `24` steps).
 *      - `guardrail (70 <= w < 90)`: `deep` `2–4` + `1` helpers, `14–20` + `4` web calls, `26` steps
 *        (`fast` `0–1` helpers, `10–13` + `3` web calls, `18` steps).
 *      - `secondary (w < 70)`: strictly capped (`deep`: `1` helper, `6–8` web calls, `18` steps;
 *        `fast`: `0` helpers, `4–6` web calls, `12` steps) with `burstEligible = false` (zero burst preemption).
 *   3. Zero-Token Checkpoint Reflow: unspent base quota from Stage W1 (`board_post`) or completed tracks
 *      reflows automatically into `sharedResearchAvailable` / `sharedHelpersAvailable` to feed Stage W3
 *      deep dives and `RequestPeerRole` dynamic peer specialists.
 *   4. SRE Error-Budget Rework Freeze & Protected Inspector Pool: tracks rejected into `reworking` lose
 *      burst preemption (`burstFrozenByRework = true`); `quality-inspector` keeps an isolated protected audit pool.
 */

export const DEFAULT_BORG_DEEP_BASE_HELPERS_POOL = 12;
export const DEFAULT_BORG_DEEP_BASE_RESEARCH_POOL = 60;
export const DEFAULT_BORG_FAST_BASE_HELPERS_POOL = 4;
export const DEFAULT_BORG_FAST_BASE_RESEARCH_POOL = 36;
export const DEFAULT_BORG_BURST_RATIO = 0.25;

const WEB_CAPABLE_TOOL_NAMES = new Set([
  "websearch",
  "webfetch",
  "search_web",
  "web_search",
  "web_fetch",
  "read_url_content",
]);

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function isRoleTemplateWebCapable(
  tpl?: Pick<RoleTemplate, "allowedTools"> | undefined,
  explicitOverride?: boolean,
): boolean {
  if (explicitOverride !== undefined) return explicitOverride;
  if (!tpl) return true;
  if (tpl.allowedTools.length === 0) return true;
  return tpl.allowedTools.some((tool) => WEB_CAPABLE_TOOL_NAMES.has(tool.trim().toLowerCase()));
}

export function resolveBorgPriorityTierFromWeight(
  weight: number,
  fallbackTier?: RolePriorityTier,
  weightExplicitlyAdjusted = true,
): RolePriorityTier {
  const clamped = clampInt(weight, 10, 100);
  if (weightExplicitlyAdjusted || !fallbackTier) {
    return clamped >= 90 ? "primary" : clamped >= 70 ? "guardrail" : "secondary";
  }
  return fallbackTier;
}

export interface BorgTrackSeed {
  readonly trackId: string;
  readonly roleId: string;
  readonly roleLabel: string;
  readonly weight: number;
  readonly priorityTier?: RolePriorityTier;
  readonly kind?: "professional" | "inspector";
  readonly webCapable?: boolean;
  readonly isDynamicPeer?: boolean;
}

export interface ComputeInitialBorgQuotaPoolParams {
  readonly effortProfile: VetoBoardEffortProfile;
  readonly tracks: readonly BorgTrackSeed[];
  readonly baseHelpersPoolOverride?: number;
  readonly baseResearchPoolOverride?: number;
  readonly burstRatio?: number;
  readonly nowIso?: string;
}

export function computeInitialBorgQuotaPool(
  params: ComputeInitialBorgQuotaPoolParams,
): QuotaPoolSnapshot {
  const now = params.nowIso ?? new Date().toISOString();
  const deep = params.effortProfile === "deep";
  const burstRatio =
    params.burstRatio !== undefined && params.burstRatio >= 0
      ? params.burstRatio
      : DEFAULT_BORG_BURST_RATIO;
  const inspectorProtectedResearch = deep ? 10 : 6;

  const execSeeds = params.tracks.filter(
    (t) => t.kind !== "inspector" && t.roleId !== "quality-inspector",
  );

  if (execSeeds.length === 0) {
    return {
      allocations: [],
      baseHelpersPool: 0,
      baseResearchPool: 0,
      burstHelpersPool: 0,
      burstHelpersUsed: 0,
      burstResearchPool: 0,
      burstResearchUsed: 0,
      inspectorProtectedResearch,
      reflowedHelpersTotal: 0,
      reflowedResearchTotal: 0,
      sharedHelpersAvailable: 0,
      sharedResearchAvailable: 0,
      totalHelpersCap: 0,
      totalHelpersUsed: 0,
      totalResearchCap: 0,
      totalResearchUsed: 0,
      updatedAt: now,
    };
  }

  const enriched = execSeeds.map((seed) => {
    const weight = clampInt(seed.weight, 10, 100);
    const priorityTier = resolveBorgPriorityTierFromWeight(weight, seed.priorityTier, true);
    const webCapable = seed.webCapable !== false;
    return { priorityTier, seed, webCapable, weight };
  });

  const webItems = enriched.filter((item) => item.webCapable);
  let baseHelpersPool =
    params.baseHelpersPoolOverride !== undefined
      ? Math.max(execSeeds.length, Math.round(params.baseHelpersPoolOverride))
      : deep
        ? Math.max(DEFAULT_BORG_DEEP_BASE_HELPERS_POOL, execSeeds.length * 3)
        : Math.max(DEFAULT_BORG_FAST_BASE_HELPERS_POOL, execSeeds.length);

  let baseResearchPool =
    webItems.length === 0
      ? 0
      : params.baseResearchPoolOverride !== undefined
        ? Math.max(webItems.length * 5, Math.round(params.baseResearchPoolOverride))
        : deep
          ? Math.max(DEFAULT_BORG_DEEP_BASE_RESEARCH_POOL, webItems.length * 15)
          : Math.max(DEFAULT_BORG_FAST_BASE_RESEARCH_POOL, webItems.length * 10);

  const secondaryItems = enriched.filter((item) => item.priorityTier === "secondary");
  const coreItems = enriched.filter((item) => item.priorityTier !== "secondary");

  // 1) Read-Only Explore Helpers split (`deep` full dual-layer vs `fast` flat-first anti-429 cap)
  const baseHelpersByTrack = new Map<string, number>();
  const secondaryHelperFloor = deep ? 1 : 0;
  for (const sec of secondaryItems) {
    baseHelpersByTrack.set(sec.seed.trackId, secondaryHelperFloor);
  }
  const remainingHelpersForCore = Math.max(
    0,
    baseHelpersPool - secondaryItems.length * secondaryHelperFloor,
  );
  const coreWeightSum = Math.max(
    1,
    coreItems.reduce((acc, item) => acc + item.weight, 0),
  );
  for (const item of coreItems) {
    const rawShare = remainingHelpersForCore * (item.weight / coreWeightSum);
    const baseH = deep
      ? item.priorityTier === "primary"
        ? clampInt(rawShare, 4, 5)
        : clampInt(rawShare, 2, 4)
      : item.priorityTier === "primary"
        ? clampInt(rawShare, 1, 2)
        : 0;
    baseHelpersByTrack.set(item.seed.trackId, baseH);
  }

  // 2) External Web-Research split (ONLY across `webCapable` tracks!)
  const baseResearchByTrack = new Map<string, number>();
  const totalWebWeight = Math.max(
    1,
    webItems.reduce((acc, item) => acc + item.weight, 0),
  );
  const secondaryWebItems = webItems.filter((item) => item.priorityTier === "secondary");
  const coreWebItems = webItems.filter((item) => item.priorityTier !== "secondary");

  let secondaryResearchSum = 0;
  for (const sec of secondaryWebItems) {
    const rawShare = baseResearchPool * (sec.weight / totalWebWeight);
    const share = deep
      ? clampInt(Math.min(rawShare, 6 + ((clampInt(sec.weight, 30, 69) - 30) / 39) * 2), 6, 8)
      : clampInt(Math.min(rawShare, 4 + ((clampInt(sec.weight, 30, 69) - 30) / 39) * 2), 4, 6);
    baseResearchByTrack.set(sec.seed.trackId, share);
    secondaryResearchSum += share;
  }

  const remainingResearchForCore = Math.max(0, baseResearchPool - secondaryResearchSum);
  const coreWebWeightSum = Math.max(
    1,
    coreWebItems.reduce((acc, item) => acc + item.weight, 0),
  );
  for (const item of coreWebItems) {
    const rawShare = remainingResearchForCore * (item.weight / coreWebWeightSum);
    const baseR = deep
      ? item.priorityTier === "primary"
        ? clampInt(rawShare, 20, 26)
        : clampInt(rawShare, 14, 20)
      : item.priorityTier === "primary"
        ? clampInt(rawShare, 14, 18)
        : clampInt(rawShare, 10, 13);
    baseResearchByTrack.set(item.seed.trackId, baseR);
  }

  const allocatedHelpersSum = [...baseHelpersByTrack.values()].reduce((a, b) => a + b, 0);
  const allocatedResearchSum = [...baseResearchByTrack.values()].reduce((a, b) => a + b, 0);
  if (allocatedHelpersSum > baseHelpersPool) baseHelpersPool = allocatedHelpersSum;
  if (allocatedResearchSum > baseResearchPool) baseResearchPool = allocatedResearchSum;

  const burstHelpersPool = baseHelpersPool > 0 ? Math.ceil(baseHelpersPool * burstRatio) : 0;
  const burstResearchPool = baseResearchPool > 0 ? Math.ceil(baseResearchPool * burstRatio) : 0;
  const totalHelpersCap = baseHelpersPool + burstHelpersPool;
  const totalResearchCap = baseResearchPool + burstResearchPool;

  const allocations: RoleQuotaAllocation[] = enriched.map((item) => {
    const baseHelpers = baseHelpersByTrack.get(item.seed.trackId) ?? 0;
    const baseResearch = item.webCapable
      ? (baseResearchByTrack.get(item.seed.trackId) ?? (deep ? 6 : 4))
      : 0;
    const burstHelpersCap = deep
      ? item.priorityTier === "primary"
        ? Math.max(1, 6 - baseHelpers)
        : item.priorityTier === "guardrail"
          ? 1
          : 0
      : item.priorityTier === "primary"
        ? 1
        : 0;
    const burstResearchCap = !item.webCapable
      ? 0
      : deep
        ? item.priorityTier === "primary"
          ? Math.max(6, 30 - baseResearch)
          : item.priorityTier === "guardrail"
            ? 4
            : 0
        : item.priorityTier === "primary"
          ? 6
          : item.priorityTier === "guardrail"
            ? 3
            : 0;
    const maxModelSteps = deep
      ? item.priorityTier === "primary"
        ? 34
        : item.priorityTier === "guardrail"
          ? 26
          : 18
      : item.priorityTier === "primary"
        ? 24
        : item.priorityTier === "guardrail"
          ? 18
          : 12;
    const maxSameDomainFetches = !item.webCapable
      ? 0
      : item.priorityTier === "primary"
        ? deep
          ? 8
          : 6
        : item.priorityTier === "guardrail"
          ? deep
            ? 5
            : 4
          : 3;

    return {
      baseHelpers,
      baseResearch,
      burstEligible: item.priorityTier !== "secondary",
      burstFrozenByRework: false,
      burstHelpersCap,
      burstHelpersUsed: 0,
      burstResearchCap,
      burstResearchUsed: 0,
      helpersReflowed: 0,
      helpersUsed: 0,
      ...(item.seed.isDynamicPeer ? { isDynamicPeer: true } : {}),
      maxModelSteps,
      maxSameDomainFetches,
      priorityTier: item.priorityTier,
      researchReflowed: 0,
      researchUsed: 0,
      roleId: item.seed.roleId,
      roleLabel: item.seed.roleLabel,
      trackId: item.seed.trackId,
      webCapable: item.webCapable,
      weight: item.weight,
    };
  });

  const unallocatedBaseHelpers = Math.max(0, baseHelpersPool - allocatedHelpersSum);
  const unallocatedBaseResearch = Math.max(0, baseResearchPool - allocatedResearchSum);

  return {
    allocations,
    baseHelpersPool,
    baseResearchPool,
    burstHelpersPool,
    burstHelpersUsed: 0,
    burstResearchPool,
    burstResearchUsed: 0,
    inspectorProtectedResearch,
    reflowedHelpersTotal: 0,
    reflowedResearchTotal: 0,
    sharedHelpersAvailable: unallocatedBaseHelpers + burstHelpersPool,
    sharedResearchAvailable: unallocatedBaseResearch + burstResearchPool,
    totalHelpersCap,
    totalHelpersUsed: 0,
    totalResearchCap,
    totalResearchUsed: 0,
    updatedAt: now,
  };
}

export interface BorgStageSlice {
  readonly trackId: string;
  readonly priorityTier: RolePriorityTier;
  readonly weight: number;
  readonly stageBaseHelpers: number;
  readonly stageBurstHelpersCap: number;
  readonly stageBaseResearch: number;
  readonly stageBurstResearchCap: number;
  readonly maxModelSteps: number;
  readonly maxSameDomainFetches: number;
  readonly burstEligible: boolean;
  readonly burstFrozenByRework: boolean;
}

export function getBorgStageSlice(
  pool: QuotaPoolSnapshot,
  params: {
    readonly trackId: string;
    readonly stage: "board_post" | "deliverable";
    readonly isReworkAttempt?: boolean;
  },
): BorgStageSlice | undefined {
  const alloc = pool.allocations.find((a) => a.trackId === params.trackId);
  if (!alloc) return undefined;

  if (params.isReworkAttempt || alloc.burstFrozenByRework) {
    return {
      burstEligible: false,
      burstFrozenByRework: true,
      maxModelSteps: 14,
      maxSameDomainFetches: alloc.webCapable ? 3 : 0,
      priorityTier: alloc.priorityTier,
      stageBaseHelpers: alloc.baseHelpers > 0 ? 1 : 0,
      stageBaseResearch: alloc.webCapable ? 5 : 0,
      stageBurstHelpersCap: 0,
      stageBurstResearchCap: 0,
      trackId: alloc.trackId,
      weight: alloc.weight,
    };
  }

  if (params.stage === "board_post") {
    const prepResearch = !alloc.webCapable
      ? 0
      : clampInt(Math.ceil(alloc.baseResearch * 0.35), 2, 9);
    const prepHelpers = alloc.baseHelpers >= 4 ? 2 : alloc.baseHelpers >= 2 ? 1 : 0;
    return {
      burstEligible: false,
      burstFrozenByRework: false,
      maxModelSteps: Math.max(10, Math.ceil(alloc.maxModelSteps * 0.45)),
      maxSameDomainFetches: alloc.webCapable ? Math.min(3, alloc.maxSameDomainFetches) : 0,
      priorityTier: alloc.priorityTier,
      stageBaseHelpers: prepHelpers,
      stageBaseResearch: prepResearch,
      stageBurstHelpersCap: 0,
      stageBurstResearchCap: 0,
      trackId: alloc.trackId,
      weight: alloc.weight,
    };
  }

  const baseResearchUsedSoFar = Math.max(0, alloc.researchUsed - alloc.burstResearchUsed);
  const baseHelpersUsedSoFar = Math.max(0, alloc.helpersUsed - alloc.burstHelpersUsed);
  const remainingBaseResearch = !alloc.webCapable
    ? 0
    : Math.max(3, alloc.baseResearch - baseResearchUsedSoFar);
  const remainingBaseHelpers = Math.max(0, alloc.baseHelpers - baseHelpersUsedSoFar);

  const burstResearchGrant =
    alloc.burstEligible && alloc.webCapable
      ? Math.min(
          Math.max(0, alloc.burstResearchCap - alloc.burstResearchUsed),
          pool.sharedResearchAvailable,
        )
      : 0;
  const burstHelpersGrant = alloc.burstEligible
    ? Math.min(
        Math.max(0, alloc.burstHelpersCap - alloc.burstHelpersUsed),
        pool.sharedHelpersAvailable,
      )
    : 0;

  return {
    burstEligible: alloc.burstEligible,
    burstFrozenByRework: alloc.burstFrozenByRework,
    maxModelSteps: alloc.maxModelSteps,
    maxSameDomainFetches: alloc.maxSameDomainFetches,
    priorityTier: alloc.priorityTier,
    stageBaseHelpers: remainingBaseHelpers,
    stageBaseResearch: remainingBaseResearch,
    stageBurstHelpersCap: burstHelpersGrant,
    stageBurstResearchCap: burstResearchGrant,
    trackId: alloc.trackId,
    weight: alloc.weight,
  };
}

export function freezeTrackBurstOnRework(
  pool: QuotaPoolSnapshot,
  trackId: string,
  nowIso = new Date().toISOString(),
): QuotaPoolSnapshot {
  const idx = pool.allocations.findIndex((a) => a.trackId === trackId);
  if (idx < 0) return pool;
  const nextAllocations = pool.allocations.slice();
  nextAllocations[idx] = {
    ...nextAllocations[idx]!,
    burstFrozenByRework: true,
  };
  return {
    ...pool,
    allocations: nextAllocations,
    updatedAt: nowIso,
  };
}

export function settleBorgStageCompletion(
  pool: QuotaPoolSnapshot,
  params: {
    readonly trackId: string;
    readonly stage: "board_post" | "deliverable";
    readonly researchUsedInStage: number;
    readonly helpersUsedInStage?: number;
    readonly isReworkAttempt?: boolean;
    readonly nowIso?: string;
  },
): {
  readonly pool: QuotaPoolSnapshot;
  readonly reflowedResearch: number;
  readonly reflowedHelpers: number;
  readonly burstResearchClaimed: number;
} {
  const idx = pool.allocations.findIndex((a) => a.trackId === params.trackId);
  if (idx < 0) {
    return { burstResearchClaimed: 0, pool, reflowedHelpers: 0, reflowedResearch: 0 };
  }
  const alloc = pool.allocations[idx]!;
  // Idempotent guard against duplicate non-rework settlement on same stage
  if (!params.isReworkAttempt) {
    if (params.stage === "board_post" && alloc.settledBoardPrep) {
      return { burstResearchClaimed: 0, pool, reflowedHelpers: 0, reflowedResearch: 0 };
    }
    if (params.stage === "deliverable" && alloc.settledDeliverable) {
      return { burstResearchClaimed: 0, pool, reflowedHelpers: 0, reflowedResearch: 0 };
    }
  }

  const now = params.nowIso ?? new Date().toISOString();
  const slice = getBorgStageSlice(pool, {
    isReworkAttempt: params.isReworkAttempt,
    stage: params.stage,
    trackId: params.trackId,
  })!;

  const actualResearch = Math.max(0, Math.round(params.researchUsedInStage));
  const actualHelpers = Math.max(0, Math.round(params.helpersUsedInStage ?? 0));

  // O(1) burst preemption when a primary/guardrail track exceeds its base slice within burst limits
  const neededBurstResearch = Math.max(0, actualResearch - slice.stageBaseResearch);
  const burstResearchClaimed =
    !params.isReworkAttempt && slice.burstEligible && alloc.webCapable
      ? Math.min(
          neededBurstResearch,
          Math.max(0, alloc.burstResearchCap - alloc.burstResearchUsed),
          pool.sharedResearchAvailable,
        )
      : 0;

  const neededBurstHelpers = Math.max(0, actualHelpers - slice.stageBaseHelpers);
  const burstHelpersClaimed =
    !params.isReworkAttempt && slice.burstEligible
      ? Math.min(
          neededBurstHelpers,
          Math.max(0, alloc.burstHelpersCap - alloc.burstHelpersUsed),
          pool.sharedHelpersAvailable,
        )
      : 0;

  const baseResearchUsedInStage = Math.max(0, actualResearch - burstResearchClaimed);
  const baseHelpersUsedInStage = Math.max(0, actualHelpers - burstHelpersClaimed);

  // Unused base quota reflows into the shared pool:
  // - On `board_post` (when single-stage / non-whiteboard isn't used, or unused prep share), wait:
  //   note that `alloc.baseResearch` is the track's full task budget; if `board_post` spends less than its
  //   `stageBaseResearch` slice, the unused portion ALREADY remains inside `alloc.baseResearch - baseResearchUsedSoFar`
  //   for the SAME track's `deliverable`! AND when `deliverable` completes (the track's final stage), ALL remaining
  //   unspent `alloc.baseResearch` reflows into `sharedResearchAvailable` for downstream waves & `RequestPeerRole` peers!
  //   Additionally, on `board_post`, secondary roles (`w < 70`) reflow up to half their unused prep slice immediately!
  let rawReflowResearch = 0;
  let rawReflowHelpers = 0;
  if (!params.isReworkAttempt) {
    if (params.stage === "deliverable") {
      const totalBaseResUsed =
        Math.max(0, alloc.researchUsed - alloc.burstResearchUsed) + baseResearchUsedInStage;
      const totalBaseHelpUsed =
        Math.max(0, alloc.helpersUsed - alloc.burstHelpersUsed) + baseHelpersUsedInStage;
      rawReflowResearch = alloc.webCapable ? Math.max(0, alloc.baseResearch - totalBaseResUsed) : 0;
      rawReflowHelpers = Math.max(0, alloc.baseHelpers - totalBaseHelpUsed);
    } else if (alloc.priorityTier === "secondary") {
      rawReflowResearch = alloc.webCapable
        ? Math.floor(Math.max(0, slice.stageBaseResearch - baseResearchUsedInStage) * 0.5)
        : 0;
    }
  }

  const nextTotalResearchUsed = pool.totalResearchUsed + actualResearch;
  const nextTotalHelpersUsed = pool.totalHelpersUsed + actualHelpers;
  const afterClaimSharedResearch = Math.max(0, pool.sharedResearchAvailable - burstResearchClaimed);
  const afterClaimSharedHelpers = Math.max(0, pool.sharedHelpersAvailable - burstHelpersClaimed);

  const maxPoolResearchLeft = Math.max(0, pool.totalResearchCap - nextTotalResearchUsed);
  const maxPoolHelpersLeft = Math.max(0, pool.totalHelpersCap - nextTotalHelpersUsed);

  const nextSharedResearch = Math.min(
    maxPoolResearchLeft,
    afterClaimSharedResearch + rawReflowResearch,
  );
  const nextSharedHelpers = Math.min(
    maxPoolHelpersLeft,
    afterClaimSharedHelpers + rawReflowHelpers,
  );

  const reflowedResearch = Math.max(0, nextSharedResearch - afterClaimSharedResearch);
  const reflowedHelpers = Math.max(0, nextSharedHelpers - afterClaimSharedHelpers);

  const nextAllocations = pool.allocations.slice();
  nextAllocations[idx] = {
    ...alloc,
    // If secondary reflowed prep surplus early, deduct from its base so it isn't double-counted on deliverable
    baseResearch:
      params.stage === "board_post"
        ? Math.max(0, alloc.baseResearch - reflowedResearch)
        : alloc.baseResearch,
    burstHelpersUsed: alloc.burstHelpersUsed + burstHelpersClaimed,
    burstResearchUsed: alloc.burstResearchUsed + burstResearchClaimed,
    helpersReflowed: alloc.helpersReflowed + reflowedHelpers,
    helpersUsed: alloc.helpersUsed + actualHelpers,
    researchReflowed: alloc.researchReflowed + reflowedResearch,
    researchUsed: alloc.researchUsed + actualResearch,
    ...(params.stage === "board_post" ? { settledBoardPrep: true } : {}),
    ...(params.stage === "deliverable" ? { settledDeliverable: true } : {}),
  };

  return {
    burstResearchClaimed,
    pool: {
      ...pool,
      allocations: nextAllocations,
      burstHelpersUsed: pool.burstHelpersUsed + burstHelpersClaimed,
      burstResearchUsed: pool.burstResearchUsed + burstResearchClaimed,
      reflowedHelpersTotal: pool.reflowedHelpersTotal + reflowedHelpers,
      reflowedResearchTotal: pool.reflowedResearchTotal + reflowedResearch,
      sharedHelpersAvailable: nextSharedHelpers,
      sharedResearchAvailable: nextSharedResearch,
      totalHelpersUsed: nextTotalHelpersUsed,
      totalResearchUsed: nextTotalResearchUsed,
      updatedAt: now,
    },
    reflowedHelpers,
    reflowedResearch,
  };
}

export function registerDynamicRoleInBorgPool(
  pool: QuotaPoolSnapshot,
  params: {
    readonly effortProfile: VetoBoardEffortProfile;
    readonly seed: BorgTrackSeed;
    readonly nowIso?: string;
  },
): QuotaPoolSnapshot {
  if (params.seed.kind === "inspector" || params.seed.roleId === "quality-inspector") {
    return pool;
  }
  if (pool.allocations.some((a) => a.trackId === params.seed.trackId)) {
    return pool;
  }
  const now = params.nowIso ?? new Date().toISOString();
  const deep = params.effortProfile === "deep";
  const weight = clampInt(params.seed.weight, 10, 100);
  const priorityTier = resolveBorgPriorityTierFromWeight(weight, params.seed.priorityTier, true);
  const webCapable = params.seed.webCapable !== false;

  const desiredHelpers = deep
    ? priorityTier === "primary"
      ? 4
      : priorityTier === "guardrail"
        ? 3
        : 1
    : priorityTier === "primary"
      ? 1
      : 0;
  const desiredResearch = !webCapable
    ? 0
    : deep
      ? priorityTier === "primary"
        ? 20
        : priorityTier === "guardrail"
          ? 14
          : 7
      : priorityTier === "primary"
        ? 14
        : priorityTier === "guardrail"
          ? 10
          : 5;

  const minHelperFloor = deep ? 1 : 0;
  const minResearchFloor = webCapable ? (deep ? 6 : 4) : 0;

  const drawnHelpers = Math.min(pool.sharedHelpersAvailable, desiredHelpers);
  const emergencyHelpers = drawnHelpers < minHelperFloor ? minHelperFloor - drawnHelpers : 0;
  const baseHelpers = drawnHelpers + emergencyHelpers;

  const drawnResearch = webCapable
    ? Math.min(pool.sharedResearchAvailable, desiredResearch)
    : 0;
  const emergencyResearch =
    webCapable && drawnResearch < minResearchFloor ? minResearchFloor - drawnResearch : 0;
  const baseResearch = drawnResearch + emergencyResearch;

  const newAlloc: RoleQuotaAllocation = {
    baseHelpers,
    baseResearch,
    burstEligible: priorityTier !== "secondary",
    burstFrozenByRework: false,
    burstHelpersCap: deep ? (priorityTier === "primary" ? 2 : priorityTier === "guardrail" ? 1 : 0) : 0,
    burstHelpersUsed: 0,
    burstResearchCap: !webCapable
      ? 0
      : priorityTier === "primary"
        ? 6
        : priorityTier === "guardrail"
          ? 3
          : 0,
    burstResearchUsed: 0,
    helpersReflowed: 0,
    helpersUsed: 0,
    isDynamicPeer: true,
    maxModelSteps: deep
      ? priorityTier === "primary"
        ? 32
        : priorityTier === "guardrail"
          ? 24
          : 18
      : priorityTier === "primary"
        ? 22
        : priorityTier === "guardrail"
          ? 18
          : 12,
    maxSameDomainFetches: !webCapable ? 0 : priorityTier === "primary" ? 6 : 4,
    priorityTier,
    researchReflowed: 0,
    researchUsed: 0,
    roleId: params.seed.roleId,
    roleLabel: params.seed.roleLabel,
    trackId: params.seed.trackId,
    webCapable,
    weight,
  };

  return {
    ...pool,
    allocations: [...pool.allocations, newAlloc],
    sharedHelpersAvailable: Math.max(0, pool.sharedHelpersAvailable - drawnHelpers),
    sharedResearchAvailable: Math.max(0, pool.sharedResearchAvailable - drawnResearch),
    totalHelpersCap: pool.totalHelpersCap + emergencyHelpers,
    totalResearchCap: pool.totalResearchCap + emergencyResearch,
    updatedAt: now,
  };
}

export function rebalanceBorgPoolWeights(
  pool: QuotaPoolSnapshot,
  params: {
    readonly effortProfile: VetoBoardEffortProfile;
    readonly tracks: readonly BorgTrackSeed[];
    readonly nowIso?: string;
  },
): QuotaPoolSnapshot {
  const fresh = computeInitialBorgQuotaPool({
    effortProfile: params.effortProfile,
    nowIso: params.nowIso,
    tracks: params.tracks,
  });
  const oldByTrack = new Map(pool.allocations.map((a) => [a.trackId, a]));

  const mergedAllocations: RoleQuotaAllocation[] = fresh.allocations.map((nextA) => {
    const prev = oldByTrack.get(nextA.trackId);
    if (!prev) return nextA;
    return {
      ...nextA,
      burstFrozenByRework: prev.burstFrozenByRework,
      burstHelpersUsed: prev.burstHelpersUsed,
      burstResearchUsed: prev.burstResearchUsed,
      helpersReflowed: prev.helpersReflowed,
      helpersUsed: prev.helpersUsed,
      ...(prev.isDynamicPeer ? { isDynamicPeer: true } : {}),
      researchReflowed: prev.researchReflowed,
      researchUsed: prev.researchUsed,
      ...(prev.settledBoardPrep ? { settledBoardPrep: true } : {}),
      ...(prev.settledDeliverable ? { settledDeliverable: true } : {}),
    };
  });

  return {
    ...fresh,
    allocations: mergedAllocations,
    burstHelpersUsed: pool.burstHelpersUsed,
    burstResearchUsed: pool.burstResearchUsed,
    reflowedHelpersTotal: pool.reflowedHelpersTotal,
    reflowedResearchTotal: pool.reflowedResearchTotal,
    sharedHelpersAvailable: Math.max(
      0,
      fresh.sharedHelpersAvailable - pool.burstHelpersUsed + pool.reflowedHelpersTotal,
    ),
    sharedResearchAvailable: Math.max(
      0,
      fresh.sharedResearchAvailable - pool.burstResearchUsed + pool.reflowedResearchTotal,
    ),
    totalHelpersUsed: pool.totalHelpersUsed,
    totalResearchUsed: pool.totalResearchUsed,
  };
}

export function renderBorgRoleCharterBadge(
  alloc: RoleQuotaAllocation,
  effortProfile: VetoBoardEffortProfile,
  locale: VetoBoardLocale,
): string {
  const zh = locale === "zh";
  const deep = effortProfile === "deep";
  const maxRes = alloc.baseResearch + alloc.burstResearchCap;
  const maxHelp = alloc.baseHelpers + alloc.burstHelpersCap;

  if (zh) {
    const webPart = alloc.webCapable
      ? `外网检索配额 **${alloc.baseResearch}** 次基础${alloc.burstResearchCap > 0 ? ` + **${alloc.burstResearchCap}** 次公共机动池抢占（总上限 **${maxRes}** 次）` : "（次级席位禁碰抢占池）"}`
      : "纯本地代码实现席位（**0** 外网配额，不稀释联网池）";
    const helperPart =
      maxHelp > 0
        ? deep
          ? `｜只读侦察小弟上限 **≤ ${maxHelp} 个**（硬锁 \`Depth=1\` 禁写禁套娃，单节点并发 ≤2）`
          : `｜默认单层专员直跑（仅遇超大代码仓可按需派 **≤ ${maxHelp} 个**只读侦察 helper，严禁刷屏打爆 429）`
        : "｜单层扁平直跑（**0** 子小弟，严禁额外派生会话防 429）";
    const reworkNote = alloc.burstFrozenByRework
      ? "｜⚠️ **SRE 返工缩权已激活（已冻结公共抢占池资格）**"
      : "";
    return `> **⚖️ [Borg Quota Pool · 权重 ${alloc.weight}/100 · ${alloc.priorityTier.toUpperCase()}]**：${webPart}｜推理步数 **≤ ${alloc.maxModelSteps} 步**${helperPart}${reworkNote}；未用完的基础额度将在关卡完结后自动回流公共池供给下游攻坚与动态增援席位。`;
  }

  const webPartEn = alloc.webCapable
    ? `Web quota **${alloc.baseResearch}** base${alloc.burstResearchCap > 0 ? ` + **${alloc.burstResearchCap}** burst (max **${maxRes}**)` : " (no burst preemption)"}`
    : "Pure local coding track (**0** web quota; excluded from web pool)";
  const helperPartEn =
    maxHelp > 0
      ? ` | Read-only Explore helpers **<= ${maxHelp}** (\`Depth=1\`, no write/nesting)`
      : " | Single-layer execution (**0** sub-helpers to prevent RPM 429)";
  return `> **⚖️ [Borg Quota Pool · Weight ${alloc.weight}/100 · ${alloc.priorityTier.toUpperCase()}]**: ${webPartEn} | Max steps **<= ${alloc.maxModelSteps}**${helperPartEn}${alloc.burstFrozenByRework ? " | ⚠️ **SRE Rework Burst Frozen**" : ""}. Unused base quota automatically reflows into the shared pool.`;
}

export function formatBorgQuotaLedgerForReport(
  pool: QuotaPoolSnapshot,
  locale: VetoBoardLocale,
  dynamicPeersSummary?: {
    readonly used: number;
    readonly maxAutoApprove: number;
    readonly totalRequests: number;
  },
): string {
  const zh = locale === "zh";
  const peerSuffix = dynamicPeersSummary
    ? zh
      ? ` ｜ 动态平级扩编已用 **${dynamicPeersSummary.used}/${dynamicPeersSummary.maxAutoApprove}** 免批席位（累计申请 ${dynamicPeersSummary.totalRequests} 次）`
      : ` | Dynamic Peer Seats Used: **${dynamicPeersSummary.used}/${dynamicPeersSummary.maxAutoApprove}** (${dynamicPeersSummary.totalRequests} requests)`
    : "";

  if (zh) {
    const rows = pool.allocations.map((a) => {
      const tierText =
        a.priorityTier === "primary"
          ? "核心主导"
          : a.priorityTier === "guardrail"
            ? "关键护栏"
            : "次级支撑";
      const webQuota = a.webCapable
        ? `${a.baseResearch}${a.burstResearchCap > 0 ? `+${a.burstResearchCap}` : ""}`
        : "0 (纯本地)";
      const helpQuota = `${a.baseHelpers}${a.burstHelpersCap > 0 ? `+${a.burstHelpersCap}` : ""}`;
      const statusFlags = [
        a.isDynamicPeer ? "⚡动态增援" : "首发席位",
        a.burstFrozenByRework ? "🔒返工冻结抢占" : a.burstEligible ? "✅可抢占机动池" : "⛔禁碰机动池",
      ].join(" · ");
      return `| \`${a.trackId}\` (${a.roleLabel}) | ${tierText} · **${a.weight}** | ${webQuota} 次 / ${helpQuota} 小弟 / ≤${a.maxModelSteps} 步 | 已用 ${a.researchUsed} 搜 (抢占 ${a.burstResearchUsed}) | 回流 +${a.researchReflowed} 搜 | ${statusFlags} |`;
    });

    return [
      `- **总资源池容量（基础池 + 25% 抢占池）**：外网检索上限 **${pool.totalResearchCap}** 次（基础 ${pool.baseResearchPool} + 机动 ${pool.burstResearchPool} · 实际消耗 **${pool.totalResearchUsed}** 次 · 累计结余回流 **+${pool.reflowedResearchTotal}** 次 · 当前公共池可用 **${pool.sharedResearchAvailable}** 次）｜只读小弟上限 **${pool.totalHelpersCap}** 个｜独立督察受保护审计池 **${pool.inspectorProtectedResearch}** 次${peerSuffix}`,
      "",
      "| 专员轨道 | QoS 梯队 & 权重 | 核定配额 (外网 / 小弟 / 步数) | 实际消耗 | 结余回流公共池 | 治理状态 |",
      "| :--- | :--- | :--- | :--- | :--- | :--- |",
      ...rows,
    ].join("\n");
  }

  const rowsEn = pool.allocations.map((a) => {
    const webQuota = a.webCapable
      ? `${a.baseResearch}${a.burstResearchCap > 0 ? `+${a.burstResearchCap}` : ""}`
      : "0 (local)";
    const helpQuota = `${a.baseHelpers}${a.burstHelpersCap > 0 ? `+${a.burstHelpersCap}` : ""}`;
    const flags = [
      a.isDynamicPeer ? "⚡Dynamic Peer" : "Initial",
      a.burstFrozenByRework ? "🔒Rework Frozen" : a.burstEligible ? "✅Burst Eligible" : "⛔No Burst",
    ].join(" · ");
    return `| \`${a.trackId}\` (${a.roleLabel}) | ${a.priorityTier} · **${a.weight}** | ${webQuota} web / ${helpQuota} helpers / <=${a.maxModelSteps} steps | ${a.researchUsed} web (${a.burstResearchUsed} burst) | +${a.researchReflowed} web | ${flags} |`;
  });

  return [
    `- **Borg Pool Summary (Base + 25% Burst)**: Web Cap **${pool.totalResearchCap}** (${pool.baseResearchPool}+${pool.burstResearchPool} · Used **${pool.totalResearchUsed}** · Reflowed **+${pool.reflowedResearchTotal}** · Shared Available **${pool.sharedResearchAvailable}**) | Helpers Cap **${pool.totalHelpersCap}** | Protected Inspector Audit Pool **${pool.inspectorProtectedResearch}**${peerSuffix}`,
    "",
    "| Specialist Track | QoS Tier & Weight | Granted Quota (Web / Helpers / Steps) | Consumed | Reflowed to Pool | Governance Flags |",
    "| :--- | :--- | :--- | :--- | :--- | :--- |",
    ...rowsEn,
  ].join("\n");
}
