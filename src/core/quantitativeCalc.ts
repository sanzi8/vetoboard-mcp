import type { VetoBoardLocale } from "../i18n/locales.js";

/**
 * Zero-eval Deterministic Quantitative Calculation & Independent Reconciliation Engine (`en` + `zh`).
 * Eliminates LLM mental-math hallucinations in BEP, unit economics, sensitivity matrices, weighted scoring, and audit verification.
 */

export type SafeExpressionResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: string };

type Token =
  | { type: "number"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: "+" | "-" | "*" | "/" | "^" | "%" }
  | { type: "paren"; value: "(" | ")" }
  | { type: "comma" };

const MATH_FUNCTIONS: Readonly<Record<string, (...args: number[]) => number>> = {
  abs: (x) => Math.abs(x),
  ceil: (x) => Math.ceil(x),
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
  floor: (x) => Math.floor(x),
  max: (...args) => Math.max(...args),
  min: (...args) => Math.min(...args),
  pow: (base, exp) => Math.pow(base, exp),
  round: (x, digits = 0) => {
    const factor = Math.pow(10, Math.max(0, Math.min(8, Math.trunc(digits))));
    return Math.round(x * factor) / factor;
  },
  sqrt: (x) => Math.sqrt(x),
};

function tokenizeExpression(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const start = i;
      while (i < expr.length && /[0-9.]/.test(expr[i]!)) i += 1;
      if (i < expr.length && (expr[i] === "e" || expr[i] === "E")) {
        i += 1;
        if (i < expr.length && (expr[i] === "+" || expr[i] === "-")) i += 1;
        while (i < expr.length && /[0-9]/.test(expr[i]!)) i += 1;
      }
      const raw = expr.slice(start, i);
      const num = Number(raw);
      if (!Number.isFinite(num)) throw new Error(`Invalid numeric literal "${raw}"`);
      tokens.push({ type: "number", value: num });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i]!)) i += 1;
      tokens.push({ type: "ident", value: expr.slice(start, i) });
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^" || ch === "%") {
      tokens.push({ type: "op", value: ch });
      i += 1;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ type: "paren", value: ch });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma" });
      i += 1;
      continue;
    }
    throw new Error(`Unsupported character "${ch}" in expression`);
  }
  return tokens;
}

