import { type VetoBoardLocale, t } from "../i18n/locales.js";
import {
  buildEffortScalingBudgetDirective,
  classifyRoleEffortTier,
  resolveTurnResearchBudget,
} from "./researchBudget.js";
import { formatExecutableRulesForPrompt } from "./ruleGate.js";
import {
  attachSkillsToRole,
  recommendSkillBindingsAndCandidates,
  synthesizeRoleFromSkill,
  type DiscoveredSkill,
} from "./skillRadar.js";
import type {
  ClarifyQuestion,
  CustomRoleInput,
  HostModelCandidate,
  RoleModelBinding,
  RolePriorityTier,
  RoleTemplate,
  VetoBoardAssetPack,
} from "./types.js";

/**
 * Built-in Bilingual (`en` + `zh`) Weighted Role Catalog:
 * - Commercial Strategy & Unit Economics Council
 * - Google 7-Gate Software Engineering Suite
 * Open-Core Note: Includes foundational starter rules; domain-specific vertical packs load via `.vetoboard-pack.json` or VetoBoard Cloud.
 */

export const BUILTIN_ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    allowedTools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "vetoboard_calc"],
    domain: "commercial",
    evidenceRequirements: [
      "Live web search (`search_web`/`WebSearch`) citing >= 3 concrete real-world brand/model SKUs or named competitors across Low/Mid/High price bands (`P_low`, `P_mid`, `P_high`) with real `https://` URLs",
      "Reverse-calculated customer-base funnel (`annual_bep_orders / orders_per_account_per_year = required_accounts`) and 4-tier conclusion tags (`[VERIFIED]` / `[MODEL-DERIVED]` / `[CONDITIONAL]` / `[ASSUMPTION]`)",
    ],
    executableRules: [
      {
        description: "Must execute live WebSearch/search_web and cite verifiable https:// primary sources before locking market prices or ceilings.",
        enforcement: "hard",
        escalateOnTrigger: false,
        forbiddenPatterns: ["待后续补充数据"],
        mustIncludeKeywords: [],
        mustInvokeSkills: [],
        mustUseTools: ["WebSearch"],
        ruleId: "rule-market-evidence",
        title: "Mandatory Live Web Grounding & 3-Tier Real SKU Anchoring",
      },
    ],
    kind: "professional",
    name: {
      en: "Market & Replacement-Ceiling Strategist",
      zh: "多路线市场与重置天花板专员",
    },
    priorityTier: "primary",
    readOnly: true,
    roleId: "market-analyst",
    systemCharter: {
      en: "You are the [Primary Lead · Weight 95/100] Market & Replacement-Ceiling Strategist. 1) Run live `search_web`/`WebSearch` FIRST (within your 20/60/20 search quota!) to anchor >=3 concrete in-market brand/model SKUs or named competitors across Low (`P_low`), Mid (`P_mid`), and High (`P_high`) tiers with exact prices and `https://` URLs — NEVER rely on vague single-average guesses! 2) Anchor real buyer budgets, payment line-items, transition-stage income/fee realities, and replacement-cost ceilings (`35%-40% * P_new`). 3) Reverse-calculate required active accounts (`annual_orders / orders_per_customer`) to verify channel feasibility. 4) Tag every core claim with `[VERIFIED]`, `[MODEL-DERIVED]`, `[CONDITIONAL]`, or `[ASSUMPTION]`.",
      zh: "你是【核心主导 · 权重 95/100】多路线市场与重置天花板专员。取证与颗粒度四条铁律：1) **必先联网抓取三档真实具体型号锚点（严禁笼统平均值）**：必须先调用 `search_web`/`WebSearch`（严守配额上限）检索至少 **3 款真实在售品牌具体型号或标杆竞品（低端 `P_low` / 中端 `P_mid` / 高端 `P_high`）的真实成交价与 `https://` 链接**（涉及副业/骑手/渠道过渡时同步核实当地真实日单价与刚性损耗），严禁拍脑袋编一个『5000–30000元、均价2800元』模糊区间！2) **重置成本天花板与付款原语**：锚定真实买单方、报销/结算发票科目与同款新机价 `35%–40%` 封顶线；3) **获客漏斗倒推客户基数**：按单客年均复购/报修频次（如 `2–4单/户·年`）倒推支撑 BEP 所需的真实签约客户/课题组总数，检验零散获客是否跑得通；4) **四级结论标识（必填）**：每条核心定论显式标注【已验证】、【模型推算】、【条件性建议】或【待确认】。",
    },
    weight: 95,
  },
  {
    allowedTools: ["Read", "Grep", "Glob", "vetoboard_calc", "WebSearch"],
    domain: "commercial",
    evidenceRequirements: [
      "Deterministic `vetoboard_calc` modeling across Low/Mid/High SKU anchors + cumulative multi-order replacement ceiling (`k * price < P_new`)",
      "Physical capacity utilization ceiling (`Utilization % = Annual_BEP / Max_Annual_Capacity`), anti-double-counting labor modes, rework/refund/CAC friction, and `<details>` JSON formula audit block",
    ],
    executableRules: [
      {
        description: "All BEP, margin, capacity utilization, sensitivity, and weighted scoring math MUST invoke vetoboard_calc.",
        enforcement: "hard",
        escalateOnTrigger: false,
        forbiddenPatterns: ["guaranteed profit", "稳赚不赔"],
        mustIncludeKeywords: ["BEP"],
        mustInvokeSkills: [],
        mustUseTools: ["vetoboard_calc"],
        ruleId: "rule-deterministic-calc",
        title: "Mandatory Deterministic Math via vetoboard_calc",
      },
    ],
    kind: "professional",
    name: {
      en: "Unit Economics & BEP Actuary",
      zh: "单位经济性与精算建模专员",
    },
    priorityTier: "primary",
    readOnly: true,
    roleId: "profit-modeler",
    systemCharter: {
      en: "You are the [Primary Co-Lead · Weight 92/100] Unit Economics & BEP Actuary. Every formula MUST be computed via `vetoboard_calc` (zero mental math!). Enforce 4 granularity gates: 1) **Low/Mid/High Tiered SKU Modeling & Cumulative Frequency Ceiling**: Model `P_low`, `P_mid`, `P_high` separately (never hide unprofitable low-end SKUs behind one blended average!), verifying both single-order cap (`<= 35%-40% * P_new`) and annual cumulative frequency (`k_orders * price < P_new` — flag & cut categories where 3-4 uses exceed buying new!). 2) **Physical Capacity Utilization Ceiling**: Compute max annual single-person/node capacity (e.g. `orders_per_day * 22 * 12`) and check `Utilization % = BEP_annual / Max_Capacity` (`>100%` = physically impossible solo; `>85%` = zero safety margin!). 3) **Anti-Double-Counting & Real Friction**: Separate fixed founder opportunity-cost salary vs per-order outsource modes, and include rework rate (`~10%`), refund/unrepairable rate (`~5%`), CAC, and payment-term working-capital lockup. 4) Include a `<details>` JSON formula list for `[V1]` `reconcile` and tag conclusions (`[VERIFIED]`/`[MODEL-DERIVED]`/`[CONDITIONAL]`/`[ASSUMPTION]`).",
      zh: "你是【核心精算 · 权重 92/100】单位经济性与精算专员。所有算式必须调用 `vetoboard_calc` 精确算出（严禁心算！），并强制跑满四大现实颗粒度校验：1) **低/中/高三档真实 SKU 分档建模 + 年度累计频次死线（严禁用单一平均值掩盖亏损档！）**：对齐市场轨抓取的低/中/高真实机型锚点分别测算单均贡献与 BEP，同时校验『单次收费 ≤ 35%~40%×新机价』且『单台年常态频次 k × 单次收费 < 新机购置价』（如低端机型修 3 次即超买新价，必须当场判为利润黑洞予以剔除！）；2) **单人/单节点物理极限产能利用率校验（Capacity Utilization %）**：测算 1 名全职人员（或单实例）年物理极限交付量（如 `日均上限单数 × 22天 × 12月`），核算 `产能利用率 = 年度BEP单量 ÷ 年极限产能`（若 `>100%` 直接证伪单人可行性，若 `>85%` 警示安全边际极窄）；3) **防人工双算多口径并表 + 真实摩擦项**：明确区分『全职固定机会成本月薪口径』与『按单外包/分包分成口径』，计入返修摊销率（如 10%）、不可修复退单率（如 5%）、获客成本 CAC 及长账期垫资占用；4) 文末附 `<details>` 机器复算 JSON 清单并标注四级结论状态。",
    },
    weight: 92,
  },
  {
    allowedTools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch"],
    domain: "compliance",
    evidenceRequirements: [
      "Live web verification (`search_web`/`WebSearch`) citing statute full title, order/promulgation number, effective status (`Active`/`Repealed`), and `https://` URL",
      "Invoice line-item legality check + constructive compliant alternative structure whenever a redline is flagged",
    ],
    executableRules: [
      {
        description: "Must verify current statutory/regulatory effective status via live WebSearch/search_web and provide constructive compliant alternatives.",
        enforcement: "hard",
        escalateOnTrigger: true,
        forbiddenPatterns: [],
        mustIncludeKeywords: [],
        mustInvokeSkills: [],
        mustUseTools: ["WebSearch"],
        ruleId: "rule-compliance-construct",
        title: "Mandatory Live Statutory Verification + Constructive Alternative",
      },
    ],
    kind: "professional",
    name: {
      en: "Compliance & Statutory Guardrail Officer",
      zh: "合规与法律风控护栏官",
    },
    priorityTier: "guardrail",
    readOnly: true,
    roleId: "legal-advisor",
    systemCharter: {
      en: "You are the [Compliance Guardrail · Weight 85/100]. 1) Run live `search_web`/`WebSearch` FIRST against authoritative regulatory sources to cite exact statute title, order number, effective date, and current status (`Active`/`Repealed`/`Upcoming`) with `https://` URLs — never rely on stale memory! 2) Audit licensing, tax/invoice line-item truth (never disguise labor/service fees as false consumables/goods invoices!), data privacy, and liability caps. 3) Do NOT merely veto — always design a constructive lawful alternative structure (`altersCorePremise=true` if changing core revenue model) and tag with 4-tier status.",
      zh: "你是【合规风控护栏 · 权重 85/100】。1) **必先联网核验现行法规时效**：对照当前基准日期调用 `search_web`/`WebSearch` 核实权威法规全称、发文字号/令号、施行日期与现行有效状态（附 `https://` 链接），严禁凭旧记忆瞎编红线；2) **票据与准入穿透核查**：严查特种/强检/医疗/牌照准入、财税票据科目真实性（严禁拿虚假耗材票包装劳务服务费套取经费！）与无限连带赔偿敞口（严禁越界手推多变量财务代数）；3) **破立结合**：凡指出违规死穴必须同步设计保住核心诉求的合法替代交易结构（如配件实物票与技术服务费双票分列、分包持证主体等；若颠覆核心收费前提则标 `altersCorePremise=true` 交用户裁决），并标注四级结论状态。",
    },
    weight: 85,
  },
  {
    allowedTools: ["Read", "Grep", "Glob", "vetoboard_calc", "WebSearch"],
    domain: "engineering",
    evidenceRequirements: [
      "Live web verification (`search_web`/`WebSearch`) of real tool/component/cloud BOM prices (`https://` URLs), per-order labor-hour distribution, and executable safety/acceptance test thresholds",
    ],
    executableRules: [
      {
        description: "Must verify real component/tool/infra BOM prices or technical specs via live WebSearch/search_web.",
        enforcement: "hard",
        escalateOnTrigger: false,
        forbiddenPatterns: [],
        mustIncludeKeywords: [],
        mustInvokeSkills: [],
        mustUseTools: ["WebSearch"],
        ruleId: "rule-tech-bom-grounding",
        title: "Mandatory Live BOM & Technical Spec Grounding",
      },
    ],
    kind: "professional",
    name: {
      en: "Engineering & Delivery SOP Specialist",
      zh: "工程边界与低阻力交付专员",
    },
    priorityTier: "secondary",
    readOnly: true,
    roleId: "tech-feasibility",
    systemCharter: {
      en: "You are the [Engineering & Delivery Specialist · Weight 75/100]. 1) Run live `search_web`/`WebSearch` FIRST to price real component/tool/cloud BOM items with `https://` URLs. 2) Define repairability/feasibility tiers, per-order labor-hour quotas (mean & worst-case), zero-inventory procurement SOPs, electrical/system safety acceptance tests, and stop-loss rules. Stay strictly in the engineering lane (leave tax/invoice rules to Legal).",
      zh: "你是【工程与交付专员 · 权重 75/100】。1) **必先联网核实真实工具/备件/云资源 BOM 现价**（附 `https://` 链接，严禁拍脑袋估价）；2) 严格划分可做品类与禁碰黑洞（含一次修复率/良率、单次标准工时均值与长尾极值、零库存按单采买 SOP）；3) 每个关键工程动作必须绑定可执行的现场安全/冒烟验收判据（如绝缘耐压、温控复测、压测延迟线），严守工程本职边界（不越界空谈财税发票），并标注四级结论状态。",
    },
    weight: 75,
  },
  {
    allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "vetoboard_calc", "WebSearch"],
    domain: "swe",
    evidenceRequirements: [
      "Live web verification (`search_web`/`WebSearch`) of current SDK/package versions, official API quotas/pricing, or CVE advisories (`https://` URLs)",
      "Explicit Non-Goals boundary + WHEN/THEN acceptance scenarios + typed contract first",
    ],
    executableRules: [
      {
        description: "Must verify current official SDK/package docs, quotas, or benchmarks via live WebSearch/search_web, with zero fake TODO/FIXME stubs.",
        enforcement: "hard",
        escalateOnTrigger: false,
        forbiddenPatterns: ["TODO:\\s*implement", "FIXME:\\s*mock"],
        mustIncludeKeywords: [],
        mustInvokeSkills: [],
        mustUseTools: ["WebSearch"],
        ruleId: "rule-swe-no-fake-stubs",
        title: "Google 7-Gate: Live Doc Grounding, Zero Fake Stubs & Contract-First",
      },
    ],
    kind: "professional",
    name: {
      en: "7-Gate Software Architect & Engineer",
      zh: "Google 7-Gate 架构契约与研发专员",
    },
    priorityTier: "primary",
    readOnly: false,
    roleId: "software-architect",
    systemCharter: {
      en: "You are the [7-Gate Software Architect · Weight 95/100]. 1) Run live `search_web`/`WebSearch` FIRST (within quota!) to verify current library/SDK versions, cloud service quotas/pricing, RFC specs, and security advisories (`https://` URLs) — never code against hallucinated deprecated APIs! 2) Enforce Gate 1 (Non-Goals & WHEN/THEN living specs), Gate 2 (Contract-First shared schemas), Gate 3 (Non-overlapping OWNERS file boundaries & Small CLs), and Gate 4/5 (Hermetic unit tests before completion).",
      zh: "你是【Google 7-Gate 架构契约师 · 权重 95/100】。1) **必先联网核验最新技术栈与配额现值**：动架构前必须先调用 `search_web`/`WebSearch`（严守检索配额）核实目标依赖包最新稳定版、官方 API 限流/计费单价与安全公告（附 `https://` 链接），严禁基于过期 API 幻觉设计架构；2) 严格执行 Gate 1（Non-Goals 边界与『当…那么…』活体规格）、Gate 2（契约先行）、Gate 3（同波次 OWNERS 目录独占防写冲突）与 Gate 4/5（密封自动化单测同交）。",
    },
    weight: 95,
  },
  {
    allowedTools: ["Read", "Grep", "Glob", "vetoboard_calc", "WebSearch"],
    domain: "inspection",
    evidenceRequirements: [
      "Independent `vetoboard_calc` (`mode='reconcile'`) verification receipt for all numeric claims + spot-check of upstream `https://` empirical sources",
      "Exact file:line or section citations for P0 defects; downgrade readiness if primary web URLs are missing",
    ],
    executableRules: [
      {
        description: "Inspector must run independent vetoboard_calc reconcile when auditing quantitative deliverables.",
        enforcement: "soft",
        escalateOnTrigger: false,
        forbiddenPatterns: [],
        mustIncludeKeywords: [],
        mustInvokeSkills: [],
        mustUseTools: ["vetoboard_calc"],
        ruleId: "rule-inspector-reconcile",
        title: "Independent Arithmetic Reconciliation & Source Audit",
      },
    ],
    kind: "inspector",
    name: {
      en: "Adversarial Quality & Math Inspector",
      zh: "独立只读铁面督察官",
    },
    priorityTier: "guardrail",
    readOnly: true,
    roleId: "quality-inspector",
    systemCharter: {
      en: "You are the [Adversarial Read-Only Inspector · Weight 85/100]. 1) Recompute every key formula, SKU tier, and capacity utilization ceiling independently via `vetoboard_calc (mode='reconcile')`. 2) Audit empirical grounding: verify upstream deliverables cite real `https://` sources and did NOT mask unprofitable low-end tiers behind a lazy single average or double-count labor costs. Reject (`passed: false`) on P0 defects (math discrepancy > 0.5%, double-counted labor, missing capacity check, fabricated sources, or fatal legal/test failures); record P2 minor style tweaks as `Nit:` notes.",
      zh: "你是【独立只读铁面督察官 · 权重 85/100】。1) 必须调用 `vetoboard_calc (mode='reconcile')` 独立复算上游每项公式、三档 SKU 损益、重置频次死线与单人物理产能利用率；2) 严查实证颗粒度：核查上游是否真正采集了一手 `https://` 链接、是否存在『拿笼统均价掩盖低端亏损档』或『固定工资与按单人工重复计费』！仅当存在 P0 实质性硬伤（算术偏差 >0.5%、人工双算、未验产能死线、伪造无源数据或触碰法律/单测死穴）时打回；P2 轻微措辞记入 `Nit:` 放行。",
    },
    weight: 85,
  },
];

