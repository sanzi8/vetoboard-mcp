/**
 * Built-in Bilingual Locale Engine (`en` + `zh`)
 * - International GitHub default: `en`, with automatic CJK input detection when `lang = "auto"`
 * - Explicit override via CLI `--lang en|zh`, env `VETOBOARD_LANG=en|zh`, or per-tool `lang` parameter.
 */

export type VetoBoardLocale = "en" | "zh";
export type VetoBoardLocaleInput = "auto" | "en" | "zh" | undefined;

const CJK_RE = /[\u4e00-\u9fff]/u;

export function resolveLocale(
  preferred?: VetoBoardLocaleInput,
  sampleText?: string,
  envDefault: string | undefined = process.env.VETOBOARD_LANG,
): VetoBoardLocale {
  const normPref = preferred?.trim().toLowerCase();
  if (normPref === "en") return "en";
  if (normPref === "zh" || normPref === "zh-cn" || normPref === "cn") return "zh";

  const normEnv = envDefault?.trim().toLowerCase();
  if (normEnv === "en") return "en";
  if (normEnv === "zh" || normEnv === "zh-cn" || normEnv === "cn") return "zh";

  if (sampleText && CJK_RE.test(sampleText)) {
    return "zh";
  }
  return "en";
}

export interface LocaleDictionary {
  readonly delegateOptionLabel: string;
  readonly delegateOptionDesc: string;
  readonly memorialCardTitle: string;
  readonly memorialReadHint: (path: string, lines: number, chars: number) => string;
  readonly memorialSummaryHeader: string;
  readonly memorialVerdictHeader: string;
  readonly memorialFactsHeader: string;
  readonly memorialTablesHeader: (count: number) => string;
  readonly memorialTableRowHint: (
    start: number,
    end: number,
    rows: number,
    span: number,
  ) => string;
  readonly memorialTableMoreHint: (
    rest: number,
    path: string,
    start: number,
    span: number,
  ) => string;
  readonly memorialSectionsHeader: string;
  readonly tierPrimary: string;
  readonly tierGuardrailEng: string;
  readonly tierGuardrailLegal: string;
  readonly tierSupport: string;
  readonly tierInspector: string;
  readonly ruleHardTag: string;
  readonly ruleSoftTag: string;
  readonly ruleHeader: string;
  readonly progressHeader: (
    done: number,
    total: number,
    elapsed: string,
    modeLabel: string,
  ) => string;
  readonly progressAsyncHint: string;
  readonly progressCloudUpsell: string;
  readonly auditSealPrefix: string;
}

const EN_DICT: LocaleDictionary = {
  auditSealPrefix: "VetoBoard Audit Seal",
  delegateOptionDesc:
    "Do not lock prematurely — instruct specialist agents to benchmark pros, cons & unit economics head-to-head before recommending.",
  delegateOptionLabel: "Undecided · Delegate head-to-head comparison to VetoBoard Agents",
  memorialCardTitle: "[Structured Memorial Card]",
  memorialFactsHeader: "**[Key Numbers, Formulas & Redline Ledger (1-based line refs)]**",
  memorialReadHint: (path, lines, chars) =>
    `- **Full Untruncated Artifact**: \`${path}\` (${lines} lines / ${chars} chars; call \`Read\` with \`file_path\`, \`offset\`, and \`limit\` below to inspect exact raw tables or clauses)`,
  memorialSectionsHeader: "**[Section Directory & Exact Read Coordinates]**",
  memorialSummaryHeader: "**[Author's Executive Memorial]**",
  memorialTableMoreHint: (rest, path, start, span) =>
    `  > ...${rest} more rows in raw artifact: \`Read(file_path="${path}", offset=${start}, limit=${span})\``,
  memorialTableRowHint: (start, end, rows, span) =>
    `- Table (L${start}-L${end}, ${rows} data rows · inspect full: \`offset=${start}, limit=${span}\`):`,
  memorialTablesHeader: (count) => `**[Tables Digest (${count} table${count === 1 ? "" : "s"})]**`,
  memorialVerdictHeader: "**[Lead Verdict Anchor]**",
  progressAsyncHint: "Non-blocking async run — your coding terminal stays free",
  progressCloudUpsell:
    "Tip: Connect VetoBoard Remote Hub (`VETOBOARD_CLOUD_URL`) for team-shared Streamable HTTP governance & heterogeneous model pools.",
  progressHeader: (done, total, elapsed, modeLabel) =>
    `[+] VetoBoard Council ${done}/${total} tracks (${elapsed}) · mode=${modeLabel}`,
  ruleHardTag: "[HARD GATE]",
  ruleHeader:
    "## Executable Rule Contract ([HARD GATE] items are deterministically verified in code; violations trigger immediate rejection)",
  ruleSoftTag: "[ADVISORY]",
  tierGuardrailEng: "Engineering & Feasibility Guardrail",
  tierGuardrailLegal: "Compliance & Risk Guardrail",
  tierInspector: "Adversarial Read-Only Inspector",
  tierPrimary: "Primary Lead",
  tierSupport: "Execution Support",
};

