import { type VetoBoardLocale, t } from "../i18n/locales.js";
import { extractVerifiedHttpUrls, hasInvokedWebResearchTool } from "./researchBudget.js";
import type { ExecutableRule } from "./types.js";

/**
 * Deterministic Code-Level Executable Rule Gate, Premise-Reversal Guard & Rework Patch-Clobber Guard (`en` + `zh`).
 */

export interface RuleViolationItem {
  readonly ruleId: string;
  readonly ruleTitle: string;
  readonly enforcement: "hard" | "soft";
  readonly reason: string;
  readonly escalate: boolean;
}

export interface RuleGateAuditResult {
  readonly passed: boolean;
  readonly needsUserDecision: boolean;
  readonly hardViolations: readonly RuleViolationItem[];
  readonly softWarnings: readonly RuleViolationItem[];
  readonly summary: string;
}

export function formatExecutableRulesForPrompt(
  rules: readonly ExecutableRule[],
  locale: VetoBoardLocale = "en",
): string {
  if (!rules || rules.length === 0) return "";
  const dict = t(locale);
  const zh = locale === "zh";
  const lines = [dict.ruleHeader];

  for (const [idx, rule] of rules.entries()) {
    const tag = rule.enforcement === "hard" ? dict.ruleHardTag : dict.ruleSoftTag;
    const parts: string[] = [`${idx + 1}. ${tag} ${rule.title}`];
    if (rule.description?.trim()) {
      parts.push(zh ? `说明：${rule.description.trim()}` : `Note: ${rule.description.trim()}`);
    }
    if (rule.mustUseTools.length > 0) {
      parts.push(
        zh
          ? `必用工具：${rule.mustUseTools.join(", ")}`
          : `Required tools: ${rule.mustUseTools.join(", ")}`,
      );
    }
    if (rule.mustInvokeSkills.length > 0) {
      parts.push(
        zh
          ? `必调技能：${rule.mustInvokeSkills.join(", ")}`
          : `Required skills: ${rule.mustInvokeSkills.join(", ")}`,
      );
    }
    if (rule.mustIncludeKeywords.length > 0) {
      parts.push(
        zh
          ? `必含维度词：${rule.mustIncludeKeywords.join(" / ")}`
          : `Required dimensions: ${rule.mustIncludeKeywords.join(" / ")}`,
      );
    }
    if (rule.forbiddenPatterns.length > 0) {
      parts.push(
        zh
          ? `禁用表述/反模式：${rule.forbiddenPatterns.join(" / ")}`
          : `Forbidden patterns: ${rule.forbiddenPatterns.join(" / ")}`,
      );
    }
    lines.push(parts.join(zh ? "；" : " | "));
  }

  return lines.join("\n");
}

export function evaluateRuleGate(input: {
  readonly outputText: string;
  readonly rules: readonly ExecutableRule[];
  readonly invokedTools?: readonly string[];
  readonly invokedSkills?: readonly string[];
  readonly locale?: VetoBoardLocale;
}): RuleGateAuditResult {
  const locale = input.locale ?? "en";
  const zh = locale === "zh";
  const toolSet = new Set((input.invokedTools ?? []).map((x) => x.toLowerCase()));
  const skillSet = new Set((input.invokedSkills ?? []).map((x) => x.toLowerCase()));
  const textLower = input.outputText.toLowerCase();
  const verifiedUrls = extractVerifiedHttpUrls(input.outputText);
  const webGrounded = hasInvokedWebResearchTool(input.invokedTools) || verifiedUrls.length >= 1;

  const hardViolations: RuleViolationItem[] = [];
  const softWarnings: RuleViolationItem[] = [];

  for (const rule of input.rules) {
    const reasons: string[] = [];

    for (const reqTool of rule.mustUseTools) {
      const reqLower = reqTool.toLowerCase();
      const isWebReq = reqLower === "websearch" || reqLower === "search_web" || reqLower === "webfetch";
      if (isWebReq) {
        if (!webGrounded) {
          reasons.push(
            zh
              ? `未执行联网实证检索（缺少 search_web/WebSearch 调用且正文中无任何真实外部 https:// 来源链接！请按 20/60/20 配额纪律先联网核实一手价格/法规/文档现值并附 URL）`
              : `Missing live web grounding (neither WebSearch/search_web invoked nor any external https:// URL cited in output)`,
          );
        }
      } else if (!toolSet.has(reqLower)) {
        reasons.push(
          zh
            ? `未真实调用必用工具 "${reqTool}"`
            : `Missing required tool invocation "${reqTool}"`,
        );
      }
    }

    for (const reqSkill of rule.mustInvokeSkills) {
      if (!skillSet.has(reqSkill.toLowerCase())) {
        reasons.push(
          zh
            ? `未加载必调技能 "${reqSkill}"`
            : `Missing required skill invocation "${reqSkill}"`,
        );
      }
    }

    for (const kw of rule.mustIncludeKeywords) {
      if (!textLower.includes(kw.toLowerCase())) {
        reasons.push(
          zh
            ? `正文缺少必含维度关键词 "${kw}"`
            : `Output missing required dimension keyword "${kw}"`,
        );
      }
    }

    for (const pat of rule.forbiddenPatterns) {
      let matched = false;
      try {
        matched = new RegExp(pat, "iu").test(input.outputText);
      } catch {
        matched = textLower.includes(pat.toLowerCase());
      }
      if (matched) {
        reasons.push(
          zh
            ? `命中禁止出现的违规模式 "${pat}"`
            : `Triggered forbidden anti-pattern "${pat}"`,
        );
      }
    }

    if (reasons.length > 0) {
      const item: RuleViolationItem = {
        enforcement: rule.enforcement,
        escalate: rule.escalateOnTrigger,
        reason: reasons.join("; "),
        ruleId: rule.ruleId,
        ruleTitle: rule.title,
      };
      if (rule.enforcement === "hard") {
        hardViolations.push(item);
      } else {
        softWarnings.push(item);
      }
    }
  }

  const passed = hardViolations.length === 0;
  const needsUserDecision = hardViolations.some((v) => v.escalate);
  const summary = passed
    ? zh
      ? `代码级规则门禁通过（硬违规 0 项，软提醒 ${softWarnings.length} 项）`
      : `Code-level Rule Gate PASSED (0 hard violations, ${softWarnings.length} advisory notes)`
    : zh
      ? `代码级规则门禁拦截：${hardViolations.length} 项硬规则未达标`
      : `Code-level Rule Gate BLOCKED: ${hardViolations.length} hard rule violation(s)`;

  return { hardViolations, needsUserDecision, passed, softWarnings, summary };
}