export const CROSS_EXAMINER_ROLE_TEMPLATE: RoleTemplate = {
  allowedTools: ["Read", "Grep", "Glob", "vetoboard_calc", "WebSearch"],
  domain: "inspection",
  evidenceRequirements: [
    "At least 3 explicit Role-A vs Role-B contradiction clashes citing upstream track metrics",
    "Forced Concession & Revised Parameter Table feeding into Wave 3 vetoboard_calc reconciliation",
  ],
  executableRules: [],
  kind: "professional",
  name: {
    en: "Cross-Role Adversarial Clash Moderator",
    zh: "交叉质询与角色交锋官",
  },
  priorityTier: "primary",
  readOnly: true,
  roleId: "cross-examiner",
  systemCharter: {
    en: "You are the [Wave 2 Cross-Role Clash Moderator · Weight 94/100]. You receive all Wave 1 specialists' independent proposals and MUST force direct role-vs-role confrontation. Identify at least 3 concrete assumption clashes across tracks (e.g. Market WTP ceiling vs Profit ARPU, Legal MoR/compliance fees vs Profit margin, Engineering infra/API limits vs Product scope), adjudicate forced concessions weighted by role authority scores (Primary Lead >=95 prevails on commercial direction, but NEVER overrides statutory redlines or deterministic math), and output a structured Cross-Examination Clash & Parameter Revision Matrix.",
    zh: "你是【第 2 波角色交锋与交叉质询官 · 权重 94/100】。你将同时拿到第 1 波全部专员的独立盲审摘要，必须主持真刀真枪的『跨席位正面互撕与交叉质询』：至少揪出 3 处跨角色前提打架或口径冲突（例如：市场轨免费替代天花板 vs 精算轨高转化假设、合规轨 MoR/牌照真实税费 vs 精算轨低抽成假设、工程轨真实配额/算力瓶颈 vs 业务承诺），按角色权重梯度（核心主导 ≥95 分掌握战略拍板权，但绝不可凌驾于法律死穴与算术定律之上）裁定『谁必须向谁让步、哪个关键参数必须重修』，并输出《跨席位交锋质询与参数强制修正表》移交第 3 波铁面督察复算。",
  },
  weight: 94,
};