const ZH_DICT: LocaleDictionary = {
  auditSealPrefix: "VetoBoard 审计背书钢印",
  delegateOptionDesc: "暂不提前锁死，交由多角色专员同台实证对比优劣与单位经济性后再给出主备推荐。",
  delegateOptionLabel: "还不确定 · 交由 Agent 横向对比优劣后推荐（不提前锁死）",
  memorialCardTitle: "【结构化奏折呈批卡】",
  memorialFactsHeader: "**【全文关键数字、口径与红线账本（含行号定位）】**",
  memorialReadHint: (path, lines, chars) =>
    `- **调卷路径（完整无删减原卷）**: \`${path}\`（共 ${lines} 行 / ${chars} 字符；如需核对某章或某表完整原文，请调用 \`Read\` 传入 \`file_path\` 及下方 \`offset\` 与 \`limit\`）`,
  memorialSectionsHeader: "**【全文小节目录与精准调卷坐标】**",
  memorialSummaryHeader: "**【专员呈批核心摘要】**",
  memorialTableMoreHint: (rest, path, start, span) =>
    `  > …其余 ${rest} 行详见原卷 \`Read(file_path="${path}", offset=${start}, limit=${span})\``,
  memorialTableRowHint: (start, end, rows, span) =>
    `- 表（L${start}-L${end}，共 ${rows} 行数据 · 完整调卷 \`offset=${start}, limit=${span}\`）：`,
  memorialTablesHeader: (count) => `**【数据表摘要（共 ${count} 张表）】**`,
  memorialVerdictHeader: "**【开篇定论锚点】**",
  progressAsyncHint: "异步非阻塞运行中，当前编码会话可继续自由工作",
  progressCloudUpsell:
    "提示：配置 VetoBoard Remote Hub (`VETOBOARD_CLOUD_URL`) 可开启团队远程 HTTP 协同审理与异构模型核验池。",
  progressHeader: (done, total, elapsed, modeLabel) =>
    `[+] VetoBoard 决策委员会 ${done}/${total} 轨已完成 (${elapsed}) · 供能=${modeLabel}`,
  ruleHardTag: "[硬规则·必检]",
  ruleHeader:
    "## 角色可执行规则契约（标注 [硬规则·必检] 的条目由系统代码自动核验，违者直接打回返工）",
  ruleSoftTag: "[软规则·建议]",
  tierGuardrailEng: "工程主干护栏",
  tierGuardrailLegal: "合规风控护栏",
  tierInspector: "独立只读铁面督察",
  tierPrimary: "核心主导",
  tierSupport: "次级支撑",
};

export function t(locale: VetoBoardLocale): LocaleDictionary {
  return locale === "zh" ? ZH_DICT : EN_DICT;
}
