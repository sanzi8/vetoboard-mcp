import { type VetoBoardLocale, t } from "../i18n/locales.js";
import {
  DELEGATE_TO_AGENT_OPTION_ID,
  type CandidateRoute,
  type ClarifyQuestion,
  type GoalClarificationPlan,
} from "./types.js";

/**
 * Bilingual (`en` + `zh`) Diverge-Then-Converge Strategic Route Matrix & Objective Hand-of-Cards Clarifier.
 * - Exploratory tasks: Generates 4 differentiated candidate routes upfront (Buyer Logic / Entry Barrier / Compliance Redline)
 *   and asks ONLY objective capability/category/budget questions (with mandatory concrete target-category anchoring).
 * - Convergent tasks: Clarifies entity, scope, and acceptance boundaries cleanly.
 */

const EXPLORATORY_RE =
  /(?:转型|破局|方向在哪|做什么|怎么变现|如何切入|选哪个赛道|出路|副业|创业方向|现金流差|经营不下去|how\s+to\s+pivot|which\s+(?:direction|niche|vertical|market|route|product)|monetiz|what\s+(?:[a-z0-9_-]+\s+){0,5}(?:business|product|saas|tool|niche|direction|launch)|side\s*hustle|career\s+transition|strategic\s+options|explore\s+routes|cash\s*flow\s+crisis)/iu;

export function classifyTaskMode(goal: string): "exploratory" | "convergent" {
  return EXPLORATORY_RE.test(goal) ? "exploratory" : "convergent";
}