export function findRoleTemplate(roleId: string): RoleTemplate | undefined {
  if (roleId === CROSS_EXAMINER_ROLE_TEMPLATE.roleId) {
    return CROSS_EXAMINER_ROLE_TEMPLATE;
  }
  return BUILTIN_ROLE_TEMPLATES.find((r) => r.roleId === roleId);
}

export function customRoleToTemplate(input: CustomRoleInput): RoleTemplate {
  const safeId = input.roleId.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase() || "custom-specialist";
  const hasRules =
    (input.mustUseTools?.length ?? 0) > 0 ||
    (input.mustIncludeKeywords?.length ?? 0) > 0 ||
    (input.forbiddenPatterns?.length ?? 0) > 0;
  return {
    allowedTools: ["Read", "Grep", "Glob", "WebSearch", "vetoboard_calc"],
    domain: "commercial",
    evidenceRequirements: ["Verifiable empirical evidence or deterministic vetoboard_calc receipt"],
    executableRules: hasRules
      ? [
          {
            description: `Custom rule contract for ${input.title}`,
            enforcement: "hard",
            escalateOnTrigger: false,
            forbiddenPatterns: input.forbiddenPatterns ?? [],
            mustIncludeKeywords: input.mustIncludeKeywords ?? [],
            mustInvokeSkills: [],
            mustUseTools: input.mustUseTools ?? [],
            ruleId: `rule-custom-${safeId}`,
            title: `${input.title} Custom Gate`,
          },
        ]
      : [],
    kind: "professional",
    ...(input.modelBinding ? { modelBinding: input.modelBinding } : {}),
    name: { en: input.title, zh: input.title },
    priorityTier: input.priorityTier ?? "primary",
    readOnly: true,
    roleId: safeId,
    systemCharter: { en: input.charter, zh: input.charter },
    weight: input.weight ?? 90,
  };
}

export function normalizeRoleModelBinding(
  raw: string | RoleModelBinding,
): RoleModelBinding {
  if (typeof raw !== "string") {
    return {
      ...raw,
      kind: raw.kind ?? (raw.hostModelTier ? "host-tier" : "byok"),
    };
  }
  const clean = raw.trim();
  const lower = clean.toLowerCase();
  if (lower === "inherit" || lower === "pro" || lower === "flash" || lower === "flash_lite") {
    return { hostModelTier: lower, kind: "host-tier" };
  }
  const sepIdx = clean.search(/[:/]/);
  if (sepIdx > 0 && sepIdx < clean.length - 1) {
    return {
      kind: "byok",
      modelId: clean.slice(sepIdx + 1).trim(),
      providerId: clean.slice(0, sepIdx).trim(),
    };
  }
  return { kind: "byok", modelId: clean };
}

export function formatModelBindingLabel(binding?: RoleModelBinding): string | undefined {
  if (!binding) return undefined;
  if (binding.kind === "host-tier" && binding.hostModelTier) {
    return binding.hostModelTier;
  }
  if (binding.modelId) {
    const prov = binding.providerId ? `${binding.providerId}/` : "";
    const rsn = binding.reasoningLevel ? `(${binding.reasoningLevel})` : "";
    return `${prov}${binding.modelId}${rsn}`;
  }
  return undefined;
}

export function parseNaturalLanguageModelOverrides(
  text?: string,
): Record<string, RoleModelBinding> {
  if (!text?.trim()) return {};
  const out: Record<string, RoleModelBinding> = {};
  const aliasPairs: ReadonlyArray<readonly [RegExp, string]> = [
    [/(?:精算|财务|成本|盈利|profit[-_]?modeler)/iu, "profit-modeler"],
    [/(?:市场|选品|竞品|market[-_]?analyst)/iu, "market-analyst"],
    [/(?:合规|法务|法律|风控|legal[-_]?advisor)/iu, "legal-advisor"],
    [/(?:工程|技术|交付|tech[-_]?feasibility)/iu, "tech-feasibility"],
    [/(?:架构|architect|software[-_]?architect)/iu, "software-architect"],
    [/(?:督察|质检|终检|终验|inspector|quality[-_]?inspector)/iu, "quality-inspector"],
  ];
  const segments = text.split(/[,，;；。\n]+/);
  for (const seg of segments) {
    const modelMatch = /(?:用|绑定|指定|切|model\s*[=:：]?|use)\s*([a-zA-Z0-9._:/-]+)\b/iu.exec(seg);
    if (!modelMatch) continue;
    const rawModel = modelMatch[1]!.trim();
    if (/^\d+$/.test(rawModel)) continue; // Ignore numeric weights like `用 95`
    for (const [re, roleId] of aliasPairs) {
      if (re.test(seg)) {
        out[roleId] = normalizeRoleModelBinding(rawModel);
      }
    }
  }
  return out;
}

const COMPLIANCE_HEAVY_RE =
  /(?:合规|法务|法律|医疗|器械|牌照|资质|税|开票|隐私|海关|药监|强检|特种|GDPR|HIPAA|FDA|FCC|SOC2|EPR|CPRA|FCRA|compliance|legal|regul|privacy|tax|licens|statutory)/iu;
const FINANCE_HEAVY_RE =
  /(?:定价|回本|毛利|盈亏|抽佣|退货|精算|成本|客单价|月费|年费|订阅|ROI|LTV|CAC|现金流|pricing|margin|bep|break[- ]?even|unit\s+economics|arpu|churn|profit|\$\d+)/iu;
const TECH_HEAVY_RE =
  /(?:硬件|BOM|高并发|延迟|吞吐|分布式|网关|集群|固件|架构|接口|数据库|qps|req\/s|latency|throughput|distributed|webhook|hardware|bom|infra|microservice)/iu;
const MARKET_HEAVY_RE =
  /(?:赛道|选品|转型|市场|竞品|买单|切入|方向|出海|独立站|跨境|market|positioning|pivot|competitor|niche|go[- ]to[- ]market)/iu;