const COMMERCIAL_INTENT_RE =
  /(?:收费|计费|盈利|利润|分成|变现|商业化|回本|营收|monetiz|revenue|profit|pricing|subscription|commission|margin)/iu;

const PREMISE_REVERSAL_RE =
  /(?:非营利|非盈利|禁止分成|零收入|不能收费|全额缴库|公益记账|non[- ]?profit\s+only|zero[- ]revenue|prohibit\s+charging|volunteer[- ]only)/iu;

const TOPIC_ABANDONMENT_RE =
  /(?:放弃原(?:目标|课题|方案)|完全偏离原题|推翻原题|abandon\s+the\s+original\s+(?:topic|goal|plan)|ignore\s+the\s+user'?s\s+goal)/iu;

export function detectPremiseReversal(goal: string, proposalText: string): boolean {
  if (TOPIC_ABANDONMENT_RE.test(proposalText)) return true;
  return COMMERCIAL_INTENT_RE.test(goal) && PREMISE_REVERSAL_RE.test(proposalText);
}

const INCREMENTAL_PATCH_RE =
  /(?:证据补丁|法规补丁|修正补丁|修订补丁|局部补丁|返工补丁|补充说明|此补丁不改变|原.{0,16}(?:行动图|矩阵|表格|方案|原稿)继续有效|按(?:上游|前序)?原稿执行|其余(?:内容|章节|部分|矩阵)?(?:不变|同原稿|维持原稿)|incremental\s+patch|rework\s+(?:supplement|patch|addendum)|does\s+not\s+change\s+the\s+(?:previous\s+)?(?:matrix|roadmap|tables?)|refer\s+to\s+previous\s+draft\s+for\s+remaining)/iu;

/**
 * Prevents a short rework patch from clobbering a rich baseline deliverable containing full matrices & roadmaps.
 */
export function preserveBaselineOnIncrementalPatch(
  newOutput: string,
  previousDraft: string | null | undefined,
  locale: VetoBoardLocale = "en",
): string {
  const trimmedNew = newOutput.trim();
  const rawPrev = previousDraft?.trim();
  if (!trimmedNew || !rawPrev) return newOutput;
  if (trimmedNew.startsWith("{") && trimmedNew.endsWith("}")) return newOutput;

  const zh = locale === "zh";
  const markerZh = "## 附：本步前序完整基准底稿（宿主防补丁覆盖自动保留）";
  const markerEn = "## Appendix: Preserved Full Baseline Deliverable (Auto-Protected Against Patch Clobber)";

  let cleanPrev = rawPrev;
  for (const mk of [markerZh, markerEn]) {
    const idx = cleanPrev.indexOf(mk);
    if (idx >= 0) {
      cleanPrev = cleanPrev
        .slice(idx + mk.length)
        .trim()
        .replace(/^>\s*(?:说明|Note)[:：][^\r\n]+[\r\n]*/u, "")
        .trim();
    }
  }

  if (cleanPrev.length < 1_000) return newOutput;
  if (trimmedNew.length >= cleanPrev.length * 0.58) return newOutput;
  if (!INCREMENTAL_PATCH_RE.test(trimmedNew)) return newOutput;

  const heading = zh ? markerZh : markerEn;
  const note = zh
    ? "> 说明：本轮返工仅输出了局部修订补丁，宿主已自动保留本步骤上一版完整对比矩阵与行动清单如下（局部冲突处以上方最新补丁为准）。"
    : "> Note: This rework turn emitted an incremental patch; the host automatically preserved the full baseline tables and action roadmap below (latest patch above takes precedence on amended clauses).";

  return `${trimmedNew}\n\n---\n\n${heading}\n\n${note}\n\n${cleanPrev}`;
}
