import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { VetoBoardLocale } from "../i18n/locales.js";
import { retrieveReusableAssets } from "./assetLibrary.js";
import { findRoleTemplate } from "./roleCatalog.js";
import { discoverNativeSkills } from "./skillRadar.js";
import {
  contributionReceiptSchema,
  roleTemplateSchema,
  type ContributionReceipt,
  type RoleTemplate,
} from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Method A Standardized Asset Contribution & 1-Click Withdrawal Engine (`assetContribution.ts`).
 *
 * Enforces three ironclad user-trust guarantees:
 * 1. **Automatic Local Privacy Scrubbing**: Strips local Windows/Unix paths, API keys/tokens, emails, and private IPs before preview or export.
 * 2. **Explicit Transparency & Purpose Limitation (`project_upgrade_and_optimization_only`)**:
 *    Clearly informs the user BEFORE submission that the asset will be collected into the VetoBoard library
 *    **solely for project upgrades, rule calibration, or optimization** — never silent uploads!
 * 3. **100% Revocable / Withdrawable Anytime**:
 *    Generates a permanent local receipt (`sub_...`) + Method A GitHub Issue/PR workflow (`gh` CLI or 1-click pre-filled GitHub Issue URL),
 *    supporting instant withdrawal via `action: "withdraw"`!
 */

export const DEFAULT_VETOBOARD_HUB_REPO = "vetoboard-mcp/community-assets";

export interface SanitizeResult {
  readonly sanitized: string;
  readonly redactedCount: number;
}