export interface ResolveCouncilLineupInput {
  readonly goal: string;
  readonly domain?: "commercial" | "swe";
  readonly locale?: VetoBoardLocale;
  readonly autoTuneWeights?: boolean;
  readonly roleIds?: readonly string[];
  readonly excludeRoleIds?: readonly string[];
  readonly primaryRoleIds?: readonly string[];
  readonly weightOverrides?: Readonly<Record<string, number>>;
  readonly tierOverrides?: Readonly<Record<string, RolePriorityTier>>;
  readonly modelOverrides?: Readonly<Record<string, string | RoleModelBinding>>;
  readonly customRoles?: readonly CustomRoleInput[];
  readonly reusableRoles?: readonly RoleTemplate[];
  readonly discoveredSkills?: readonly DiscoveredSkill[];
  readonly spawnRoleFromSkillIds?: readonly string[];
  readonly roleSkillBindings?: Readonly<Record<string, readonly string[]>>;
  readonly globalSkillIds?: readonly string[];
  readonly enforceHardSkillGate?: boolean;
  readonly includeInspector?: boolean;
}

export interface ResolvedCouncilLineup {
  readonly roles: readonly RoleTemplate[];
  readonly rationale: readonly string[];
  readonly boundSkillsByRoleId: Readonly<Record<string, readonly string[]>>;
}

export function resolveTierLabel(role: RoleTemplate, locale: VetoBoardLocale): string {
  const dict = t(locale);
  if (role.roleId === "cross-examiner") {
    return locale === "zh" ? "交叉质询交锋" : "Cross-Debate";
  }
  if (role.kind === "inspector") return dict.tierInspector;
  if (role.priorityTier === "primary") return dict.tierPrimary;
  if (role.priorityTier === "guardrail") {
    return role.domain === "engineering" ? dict.tierGuardrailEng : dict.tierGuardrailLegal;
  }
  return dict.tierSupport;
}

/**
 * Resolves the active role bench with:
 * 1. Smart topic-aware dynamic Primary Lead & weight tuning (`autoTuneWeights !== false`)
 * 2. Explicit `primaryRoleIds`, `roleIds`, `excludeRoleIds`, `weightOverrides`, `tierOverrides`
 * 3. On-the-fly `customRoles` injection
 */
export function resolveCouncilLineup(input: ResolveCouncilLineupInput): ResolvedCouncilLineup {
  const locale = input.locale ?? "en";
  const zh = locale === "zh";
  const domain = input.domain ?? "commercial";
  const includeInspector = input.includeInspector !== false;
  const rationale: string[] = [];

  const defaultSpecialistIds =
    domain === "swe"
      ? ["software-architect", "tech-feasibility"]
      : ["market-analyst", "profit-modeler", "legal-advisor", "tech-feasibility"];

  const excludeSet = new Set((input.excludeRoleIds ?? []).map((s) => s.trim().toLowerCase()));
  const requestedIds =
    input.roleIds !== undefined
      ? input.roleIds.filter((id) => id !== "quality-inspector")
      : defaultSpecialistIds;

  const reusableById = new Map(
    (input.reusableRoles ?? []).map((r) => [r.roleId.toLowerCase(), r]),
  );

  let specialists: RoleTemplate[] = [];
  for (const id of requestedIds) {
    if (excludeSet.has(id.toLowerCase())) continue;
    const found = findRoleTemplate(id) ?? reusableById.get(id.toLowerCase());
    if (found) specialists.push({ ...found });
  }

  // Also auto-include saved library / workspace reusable roles when default lineup is used and they match strongly
  if (input.roleIds === undefined && input.reusableRoles) {
    const existingIds = new Set(specialists.map((s) => s.roleId.toLowerCase()));
    for (const saved of input.reusableRoles) {
      if (existingIds.has(saved.roleId.toLowerCase()) || excludeSet.has(saved.roleId.toLowerCase())) {
        continue;
      }
      // Only auto-attach non-builtin library roles if their keywords match the goal
      const words = saved.name.en.toLowerCase().split(/[\s·_-]+/).filter((w) => w.length >= 3);
      if (words.some((w) => input.goal.toLowerCase().includes(w))) {
        specialists.push({ ...saved });
        existingIds.add(saved.roleId.toLowerCase());
        rationale.push(
          zh
            ? `从角色复用库自动命中并挂载已有专员「${saved.name.zh}」(权重 ${saved.weight})`
            : `Retrieved & mounted saved reusable role "${saved.name.en}" (W${saved.weight})`,
        );
      }
    }
  }

  // Append custom ad-hoc roles
  for (const custom of input.customRoles ?? []) {
    const tpl = customRoleToTemplate(custom);
    if (!excludeSet.has(tpl.roleId.toLowerCase())) {
      specialists.push(tpl);
      rationale.push(
        zh
          ? `新增自定义专员「${tpl.name.zh}」(权重 ${tpl.weight})`
          : `Added custom specialist "${tpl.name.en}" (W${tpl.weight})`,
      );
    }
  }

  const discoveredById = new Map(
    (input.discoveredSkills ?? []).map((s) => [s.skillId.toLowerCase(), s]),
  );

  // Spawn dedicated Specialist Roles directly from host's native SKILL.md skills!
  const explicitSpawnIds = new Set(
    (input.spawnRoleFromSkillIds ?? []).map((s) =>
      s.trim().replace(/^spawn:/i, "").toLowerCase(),
    ),
  );
  // Also allow passing `spawn:<skillId>` or `skill-<skillId>` inside `roleIds`!
  for (const rid of input.roleIds ?? []) {
    const lower = rid.trim().toLowerCase();
    if (lower.startsWith("spawn:")) explicitSpawnIds.add(lower.slice(6));
    else if (lower.startsWith("skill-") && discoveredById.has(lower.slice(6))) {
      explicitSpawnIds.add(lower.slice(6));
    }
  }

  // If autoTuneWeights is enabled and no explicit spawn list was given, auto-spawn workspace/user/plugin skills with strong relevance (>= 7)
  if (explicitSpawnIds.size === 0 && input.autoTuneWeights !== false && discoveredById.size > 0) {
    const rec = recommendSkillBindingsAndCandidates({
      discoveredSkills: input.discoveredSkills ?? [],
      goal: input.goal,
      roles: specialists,
    });
    for (const cand of rec.candidateSkillRoles) {
      if (
        cand.score >= 7 &&
        cand.skill.source !== "antigravity-builtin" &&
        cand.skill.source !== "vetoboard-pack"
      ) {
        explicitSpawnIds.add(cand.skill.skillId.toLowerCase());
      }
    }
  }

  for (const skId of explicitSpawnIds) {
    const sk = discoveredById.get(skId);
    if (!sk) continue;
    const synthesized = synthesizeRoleFromSkill(sk, locale, 90);
    if (!excludeSet.has(synthesized.roleId.toLowerCase())) {
      specialists.push(synthesized);
      rationale.push(
        zh
          ? `由本机原生技能 \`${sk.name}\` 动态孵化专属角色「${synthesized.name.zh}」(权重 90)`
          : `Synthesized specialist "${synthesized.name.en}" from native skill "${sk.name}" (W90)`,
      );
    }
  }

  if (specialists.length === 0) {
    specialists = [{ ...findRoleTemplate(domain === "swe" ? "software-architect" : "market-analyst")! }];
  }

  const hasExplicitPrimary = (input.primaryRoleIds?.length ?? 0) > 0;
  const autoTune = input.autoTuneWeights !== false && !hasExplicitPrimary;

  if (autoTune && domain === "commercial") {
    const isCompliance = COMPLIANCE_HEAVY_RE.test(input.goal);
    const isFinance = FINANCE_HEAVY_RE.test(input.goal);
    const isTech = TECH_HEAVY_RE.test(input.goal);
    const isMarket = MARKET_HEAVY_RE.test(input.goal);

    specialists = specialists.map((role) => {
      if (role.roleId === "legal-advisor" && isCompliance) {
        rationale.push(
          zh
            ? "识别到强合规/监管议题 → 提拔「合规与法律风控护栏官」为核心主导(96)"
            : "Detected regulatory/compliance risk -> promoted Legal Guardrail to Primary Lead (W96)",
        );
        return { ...role, priorityTier: "primary", weight: 96 };
      }
      if (role.roleId === "profit-modeler" && isFinance) {
        rationale.push(
          zh
            ? "识别到定价/退货率/盈亏测算诉求 → 提拔「精算建模专员」为核心主导(96)"
            : "Detected pricing/BEP unit-economics focus -> promoted Profit Actuary to Primary Lead (W96)",
        );
        return { ...role, priorityTier: "primary", weight: 96 };
      }
      if (role.roleId === "tech-feasibility" && isTech) {
        rationale.push(
          zh
            ? "识别到硬件BOM/高并发工程瓶颈 → 提拔「工程与交付专员」为核心主导(94)"
            : "Detected BOM/engineering bottleneck -> promoted Engineering Specialist to Primary Lead (W94)",
        );
        return { ...role, priorityTier: "primary", weight: 94 };
      }
      if (role.roleId === "market-analyst" && !isMarket && (isCompliance || isTech)) {
        return { ...role, priorityTier: "guardrail", weight: 86 };
      }
      return role;
    });
  }

  // Apply explicit primaryRoleIds if user picked who leads
  if (hasExplicitPrimary) {
    const primarySet = new Set(input.primaryRoleIds!.map((s) => s.trim().toLowerCase()));
    specialists = specialists.map((role) => {
      if (primarySet.has(role.roleId.toLowerCase())) {
        return {
          ...role,
          priorityTier: "primary",
          weight: Math.max(role.weight, 95),
        };
      }
      // Demote non-selected default primaries so user's chosen Primary Lead strictly leads
      if (role.priorityTier === "primary") {
        return {
          ...role,
          priorityTier: "guardrail",
          weight: Math.min(role.weight, 86),
        };
      }
      return role;
    });
    const leadNames = specialists
      .filter((r) => r.priorityTier === "primary")
      .map((r) => r.name[locale])
      .join(zh ? "、" : ", ");
    if (leadNames) {
      rationale.push(
        zh ? `人工指定核心主导：${leadNames}` : `User-selected Primary Lead(s): ${leadNames}`,
      );
    }
  }

  // Apply explicit tierOverrides, weightOverrides & modelOverrides
  if (input.tierOverrides || input.weightOverrides || input.modelOverrides) {
    specialists = specialists.map((role) => {
      const nextTier = input.tierOverrides?.[role.roleId] ?? role.priorityTier;
      const rawWeight = input.weightOverrides?.[role.roleId];
      const nextWeight =
        rawWeight !== undefined
          ? Math.max(10, Math.min(100, Math.round(rawWeight)))
          : role.weight;
      const rawModel = input.modelOverrides?.[role.roleId];
      const nextModel = rawModel ? normalizeRoleModelBinding(rawModel) : role.modelBinding;
      return {
        ...role,
        ...(nextModel ? { modelBinding: nextModel } : {}),
        priorityTier: nextTier,
        weight: nextWeight,
      };
    });
  }

  // Mount bound native & pack skills onto each specialist role
  const boundSkillsByRoleId: Record<string, string[]> = {};
  if (discoveredById.size > 0) {
    const autoSkillRec = recommendSkillBindingsAndCandidates({
      discoveredSkills: input.discoveredSkills ?? [],
      goal: input.goal,
      roles: specialists,
    });
    const globalList = (input.globalSkillIds ?? []).map((x) => x.trim().toLowerCase());

    specialists = specialists.map((role) => {
      const isSynthesizedFromSkill = role.roleId.startsWith("skill-");
      const synthSkillId = isSynthesizedFromSkill ? role.roleId.slice(6) : undefined;
      const explicitForRole = input.roleSkillBindings?.[role.roleId];
      const targetIds = new Set<string>(
        explicitForRole
          ? explicitForRole.map((s) => s.trim().toLowerCase())
          : (autoSkillRec.recommendedBindings[role.roleId] ?? []),
      );
      for (const gid of globalList) targetIds.add(gid);
      if (synthSkillId && discoveredById.has(synthSkillId)) {
        targetIds.add(synthSkillId);
      }

      const attachable: DiscoveredSkill[] = [];
      const recordedIds: string[] = [];
      for (const tid of targetIds) {
        const sk = discoveredById.get(tid);
        if (!sk) continue;
        recordedIds.push(sk.skillId);
        // Synthesized skill-role already has its primary skill embedded in systemCharter
        if (tid !== synthSkillId) {
          attachable.push(sk);
        }
      }

      if (recordedIds.length > 0) {
        boundSkillsByRoleId[role.roleId] = recordedIds;
      }
      return attachable.length > 0
        ? attachSkillsToRole(role, attachable, input.enforceHardSkillGate === true)
        : role;
    });
  }

  // Sort Wave 1 specialists by weight descending so the highest-authority Primary Lead sits at Track 1!
  specialists.sort((a, b) => b.weight - a.weight);

  const finalRoles: RoleTemplate[] = [...specialists];
  if (includeInspector && !excludeSet.has("quality-inspector")) {
    const inspector: RoleTemplate = { ...findRoleTemplate("quality-inspector")! };
    if (input.weightOverrides?.["quality-inspector"] !== undefined) {
      inspector.weight = Math.max(
        10,
        Math.min(100, Math.round(input.weightOverrides["quality-inspector"])),
      );
    }
    const rawInspModel = input.modelOverrides?.["quality-inspector"];
    if (rawInspModel) {
      inspector.modelBinding = normalizeRoleModelBinding(rawInspModel);
    }
    finalRoles.push(inspector);
  }

  return { boundSkillsByRoleId, rationale, roles: finalRoles };
}