export function buildDivergeConvergeClarification(params: {
  readonly goal: string;
  readonly expectedOutcome?: string;
  readonly constraints?: readonly string[];
  readonly locale?: VetoBoardLocale;
}): GoalClarificationPlan {
  const locale = params.locale ?? "en";
  const zh = locale === "zh";
  const dict = t(locale);
  const taskMode = classifyTaskMode(params.goal);
  const constraints = [...(params.constraints ?? [])];

  if (taskMode === "exploratory") {
    const candidateRoutes: CandidateRoute[] = zh
      ? [
          {
            buyerLogic:
              "将核心经验封装为非侵入式外挂套件/标准化工具包或模块化诊断包，按标品采购或技术附件结算，锚定同档新品价 15%~35% 区间",
            complianceRedline:
              "严禁触碰医疗临床注册证、强检计量铅封破坏、特种安全回路改装或原厂加密固件破解侵权",
            entryBarrier:
              "需先收敛 1~2 类高频通用接口/场景打磨样机，后续以远程指导出货替代重体力驻场",
            fitSummary: "最大化脱离纯工时售卖，具备标品毛利与可复制性",
            routeId: "route_a_modular_kit",
            title: "路线 A · 非侵入式标准化模块 / 可复用工具包产品化",
          },
          {
            buyerLogic:
              "面向维修同行、中小型经销商或运维团队输出疑难排故会诊、远程技术支持与标准化 SOP 协作分成（B2B2B 赋能）",
            complianceRedline:
              "严禁泄露受保护原厂图纸/固件，须书面划清远程诊断建议与现场带电安全操作、终端售后的责任边界",
            entryBarrier:
              "零配件库存占款、前期现金投入最低，可在 7~14 天内验证首单付费意愿，但依赖技术信任建立",
            fitSummary: "零库存极轻冷启动，适合现金流吃紧期优先测试回款",
            routeId: "route_b_peer_diagnostic_b2b",
            title: "路线 B · 同行/经销商疑难诊断外包与 B2B 技术支持",
          },
          {
            buyerLogic:
              "聚焦近距离高停机损失商业客户（门店/园区/产线非强监管设备），提供『先收诊断定金 + 按单采买配件』的应急快修与单项巡检包",
            complianceRedline:
              "严格排除特种设备、消防、高压燃气等需专项持证工序；严禁低价承诺无限次包年兜底或垫资囤货",
            entryBarrier:
              "现金回款快（按单现结），但仍占用个人现场与交通工时，需靠分项报价单锁定利润率",
            fitSummary: "最快产生近期正向现金流，为产品化转型提供试单样本与止血现金",
            routeId: "route_c_prepaid_rapid_service",
            title: "路线 C · 近距零垫资预付应急服务与单项巡检包",
          },
          {
            buyerLogic:
              "针对选定熟悉品类的过保/闲置设备，采用『先锁定买方意向定金 → 再按单整备检测』的撮合寄售或翻新延寿佣金模式",
            complianceRedline:
              "严禁收购来源不明或涉密/医疗/强检淘汰设备；必须如实披露维修记录与瑕疵，且整备总成本须显著低于同型号新机可购价",
            entryBarrier:
              "严禁自掏腰包盲目囤货压死现金流，需精准掌握细分机型新机重置价与二手流通价差",
            fitSummary: "单票价差弹性高于纯工时费，但必须严守零囤货与重置价天花板",
            routeId: "route_d_zero_inventory_brokerage",
            title: "路线 D · 熟悉品类零囤货寄售撮合与过保设备延寿整备",
          },
        ]
      : [
          {
            buyerLogic:
              "Package domain expertise into a non-invasive external add-on kit, diagnostic CLI/template, or standardized retrofit module priced at 15%-35% of brand-new equipment replacement cost.",
            complianceRedline:
              "Strictly avoid regulated medical/safety-interlock tampering, certified metrology seal breaking, or proprietary firmware DRM circumvention.",
            entryBarrier:
              "Requires standardizing 1-2 high-frequency interfaces/workflows upfront; shifts delivery from on-site manual labor to remote fulfillment.",
            fitSummary: "Breaks linear billable-hour ceiling with scalable unit economics.",
            routeId: "route_a_modular_kit",
            title: "Route A · Standardized Non-Invasive Module / Productized Kit",
          },
          {
            buyerLogic:
              "Sell remote tier-3 troubleshooting, diagnostic playbooks, and after-sales technical backing to peer shops, regional dealers, or lean ops teams (B2B2B enablement).",
            complianceRedline:
              "Never redistribute NDA OEM schematics/firmware; contractually separate remote diagnostic advice from on-site high-voltage/safety sign-off.",
            entryBarrier:
              "Zero parts inventory and near-zero startup cash; fastest 7-14 day first-dollar test, gated primarily by B2B trust.",
            fitSummary: "Lowest cash burn and zero inventory risk for immediate validation.",
            routeId: "route_b_peer_diagnostic_b2b",
            title: "Route B · Peer/Dealer Tier-3 Diagnostic & B2B Tech Support",
          },
          {
            buyerLogic:
              "Target local SMBs with high downtime cost using 'upfront diagnostic deposit + buy-parts-per-order' rapid recovery & scoped preventive checkups.",
            complianceRedline:
              "Exclude licensed high-risk trades (high-voltage, gas, fire, certified boilers/lifts); never sign unlimited flat-fee SLA commitments.",
            entryBarrier:
              "Fastest immediate cash collection, though still bounded by personal hours and travel radius.",
            fitSummary: "Immediate cash-flow stabilizer while gathering real field BOM data.",
            routeId: "route_c_prepaid_rapid_service",
            title: "Route C · Deposit-First Scoped Rapid Recovery & Checkup Packs",
          },
          {
            buyerLogic:
              "Brokerage/consignment refurbishment on familiar out-of-warranty equipment using buyer-deposit-first sourcing, anchored strictly below brand-new replacement price.",
            complianceRedline:
              "Verify clean title/serials, disclose all refurbishment history & defects, and ensure total landed cost stays well below new-unit street price.",
            entryBarrier:
              "Must enforce zero speculative inventory holding to protect cash flow.",
            fitSummary: "Higher per-deal spread than hourly labor if zero-inventory discipline holds.",
            routeId: "route_d_zero_inventory_brokerage",
            title: "Route D · Zero-Inventory Consignment & Out-of-Warranty Refurbishment",
          },
        ];

    const questions: ClarifyQuestion[] = zh
      ? [
          {
            options: [
              {
                description: "工业控制板卡、变频伺服、PLC、传感器与产线自动化设备",
                label: "工控自动化 / 电路板与变频伺服",
                optionId: "cat_industrial",
              },
              {
                description: "商用餐饮厨电、制冷冷链、门店经营设备或楼宇物业机电",
                label: "商用厨电制冷 / 门店与物业设备",
                optionId: "cat_commercial",
              },
              {
                description: "实验室通用分析检测仪器、办公打印数码或精密电子仪器",
                label: "实验室非医疗仪器 / 办公与精密电子",
                optionId: "cat_instrument",
              },
              {
                description: "软件系统、SaaS 工具、数据自动化脚本或软硬结合终端",
                label: "软件研发 / 数据脚本与智能硬件终端",
                optionId: "cat_software_iot",
              },
              {
                description: dict.delegateOptionDesc,
                label: dict.delegateOptionLabel,
                optionId: DELEGATE_TO_AGENT_OPTION_ID,
              },
            ],
            question:
              "【具体标的物锚定 · 必选】你过往最熟悉、有实操把握的具体标的物/细分设备或业务品类是哪些（防检索泛化）？",
            questionId: "q_target_category",
            selectionMode: "multiple",
          },
          {
            options: [
              {
                description: "手头有可触达的老客户、同行群或本地经销商关系",
                label: "有一定老客户 / 同行或渠道人脉",
                optionId: "res_warm_network",
              },
              {
                description: "主要靠陌生获客，且配件/资源依赖公开电商平台按单采买",
                label: "主要靠陌生获客 + 公开平台按单采购",
                optionId: "res_cold_start",
              },
              {
                description: dict.delegateOptionDesc,
                label: dict.delegateOptionLabel,
                optionId: DELEGATE_TO_AGENT_OPTION_ID,
              },
            ],
            question: "【客观资源底牌】你当前可直接动用的获客与供应链基础如何？",
            questionId: "q_resource_hand",
            selectionMode: "multiple",
          },
          {
            options: [
              {
                description: "启动现金严格控制在 1 万元以内（或兼职零垫资），优先追求 30 天内正向回款",
                label: "极轻投入（< 1万元 / 零囤货），优先 30 天快速回款",
                optionId: "budget_ultra_lean",
              },
              {
                description: "可承受 1~5 万元小规模样机/渠道试错，接受 1~3 个月验证期",
                label: "小额试错（1~5万元），接受 1~3 个月打磨验证",
                optionId: "budget_moderate",
              },
              {
                description: dict.delegateOptionDesc,
                label: dict.delegateOptionLabel,
                optionId: DELEGATE_TO_AGENT_OPTION_ID,
              },
            ],
            question: "【现金流与试错底线】启动期可承受的现金投入上限与回款时间要求是？",
            questionId: "q_cash_runway",
            selectionMode: "single",
          },
        ]
      : [
          {
            options: [
              {
                description: "Industrial PCBs, VFDs/servos, PLCs, sensors & factory automation gear",
                label: "Industrial Controls / PCBs & Automation",
                optionId: "cat_industrial",
              },
              {
                description: "Commercial HVAC/refrigeration, kitchen/retail equipment & facility MEP",
                label: "Commercial Equipment / Retail & Facility Systems",
                optionId: "cat_commercial",
              },
              {
                description: "Non-clinical lab instruments, test gear, office/prosumer electronics",
                label: "Lab/Test Instruments & Precision Electronics",
                optionId: "cat_instrument",
              },
              {
                description: "Software SaaS, developer tooling, AI workflows, or embedded IoT firmware",
                label: "Software / SaaS / Embedded IoT",
                optionId: "cat_software_iot",
              },
              {
                description: dict.delegateOptionDesc,
                label: dict.delegateOptionLabel,
                optionId: DELEGATE_TO_AGENT_OPTION_ID,
              },
            ],
            question:
              "[Concrete Target Category · Anchor] Which specific equipment, product, or domain categories do you know best from hands-on experience?",
            questionId: "q_target_category",
            selectionMode: "multiple",
          },
          {
            options: [
              {
                description: "Have existing past clients, peer technicians, or local distributor contacts",
                label: "Warm client / peer / dealer network available",
                optionId: "res_warm_network",
              },
              {
                description: "Cold outbound acquisition only; parts/inputs bought per-order off public marketplaces",
                label: "Cold start + public marketplace per-order sourcing",
                optionId: "res_cold_start",
              },
              {
                description: dict.delegateOptionDesc,
                label: dict.delegateOptionLabel,
                optionId: DELEGATE_TO_AGENT_OPTION_ID,
              },
            ],
            question: "[Objective Resource Hand] What customer acquisition & supply channels do you currently hold?",
            questionId: "q_resource_hand",
            selectionMode: "multiple",
          },
          {
            options: [
              {
                description: "Strictly under $1,500 (zero inventory holding), prioritizing positive cash collection within 30 days",
                label: "Ultra-lean (< $1.5k, zero inventory, <=30d payback)",
                optionId: "budget_ultra_lean",
              },
              {
                description: "Up to $1.5k-$8k pilot budget with a 1-3 month validation window",
                label: "Moderate pilot ($1.5k-$8k, 1-3 month runway)",
                optionId: "budget_moderate",
              },
              {
                description: dict.delegateOptionDesc,
                label: dict.delegateOptionLabel,
                optionId: DELEGATE_TO_AGENT_OPTION_ID,
              },
            ],
            question: "[Cash & Runway Floor] What is your maximum acceptable startup cash risk and payback window?",
            questionId: "q_cash_runway",
            selectionMode: "single",
          },
        ];

    return {
      assumptions: [],
      candidateRoutes,
      constraints,
      delegateOptionId: DELEGATE_TO_AGENT_OPTION_ID,
      expectedOutcome:
        params.expectedOutcome?.trim() ||
        (zh
          ? "通过四路线同台实证算账与合规排雷，淘汰伪命题并给出主/备选破局路线与 30 天行动清单"
          : "Stress-test all candidate routes head-to-head on unit economics & statutory redlines, eliminate traps, and converge on primary/backup routes with a 30-day action plan"),
      goal: params.goal,
      locale,
      questions,
      taskMode: "exploratory",
      unresolved: questions.map((q) => q.question),
    };
  }

  // Convergent mode (software engineering / concrete single-target evaluation)
  const questions: ClarifyQuestion[] = zh
    ? [
        {
          options: [
            {
              description: "快速跑通最小可行闭环与核心单元测试（Small CLs）",
              label: "MVP 最小闭环实现 + 核心自动化单测",
              optionId: "conv_mvp",
            },
            {
              description: "深度核验单位经济模型（BEP/敏感性）与现行法规/安全死线",
              label: "深度财务可行性复算 + 合规安全排雷",
              optionId: "conv_audit",
            },
            {
              description: dict.delegateOptionDesc,
              label: dict.delegateOptionLabel,
              optionId: DELEGATE_TO_AGENT_OPTION_ID,
            },
          ],
          question: "本明确命题的首要验收重心是什么？",
          questionId: "q_convergent_focus",
          selectionMode: "multiple",
        },
      ]
    : [
        {
          options: [
            {
              description: "Ship a clean contract-first implementation with hermetic unit tests",
              label: "Contract-first MVP + Hermetic Unit Tests",
              optionId: "conv_mvp",
            },
            {
              description: "Audit unit economics (BEP/sensitivity) & statutory/security redlines",
              label: "Deep Unit-Economics Audit + Redline Verification",
              optionId: "conv_audit",
            },
            {
              description: dict.delegateOptionDesc,
              label: dict.delegateOptionLabel,
              optionId: DELEGATE_TO_AGENT_OPTION_ID,
            },
          ],
          question: "What is the primary acceptance focus for this convergent task?",
          questionId: "q_convergent_focus",
          selectionMode: "multiple",
        },
      ];

  return {
    assumptions: [],
    candidateRoutes: [],
    constraints,
    delegateOptionId: DELEGATE_TO_AGENT_OPTION_ID,
    ...(params.expectedOutcome?.trim() ? { expectedOutcome: params.expectedOutcome.trim() } : {}),
    goal: params.goal,
    locale,
    questions,
    taskMode: "convergent",
    unresolved: questions.map((q) => q.question),
  };
}