export function evaluateSafeArithmeticExpression(
  formula: string,
  variables: Readonly<Record<string, number>> = {},
): SafeExpressionResult {
  const trimmed = formula.trim();
  if (!trimmed) return { error: "Expression is empty", ok: false };
  try {
    const tokens = tokenizeExpression(trimmed);
    let pos = 0;
    const peek = (): Token | undefined => tokens[pos];
    const consume = (): Token => {
      const tok = tokens[pos];
      if (!tok) throw new Error("Unexpected end of expression");
      pos += 1;
      return tok;
    };

    const parseAddSub = (): number => {
      let left = parseMulDiv();
      while (true) {
        const next = peek();
        if (next?.type === "op" && (next.value === "+" || next.value === "-")) {
          consume();
          const right = parseMulDiv();
          left = next.value === "+" ? left + right : left - right;
        } else {
          break;
        }
      }
      return left;
    };

    const parseMulDiv = (): number => {
      let left = parsePower();
      while (true) {
        const next = peek();
        if (
          next?.type === "op" &&
          (next.value === "*" || next.value === "/" || next.value === "%")
        ) {
          consume();
          const right = parsePower();
          if ((next.value === "/" || next.value === "%") && right === 0) {
            throw new Error("Division by zero");
          }
          left =
            next.value === "*" ? left * right : next.value === "/" ? left / right : left % right;
        } else {
          break;
        }
      }
      return left;
    };

    const parsePower = (): number => {
      const base = parseUnary();
      const next = peek();
      if (next?.type === "op" && next.value === "^") {
        consume();
        return Math.pow(base, parsePower());
      }
      return base;
    };

    const parseUnary = (): number => {
      const next = peek();
      if (next?.type === "op" && (next.value === "+" || next.value === "-")) {
        consume();
        const operand = parseUnary();
        return next.value === "-" ? -operand : operand;
      }
      return parsePrimary();
    };

    const parsePrimary = (): number => {
      const tok = consume();
      if (tok.type === "number") return tok.value;
      if (tok.type === "paren" && tok.value === "(") {
        const val = parseAddSub();
        const closing = consume();
        if (closing.type !== "paren" || closing.value !== ")") {
          throw new Error("Missing closing parenthesis");
        }
        return val;
      }
      if (tok.type === "ident") {
        const next = peek();
        if (next?.type === "paren" && next.value === "(") {
          const fn = MATH_FUNCTIONS[tok.value.toLowerCase()];
          if (!fn) throw new Error(`Unknown function "${tok.value}"`);
          consume();
          const args: number[] = [];
          const maybeClose = peek();
          if (!(maybeClose?.type === "paren" && maybeClose.value === ")")) {
            args.push(parseAddSub());
            while (peek()?.type === "comma") {
              consume();
              args.push(parseAddSub());
            }
          }
          const closing = consume();
          if (closing.type !== "paren" || closing.value !== ")") {
            throw new Error(`Missing closing parenthesis in call to "${tok.value}"`);
          }
          if (args.length === 0) throw new Error(`Function "${tok.value}" requires arguments`);
          return fn(...args);
        }
        if (Object.prototype.hasOwnProperty.call(variables, tok.value)) {
          const val = variables[tok.value]!;
          if (!Number.isFinite(val)) throw new Error(`Variable "${tok.value}" is not finite`);
          return val;
        }
        throw new Error(`Unknown variable "${tok.value}"`);
      }
      throw new Error("Unexpected token in expression");
    };

    const value = parseAddSub();
    if (pos < tokens.length) throw new Error("Unexpected trailing tokens in expression");
    if (!Number.isFinite(value)) throw new Error("Expression evaluated to a non-finite number");
    return { ok: true, value };
  } catch (thrown) {
    return { error: thrown instanceof Error ? thrown.message : String(thrown), ok: false };
  }
}

function roundTo(value: number, digits = 4): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

export type QuantitativeCalcInput =
  | {
      readonly mode: "expression";
      readonly variables?: Readonly<Record<string, number>>;
      readonly expressions: readonly {
        readonly name: string;
        readonly formula: string;
        readonly unit?: string;
      }[];
    }
  | {
      readonly mode: "unit_economics";
      readonly fixedCostAnnual: number;
      readonly unitPrice: number;
      readonly unitCogs: number;
      readonly variableRatePct?: number;
      readonly unitVariableExtra?: number;
      readonly unitLabel?: string;
      readonly volumes?: readonly number[];
      readonly priceDeltasPct?: readonly number[];
      readonly costDeltasPct?: readonly number[];
    }
  | {
      readonly mode: "weighted_score";
      readonly criteria: readonly {
        readonly id: string;
        readonly name?: string;
        readonly weight: number;
      }[];
      readonly options: readonly {
        readonly id: string;
        readonly name: string;
        readonly scores: Readonly<Record<string, number>>;
      }[];
    }
  | {
      readonly mode: "reconcile";
      readonly tolerancePct?: number;
      readonly variables?: Readonly<Record<string, number>>;
      readonly checks: readonly {
        readonly label: string;
        readonly claimedValue: number;
        readonly formula: string;
        readonly variables?: Readonly<Record<string, number>>;
        readonly unit?: string;
      }[];
    };

export interface QuantitativeCalcResult {
  readonly mode: QuantitativeCalcInput["mode"];
  readonly ok: boolean;
  readonly summary: string;
  readonly data: Record<string, unknown>;
  readonly warnings: readonly string[];
}