export const AUTO_RECOMMENDED_LEAD_OPTION_ID = "__auto_recommended_lead__";
export const DEFAULT_FULL_LINEUP_OPTION_ID = "__default_full_lineup__";
export const AUTO_BIND_SKILLS_OPTION_ID = "__auto_bind_skills__";
export const WEIGHT_PRESET_AUTO = "__weight_auto__";
export const WEIGHT_PRESET_SINGLE_DICTATOR = "__weight_single_99__";
export const WEIGHT_PRESET_COMPLIANCE_FIRST = "__weight_compliance_98__";
export const WEIGHT_PRESET_FINANCE_FIRST = "__weight_finance_98__";
export const WEIGHT_PRESET_EQUAL = "__weight_equal_90__";

/**
 * Parses natural-language custom weight expressions entered in `ask_question` "Other" input,
 * e.g. `"精算=98, automation:92, 市场 70, legal-advisor=96"`.
 */
export function parseCustomWeightText(
  rawText: string | undefined,
  availableRoles: readonly { readonly roleId: string; readonly title: string }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!rawText?.trim()) return out;

  const aliasMap: ReadonlyArray<readonly [RegExp, string]> = [
    [/(?:profit-modeler|精算|单位经济|财务|盈利)/iu, "profit-modeler"],
    [/(?:market-analyst|市场|重置天花板|选品)/iu, "market-analyst"],
    [/(?:legal-advisor|合规|法务|法律|风控)/iu, "legal-advisor"],
    [/(?:tech-feasibility|工程|技术可行|交付)/iu, "tech-feasibility"],
    [/(?:software-architect|架构|7-gate)/iu, "software-architect"],
    [/(?:quality-inspector|督察|质检|核账)/iu, "quality-inspector"],
  ];

  const segments = rawText.split(/[,，;；\n]+/);
  for (const seg of segments) {
    const m = /(.+?)\s*(?:=|:|：|\s)\s*(\d{2,3})\b/u.exec(seg.trim());
    if (!m) continue;
    const keyRaw = m[1]!.trim();
    const num = Math.max(10, Math.min(100, Number(m[2])));
    if (!Number.isFinite(num)) continue;

    let matchedRoleId: string | undefined;
    for (const r of availableRoles) {
      if (
        r.roleId.toLowerCase() === keyRaw.toLowerCase() ||
        r.roleId.toLowerCase() === `skill-${keyRaw.toLowerCase()}` ||
        r.title.toLowerCase().includes(keyRaw.toLowerCase())
      ) {
        matchedRoleId = r.roleId;
        break;
      }
    }
    if (!matchedRoleId) {
      for (const [re, id] of aliasMap) {
        if (re.test(keyRaw)) {
          matchedRoleId = id;
          break;
        }
      }
    }
    if (matchedRoleId) {
      out[matchedRoleId] = num;
    }
  }
  return out;
}

/**
 * Generates zero-conflict IDE-native interactive selector questions (`ask_question` compatible)
 * covering ALL FOUR dimensions without overlapping umbrella items:
 * 1. Active Roles + Native Skill -> Role synthesis (`q_active_roles`, check ONLY who participates — zero conflict!)
 * 2. Primary Lead selection (`q_primary_leads`, single or multi-lead)
 * 3. Weight Distribution Preset + Custom Numeric Input via "Other" (`q_role_weights`)
 * 4. Mounting Specific Native / VetoBoard Skills (`q_skill_bindings`)
 */
function inferHostModelFamily(id: string, explicitFamily?: string): string {
  if (explicitFamily?.trim()) return explicitFamily.trim().toLowerCase();
  const s = id.toLowerCase();
  if (s.includes("claude") || s.includes("opus") || s.includes("sonnet") || s.includes("haiku")) return "claude";
  if (s.includes("gemini")) return "gemini";
  if (s.includes("gpt") || /^o\d/.test(s) || s.includes("codex")) return "openai";
  if (s.includes("deepseek")) return "deepseek";
  if (s.includes("grok")) return "grok";
  return "other";
}

