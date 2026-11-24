import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { vetoboardTaskRecordSchema, type VetoBoardTaskRecord } from "./types.js";

function sanitizeId(raw: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error(`Invalid identifier: "${raw}"`);
  }
  return cleaned;
}

async function atomicWriteUtf8(targetPath: string, content: string): Promise<void> {
  const tmpPath = `${targetPath}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmpPath, content, "utf8");
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rename(tmpPath, targetPath);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "EPERM" || code === "EACCES" || code === "EBUSY") {
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
        continue;
      }
      break;
    }
  }
  // Fallback direct overwrite if Windows AV/indexer holds rename lock
  try {
    await writeFile(targetPath, content, "utf8");
    await rm(tmpPath, { force: true }).catch(() => undefined);
  } catch {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw lastErr;
  }
}

/**
 * Session-isolated local task & artifact store (`~/.vetoboard-mcp/tasks/<taskId>/`).
 * Session-isolated (`~/.vetoboard-mcp/tasks/<taskId>/`) and serialized per-taskId
 * so concurrent IDE sessions never collide or clobber each other.
 */
export class VetoBoardTaskStore {
  public readonly rootDir: string;
  private readonly writeLocks = new Map<string, Promise<void>>();
  private readonly mutationLocks = new Map<string, Promise<void>>();

  public constructor(customRootDir?: string) {
    const base =
      customRootDir?.trim() ||
      process.env.VETOBOARD_DATA_DIR?.trim() ||
      join(homedir(), ".vetoboard-mcp");
    this.rootDir = resolve(base);
  }

  public getTaskDir(taskId: string): string {
    return join(this.rootDir, "tasks", sanitizeId(taskId));
  }

  /**
   * Serializes read-modify-write mutations per `taskId` so concurrent parallel `vetoboard_submit_track_output`
   * calls never clobber each other's track status updates!
   */
  public async mutateTaskSerial<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    const key = sanitizeId(taskId);
    const prev = this.mutationLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const chained = prev.then(() => gate);
    this.mutationLocks.set(key, chained);

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.mutationLocks.get(key) === chained) {
        this.mutationLocks.delete(key);
      }
    }
  }

  private async enqueueWrite<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    const key = sanitizeId(taskId);
    const prev = this.writeLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const chained = prev.then(() => gate);
    this.writeLocks.set(key, chained);

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.writeLocks.get(key) === chained) {
        this.writeLocks.delete(key);
      }
    }
  }

  public async saveTask(record: VetoBoardTaskRecord): Promise<void> {
    const validated = vetoboardTaskRecordSchema.parse(record);
    await this.enqueueWrite(validated.taskId, async () => {
      const dir = this.getTaskDir(validated.taskId);
      await mkdir(join(dir, "tracks"), { recursive: true });
      const filePath = join(dir, "task.json");
      await atomicWriteUtf8(filePath, `${JSON.stringify(validated, null, 2)}\n`);
    });
  }

  public async getTask(taskId: string): Promise<VetoBoardTaskRecord | null> {
    try {
      const filePath = join(this.getTaskDir(taskId), "task.json");
      const raw = await readFile(filePath, "utf8");
      return vetoboardTaskRecordSchema.parse(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  public async listTasks(): Promise<VetoBoardTaskRecord[]> {
    const tasksRoot = join(this.rootDir, "tasks");
    try {
      const entries = await readdir(tasksRoot, { withFileTypes: true });
      const records: VetoBoardTaskRecord[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const rec = await this.getTask(entry.name).catch(() => null);
        if (rec) records.push(rec);
      }
      return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  public async writeTrackArtifact(
    taskId: string,
    trackId: string,
    markdown: string,
  ): Promise<string> {
    return this.enqueueWrite(taskId, async () => {
      const tracksDir = join(this.getTaskDir(taskId), "tracks");
      await mkdir(tracksDir, { recursive: true });
      const targetPath = join(tracksDir, `${sanitizeId(trackId)}.md`);
      await atomicWriteUtf8(targetPath, markdown);
      return targetPath;
    });
  }

  public async readTrackArtifact(
    taskId: string,
    trackId: string,
  ): Promise<string | undefined> {
    try {
      const targetPath = join(this.getTaskDir(taskId), "tracks", `${sanitizeId(trackId)}.md`);
      return await readFile(targetPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return undefined;
      }
      throw err;
    }
  }

  public async writeFinalReports(
    taskId: string,
    reports: {
      readonly combinedReport: string;
      readonly briefingReport?: string;
      readonly originalReport: string;
      readonly workspaceDir?: string;
      readonly goal?: string;
    },
  ): Promise<{
    readonly reportPath: string;
    readonly briefingPath: string;
    readonly originalPath: string;
    readonly workspaceReportPath?: string;
    readonly workspaceBriefingPath?: string;
    readonly workspaceOriginalPath?: string;
  }> {
    return this.enqueueWrite(taskId, async () => {
      const dir = this.getTaskDir(taskId);
      await mkdir(dir, { recursive: true });
      const reportPath = join(dir, "report.md");
      const briefingPath = join(dir, "briefing.md");
      const originalPath = join(dir, "report.original.md");
      await atomicWriteUtf8(reportPath, reports.combinedReport);
      await atomicWriteUtf8(briefingPath, reports.briefingReport ?? reports.combinedReport);
      await atomicWriteUtf8(originalPath, reports.originalReport);

      if (reports.workspaceDir?.trim()) {
        try {
          const wsDir = resolve(reports.workspaceDir.trim());
          await mkdir(wsDir, { recursive: true });
          const rawSlug = (reports.goal ?? taskId)
            .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 38)
            .replace(/[. ]+$/, "");
          const slug = rawSlug || sanitizeId(taskId);
          const workspaceReportPath = join(wsDir, `${slug}-report.md`);
          const workspaceBriefingPath = join(wsDir, `${slug}-briefing.md`);
          const workspaceOriginalPath = join(wsDir, `${slug}-original-report.md`);
          await atomicWriteUtf8(workspaceReportPath, reports.combinedReport);
          await atomicWriteUtf8(
            workspaceBriefingPath,
            reports.briefingReport ?? reports.combinedReport,
          );
          await atomicWriteUtf8(workspaceOriginalPath, reports.originalReport);
          return {
            briefingPath,
            originalPath,
            reportPath,
            workspaceBriefingPath,
            workspaceOriginalPath,
            workspaceReportPath,
          };
        } catch {
          // If workspaceDir is read-only or invalid, fall back gracefully to task dir
        }
      }

      return { briefingPath, originalPath, reportPath };
    });
  }

  public async readFinalReport(taskId: string): Promise<string | undefined> {
    try {
      const reportPath = join(this.getTaskDir(taskId), "report.md");
      return await readFile(reportPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return undefined;
      }
      throw err;
    }
  }
}
