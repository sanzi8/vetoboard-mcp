import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { VetoBoardLocale } from "../i18n/locales.js";

const execFileAsync = promisify(execFile);

/**
 * Non-Blocking 24h Update Notifier & Multi-Mode Self-Updater (`selfUpdater.ts`).
 *
 * Open-source etiquette & safety guarantees:
 * 1. Respects `VETOBOARD_NO_UPDATE_CHECK=1` (and skips network checks during `VITEST` unless `registryUrlOverride` is given).
 * 2. Caches version checks for 24 hours in `~/.vetoboard-mcp/update-check.json` with a hard 1,500ms timeout —
 *    offline/intranet environments NEVER hang or error out.
 * 3. Stays 100% silent when already on the latest version; appends a 1-line notice at task completion ONLY when an update exists.
 * 4. `runSelfUpdate` detects Git source clones (`git pull --ff-only` + `build`, refusing to clobber dirty working trees)
 *    vs npm installs (`npm install -g vetoboard-mcp@latest`).
 */

export const CURRENT_VETOBOARD_VERSION = "1.1.0";
export const DEFAULT_NPM_LATEST_URL = "https://registry.npmjs.org/vetoboard-mcp/latest";
const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

interface UpdateCacheRecord {
  readonly checkedAt: string;
  readonly latestVersion: string;
  readonly releaseSummary?: string;
}

export function compareSemver(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const clean = v.trim().replace(/^v/i, "").split("-")[0] ?? "0.0.0";
    const parts = clean.split(".").map((n) => Number.parseInt(n, 10) || 0);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 < b1 ? -1 : 1;
  if (a2 !== b2) return a2 < b2 ? -1 : 1;
  if (a3 !== b3) return a3 < b3 ? -1 : 1;
  return 0;
}

export interface UpdateNoticeResult {
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly updateAvailable: boolean;
  readonly bannerMarkdown?: string;
}