function inferHostModelTier(id: string, explicitTier?: "frontier" | "balanced" | "fast"): "frontier" | "balanced" | "fast" {
  if (explicitTier) return explicitTier;
  const s = id.toLowerCase();
  if (s.includes("flash") || s.includes("haiku") || s.includes("mini") || s.includes("lite") || s.endsWith("-low")) {
    return "fast";
  }
  if (
    s.includes("opus") ||
    s.includes("reasoner") ||
    s.includes("xhigh") ||
    s.includes("-high") ||
    s.includes("gpt-5") ||
    /^o3\b/.test(s) ||
    s.includes("pro")
  ) {
    return "frontier";
  }
  return "balanced";
}

const EFFORT_LABEL_SUFFIX_RE = /\s*\((XHigh|High|Medium|Med|Low|Minimal)\)\s*$/i;
const EFFORT_ID_SUFFIX_RE = /-(xhigh|high|medium|med|low|minimal)$/i;

const EFFORT_RANK: Readonly<Record<string, number>> = {
  high: 4,
  low: 2,
  med: 3,
  medium: 3,
  minimal: 1,
  xhigh: 5,
};

function shortEffortLabel(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower === "medium" || lower === "med") return "Med";
  if (lower === "xhigh") return "XHigh";
  if (lower === "minimal") return "Min";
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function extractBaseModelAndEffort(
  id: string,
  label?: string,
): { readonly baseId: string; readonly baseLabel: string; readonly effort?: string } {
  const display = (label ?? id).trim();
  const labelMatch = EFFORT_LABEL_SUFFIX_RE.exec(display);
  const idMatch = EFFORT_ID_SUFFIX_RE.exec(id.trim());
  const baseId = idMatch ? id.trim().slice(0, idMatch.index) : id.trim();
  if (labelMatch) {
    return {
      baseId,
      baseLabel: display.slice(0, labelMatch.index).trim(),
      effort: shortEffortLabel(labelMatch[1]!),
    };
  }
  if (!label && idMatch) {
    return {
      baseId,
      baseLabel: baseId,
      effort: shortEffortLabel(idMatch[1]!),
    };
  }
  return { baseId, baseLabel: display };
}

export function normalizeHostModelCandidates(
  explicitModels?: readonly HostModelCandidate[],
  rawHostModelsJson?: string,
): HostModelCandidate[] {
  const byId = new Map<string, HostModelCandidate>();

  if (rawHostModelsJson?.trim()) {
    try {
      const parsed = JSON.parse(rawHostModelsJson.trim()) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && item.trim()) {
            byId.set(item.trim(), { id: item.trim() });
          } else if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            const id = typeof obj.id === "string" ? obj.id.trim() : "";
            if (id) {
              byId.set(id, {
                ...(typeof obj.family === "string" ? { family: obj.family } : {}),
                id,
                ...(typeof obj.label === "string"
                  ? { label: obj.label }
                  : typeof obj.name === "string"
                    ? { label: obj.name }
                    : {}),
                ...(typeof obj.quotaRemaining === "string"
                  ? { quotaRemaining: obj.quotaRemaining }
                  : {}),
              });
            }
          }
        }
      } else if (parsed && typeof parsed === "object") {
        const obj = parsed as {
          models?: unknown;
          display_names?: Record<string, unknown>;
          quotas?: Record<string, { quota_remaining?: unknown }>;
          data?: unknown;
        };
        // Antigravity `swarm({ action: "models", all: true })` payload format
        if (Array.isArray(obj.models)) {
          for (const m of obj.models) {
            if (typeof m !== "string" || !m.trim()) continue;
            const id = m.trim();
            const rawDisplay = obj.display_names?.[id];
            const rawQuota = obj.quotas?.[id]?.quota_remaining;
            byId.set(id, {
              id,
              ...(typeof rawDisplay === "string" && rawDisplay.trim()
                ? { label: rawDisplay.trim() }
                : {}),
              ...(typeof rawQuota === "string" && rawQuota.trim()
                ? { quotaRemaining: rawQuota.trim() }
                : {}),
            });
          }
        }
        // OpenAI / OpenRouter `/v1/models` `{ data: [...] }` payload format
        if (Array.isArray(obj.data)) {
          for (const item of obj.data) {
            if (!item || typeof item !== "object") continue;
            const rec = item as Record<string, unknown>;
            const id = typeof rec.id === "string" ? rec.id.trim() : "";
            if (!id) continue;
            byId.set(id, {
              id,
              ...(typeof rec.name === "string" && rec.name.trim() ? { label: rec.name.trim() } : {}),
            });
          }
        }
      }
    } catch {
      // Ignore malformed raw JSON and rely on explicitModels
    }
  }

  for (const m of explicitModels ?? []) {
    const prev = byId.get(m.id);
    byId.set(m.id, { ...prev, ...m });
  }

  return [...byId.values()];
}

function extractModelGenerationScore(id: string, label?: string): number {
  const text = `${label ?? ""} ${id}`;
  // Match version numbers like `4.6`, `4`, `3.8`, `5.4` while ignoring parameter sizes like `120B`, `70B`, `32k`
  const re = /(?<![a-z0-9.])(\d+(?:\.\d+)?)(?![0-9.]*[bkm]\b)/gi;
  let best = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const val = Number.parseFloat(match[1]!);
    if (Number.isFinite(val) && val > 0 && val < 30 && val > best) {
      best = val;
    }
  }
  return best * 8;
}

export function scoreModelCandidate(
  m: HostModelCandidate,
  activeHostModel?: string,
  forLeafWorker = true,
): number {
  let score = extractModelGenerationScore(m.id, m.label);

  if (m.quotaRemaining) {
    const pctMatch = /(\d+(?:\.\d+)?)\s*%/.exec(m.quotaRemaining);
    if (pctMatch) {
      const pct = Number.parseFloat(pctMatch[1]!);
      if (pct <= 0) score -= 1_000;
      else score += pct * 0.25;
    }
  }

  if (forLeafWorker && /orchestrator/i.test(`${m.id} ${m.label ?? ""}`)) {
    score -= 12;
  }

  const { effort, baseId, baseLabel } = extractBaseModelAndEffort(m.id, m.label);
  if (effort) {
    score += (EFFORT_RANK[effort.toLowerCase()] ?? 2) * 0.4;
  }

  if (activeHostModel?.trim()) {
    const activeClean = extractBaseModelAndEffort(activeHostModel, activeHostModel);
    const activeNeedle = activeClean.baseLabel.toLowerCase();
    const activeIdNeedle = activeClean.baseId.toLowerCase();
    if (
      baseLabel.toLowerCase() === activeNeedle ||
      baseId.toLowerCase() === activeIdNeedle ||
      (activeNeedle.length >= 4 && baseLabel.toLowerCase().includes(activeNeedle))
    ) {
      score += 18;
    }
  }

  return score;
}

export function groupHostModelsForDisplay(
  hostModels: readonly HostModelCandidate[],
  activeHostModel?: string,
  locale: VetoBoardLocale = "zh",
): string[] {
  interface FamilyBucket {
    baseLabel: string;
    items: HostModelCandidate[];
    efforts: Set<string>;
    quota?: string;
    bestScore: number;
    isActive: boolean;
  }

  const buckets = new Map<string, FamilyBucket>();
  const activeClean = activeHostModel?.trim()
    ? extractBaseModelAndEffort(activeHostModel, activeHostModel)
    : undefined;

  for (const m of hostModels) {
    const { baseId, baseLabel, effort } = extractBaseModelAndEffort(m.id, m.label);
    const key = baseLabel.toLowerCase();
    const sc = scoreModelCandidate(m, activeHostModel, false);
    const matchesActive = Boolean(
      activeClean &&
        (baseLabel.toLowerCase() === activeClean.baseLabel.toLowerCase() ||
          baseId.toLowerCase() === activeClean.baseId.toLowerCase() ||
          (activeClean.baseLabel.length >= 4 &&
            baseLabel.toLowerCase().includes(activeClean.baseLabel.toLowerCase()))),
    );

    const existing = buckets.get(key);
    if (!existing) {
      const efforts = new Set<string>();
      if (effort) efforts.add(effort);
      buckets.set(key, {
        baseLabel,
        bestScore: sc,
        efforts,
        isActive: matchesActive,
        items: [m],
        ...(m.quotaRemaining ? { quota: m.quotaRemaining } : {}),
      });
    } else {
      existing.items.push(m);
      if (effort) existing.efforts.add(effort);
      if (sc > existing.bestScore) existing.bestScore = sc;
      if (matchesActive) existing.isActive = true;
      if (!existing.quota && m.quotaRemaining) existing.quota = m.quotaRemaining;
    }
  }

  const sorted = [...buckets.values()].sort((a, b) => b.bestScore - a.bestScore);
  return sorted.slice(0, 30).map((b) => {
    const activeBadge = b.isActive ? (locale === "zh" ? " ★当前" : " ★active") : "";
    const quotaSuffix = b.quota ? `(${b.quota})` : "";
    if (b.items.length === 1 || b.efforts.size <= 1) {
      const single = b.items[0]!;
      return `\`${single.label ?? single.id}${activeBadge}\`${quotaSuffix}`;
    }
    const orderedEfforts = [...b.efforts].sort(
      (x, y) => (EFFORT_RANK[x.toLowerCase()] ?? 9) - (EFFORT_RANK[y.toLowerCase()] ?? 9),
    );
    return `\`${b.baseLabel} [${orderedEfforts.join("/")}]${activeBadge}\`${quotaSuffix}`;
  });
}

