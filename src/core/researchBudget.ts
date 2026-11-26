import type { VetoBoardLocale } from "../i18n/locales.js";
import { resolveBorgPriorityTierFromWeight } from "./borgQuotaPool.js";
import type { RolePriorityTier, VetoBoardEffortProfile } from "./types.js";

/**
 * Effort-Scaling Search & Turn Quota Engine (`researchBudget.ts`).
 *
 * Enforces two complementary laws across ALL domains (`commercial` AND `swe`):
 * 1. **Universal Web-Grounding First**: Every council topic must verify live primary facts,
 *    SKU prices, statutory status, or official SDK/package/benchmark docs via web search BEFORE locking assumptions.
 * 2. **Strict Anti-Rabbit-Hole Quota Ceiling (20 / 60 / 20 Funnel)**:
 *    Caps total model steps, total external web searches/fetches, and per-domain fetches per node tier
 *    so agents never spin in infinite search loops.
 */

export type VetoBoardEffortTier = "board_prep" | "research" | "synthesis" | "inspection";

export interface TurnResearchBudget {
  readonly tier: VetoBoardEffortTier;
  readonly label: { readonly en: string; readonly zh: string };
  readonly minExternalWebSources: number;
  readonly maxExternalResearchCalls: number;
  readonly maxSameDomainFetches: number;
  readonly maxModelSteps: number;
}

function parsePositiveIntEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function classifyRoleEffortTier(params: {
  readonly roleId: string;
  readonly kind?: "professional" | "inspector";
  readonly isTerminal?: boolean;
  readonly stage?: "board_post" | "deliverable";
}): VetoBoardEffortTier {
  if (params.kind === "inspector" || params.roleId === "quality-inspector") {
    return "inspection";
  }
  if (params.stage === "board_post") {
    return "board_prep";
  }
  if (params.isTerminal && params.roleId === "profit-modeler") {
    return "synthesis";
  }
  return "research";
}

export function resolveTurnResearchBudget(params: {
  readonly tier: VetoBoardEffortTier;
  readonly effortProfile?: VetoBoardEffortProfile;
  readonly roleId?: string;
  readonly weight?: number;
  readonly priorityTier?: RolePriorityTier;
  readonly webCapable?: boolean;
}): TurnResearchBudget {
  const deep = params.effortProfile === "deep";
  const envMaxSteps = parsePositiveIntEnv("VETOBOARD_MAX_STEPS");
  const envMaxResearch = parsePositiveIntEnv("VETOBOARD_MAX_RESEARCH_CALLS");
  const envMaxDomain = parsePositiveIntEnv("VETOBOARD_MAX_DOMAIN_FETCHES");

  // Pure quantitative actuary (`profit-modeler`) may rely on market/tech web URLs once anchored, needing >=1 benchmark check
  const isActuary = params.roleId === "profit-modeler";
  const effectiveQoS: RolePriorityTier | undefined =
    params.weight !== undefined
      ? resolveBorgPriorityTierFromWeight(params.weight, params.priorityTier, true)
      : params.priorityTier;

  const defaults: Record<VetoBoardEffortTier, Omit<TurnResearchBudget, "tier">> = {
    board_prep: {
      label: { en: "Whiteboard Grounding Prep", zh: "白板前置联网摸底" },
      maxExternalResearchCalls:
        params.webCapable === false
          ? 0
          : effectiveQoS === "secondary"
            ? deep
              ? 3
              : 2
            : effectiveQoS === "primary"
              ? deep
                ? 8
                : 6
              : deep
                ? 6
                : 5,
      maxModelSteps:
        effectiveQoS === "secondary" ? 8 : deep ? 14 : 10,
      maxSameDomainFetches: params.webCapable === false ? 0 : 2,
      minExternalWebSources: params.webCapable === false || isActuary ? 0 : 1,
    },
    inspection: {
      label: { en: "Read-Only Adversarial Inspection", zh: "只读独立抽检核验" },
      maxExternalResearchCalls: deep ? 10 : 6,
      maxModelSteps: deep ? 18 : 14,
      maxSameDomainFetches: 3,
      minExternalWebSources: 0,
    },
    research: {
      label: { en: "Primary Field Evidence & Engineering", zh: "一线实证抓取与工程拆解" },
      maxExternalResearchCalls:
        params.webCapable === false
          ? 0
          : effectiveQoS === "primary"
            ? deep
              ? 28
              : 20
            : effectiveQoS === "secondary"
              ? deep
                ? 7
                : 5
              : deep
                ? 18
                : 12,
      maxModelSteps:
        effectiveQoS === "primary"
          ? deep
            ? 34
            : 24
          : effectiveQoS === "secondary"
            ? deep
              ? 18
              : 12
            : deep
              ? 26
              : 18,
      maxSameDomainFetches:
        params.webCapable === false
          ? 0
          : effectiveQoS === "primary"
            ? deep
              ? 8
              : 6
            : effectiveQoS === "secondary"
              ? 3
              : deep
                ? 5
                : 4,
      minExternalWebSources: params.webCapable === false ? 0 : isActuary ? 1 : 2,
    },
    synthesis: {
      label: { en: "Quantitative Convergence & Modeling", zh: "定量精算收敛与多档建模" },
      maxExternalResearchCalls: 6,
      maxModelSteps: 16,
      maxSameDomainFetches: 3,
      minExternalWebSources: 0,
    },
  };

  const base = defaults[params.tier];
  return {
    ...base,
    tier: params.tier,
    ...(envMaxSteps !== undefined ? { maxModelSteps: envMaxSteps } : {}),
    ...(envMaxResearch !== undefined ? { maxExternalResearchCalls: envMaxResearch } : {}),
    ...(envMaxDomain !== undefined ? { maxSameDomainFetches: envMaxDomain } : {}),
  };
}