export function sanitizeTextForPublicContribution(raw: string): SanitizeResult {
  let redactedCount = 0;
  const replaceAndCount = (input: string, re: RegExp, replacement: string): string =>
    input.replace(re, () => {
      redactedCount += 1;
      return replacement;
    });

  let text = raw;
  // 1. Secret tokens & API keys
  text = replaceAndCount(
    text,
    /\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z_-]{25,}|xox[baprs]-[a-zA-Z0-9-]{16,})\b/g,
    "[REDACTED_SECRET]",
  );
  text = replaceAndCount(
    text,
    /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi,
    "Bearer [REDACTED_TOKEN]",
  );
  // 2. File URIs & Windows / Unix local user paths
  text = replaceAndCount(text, /\bfile:\/\/\/[^\s"'`)>\]]+/gi, "[REDACTED_LOCAL_PATH]");
  text = replaceAndCount(
    text,
    /\b[A-Za-z]:\\(?:Users|Documents|Projects|Repos|workspace|temp|tmp)\\[^\s"'`)>\]]*/gi,
    "[REDACTED_LOCAL_PATH]",
  );
  text = replaceAndCount(
    text,
    /\b[A-Za-z]:\\[^\s"'`)>\]]{4,}/g,
    "[REDACTED_LOCAL_PATH]",
  );
  text = replaceAndCount(
    text,
    /\/(?:Users|home|private\/var|var\/folders)\/[^\s"'`)>\]]+/g,
    "[REDACTED_LOCAL_PATH]",
  );
  // 3. Emails & private LAN IPv4 addresses
  text = replaceAndCount(
    text,
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    "[REDACTED_EMAIL]",
  );
  text = replaceAndCount(
    text,
    /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
    "[REDACTED_IP]",
  );

  return { redactedCount, sanitized: text };
}

function buildGovernanceNoticeBlock(locale: VetoBoardLocale, submissionIdHint?: string): string {
  const zh = locale === "zh";
  const idLabel = submissionIdHint ? `\`${submissionIdHint}\`` : "`sub_<自动生成凭证号>`";
  if (zh) {
    return [
      "### 🛡️ VetoBoard 资产入库告知与权益保障声明（请必读）",
      "1. **收录入库说明**：您推送的标准化角色 / 技能在通过格式与安全校验后，**将被收录进 VetoBoard 资产库**；",
      "2. **用途严格限定**：该资产**仅用于 VetoBoard 项目的升级、规则校准或体验优化**，绝不用于无关商业售卖或用户隐私画像（本地路径、密钥与邮箱均已在本地自动脱敏剥离）；",
      `3. **100% 随时可撤回**：每次推送均生成唯一凭证号（${idLabel}）并落盘本地收据；您随时可调用 \`vetoboard_contribute_asset({ action: "withdraw", submissionId: ... })\`（或终端执行 \`npx vetoboard-mcp withdraw <凭证号>\`，或直接在对应 GitHub Issue 留言/关闭），我们将无条件从库中撤回并移除！`,
    ].join("\n");
  }
  return [
    "### 🛡️ VetoBoard Library Collection & Withdrawal Guarantee",
    "1. **Library Collection**: Once reviewed, your standardized role/skill **will be collected into the VetoBoard Asset Library**;",
    "2. **Strict Purpose Limitation**: Contributed assets are **used SOLELY for VetoBoard project upgrades, rule calibration, or optimization** (all local paths, tokens, and emails are scrubbed locally prior to export);",
    `3. **100% Withdrawable Anytime**: Every submission receives a unique receipt ID (${idLabel}). You may revoke and remove it at any time via \`vetoboard_contribute_asset({ action: "withdraw", submissionId: ... })\`, \`npx vetoboard-mcp withdraw <id>\`, or by closing the GitHub Issue.`,
  ].join("\n");
}

async function resolveTargetAssetPayload(params: {
  readonly assetType: "role" | "skill";
  readonly assetId: string;
  readonly dataRootDir: string;
  readonly workspaceDir?: string;
  readonly locale: VetoBoardLocale;
}): Promise<
  | {
      readonly ok: true;
      readonly normalizedId: string;
      readonly title: string;
      readonly serializedPayload: string;
      readonly redactedCount: number;
    }
  | { readonly ok: false; readonly error: string }
> {
  const { assetType, assetId, dataRootDir, workspaceDir, locale } = params;
  const cleanId = assetId.trim().toLowerCase();

  if (assetType === "role") {
    const retrieved = await retrieveReusableAssets({
      dataRootDir,
      goal: cleanId,
      locale,
      workspaceDir,
    });
    const foundRole: RoleTemplate | undefined =
      retrieved.roles.find((r) => r.role.roleId.toLowerCase() === cleanId)?.role ??
      findRoleTemplate(cleanId);

    if (!foundRole) {
      return {
        error:
          locale === "zh"
            ? `未找到标准化角色 "${assetId}"（请先检查角色 ID 或通过 vetoboard_distill_skill / 自定义角色沉淀入库）。`
            : `Standardized role "${assetId}" not found.`,
        ok: false,
      };
    }

    const rawJson = JSON.stringify(foundRole, null, 2);
    const scrubbed = sanitizeTextForPublicContribution(rawJson);
    const parsedCheck = roleTemplateSchema.safeParse(JSON.parse(scrubbed.sanitized));
    if (!parsedCheck.success) {
      return {
        error: `Role schema validation failed: ${parsedCheck.error.message}`,
        ok: false,
      };
    }
    return {
      normalizedId: parsedCheck.data.roleId,
      ok: true,
      redactedCount: scrubbed.redactedCount,
      serializedPayload: JSON.stringify(parsedCheck.data, null, 2),
      title: parsedCheck.data.name[locale],
    };
  }

  // `assetType === "skill"`
  const skills = await discoverNativeSkills({
    dataRootDir,
    includeBuiltinIdeSkills: false,
    locale,
    workspaceDir,
  });
  const foundSkill = skills.find(
    (s) => s.skillId.toLowerCase() === cleanId || s.name.toLowerCase() === cleanId,
  );
  if (!foundSkill) {
    return {
      error:
        locale === "zh"
          ? `未找到标准化技能 "${assetId}"（可先调用 vetoboard_distill_skill 生成标准 SKILL.md）。`
          : `Standardized skill "${assetId}" not found.`,
      ok: false,
    };
  }

  const rawContent =
    foundSkill.inlineContent ??
    (foundSkill.filePath ? await readFile(foundSkill.filePath, "utf8") : "");
  if (!rawContent.trim()) {
    return {
      error: `Skill "${assetId}" has empty content.`,
      ok: false,
    };
  }
  const scrubbed = sanitizeTextForPublicContribution(rawContent);
  return {
    normalizedId: foundSkill.skillId,
    ok: true,
    redactedCount: scrubbed.redactedCount,
    serializedPayload: scrubbed.sanitized,
    title: foundSkill.name,
  };
}

function buildPrefilledGithubIssueUrl(params: {
  readonly targetRepo: string;
  readonly title: string;
  readonly body: string;
  readonly labels: string;
}): string {
  const maxBodyUrlChars = 3_600;
  const truncatedBody =
    params.body.length > maxBodyUrlChars
      ? `${params.body.slice(0, maxBodyUrlChars)}\n\n...(Full sanitized bundle saved locally; paste if truncated)...`
      : params.body;
  const query = new URLSearchParams({
    body: truncatedBody,
    labels: params.labels,
    title: params.title,
  });
  return `https://github.com/${params.targetRepo}/issues/new?${query.toString()}`;
}

export async function previewOrSubmitAssetContribution(params: {
  readonly action: "preview" | "submit";
  readonly assetType: "role" | "skill";
  readonly assetId: string;
  readonly confirmedConsent?: boolean;
  readonly authorHandle?: string;
  readonly targetRepo?: string;
  readonly autoRunGhCli?: boolean;
  readonly dataRootDir?: string;
  readonly workspaceDir?: string;
  readonly locale: VetoBoardLocale;
}): Promise<{ readonly isError?: boolean; readonly markdown: string; readonly receipt?: ContributionReceipt }> {
  const { locale } = params;
  const zh = locale === "zh";
  const home = homedir();
  const dataRoot = resolve(params.dataRootDir ?? process.env.VETOBOARD_DATA_DIR ?? join(home, ".vetoboard-mcp"));
  const targetRepo = (params.targetRepo ?? process.env.VETOBOARD_HUB_REPO ?? DEFAULT_VETOBOARD_HUB_REPO).trim();

  const resolved = await resolveTargetAssetPayload({
    assetId: params.assetId,
    assetType: params.assetType,
    dataRootDir: dataRoot,
    locale,
    workspaceDir: params.workspaceDir,
  });
  if (!resolved.ok) {
    return { isError: true, markdown: resolved.error };
  }

  // Enforce Two-Step Transparency Gate: NEVER submit unless `action === "submit" && confirmedConsent === true`!
  if (params.action === "preview" || params.confirmedConsent !== true) {
    const codeLang = params.assetType === "role" ? "json" : "markdown";
    const previewExcerpt =
      resolved.serializedPayload.length > 1_800
        ? `${resolved.serializedPayload.slice(0, 1_800)}\n...(共 ${resolved.serializedPayload.length} 字符)`
        : resolved.serializedPayload;

    const md = zh
      ? [
          `## 📦 [CONTRIBUTION_CONSENT_REQUIRED] 标准化${params.assetType === "role" ? "角色" : "技能"}推送前脱敏预览单（方法 A · GitHub 投递）`,
          "",
          buildGovernanceNoticeBlock(locale),
          "",
          `- **待推送资产**：\`${resolved.normalizedId}\`（${resolved.title} · 类型：\`${params.assetType}\`）`,
          `- **目标官方仓库**：\`${targetRepo}\``,
          `- **本地隐私自动脱敏统计**：已自动扫描并剥离 **${resolved.redactedCount}** 处敏感路径/凭据/邮箱`,
          "",
          "### 脱敏后载荷预览",
          `\`\`\`${codeLang}`,
          previewExcerpt,
          "```",
          "",
          "> **💬 请向用户展示上方告知书与脱敏预览**：仅当用户明确回复同意（知悉**将收录进库、仅用于项目升级或优化、且可随时撤回**）后，再传 `action: \"submit\", confirmedConsent: true` 生成方法 A 投递单！",
        ].join("\n")
      : [
          `## 📦 [CONTRIBUTION_CONSENT_REQUIRED] Sanitized ${params.assetType.toUpperCase()} Contribution Preview (Method A · GitHub)`,
          "",
          buildGovernanceNoticeBlock(locale),
          "",
          `- **Target Asset**: \`${resolved.normalizedId}\` (${resolved.title})`,
          `- **Target Repository**: \`${targetRepo}\``,
          `- **Automatic Privacy Redactions**: **${resolved.redactedCount}** local path/secret/email item(s) scrubbed`,
          "",
          `\`\`\`${codeLang}`,
          previewExcerpt,
          "```",
          "",
          "> **💬 Ask User for Explicit Consent**: Present the notice & sanitized preview above. Once confirmed, call `vetoboard_contribute_asset` with `action: \"submit\", confirmedConsent: true`.",
        ].join("\n");

    return { markdown: md };
  }

  // Confirmed submission -> create receipt & Method A GitHub Issue bundle!
  const submissionId = `sub_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  const contribDir = join(dataRoot, "contributions");
  await mkdir(contribDir, { recursive: true });

  const codeLang = params.assetType === "role" ? "json" : "markdown";
  const issueTitle = `[Asset Contribution][${params.assetType}] ${resolved.normalizedId} (${submissionId})`;
  const issueBody = [
    `## VetoBoard Standardized Asset Contribution (\`${submissionId}\`)`,
    `- **Asset Type**: \`${params.assetType}\``,
    `- **Asset ID**: \`${resolved.normalizedId}\``,
    `- **Title**: ${resolved.title}`,
    `- **Contributor**: ${params.authorHandle?.trim() || "anonymous"}`,
    `- **Purpose Scope**: \`project_upgrade_and_optimization_only\` (收录入库仅用于项目升级或优化)`,
    `- **Withdrawable**: \`true\` (Author can withdraw anytime quoting \`${submissionId}\`)`,
    `- **Local Privacy Redactions Applied**: ${resolved.redactedCount}`,
    "",
    `### Standardized Payload`,
    `\`\`\`${codeLang}`,
    resolved.serializedPayload,
    "```",
  ].join("\n");

  const bundlePath = join(contribDir, `${submissionId}-bundle.md`);
  await writeFile(bundlePath, issueBody, "utf8");

  const prefilledIssueUrl = buildPrefilledGithubIssueUrl({
    body: issueBody,
    labels: "community-asset,upgrade-only",
    targetRepo,
    title: issueTitle,
  });

  let liveIssueUrl: string | undefined;
  let ghCliNote = "";
  if (params.autoRunGhCli) {
    try {
      const { stdout } = await execFileAsync(
        "gh",
        [
          "issue",
          "create",
          "--repo",
          targetRepo,
          "--title",
          issueTitle,
          "--body-file",
          bundlePath,
        ],
        { timeout: 15_000 },
      );
      const urlMatch = /https:\/\/github\.com\/[^\s]+/i.exec(stdout);
      if (urlMatch) liveIssueUrl = urlMatch[0];
    } catch (err) {
      ghCliNote = zh
        ? `（注：本机 \`gh\` CLI 未登录或未连通目标库，已自动切换为下方一键预填 GitHub 提交链接：${err instanceof Error ? err.message.split("\n")[0] : "fallback"}）`
        : `(Note: local \`gh\` CLI unavailable; fell back to 1-click pre-filled GitHub Issue URL)`;
    }
  }

  const receipt: ContributionReceipt = {
    assetId: resolved.normalizedId,
    assetType: params.assetType,
    ...(params.authorHandle?.trim() ? { authorHandle: params.authorHandle.trim() } : {}),
    bundlePath,
    createdAt: now,
    ...(liveIssueUrl ? { issueUrl: liveIssueUrl } : {}),
    prefilledIssueUrl,
    purposeScope: "project_upgrade_and_optimization_only",
    redactedCount: resolved.redactedCount,
    status: "submitted",
    submissionId,
    targetRepo,
    title: resolved.title,
    withdrawable: true,
  };
  const receiptPath = join(contribDir, `${submissionId}.json`);
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), "utf8");

  const ghCmd = `gh issue create --repo "${targetRepo}" --title "${issueTitle}" --body-file "${bundlePath}"`;
  const md = zh
    ? [
        `## ✅ 方法 A 标准化资产投递包已就绪（凭证号：\`${submissionId}\`）`,
        "",
        buildGovernanceNoticeBlock(locale, submissionId),
        "",
        ...(liveIssueUrl
          ? [`- **🚀 已通过 \`gh\` CLI 自动推送至 GitHub**：${liveIssueUrl}`]
          : [
              `- **🔗 方式 1（零配置浏览器一键推送）**：[点此打开预填好的 GitHub 投递单并点击 Submit](${prefilledIssueUrl})`,
              `- **💻 方式 2（终端 \`gh\` CLI 一行推送）**：\`${ghCmd}\``,
              ...(ghCliNote ? [`- ${ghCliNote}`] : []),
            ]),
        `- **📄 本地永久收据（撤回凭证）**：\`${receiptPath}\``,
        `- **🔄 随时撤回方式**：任意时刻调用 \`vetoboard_contribute_asset({ action: "withdraw", submissionId: "${submissionId}" })\` 或执行 \`npx vetoboard-mcp withdraw ${submissionId}\` 即可申请撤回移除！`,
      ].join("\n")
    : [
        `## ✅ Method A Standardized Contribution Ready (Receipt: \`${submissionId}\`)`,
        "",
        buildGovernanceNoticeBlock(locale, submissionId),
        "",
        ...(liveIssueUrl
          ? [`- **🚀 Submitted via \`gh\` CLI**: ${liveIssueUrl}`]
          : [
              `- **🔗 Option 1 (1-Click Browser Submit)**: [Open Pre-Filled GitHub Issue](${prefilledIssueUrl})`,
              `- **💻 Option 2 (\`gh\` CLI One-Liner)**: \`${ghCmd}\``,
            ]),
        `- **📄 Local Receipt**: \`${receiptPath}\``,
        `- **🔄 Withdraw Anytime**: Call \`vetoboard_contribute_asset({ action: "withdraw", submissionId: "${submissionId}" })\` or run \`npx vetoboard-mcp withdraw ${submissionId}\`.`,
      ].join("\n");

  return { markdown: md, receipt };
}

export async function withdrawAssetContribution(params: {
  readonly submissionId: string;
  readonly reason?: string;
  readonly autoRunGhCli?: boolean;
  readonly dataRootDir?: string;
  readonly locale: VetoBoardLocale;
}): Promise<{ readonly isError?: boolean; readonly markdown: string; readonly receipt?: ContributionReceipt }> {
  const { locale } = params;
  const zh = locale === "zh";
  const home = homedir();
  const dataRoot = resolve(params.dataRootDir ?? process.env.VETOBOARD_DATA_DIR ?? join(home, ".vetoboard-mcp"));
  const cleanSubId = params.submissionId.trim().replace(/[^a-zA-Z0-9_-]+/g, "");
  const receiptPath = join(dataRoot, "contributions", `${cleanSubId}.json`);

  let existing: ContributionReceipt;
  try {
    const raw = await readFile(receiptPath, "utf8");
    existing = contributionReceiptSchema.parse(JSON.parse(raw));
  } catch {
    return {
      isError: true,
      markdown: zh
        ? `未找到投递凭证号 "${params.submissionId}" 的本地记录（目录：\`${join(dataRoot, "contributions")}\`）。`
        : `Submission receipt "${params.submissionId}" not found.`,
    };
  }

  const now = new Date().toISOString();
  const withdrawTitle = `[WITHDRAW] Remove contributed ${existing.assetType} "${existing.assetId}" (${existing.submissionId})`;
  const withdrawBody = [
    `## Asset Withdrawal & Removal Request (\`${existing.submissionId}\`)`,
    `- **Submission ID**: \`${existing.submissionId}\``,
    `- **Asset**: \`${existing.assetType}\` / \`${existing.assetId}\``,
    `- **Reason**: ${params.reason?.trim() || "Author exercised unconditional withdrawal right."}`,
    `- **Requested At**: ${now}`,
    "",
    "Please immediately remove this contributed asset from the VetoBoard library and pending upgrade pool.",
  ].join("\n");

  const withdrawIssueUrl = buildPrefilledGithubIssueUrl({
    body: withdrawBody,
    labels: "asset-withdrawal",
    targetRepo: existing.targetRepo,
    title: withdrawTitle,
  });

  let closedRemotely = false;
  if (params.autoRunGhCli && existing.issueUrl) {
    try {
      await execFileAsync(
        "gh",
        ["issue", "close", existing.issueUrl, "--comment", withdrawBody],
        { timeout: 15_000 },
      );
      closedRemotely = true;
    } catch {
      // Fallback to 1-click withdrawal URL
    }
  }

  const updated: ContributionReceipt = {
    ...existing,
    status: "withdrawn",
    withdrawIssueUrl,
    ...(params.reason?.trim() ? { withdrawReason: params.reason.trim() } : {}),
    withdrawnAt: now,
  };
  await writeFile(receiptPath, JSON.stringify(updated, null, 2), "utf8");

  const md = zh
    ? [
        `## 🔄 资产撤回登记已完成（凭证号：\`${updated.submissionId}\` → 状态：\`withdrawn\`）`,
        `- **已撤回资产**：\`${updated.assetId}\`（\`${updated.assetType}\`）`,
        `- **本地收据已更新**：\`${receiptPath}\`（撤回时间：\`${now}\`）`,
        ...(closedRemotely
          ? [`- **🚀 已通过 \`gh\` CLI 自动关闭远端投递 Issue 并附撤回声明**：${existing.issueUrl}`]
          : [
              `- **🔗 若您此前已提交至 GitHub，点此一键发出官方撤回移除工单**：[点此提交撤回通知 (${updated.submissionId})](${withdrawIssueUrl})`,
              ...(existing.issueUrl ? [`- 或直接关闭原投递链接：${existing.issueUrl}`] : []),
            ]),
        "- 官方维护库收到撤回单后将无条件立即移除该角色/技能，不再用于后续项目升级或优化。",
      ].join("\n")
    : [
        `## 🔄 Contribution Withdrawn (Receipt: \`${updated.submissionId}\` -> \`withdrawn\`)`,
        `- **Asset**: \`${updated.assetId}\` (\`${updated.assetType}\`)`,
        `- **Updated Local Receipt**: \`${receiptPath}\``,
        ...(closedRemotely
          ? [`- **🚀 Closed remote GitHub Issue via \`gh\` CLI**: ${existing.issueUrl}`]
          : [`- **🔗 Submit 1-Click GitHub Removal Notice**: [Open Withdrawal Issue](${withdrawIssueUrl})`]),
      ].join("\n");

  return { markdown: md, receipt: updated };
}

export async function listAssetContributions(params: {
  readonly dataRootDir?: string;
  readonly locale: VetoBoardLocale;
}): Promise<string> {
  const zh = params.locale === "zh";
  const home = homedir();
  const dataRoot = resolve(params.dataRootDir ?? process.env.VETOBOARD_DATA_DIR ?? join(home, ".vetoboard-mcp"));
  const contribDir = join(dataRoot, "contributions");

  const items: ContributionReceipt[] = [];
  try {
    const files = await readdir(contribDir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(contribDir, f), "utf8");
        const parsed = contributionReceiptSchema.safeParse(JSON.parse(raw));
        if (parsed.success) items.push(parsed.data);
      } catch {
        // Ignore malformed receipt
      }
    }
  } catch {
    // No contributions yet
  }

  items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (items.length === 0) {
    return zh
      ? "当前尚无已推送的资产记录（目录：`~/.vetoboard-mcp/contributions/`）。"
      : "No asset contribution receipts found.";
  }

  const lines = items.map(
    (it) =>
      `- \`${it.submissionId}\` · **${it.title}** (\`${it.assetType}:${it.assetId}\`) · ${
        it.status === "withdrawn"
          ? zh
            ? "🔄 已撤回"
            : "🔄 Withdrawn"
          : zh
            ? "✅ 已投递（可随时调 withdraw 撤回）"
            : "✅ Submitted (withdrawable)"
      } · ${it.createdAt}`,
  );
  return [
    zh ? "### 📋 本地资产推送与撤回台账" : "### 📋 Local Asset Contribution & Withdrawal Ledger",
    ...lines,
  ].join("\n");
}