export function recommendModelForRole(params: {
  readonly role: RoleTemplate;
  readonly hostModels?: readonly HostModelCandidate[];
  readonly activeHostModel?: string;
  readonly primaryLeadFamily?: string;
  readonly locale: VetoBoardLocale;
}): { readonly modelId: string; readonly displayLabel: string } {
  const { role, hostModels, activeHostModel, primaryLeadFamily, locale } = params;
  const zh = locale === "zh";

  if (role.modelBinding) {
    const lbl = formatModelBindingLabel(role.modelBinding) ?? "inherit";
    return { displayLabel: lbl, modelId: lbl };
  }

  // External BYOK inspector override via env if configured
  const envAuditModel = process.env.VETOBOARD_AUDIT_MODEL?.trim();
  if (role.kind === "inspector" && envAuditModel && process.env.VETOBOARD_API_KEY?.trim()) {
    return {
      displayLabel: `${envAuditModel} (BYOK)`,
      modelId: envAuditModel,
    };
  }

  if (hostModels && hostModels.length > 0) {
    const enriched = hostModels
      .map((m) => ({
        ...m,
        inferredFamily: inferHostModelFamily(m.id, m.family),
        inferredTier: inferHostModelTier(m.id, m.tier),
        rankScore: scoreModelCandidate(m, activeHostModel, true),
      }))
      .sort((a, b) => b.rankScore - a.rankScore);

    let chosen = enriched[0]!;
    if (role.kind === "inspector") {
      // Adversarial Cross-Family Rule: prefer highest-ranked model from a DIFFERENT family than Primary Lead!
      chosen =
        enriched.find(
          (m) =>
            primaryLeadFamily &&
            m.inferredFamily !== primaryLeadFamily &&
            m.inferredTier !== "fast",
        ) ??
        enriched.find((m) => primaryLeadFamily && m.inferredFamily !== primaryLeadFamily) ??
        enriched.find((m) => m.inferredTier === "frontier") ??
        enriched[0]!;
    } else if (role.priorityTier === "primary" || role.roleId === "profit-modeler") {
      chosen = enriched.find((m) => m.inferredTier === "frontier") ?? enriched[0]!;
    } else if (role.priorityTier === "secondary") {
      chosen =
        enriched.find((m) => m.inferredTier === "fast") ??
        enriched.find((m) => m.inferredTier === "balanced") ??
        enriched[0]!;
    } else {
      chosen =
        enriched.find((m) => m.inferredTier === "balanced") ??
        enriched.find((m) => m.inferredTier === "frontier") ??
        enriched[0]!;
    }

    const qSuffix = chosen.quotaRemaining ? ` · ${chosen.quotaRemaining}` : "";
    return {
      displayLabel: `${chosen.label ?? chosen.id}${qSuffix}`,
      modelId: chosen.id,
    };
  }

  // Universal cross-platform semantic tier fallback when host did not report specific model IDs
  if (role.kind === "inspector") {
    return {
      displayLabel: zh ? "pro / 异构核验档" : "pro (Adversarial Check)",
      modelId: "pro",
    };
  }
  if (role.priorityTier === "primary" || role.roleId === "profit-modeler") {
    return {
      displayLabel: zh ? "pro / 旗舰强推理档" : "pro (Frontier Reasoning)",
      modelId: "pro",
    };
  }
  if (role.priorityTier === "secondary") {
    return {
      displayLabel: zh ? "flash / 高速轻量档" : "flash (Fast Tier)",
      modelId: "flash",
    };
  }
  return {
    displayLabel: zh ? "inherit / 均衡主力档" : "inherit (Balanced)",
    modelId: "inherit",
  };
}

export function buildLineupSelectorPlan(params: {
  readonly goal: string;
  readonly domain?: "commercial" | "swe";
  readonly discoveredSkills?: readonly DiscoveredSkill[];
  readonly hostModels?: readonly HostModelCandidate[];
  readonly rawHostModelsJson?: string;
  readonly activeHostModel?: string;
  readonly hostPlatform?: string;
  readonly locale?: VetoBoardLocale;
}): {
  readonly locale: VetoBoardLocale;
  readonly hostPlatform?: string;
  readonly availableHostModels: readonly HostModelCandidate[];
  readonly discoveredNativeSkills: readonly {
    readonly skillId: string;
    readonly name: string;
    readonly source: string;
    readonly description: string;
  }[];
  readonly recommendedLineup: readonly {
    readonly roleId: string;
    readonly title: string;
    readonly priorityTier: RolePriorityTier;
    readonly tierLabel: string;
    readonly weight: number;
    readonly wave: number;
    readonly boundSkills: readonly string[];
    readonly recommendedModelId: string;
    readonly recommendedModelLabel: string;
  }[];
  readonly rationale: readonly string[];
  readonly questions: readonly ClarifyQuestion[];
} {
  const locale = params.locale ?? "en";
  const zh = locale === "zh";
  const discovered = params.discoveredSkills ?? [];
  const resolved = resolveCouncilLineup({
    autoTuneWeights: true,
    discoveredSkills: discovered,
    domain: params.domain,
    goal: params.goal,
    locale,
  });

  const skillRec = recommendSkillBindingsAndCandidates({
    discoveredSkills: discovered,
    goal: params.goal,
    roles: resolved.roles,
  });

  const specialists = resolved.roles.filter((r) => r.kind !== "inspector");

  const topSkillSpawnOptions = skillRec.candidateSkillRoles.slice(0, 4).map(({ skill }) => ({
    description: zh
      ? `[本机原生技能:${skill.source}] 勾选后直接将该原生技能孵化为一名独立专员参审`
      : `[Native Skill:${skill.source}] Spawn a dedicated specialist role from "${skill.name}"`,
    label: zh
      ? `✨ [原生技能→生成角色] ${skill.name}`
      : `✨ [Spawn Role from Skill] ${skill.name}`,
    optionId: `spawn:${skill.skillId}`,
  }));

  const mountableSkillOptions = discovered.slice(0, 6).map((sk) => ({
    description: `[${sk.source}] ${sk.description.slice(0, 90)}`,
    label: `${sk.name} (${sk.skillId})`,
    optionId: sk.skillId,
  }));

  const questions: ClarifyQuestion[] = [
    {
      options: [
        ...specialists.map((r, idx) => ({
          description: `${resolveTierLabel(r, locale)} · 默认权重 ${r.weight}`,
          label: `${idx === 0 ? "(Recommended) " : ""}${r.name[locale]} (${r.roleId} · W${r.weight})`,
          optionId: r.roleId,
        })),
        ...topSkillSpawnOptions,
      ],
      question: zh
        ? "1/4 【上场角色选择（多选：勾谁谁上场，不勾则不上，互不冲突）】省流建议勾 2–3 项（独立督察官会自动殿后核账）："
        : "1/4 [Active Roles (Multi-select: check ONLY who participates)] Pick 2-3 tracks for lean quota:",
      questionId: "q_active_roles",
      selectionMode: "multiple",
    },
    {
      options: specialists.map((r, idx) => ({
        description: zh
          ? `设为【核心主导】(权重≥95)，当各轨结论分歧时优先采信该角色`
          : `Set ${r.name.en} as Primary Lead (W>=95) in conflict resolution`,
        label: `${idx === 0 ? "(Recommended) " : ""}${r.name[locale]} (${r.roleId})`,
        optionId: r.roleId,
      })),
      question: zh
        ? "2/4 【核心主导（建议选 1–2 项）】当各角色意见打架时，最终以谁为主裁？（选 1 个=单核拍板，选多个=联席主裁）"
        : "2/4 [Primary Lead] Who holds decisive authority when specialists disagree?",
      questionId: "q_primary_leads",
      selectionMode: "multiple",
    },
    {
      options: [
        {
          description: zh
            ? "按课题风险自动分配梯度（核心主导 96 / 护栏 85 / 辅助 75）"
            : "Task-aware gradient (Primary 96 / Guardrail 85 / Support 75)",
          label: zh
            ? "(Recommended) VetoBoard 智能风险梯度权重（96 / 85 / 75）"
            : "(Recommended) Smart Risk-Weighted Gradient (96 / 85 / 75)",
          optionId: WEIGHT_PRESET_AUTO,
        },
        {
          description: zh
            ? "把你选的第 1 主导拉满 99 绝对一票拍板，其余参审角色压至 75 仅做挑刺补充"
            : "First Primary Lead at W99 decisive authority; other tracks at W75 advisory",
          label: zh
            ? "强主裁一票制（第一主导 99 vs 其余 75）"
            : "Strong Single-Lead Authority (99 vs 75)",
          optionId: WEIGHT_PRESET_SINGLE_DICTATOR,
        },
        {
          description: zh
            ? "精算建模专员拉满 98（ROI/回本算不过直接一票否决），其余 82"
            : "Profit & BEP Actuary at W98; others at W82",
          label: zh
            ? "财务/ROI 铁算盘优先（精算 98 vs 其余 82）"
            : "Unit-Economics & ROI First (Profit 98 vs 82)",
          optionId: WEIGHT_PRESET_FINANCE_FIRST,
        },
        {
          description: zh
            ? "合规风控官拉满 98（法务/隐私踩线直接一票否决），其余 82"
            : "Compliance & Legal Guardrail at W98; others at W82",
          label: zh
            ? "法务合规风控优先（合规 98 vs 其余 82）"
            : "Compliance & Legal Redline First (Legal 98 vs 82)",
          optionId: WEIGHT_PRESET_COMPLIANCE_FIRST,
        },
        {
          description: zh
            ? "所有上场专员统一权重 90 平票辩论"
            : "All participating specialists at equal W90",
          label: zh
            ? "全员平权对等博弈（全部 90）"
            : "Equal-Weight Peer Debate (All 90)",
          optionId: WEIGHT_PRESET_EQUAL,
        },
      ],
      question: zh
        ? "3/4 【权重调整（单选预设，或点底部「其他」直接手输任意 10-100 权重，如：精算=98, automation=92, 市场=70）】"
        : "3/4 [Weight Tuning] Pick a preset OR click 'Other' to type exact 10-100 weights (e.g. profit-modeler=98, automation=92)",
      questionId: "q_role_weights",
      selectionMode: "single",
    },
    ...(mountableSkillOptions.length > 0
      ? [
          {
            options: [
              {
                description: zh
                  ? "按角色职责自动挂载匹配的技能包（无需手工逐个挑）"
                  : "Automatically mount matching skills per role",
                label: zh
                  ? `(Recommended) 智能按需自动挂载`
                  : `(Recommended) Auto-mount matching skills`,
                optionId: AUTO_BIND_SKILLS_OPTION_ID,
              },
              ...mountableSkillOptions,
            ],
            question: zh
              ? "4/4 【挂载技能包（单选第 1 项自动挂载，或手动勾选指定技能）】"
              : "4/4 [Skill Mounting] Auto-mount (Option 1) or manually pick skills:",
            questionId: "q_skill_bindings",
            selectionMode: "multiple" as const,
          },
        ]
      : []),
  ];

  const hostModels = normalizeHostModelCandidates(params.hostModels, params.rawHostModelsJson);
  const leadModelPick =
    specialists.length > 0
      ? recommendModelForRole({
          activeHostModel: params.activeHostModel,
          hostModels,
          locale,
          role: specialists[0]!,
        })
      : undefined;
  const primaryLeadFamily = leadModelPick
    ? inferHostModelFamily(leadModelPick.modelId)
    : undefined;

  return {
    availableHostModels: hostModels,
    discoveredNativeSkills: discovered.map((s) => ({
      description: s.description,
      name: s.name,
      skillId: s.skillId,
      source: s.source,
    })),
    ...(params.hostPlatform ? { hostPlatform: params.hostPlatform } : {}),
    locale,
    questions,
    rationale: resolved.rationale,
    recommendedLineup: resolved.roles.map((r) => {
      const mPick = recommendModelForRole({
        activeHostModel: params.activeHostModel,
        hostModels,
        locale,
        primaryLeadFamily,
        role: r,
      });
      return {
        boundSkills: resolved.boundSkillsByRoleId[r.roleId] ?? [],
        priorityTier: r.priorityTier,
        recommendedModelId: mPick.modelId,
        recommendedModelLabel: mPick.displayLabel,
        roleId: r.roleId,
        tierLabel: resolveTierLabel(r, locale),
        title: r.name[locale],
        wave: r.kind === "inspector" ? 2 : 1,
        weight: r.weight,
      };
    }),
  };
}