export function runQuantitativeCalc(
  input: QuantitativeCalcInput,
  locale: VetoBoardLocale = "en",
): QuantitativeCalcResult {
  const zh = locale === "zh";
  const warnings: string[] = [];

  if (input.mode === "expression") {
    const env: Record<string, number> = { ...input.variables };
    const results: { name: string; formula: string; value?: number; unit?: string; error?: string }[] = [];
    let allOk = true;
    for (const item of input.expressions) {
      const evaluated = evaluateSafeArithmeticExpression(item.formula, env);
      if (!evaluated.ok) {
        allOk = false;
        results.push({ error: evaluated.error, formula: item.formula, name: item.name });
        warnings.push(`${item.name}: ${evaluated.error}`);
      } else {
        const rounded = roundTo(evaluated.value, 6);
        env[item.name] = evaluated.value;
        results.push({
          formula: item.formula,
          name: item.name,
          ...(item.unit ? { unit: item.unit } : {}),
          value: rounded,
        });
      }
    }
    const summary = results
      .map((r) =>
        r.error
          ? `${r.name}=ERROR(${r.error})`
          : `${r.name}=${r.value}${r.unit ? ` ${r.unit}` : ""}`,
      )
      .join("; ");
    return { data: { results }, mode: "expression", ok: allOk, summary, warnings };
  }

  if (input.mode === "unit_economics") {
    const varPct = input.variableRatePct ?? 0;
    const unitExtra = input.unitVariableExtra ?? 0;
    const unitLabel = input.unitLabel ?? "unit";
    if (varPct < 0 || varPct >= 100) {
      return {
        data: {},
        mode: "unit_economics",
        ok: false,
        summary: `Invalid variableRatePct (${varPct}); expected [0, 100).`,
        warnings: [
          zh
            ? "variableRatePct 必须为 0~100 之间的百分数（如 8% 传 8）"
            : "variableRatePct must be a percentage in [0, 100) (e.g. pass 8 for 8%).",
        ],
      };
    }
    const netUnitRevenue = input.unitPrice * (1 - varPct / 100);
    const totalUnitVariableCost = input.unitCogs + unitExtra;
    const unitContribution = netUnitRevenue - totalUnitVariableCost;
    const grossMarginPct =
      input.unitPrice > 0 ? ((input.unitPrice - input.unitCogs) / input.unitPrice) * 100 : 0;
    const contributionMarginPct =
      input.unitPrice > 0 ? (unitContribution / input.unitPrice) * 100 : 0;
    const viable = unitContribution > 0;
    const bepUnits = viable ? input.fixedCostAnnual / unitContribution : null;
    const bepRevenue = bepUnits !== null ? bepUnits * input.unitPrice : null;

    if (!viable) {
      warnings.push(
        zh
          ? `单位贡献额 <= 0（${roundTo(unitContribution, 4)}），该定价与成本结构无法实现盈亏平衡`
          : `Unit contribution <= 0 (${roundTo(unitContribution, 4)}); break-even is mathematically impossible under this cost structure.`,
      );
    }

    const scaleCurve = (input.volumes ?? []).map((volume) => {
      const revenue = volume * input.unitPrice;
      const variableCost = volume * (totalUnitVariableCost + (input.unitPrice * varPct) / 100);
      const profit = volume * unitContribution - input.fixedCostAnnual;
      const profitMarginPct = revenue > 0 ? (profit / revenue) * 100 : 0;
      return {
        fixedCost: roundTo(input.fixedCostAnnual, 2),
        profit: roundTo(profit, 2),
        profitMarginPct: roundTo(profitMarginPct, 2),
        revenue: roundTo(revenue, 2),
        variableCost: roundTo(variableCost, 2),
        volume,
      };
    });

    const priceDeltas = input.priceDeltasPct ?? [-15, 0, 15];
    const costDeltas = input.costDeltasPct ?? [-15, 0, 15];
    const sensitivityMatrix = priceDeltas.flatMap((pDelta) =>
      costDeltas.map((cDelta) => {
        const p = input.unitPrice * (1 + pDelta / 100);
        const c = input.unitCogs * (1 + cDelta / 100);
        const contrib = p * (1 - varPct / 100) - (c + unitExtra);
        const gmPct = p > 0 ? ((p - c) / p) * 100 : 0;
        const bep = contrib > 0 ? input.fixedCostAnnual / contrib : null;
        return {
          bepUnits: bep !== null ? roundTo(bep, 2) : null,
          costDeltaPct: cDelta,
          grossMarginPct: roundTo(gmPct, 2),
          priceDeltaPct: pDelta,
          unitCogs: roundTo(c, 2),
          unitContribution: roundTo(contrib, 2),
          unitPrice: roundTo(p, 2),
        };
      }),
    );

    const summary = viable
      ? zh
        ? `单位贡献=${roundTo(unitContribution, 2)}/${unitLabel}, 毛利率=${roundTo(grossMarginPct, 2)}%, BEP=${roundTo(bepUnits!, 2)} ${unitLabel} (营收 ${roundTo(bepRevenue!, 2)})`
        : `UnitContribution=${roundTo(unitContribution, 2)}/${unitLabel}, GrossMargin=${roundTo(grossMarginPct, 2)}%, BEP=${roundTo(bepUnits!, 2)} ${unitLabel} (Revenue ${roundTo(bepRevenue!, 2)})`
      : zh
        ? `不可盈利：单位贡献=${roundTo(unitContribution, 2)}/${unitLabel}, 毛利率=${roundTo(grossMarginPct, 2)}%`
        : `Unviable: UnitContribution=${roundTo(unitContribution, 2)}/${unitLabel}, GrossMargin=${roundTo(grossMarginPct, 2)}%`;

    return {
      data: {
        bepRevenue: bepRevenue !== null ? roundTo(bepRevenue, 2) : null,
        bepUnits: bepUnits !== null ? roundTo(bepUnits, 2) : null,
        contributionMarginPct: roundTo(contributionMarginPct, 2),
        fixedCostAnnual: input.fixedCostAnnual,
        grossMarginPct: roundTo(grossMarginPct, 2),
        netUnitRevenue: roundTo(netUnitRevenue, 4),
        scaleCurve,
        sensitivityMatrix,
        unitContribution: roundTo(unitContribution, 4),
        unitLabel,
        viable,
      },
      mode: "unit_economics",
      ok: true,
      summary,
      warnings,
    };
  }

  if (input.mode === "weighted_score") {
    const rawSum = input.criteria.reduce((acc, c) => acc + c.weight, 0);
    let divisor = 1;
    if (Math.abs(rawSum - 100) <= 0.1) {
      divisor = 100;
    } else if (Math.abs(rawSum - 1) > 0.01) {
      return {
        data: { rawWeightSum: roundTo(rawSum, 4) },
        mode: "weighted_score",
        ok: false,
        summary: `Weight sum mismatch: got ${roundTo(rawSum, 4)} (expected 1.0 or 100).`,
        warnings: [
          zh
            ? `权重之和为 ${roundTo(rawSum, 4)}，既不等于 1 也不等于 100`
            : `Criteria weights sum to ${roundTo(rawSum, 4)}; must equal 1.0 or 100.`,
        ],
      };
    }

    const normalizedCriteria = input.criteria.map((c) => ({
      id: c.id,
      name: c.name ?? c.id,
      normalizedWeight: c.weight / divisor,
    }));

    const scored = input.options.map((opt) => {
      let total = 0;
      const breakdown: Record<string, { score: number; weighted: number }> = {};
      for (const crit of normalizedCriteria) {
        const rawScore = opt.scores[crit.id];
        if (rawScore === undefined || !Number.isFinite(rawScore)) {
          warnings.push(
            zh
              ? `选项 "${opt.name}" 缺少维度 "${crit.name}" 得分，按 0 计`
              : `Option "${opt.name}" missing score for "${crit.name}", defaulting to 0.`,
          );
        }
        const s = Number.isFinite(rawScore) ? rawScore! : 0;
        const w = s * crit.normalizedWeight;
        total += w;
        breakdown[crit.id] = { score: s, weighted: roundTo(w, 4) };
      }
      return { breakdown, id: opt.id, name: opt.name, totalScore: roundTo(total, 4) };
    });

    const ranked = [...scored]
      .sort((a, b) => b.totalScore - a.totalScore)
      .map((item, idx, arr) => ({
        ...item,
        gapFromNext:
          idx + 1 < arr.length ? roundTo(item.totalScore - arr[idx + 1]!.totalScore, 4) : 0,
        gapFromTop: roundTo(arr[0]!.totalScore - item.totalScore, 4),
        rank: idx + 1,
      }));

    const summary = ranked
      .map((item) => `#${item.rank} ${item.name}=${item.totalScore}`)
      .join(" > ");
    return { data: { normalizedWeightSum: 1, ranked }, mode: "weighted_score", ok: true, summary, warnings };
  }

  // mode === "reconcile"
  if (!input.checks || input.checks.length === 0) {
    return {
      data: {},
      mode: "reconcile",
      ok: false,
      summary: zh ? "reconcile 模式必须提供非空 checks 数组" : "mode='reconcile' requires a non-empty checks array.",
      warnings: [],
    };
  }
  const tolerancePct = input.tolerancePct ?? 0.5;
  const sharedVars = input.variables ?? {};
  const checks = input.checks.map((check) => {
    const vars = { ...sharedVars, ...check.variables };
    const evaluated = evaluateSafeArithmeticExpression(check.formula, vars);
    if (!evaluated.ok) {
      return {
        claimedValue: check.claimedValue,
        error: evaluated.error,
        formula: check.formula,
        label: check.label,
        passed: false,
      };
    }
    const computedValue = roundTo(evaluated.value, 6);
    const absoluteDiff = roundTo(Math.abs(check.claimedValue - evaluated.value), 6);
    const denom = Math.max(Math.abs(evaluated.value), 1e-9);
    const relativeDiffPct = roundTo((absoluteDiff / denom) * 100, 4);
    const passed =
      Math.abs(evaluated.value) < 1e-9
        ? absoluteDiff <= 1e-6
        : relativeDiffPct <= tolerancePct;
    return {
      absoluteDiff,
      claimedValue: check.claimedValue,
      computedValue,
      formula: check.formula,
      label: check.label,
      passed,
      relativeDiffPct,
      ...(check.unit ? { unit: check.unit } : {}),
    };
  });

  const discrepancies = checks.filter((c) => !c.passed);
  const allPassed = discrepancies.length === 0;
  if (!allPassed) {
    for (const d of discrepancies) {
      warnings.push(
        "error" in d && d.error
          ? zh
            ? `复算失败 [${d.label}]: ${d.error}`
            : `Reconcile error [${d.label}]: ${d.error}`
          : zh
            ? `数值矛盾 [${d.label}]: 报告宣称 ${d.claimedValue}，独立复算 ${"computedValue" in d ? d.computedValue : "?"}（偏差 ${"relativeDiffPct" in d ? d.relativeDiffPct : "?"}% > ${tolerancePct}%）`
            : `Math discrepancy [${d.label}]: claimed ${d.claimedValue} vs recomputed ${"computedValue" in d ? d.computedValue : "?"} (diff ${"relativeDiffPct" in d ? d.relativeDiffPct : "?"}% > ${tolerancePct}%)`,
      );
    }
  }
  const summary = allPassed
    ? zh
      ? `独立复算全部通过（${checks.length}/${checks.length} 项，容差 ${tolerancePct}%）`
      : `Independent reconciliation PASSED (${checks.length}/${checks.length} checks within ${tolerancePct}% tolerance)`
    : zh
      ? `独立复算发现 ${discrepancies.length}/${checks.length} 项数学矛盾（容差 ${tolerancePct}%）`
      : `Independent reconciliation FAILED: ${discrepancies.length}/${checks.length} math discrepancies (> ${tolerancePct}% tolerance)`;

  return {
    data: {
      allPassed,
      checks,
      discrepancies,
      failedCount: discrepancies.length,
      passedCount: checks.length - discrepancies.length,
      tolerancePct,
    },
    mode: "reconcile",
    ok: allPassed,
    summary,
    warnings,
  };
}