export async function checkLatestVersionNonBlocking(params: {
  readonly currentVersion?: string;
  readonly dataRootDir?: string;
  readonly locale: VetoBoardLocale;
  readonly registryUrlOverride?: string;
  readonly forceRefresh?: boolean;
}): Promise<UpdateNoticeResult> {
  const currentVersion = params.currentVersion ?? CURRENT_VETOBOARD_VERSION;
  const zh = params.locale === "zh";

  if (process.env.VETOBOARD_NO_UPDATE_CHECK === "1") {
    return { currentVersion, latestVersion: currentVersion, updateAvailable: false };
  }
  // Never make real external calls during hermetic Vitest runs unless an explicit mock URL is supplied
  if (process.env.VITEST && !params.registryUrlOverride && !process.env.VETOBOARD_UPDATE_REGISTRY_URL) {
    return { currentVersion, latestVersion: currentVersion, updateAvailable: false };
  }

  const home = homedir();
  const dataRoot = resolve(
    params.dataRootDir ?? process.env.VETOBOARD_DATA_DIR ?? join(home, ".vetoboard-mcp"),
  );
  const cachePath = join(dataRoot, "update-check.json");

  let latestVersion: string | undefined;
  let releaseSummary: string | undefined;

  if (!params.forceRefresh) {
    try {
      const raw = await readFile(cachePath, "utf8");
      const cached = JSON.parse(raw) as UpdateCacheRecord;
      const ageMs = Date.now() - Date.parse(cached.checkedAt);
      if (cached.latestVersion && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < UPDATE_CACHE_TTL_MS) {
        latestVersion = cached.latestVersion;
        releaseSummary = cached.releaseSummary;
      }
    } catch {
      // Cache absent or expired
    }
  }

  if (!latestVersion) {
    const url =
      params.registryUrlOverride ??
      process.env.VETOBOARD_UPDATE_REGISTRY_URL?.trim() ??
      DEFAULT_NPM_LATEST_URL;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_500);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (res.ok) {
        const json = (await res.json()) as {
          version?: string;
          tag_name?: string;
          description?: string;
          name?: string;
        };
        const fetchedVer = (json.version ?? json.tag_name ?? "").trim().replace(/^v/i, "");
        if (/^\d+\.\d+\.\d+/.test(fetchedVer)) {
          latestVersion = fetchedVer;
          if (typeof json.description === "string" && json.description.trim()) {
            releaseSummary = json.description.trim().slice(0, 120);
          }
          await mkdir(dataRoot, { recursive: true }).catch(() => undefined);
          const record: UpdateCacheRecord = {
            checkedAt: new Date().toISOString(),
            latestVersion,
            ...(releaseSummary ? { releaseSummary } : {}),
          };
          await writeFile(cachePath, JSON.stringify(record, null, 2), "utf8").catch(() => undefined);
        }
      }
    } catch {
      // Silently ignore offline/timeout errors
    } finally {
      clearTimeout(timer);
    }
  }

  if (!latestVersion || compareSemver(currentVersion, latestVersion) >= 0) {
    return {
      currentVersion,
      latestVersion: latestVersion ?? currentVersion,
      updateAvailable: false,
    };
  }

  const bannerMarkdown = zh
    ? `- 🔔 **发现新版本 \`v${latestVersion}\`**（当前 \`v${currentVersion}\`${releaseSummary ? ` · ${releaseSummary}` : ""}）：直接回复 **「更新 VetoBoard」** 即可一键拉取升级！`
    : `- 🔔 **New Version Available \`v${latestVersion}\`** (current \`v${currentVersion}\`): Reply **"Update VetoBoard"** to pull the latest release automatically!`;

  return {
    bannerMarkdown,
    currentVersion,
    latestVersion,
    updateAvailable: true,
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function runSelfUpdate(params: {
  readonly action: "check" | "apply";
  readonly locale: VetoBoardLocale;
  readonly currentVersion?: string;
  readonly dataRootDir?: string;
  readonly repoDirOverride?: string;
  readonly registryUrlOverride?: string;
  readonly dryRun?: boolean;
}): Promise<{ readonly isError?: boolean; readonly markdown: string }> {
  const zh = params.locale === "zh";
  const currentVersion = params.currentVersion ?? CURRENT_VETOBOARD_VERSION;

  const check = await checkLatestVersionNonBlocking({
    currentVersion,
    dataRootDir: params.dataRootDir,
    forceRefresh: true,
    locale: params.locale,
    registryUrlOverride: params.registryUrlOverride,
  });

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const installRoot = resolve(params.repoDirOverride ?? resolve(moduleDir, "..", ".."));
  const isGitClone = await pathExists(join(installRoot, ".git"));

  if (params.action === "check") {
    if (!check.updateAvailable) {
      return {
        markdown: zh
          ? `✅ 当前已是最新版本 **\`v${currentVersion}\`**（安装方式：${isGitClone ? `Git 源码目录 \`${installRoot}\`` : "npm 包模式"}）。`
          : `✅ Already on the latest version **\`v${currentVersion}\`** (${isGitClone ? "Git clone" : "npm package"}).`,
      };
    }
    return {
      markdown: zh
        ? [
            `🔔 **检测到新版本 \`v${check.latestVersion}\`**（当前 \`v${currentVersion}\`）`,
            `- 安装模式：${isGitClone ? `Git 仓库（\`${installRoot}\`）` : "npm 全局 / npx 模式"}`,
            `- 回复确认或调用 \`vetoboard_self_update({ action: "apply" })\` 即可自动完成拉取与构建！`,
          ].join("\n")
        : [
            `🔔 **Update Available: \`v${check.latestVersion}\`** (current \`v${currentVersion}\`)`,
            `- Call \`vetoboard_self_update({ action: "apply" })\` to upgrade now.`,
          ].join("\n"),
    };
  }

  // `action === "apply"`
  if (isGitClone) {
    try {
      const { stdout: statusOut } = await execFileAsync("git", ["-C", installRoot, "status", "--porcelain"], {
        timeout: 10_000,
      });
      if (statusOut.trim().length > 0) {
        return {
          isError: true,
          markdown: zh
            ? [
                `⚠️ **安全保护拦截**：检测到本地仓库 \`${installRoot}\` 存在未提交的修改，已停止自动覆盖以保护您的代码：`,
                "```text",
                statusOut.trim().slice(0, 600),
                "```",
                "请先执行 `git commit` 或 `git stash` 后再重试更新。",
              ].join("\n")
            : `⚠️ **Update Aborted**: Local repository \`${installRoot}\` has uncommitted changes. Commit or stash first.`,
        };
      }

      if (params.dryRun) {
        return {
          markdown: zh
            ? `🧪 **[Dry-Run 演练通过]** 工作区干净，正式执行时将在 \`${installRoot}\` 运行 \`git pull --ff-only\` 并重新编译 \`dist/\`，随后点击 IDE \`MCP Servers > Refresh\` 即可热生效！`
            : `🧪 **[Dry-Run Passed]** Clean git tree at \`${installRoot}\`; will run \`git pull --ff-only\` + build.`,
        };
      }

      const { stdout: pullOut } = await execFileAsync("git", ["-C", installRoot, "pull", "--ff-only"], {
        timeout: 30_000,
      });
      const npmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
      try {
        await execFileAsync(npmBin, ["--dir", installRoot, "run", "build"], { timeout: 45_000 });
      } catch {
        const fallbackNpm = process.platform === "win32" ? "npm.cmd" : "npm";
        await execFileAsync(fallbackNpm, ["--prefix", installRoot, "run", "build"], { timeout: 45_000 });
      }

      const pkgRaw = await readFile(join(installRoot, "package.json"), "utf8");
      const newVer = (JSON.parse(pkgRaw) as { version?: string }).version ?? check.latestVersion;

      return {
        markdown: zh
          ? [
              `## 🚀 VetoBoard 已成功更新并完成重编译（当前版本：\`v${newVer}\`）`,
              `- **Git 同步结果**：\`${pullOut.trim() || "Already up to date."}\``,
              "- **最后一步（免重启窗口）**：请点击右上角 `... > MCP Servers > Refresh` 热重载进程即可立即使用新版本！",
            ].join("\n")
          : [
              `## 🚀 VetoBoard Updated & Rebuilt (\`v${newVer}\`)`,
              `- Git output: \`${pullOut.trim() || "Up to date"}\``,
              "- Click `MCP Servers > Refresh` in your IDE to reload the updated binary live!",
            ].join("\n"),
      };
    } catch (err) {
      return {
        isError: true,
        markdown: zh
          ? `自动拉取更新失败：${err instanceof Error ? err.message : String(err)}`
          : `Self-update failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // npm / npx installation mode
  if (params.dryRun) {
    return {
      markdown: zh
        ? `🧪 **[Dry-Run 演练通过]** 检测到 npm 包安装模式，正式执行时将运行 \`npm install -g vetoboard-mcp@latest\`。`
        : `🧪 **[Dry-Run Passed]** npm package mode; will run \`npm install -g vetoboard-mcp@latest\`.`,
    };
  }

  try {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const { stdout } = await execFileAsync(npmCmd, ["install", "-g", "vetoboard-mcp@latest"], {
      timeout: 60_000,
    });
    return {
      markdown: zh
        ? [
            `## 🚀 VetoBoard npm 全局包已更新至最新版（\`v${check.latestVersion}\`）`,
            ...(stdout.trim() ? [`\`${stdout.trim().slice(0, 240)}\``] : []),
            "- **立即生效**：请点击 IDE 右上角 `... > MCP Servers > Refresh`（若您在 `mcp_config.json` 中配置了 `\"args\": [\"-y\", \"vetoboard-mcp@latest\"]`，今后每次重开 IDE 也会零操作自动保持最新！）。",
          ].join("\n")
        : [
            `## 🚀 VetoBoard Updated via npm (\`v${check.latestVersion}\`)`,
            "- Click `MCP Servers > Refresh` in your IDE to reload!",
          ].join("\n"),
    };
  } catch (err) {
    return {
      isError: true,
      markdown: zh
        ? `npm 自动更新失败：${err instanceof Error ? err.message : String(err)}（您也可在终端手动运行 \`npm i -g vetoboard-mcp@latest\`）。`
        : `npm update failed: ${err instanceof Error ? err.message : String(err)}.`,
    };
  }
}