export function renderRoleCharterPrompt(
  role: RoleTemplate,
  locale: VetoBoardLocale = "en",
): string {
  const dict = t(locale);
  const zh = locale === "zh";
  const tierLabel =
    role.kind === "inspector"
      ? dict.tierInspector
      : role.priorityTier === "primary"
        ? dict.tierPrimary
        : role.priorityTier === "guardrail"
          ? role.domain === "engineering"
            ? dict.tierGuardrailEng
            : dict.tierGuardrailLegal
          : dict.tierSupport;

  const memorialRule = zh
    ? "- **呈批摘要卡规范（零额外请求瘦身）**：请在正文主标题下方顺手输出 4–6 行 `### 呈批摘要卡`（核心定论与底数、硬红线/排除项、上下游口径如是否含税运包装）。"
    : "- **Structured Memorial Card Rule (0-extra-turn compression)**: Right below your main title, include a 4-6 bullet `### Executive Memorial` summarizing key numeric baselines, hard redlines, and accounting boundaries (e.g. whether BOM includes packaging/shipping).";

  const effortTier = classifyRoleEffortTier({
    kind: role.kind,
    roleId: role.roleId,
  });
  const researchBudget = resolveTurnResearchBudget({
    roleId: role.roleId,
    tier: effortTier,
  });
  const budgetDirective = buildEffortScalingBudgetDirective({
    budget: researchBudget,
    locale,
  });

  const rulesBlock = formatExecutableRulesForPrompt(role.executableRules, locale);
  const evHeader = zh ? "## 强制交付凭证要求" : "## Mandatory Evidence Requirements";

  return [
    `# ${role.name[locale]} (\`${role.roleId}\` · ${tierLabel} · Weight ${role.weight}/100)`,
    "",
    role.systemCharter[locale],
    "",
    budgetDirective,
    "",
    memorialRule,
    "",
    evHeader,
    ...role.evidenceRequirements.map((req) => `- ${req}`),
    ...(rulesBlock ? ["", rulesBlock] : []),
  ].join("\n");
}

export function createStarterAssetPack(): VetoBoardAssetPack {
  return {
    author: "VetoBoard Contributors",
    description: {
      en: "Starter bilingual governance pack: 6 weighted commercial & 7-Gate SWE role charters with deterministic math & anti-stub gates.",
      zh: "双语入门治理资产包：内置商业证伪与 Google 7-Gate 研发 6 大权重角色宪章、确定性算账门禁与反假实现硬规则。",
    },
    exportedAt: "2026-11-24T00:00:00.000Z",
    format: "vetoboard-asset-pack",
    name: {
      en: "VetoBoard Starter Governance & Decision Pack",
      zh: "VetoBoard 入门决策与研发治理标准包",
    },
    packId: "starter-governance-v1",
    roles: [...BUILTIN_ROLE_TEMPLATES],
    schemaVersion: 1,
    skills: [
      {
        content: {
          en: "## Replacement-Cost Ceiling Sanity Gate\n1. Never price a repair/retrofit above 35%-50% of a comparable brand-new unit.\n2. Always include founder labor opportunity cost before claiming positive economic profit.",
          zh: "## 新品重置成本天花板与真实经济利润核验\n1. 维修/改造综合报价严禁击穿同档新品重置价的 35%~50% 生死线；\n2. 测算单干/自营利润时必须扣除创始人自身合理机会成本工资与税费，严禁把血汗工时包装成资本回报。",
        },
        skillId: "first-principles-unit-sanity",
        title: {
          en: "First-Principles Replacement Ceiling & Economic Profit Gate",
          zh: "第一性原理重置价天花板与真实经济利润门禁",
        },
      },
      {
        content: {
          en: "## 7-Gate Software Delivery Discipline\n1. Define Non-Goals & WHEN/THEN acceptance scenarios before editing files.\n2. Ship shared types/contracts first, enforce non-overlapping OWNERS directories across parallel tracks, and require hermetic unit tests before marking passed.",
          zh: "## Google 7-Gate 软件工程交付纪律\n1. 动代码前先明确 Non-Goals 与『当…那么…』验收判据；\n2. 契约先行锁定共享接口，同波次严格隔离 OWNERS 文件边界，且必须附带密封单测验证通过后方可结项。",
        },
        skillId: "7-gate-swe-verification",
        title: {
          en: "7-Gate Contract-First & Hermetic Test Discipline",
          zh: "7-Gate 契约先行与密封单测工程纪律",
        },
      },
    ],
  };
}