/**
 * Extracts unique, verifiable external HTTP(S) URLs from specialist output,
 * excluding localhost, loopback, placeholder domains (`example.com`), and internal anchors.
 */
export function extractVerifiedHttpUrls(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  const re = /https?:\/\/[^\s"'<>()[\]，。；！）】]+/giu;
  for (const m of text.matchAll(re)) {
    const cleaned = m[0].replace(/[.,;:!?)\]]+$/g, "");
    try {
      const parsed = new URL(cleaned);
      const host = parsed.hostname.toLowerCase();
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "0.0.0.0" ||
        host.endsWith(".example.com") ||
        host === "example.com" ||
        host === "your-domain.com" ||
        host.endsWith(".your-domain.com")
      ) {
        continue;
      }
      if (!seen.has(cleaned)) {
        seen.add(cleaned);
        urls.push(cleaned);
      }
    } catch {
      // Ignore malformed URL fragment
    }
  }
  return urls;
}

const WEB_SEARCH_TOOL_ALIASES = new Set([
  "websearch",
  "webfetch",
  "search_web",
  "web_search",
  "web_fetch",
  "read_url_content",
  "brave_web_search",
  "tavily_search",
  "exa_search",
  "perplexity_search",
  "google_search",
]);

export function hasInvokedWebResearchTool(invokedTools?: readonly string[]): boolean {
  if (!invokedTools) return false;
  return invokedTools.some((t) => WEB_SEARCH_TOOL_ALIASES.has(t.trim().toLowerCase()));
}

export function buildEffortScalingBudgetDirective(params: {
  readonly budget: TurnResearchBudget;
  readonly locale: VetoBoardLocale;
  readonly todayIsoDate?: string;
}): string {
  const { budget, locale } = params;
  const zh = locale === "zh";
  const today = params.todayIsoDate ?? new Date().toISOString().slice(0, 10);
  const year = Number.parseInt(today.slice(0, 4), 10) || 2026;
  const prevYear = year - 1;

  if (zh) {
    return [
      `## ⏱️ 联网实证硬纪律与防死循环配额（Effort-Scaling · 基准日 ${today}）`,
      `- **任何课题必先联网确认（严禁凭预训练旧记忆盲猜）**：无论是商业价格/薪资/法规，还是软件架构 SDK 版本/云计费/CVE/基准延迟，动手定锚前**必须先调用联网检索工具（\`search_web\` / \`WebSearch\`）核实 ${year}/${prevYear} 最新一手现值**，并在正文中保留真实 \`https://\` 来源 URL！`,
      `- **本席位硬性配额上限（${budget.label.zh} · 严禁无休止深挖卡死！）**：推理步数上限 **≤ ${budget.maxModelSteps} 步** ｜ 联网搜索/抓取总次数上限 **≤ ${budget.maxExternalResearchCalls} 次**（最低实证信源 **≥ ${budget.minExternalWebSources} 条 URL**）｜ 同一域名最多抓取 **≤ ${budget.maxSameDomainFetches} 次**。`,
      `- **20 / 60 / 20 漏斗止损铁律**：前 20% 配额宽搜锚定真实标的型号/官方文档；中间 60% 配额倒序抓取最权威一手现值；最后 20% 配额**立即停止搜索**转入 \`vetoboard_calc\` 核算与成稿！若某细分参数连续 2 次检索无果或遇付费墙，**立刻停止顺藤摸瓜**，直接标为 \`【待确认 / ASSUMPTION】\` 收口！`,
    ].join("\n");
  }

  return [
    `## ⏱️ Mandatory Web Grounding & Anti-Loop Search Quota (Baseline Date: ${today})`,
    `- **Verify Live on Web First (ALL Domains)**: Whether commercial (real SKU prices, wages, statutes) or SWE (latest SDK versions, cloud limits, CVEs, benchmarks), you MUST query live web sources (\`search_web\` / \`WebSearch\`) for **${year}/${prevYear}** primary facts BEFORE locking numbers, citing real \`https://\` URLs.`,
    `- **Hard Execution Quota (${budget.label.en} — Do NOT loop endlessly!)**: Max steps **<= ${budget.maxModelSteps}** | Max web searches/fetches **<= ${budget.maxExternalResearchCalls}** (min verified URLs **>= ${budget.minExternalWebSources}**) | Max fetches per domain **<= ${budget.maxSameDomainFetches}**.`,
    `- **20 / 60 / 20 Funnel & Immediate Stop-Loss**: First 20% broad discovery -> middle 60% primary source verification -> final 20% **STOP searching**, run \`vetoboard_calc\`, and write output. If 2 queries return nothing or hit a paywall, **stop immediately** and tag as \`[ASSUMPTION]\`.`,
  ].join("\n");
}
