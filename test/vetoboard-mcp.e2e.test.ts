import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createVetoBoardMcpServer,
  DELEGATE_TO_AGENT_OPTION_ID,
  preserveBaselineOnIncrementalPatch,
  VetoBoardTaskStore,
  startVetoBoardHttpServer,
} from "../src/index.js";

function firstText(res: Awaited<ReturnType<Client["callTool"]>>): string {
  const block = res.content?.[0];
  return block && block.type === "text" ? block.text : "";
}

describe("vetoboard-mcp bilingual clean-room governance engine (stdio/in-memory + Cloud HTTP)", () => {
  let tempDir = "";
  let store!: VetoBoardTaskStore;
  let client!: Client;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vetoboard-mcp-test-"));
    store = new VetoBoardTaskStore(tempDir);
    const server = createVetoBoardMcpServer({ defaultLocale: "auto", store });
    client = new Client({ name: "test-ide-host", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close().catch(() => undefined);
    if (tempDir) {
      await rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
    }
  });

  it("registers all 13 MCP tools and handles English & auto-detected Chinese seamlessly", async () => {
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "vetoboard_audit_output",
      "vetoboard_calc",
      "vetoboard_clarify_routes",
      "vetoboard_compress_memorial",
      "vetoboard_contribute_asset",
      "vetoboard_distill_skill",
      "vetoboard_get_role_charter",
      "vetoboard_plan_lineup",
      "vetoboard_self_update",
      "vetoboard_start_council",
      "vetoboard_submit_track_output",
      "vetoboard_task_status",
      "vetoboard_update_council",
    ]);

    // 1. English unit economics
    const unitRes = await client.callTool({
      arguments: {
        fixedCostAnnual: 120_000,
        lang: "en",
        mode: "unit_economics",
        unitCogs: 35,
        unitPrice: 100,
        variableRatePct: 15,
        volumes: [2000, 3000],
      },
      name: "vetoboard_calc",
    });
    const unitJson = JSON.parse(firstText(unitRes));
    expect(unitJson.ok).toBe(true);
    expect(unitJson.summary).toContain("UnitContribution=50/unit");
    expect(unitJson.data.unitContribution).toBe(50);
    expect(unitJson.data.bepUnits).toBe(2400);

    // 2. Chinese reconcile audit catching a 41.7% BEP mental-math hallucination
    const recRes = await client.callTool({
      arguments: {
        checks: [
          {
            claimedValue: 1400,
            formula: "120000 / (100 - 35 - 15)",
            label: "年盈亏平衡销量",
            unit: "单",
          },
        ],
        lang: "zh",
        mode: "reconcile",
        tolerancePct: 1,
      },
      name: "vetoboard_calc",
    });
    expect(recRes.isError).toBe(true);
    const recJson = JSON.parse(firstText(recRes));
    expect(recJson.ok).toBe(false);
    expect(recJson.data.allPassed).toBe(false);
    expect(recJson.summary).toContain("数学矛盾");

    // 3. Diverge-Then-Converge clarification in English vs Auto-Chinese
    const enClarify = JSON.parse(
      firstText(
        await client.callTool({
          arguments: {
            goal: "Evaluate what profitable B2B SaaS or vertical tool we should launch in 2026",
            lang: "auto",
          },
          name: "vetoboard_clarify_routes",
        }),
      ),
    );
    expect(enClarify.locale).toBe("en");
    expect(enClarify.taskMode).toBe("exploratory");
    expect(enClarify.candidateRoutes).toHaveLength(4);
    expect(enClarify.delegateOptionId).toBe(DELEGATE_TO_AGENT_OPTION_ID);
    expect(enClarify.questions.some((q: { questionId: string }) => q.questionId === "q_target_category")).toBe(true);

    const zhClarify = JSON.parse(
      firstText(
        await client.callTool({
          arguments: {
            goal: "评估 2026 年现在做什么高毛利副业或跨境垂直品类更容易跑通？",
            lang: "auto",
          },
          name: "vetoboard_clarify_routes",
        }),
      ),
    );
    expect(zhClarify.locale).toBe("zh");
    expect(zhClarify.taskMode).toBe("exploratory");
    expect(zhClarify.candidateRoutes).toHaveLength(4);
  });

  it("compresses >20k char deliverables by >75%, protects baseline tables on incremental rework patches, and blocks rule violations", async () => {
    const bigMarkdown = [
      "# Unit Economics & Sensitivity Deep Dive",
      "",
      "## 1. Baseline Assumptions",
      "| Metric | Value | Source |",
      "| :--- | :--- | :--- |",
      ...Array.from({ length: 14 }, (_, i) => `| Cohort #${i + 1} | $${99 + i}/mo | Stripe Cohort |`),
      "",
      ...Array.from(
        { length: 320 },
        (_, i) =>
          `Detailed empirical sensitivity row #${i + 1}: gross margin holds at 78.4% under AWS egress stress scenario ${i + 1}.`,
      ),
      "",
      "## 2. Final Recommendation",
      "- Break-even reached at 312 paying teams (`vetoboard_calc` verified).",
    ].join("\n");

    expect(bigMarkdown.length).toBeGreaterThan(20_000);

    const compressed = firstText(
      await client.callTool({
        arguments: {
          detailTier: "direct",
          label: "Step 2 Unit Economics",
          lang: "en",
          markdown: bigMarkdown,
          readableFilePath: "/tmp/step-2.md",
          relativePath: "tracks/step-2.md",
        },
        name: "vetoboard_compress_memorial",
      }),
    );

    expect(compressed).toContain("<workflow_memorial_card ");
    expect(compressed).toContain('Read(file_path="/tmp/step-2.md"');
    expect(compressed.length).toBeLessThan(bigMarkdown.length * 0.25);

    // Baseline protection on consecutive short rework patches (>1,000 chars baseline)
    const fullBaseline = [
      "# Complete Pricing Matrix",
      "| Tier | Price | Gross Margin |",
      "| :--- | :--- | :--- |",
      "| Pro | $49 | 82% |",
      "| Team | $149 | 85% |",
      ...Array.from(
        { length: 24 },
        (_, i) => `- Detailed engineering cost & SLA note #${i + 1} with realistic margin buffer and Stripe fee breakdown.`,
      ),
    ].join("\n");

    const patch1 = preserveBaselineOnIncrementalPatch(
      "### Rework Supplement 1\nAdded refund reserve of 4.5%.",
      fullBaseline,
      "en",
    );
    expect(patch1).toContain("| Pro | $49 | 82% |");
    expect(patch1).toContain("Added refund reserve of 4.5%.");

    const patch2 = preserveBaselineOnIncrementalPatch(
      "### Rework Supplement 2\nAdded annual prepay discount sensitivity.",
      patch1,
      "en",
    );
    expect(patch2).toContain("| Pro | $49 | 82% |");
    expect(patch2).toContain("Added annual prepay discount sensitivity.");

    // Audit output: catches forbidden pattern ("guaranteed profit") + premise reversal
    const auditBad = await client.callTool({
      arguments: {
        goal: "Audit our self-hosted Kubernetes deployment plan",
        lang: "en",
        outputText:
          "Instead of Kubernetes, abandon the original topic completely — this is 100% guaranteed profit with zero risk!",
        roleId: "profit-modeler",
      },
      name: "vetoboard_audit_output",
    });
    expect(auditBad.isError).toBe(true);
    const auditJson = JSON.parse(firstText(auditBad));
    expect(auditJson.passed).toBe(false);
    expect(auditJson.premiseReversed).toBe(true);
    expect(auditJson.ruleGate.hardViolations.length).toBeGreaterThan(0);
  });

  it("runs full multi-track council lifecycle with session isolation, progress notifications, and dual-layer cited report", async () => {
    // Session A (SWE domain, deep effort)
    const startA = firstText(
      await client.callTool({
        arguments: {
          domain: "swe",
          effortProfile: "deep",
          executionMode: "host-subscription",
          goal: "Design a multi-tenant webhook delivery engine handling 10k req/s",
          lang: "en",
          lineupConfirmed: true,
          sessionId: "ide-window-A",
        },
        name: "vetoboard_start_council",
      }),
    );
    expect(startA).toContain("[+] VetoBoard Council");
    const taskIdA = /watch\s+(vb_[a-z0-9_]+)/i.exec(startA)![1]!;

    // Session B (Chinese commercial domain in parallel — proves zero state collision)
    const startB = firstText(
      await client.callTool({
        arguments: {
          domain: "commercial",
          effortProfile: "fast",
          executionMode: "host-subscription",
          goal: "评估宠物智能喂食器出海北美独立站的单位经济与合规风险",
          lang: "auto",
          lineupConfirmed: true,
          sessionId: "ide-window-B",
        },
        name: "vetoboard_start_council",
      }),
    );
    expect(startB).toContain("[+] VetoBoard 决策委员会");
    const taskIdB = /watch\s+(vb_[a-z0-9_]+)/i.exec(startB)![1]!;
    expect(taskIdB).not.toBe(taskIdA);

    const recordA = (await store.getTask(taskIdA))!;
    expect(recordA.tracks).toHaveLength(3);

    // Submit Track 1 (`software-architect`) with progress notification listener
    const progressEvents: number[] = [];
    const track1Res = await client.callTool(
      {
        arguments: {
          catchHighlights: [
            {
              category: "evidence_verified",
              detail: "Verified bounded exponential backoff (1s -> 60s, max 8 attempts) + HMAC-SHA256",
            },
          ],
          markdown: [
            "# Webhook Engine Architecture",
            "",
            "## 1. Throughput & Storage Partitioning",
            "| Shard Tier | Target QPS | Queue Engine | P99 Latency |",
            "| :--- | :--- | :--- | :--- |",
            "| Hot Tier | 10,000 req/s | Kafka + Redis Streams | 42ms |",
            "| Retry DLQ | 1,500 req/s | Postgres Partitioned | 180ms |",
            "",
            "## 2. Failure Isolation",
            "Per-tenant token buckets isolate noisy neighbors within 5 seconds (ref: https://kafka.apache.org/documentation/ & https://redis.io/docs/latest/develop/data-types/streams/).",
          ].join("\n"),
          summaryLine: "Partitioned Kafka + bounded backoff architecture verified",
          taskId: taskIdA,
          trackId: recordA.tracks[0]!.trackId,
        },
        name: "vetoboard_submit_track_output",
      },
      {
        onprogress: (p) => {
          progressEvents.push(p.progress);
        },
      },
    );
    expect(track1Res.isError).toBeFalsy();
    expect(progressEvents).toEqual([1]);

    // Submit Track 2 (`tech-feasibility`)
    const track2Res = await client.callTool({
      arguments: {
        markdown: [
          "# Engineering Capacity & Cost Model",
          "",
          "## 1. Monthly Cloud Infrastructure Cost",
          "| Component | Spec | Monthly Cost |",
          "| :--- | :--- | :--- |",
          "| 3x Kafka Brokers | c7g.xlarge | $410 |",
          "| Worker Pool | 6x c7g.large | $390 |",
          "",
          "Total infra cost is $800/mo (`$0.00031` per 10k deliveries, AWS Graviton pricing: https://aws.amazon.com/ec2/pricing/on-demand/).",
        ].join("\n"),
        taskId: taskIdA,
        trackId: recordA.tracks[1]!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    expect(track2Res.isError).toBeFalsy();

    // Verify Wave 2 Inspector (`track-3-quality-inspector`) was automatically promoted to `running`
    const beforeInspector = (await store.getTask(taskIdA))!;
    expect(beforeInspector.tracks[2]!.status).toBe("running");

    // Submit Wave 2 Inspector (`quality-inspector`)
    const finalRes = await client.callTool({
      arguments: {
        catchHighlights: [
          {
            category: "math_mismatch",
            detail: "Reconciled $800/mo across 25.92B monthly deliveries = $0.000308 per 10k events",
          },
        ],
        executiveBriefingMarkdown: [
          "### Core Verdict",
          "Ship the partitioned Kafka + Redis Streams architecture [S1·§1] with $800/mo baseline infra [S2·§1], reconciled by independent audit [V1].",
        ].join("\n"),
        invokedTools: ["vetoboard_calc"],
        markdown: [
          "# Independent Quality & Math Reconciliation",
          "- Reconciled QPS capacity and monthly AWS cost via `vetoboard_calc`: all figures consistent.",
        ].join("\n"),
        taskId: taskIdA,
        trackId: recordA.tracks[2]!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });

    expect(finalRes.isError).toBeFalsy();
    expect(firstText(finalRes)).toContain("Dual-Layer Cited Audit Report Signed");

    // Verify final report on disk has clickable citations `[[S1·§1]](#ref-s1-sec1)`, `[[V1]](#ref-v1)`, and Audit Seal
    const statusRes = firstText(
      await client.callTool({
        arguments: { includeReport: true, taskId: taskIdA },
        name: "vetoboard_task_status",
      }),
    );
    expect(statusRes).toContain("[[S1·§1]](#ref-s1-sec1)");
    expect(statusRes).toContain("[[S2·§1]](#ref-s2-sec1)");
    expect(statusRes).toContain("[[V1]](#ref-v1)");
    expect(statusRes).toContain("VetoBoard Audit Seal");

    // Confirm Session B remained completely untouched in `running` state
    const untouchedB = (await store.getTask(taskIdB))!;
    expect(untouchedB.status).toBe("running");
    expect(untouchedB.locale).toBe("zh");
  });

  it("serves Cloud Streamable HTTP with Bearer auth & keeps stdio stdout 100% clean", async () => {
    const httpSrv = await startVetoBoardHttpServer({
      bearerTokens: ["sk-cloud-secret-123"],
      defaultLocale: "en",
      host: "127.0.0.1",
      port: 0,
      store,
    });

    try {
      const baseUrl = `http://127.0.0.1:${httpSrv.port}`;
      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({
        mode: "cloud-http",
        ok: true,
        service: "vetoboard-mcp",
      });

      // Missing Bearer token -> 401
      const unauth = await fetch(httpSrv.url, { method: "POST" });
      expect(unauth.status).toBe(401);

      // Authenticated MCP Client over Streamable HTTP
      const remoteClient = new Client({ name: "cloud-cursor-client", version: "1.0.0" });
      const httpTransport = new StreamableHTTPClientTransport(new URL(httpSrv.url), {
        requestInit: {
          headers: {
            Authorization: "Bearer sk-cloud-secret-123",
          },
        },
      });
      await remoteClient.connect(httpTransport);

      const calcRes = await remoteClient.callTool({
        arguments: {
          expressions: [{ formula: "(250 - 90) * 12", name: "annualGrossProfit", unit: "USD" }],
          lang: "en",
          mode: "expression",
        },
        name: "vetoboard_calc",
      });
      const parsed = JSON.parse(firstText(calcRes));
      expect(parsed.ok).toBe(true);
      expect(parsed.data.results[0].value).toBe(1920);
      await remoteClient.close();
    } finally {
      await httpSrv.close();
    }

    // Verify `dist/cli.js` stdio mode emits 0 stray non-JSON-RPC bytes on stdout upon boot
    const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
    const stdoutChunks: Buffer[] = [];
    const child = spawn(process.execPath, [cliPath, "--lang", "en", "--data-dir", tempDir], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    await new Promise((r) => setTimeout(r, 350));
    child.kill();
    expect(Buffer.concat(stdoutChunks).toString("utf8")).toBe("");
  });

  it("starter governance pack is valid BOM-free JSON with all 16 bilingual role charters", async () => {
    const packRaw = await readFile(
      fileURLToPath(new URL("../packs/starter-governance.vetoboard-pack.json", import.meta.url)),
      "utf8",
    );
    expect(packRaw.charCodeAt(0)).not.toBe(0xfeff);
    const pack = JSON.parse(packRaw);
    expect(pack.format).toBe("vetoboard-asset-pack");
    expect(pack.roles).toHaveLength(16);
    expect(pack.skills.length).toBeGreaterThanOrEqual(2);
  });

  it("supports BYOK / relay OpenAI-compatible cross-model heterogeneous inspection in vetoboard_audit_output", async () => {
    const mockRelay = createServer((req, res) => {
      if (req.url === "/v1/chat/completions" && req.method === "POST") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "Nit: Rate-limit burst window verified; no P0 arithmetic or security defects.",
                },
              },
            ],
            model: "deepseek-reasoner-relay",
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((r) => mockRelay.listen(0, "127.0.0.1", () => r()));
    const relayPort = (mockRelay.address() as AddressInfo).port;

    try {
      const res = await client.callTool({
        arguments: {
          apiBaseUrl: `http://127.0.0.1:${relayPort}/v1`,
          apiKey: "sk-user-relay-key",
          executionMode: "byok",
          goal: "Verify rate-limiter middleware implementation",
          invokedTools: ["search_web"],
          lang: "en",
          modelId: "deepseek-reasoner-relay",
          outputText: "Implemented token-bucket limiter with hermetic unit tests passing (RFC 6585: https://datatracker.ietf.org/doc/html/rfc6585).",
          roleId: "software-architect",
        },
        name: "vetoboard_audit_output",
      });
      expect(res.isError).toBeFalsy();
      const body = JSON.parse(firstText(res));
      expect(body.executionMode).toBe("byok");
      expect(body.passed).toBe(true);
      expect(body.externalCritique.model).toBe("deepseek-reasoner-relay");
      expect(body.externalCritique.verdict).toContain("Nit:");
    } finally {
      await new Promise<void>((r) => mockRelay.close(() => r()));
    }
  });

  it("supports pre-flight smart lineup selector (vetoboard_plan_lineup), unskippable selection gate, native SKILL.md role synthesis, and mid-flight re-weighting (vetoboard_update_council)", async () => {
    // Create a mock workspace native skill `.agents/skills/shopify-vat-audit/SKILL.md`
    const wsSkillDir = join(tempDir, "workspace", ".agents", "skills", "shopify-vat-audit");
    await mkdir(wsSkillDir, { recursive: true });
    await writeFile(
      join(wsSkillDir, "SKILL.md"),
      [
        "---",
        "name: shopify-vat-audit",
        "description: EU IOSS VAT, GDPR Consent Mode v2, and Shopify Billing compliance audit rules.",
        "---",
        "# Shopify VAT & GDPR Audit Playbook",
        "1. Verify IOSS threshold of EUR 150.",
      ].join("\n"),
      "utf8",
    );

    // 0. Calling `vetoboard_start_council` WITHOUT `lineupConfirmed: true` hits the unskippable Role & Skill Selection Gate!
    const gateText = firstText(
      await client.callTool({
        arguments: {
          domain: "commercial",
          effortProfile: "fast",
          executionMode: "host-subscription",
          goal: "评估跨境 Shopify 独立站 GDPR 与 VAT 税务合规插件（月费 $29）",
          lang: "zh",
          workspaceDir: join(tempDir, "workspace"),
        },
        name: "vetoboard_start_council",
      }),
    );
    expect(gateText).toContain("PREFLIGHT_BENCH_CONFIRMATION_REQUIRED");
    expect(gateText).toContain("VetoBoard 战前检索与推荐阵容准备单");
    expect(gateText).toContain("shopify-vat-audit");

    // 1. Smart dynamic weighting + Native Skill Radar via `vetoboard_plan_lineup`
    const planRes = JSON.parse(
      firstText(
        await client.callTool({
          arguments: {
            domain: "commercial",
            goal: "评估面向跨境卖家的 GDPR 合规与退货率精算插件（月费 $29）是否可行",
            lang: "auto",
            workspaceDir: join(tempDir, "workspace"),
          },
          name: "vetoboard_plan_lineup",
        }),
      ),
    );
    expect(planRes.locale).toBe("zh");
    expect(planRes.questions).toHaveLength(4);
    expect(planRes.questions[0].questionId).toBe("q_active_roles");
    expect(planRes.questions[1].questionId).toBe("q_primary_leads");
    expect(planRes.questions[2].questionId).toBe("q_role_weights");
    expect(planRes.questions[3].questionId).toBe("q_skill_bindings");
    expect(
      planRes.discoveredNativeSkills.some(
        (s: { skillId: string }) => s.skillId === "shopify-vat-audit",
      ),
    ).toBe(true);
    const legalRec = planRes.recommendedLineup.find(
      (r: { roleId: string }) => r.roleId === "legal-advisor",
    );
    expect(legalRec.priorityTier).toBe("primary");
    expect(legalRec.weight).toBe(96);

    // 2. Start council spawning a brand-new Specialist Role directly from native skill `shopify-vat-audit`!
    const startCustom = firstText(
      await client.callTool({
        arguments: {
          customRoles: [
            {
              charter: "严查欧盟 IOSS VAT 与美国各州 Economic Nexus 税务代扣红线。",
              priorityTier: "guardrail",
              roleId: "cross-border-tax",
              title: "跨境财税合规专家",
              weight: 90,
            },
          ],
          domain: "commercial",
          effortProfile: "deep",
          excludeRoleIds: ["tech-feasibility"],
          executionMode: "host-subscription",
          goal: "评估跨境独立站税务与合规 SaaS",
          lang: "zh",
          lineupConfirmed: true,
          primaryRoleIds: ["legal-advisor"],
          spawnRoleFromSkillIds: ["shopify-vat-audit"],
          weightPresetOrCustomText: "合规=99, shopify-vat-audit=93",
          workspaceDir: join(tempDir, "workspace"),
        },
        name: "vetoboard_start_council",
      }),
    );
    expect(startCustom).toContain("合规与法律风控护栏官");
    expect(startCustom).toContain("跨境财税合规专家");
    expect(startCustom).toContain("原生技能专员 · shopify-vat-audit");
    expect(startCustom).toContain("{skills: shopify-vat-audit}");
    expect(startCustom).not.toContain("工程边界与低阻力交付专员");

    const customTaskId = /watch\s+(vb_[a-z0-9_]+)/i.exec(startCustom)![1]!;
    const initialTask = (await store.getTask(customTaskId))!;
    expect(initialTask.tracks[0]!.roleId).toBe("legal-advisor");
    expect(initialTask.tracks[0]!.weight).toBe(99);
    expect(initialTask.tracks[0]!.tierLabel).toBe("核心主导");

    // Verify the synthesized native-skill track received custom weight 93 and enforces `mustInvokeSkills: ["shopify-vat-audit"]`!
    const skillTrack = initialTask.tracks.find((t) => t.roleId === "skill-shopify-vat-audit")!;
    expect(skillTrack).toBeDefined();
    expect(skillTrack.weight).toBe(93);
    const blockedWithoutSkill = await client.callTool({
      arguments: {
        markdown: "# VAT Check\nChecked IOSS EUR 150 threshold.",
        taskId: customTaskId,
        trackId: skillTrack.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    expect(blockedWithoutSkill.isError).toBe(true);

    const passedWithSkill = await client.callTool({
      arguments: {
        invokedSkills: ["shopify-vat-audit"],
        markdown: "# VAT Check\nChecked IOSS EUR 150 threshold via native skill.",
        taskId: customTaskId,
        trackId: skillTrack.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    expect(passedWithSkill.isError).toBeFalsy();

    // 3. Mid-flight re-weighting: promote `cross-border-tax` to Primary Lead W98, skip `market-analyst`, and add an extra custom track
    const updatedTree = firstText(
      await client.callTool({
        arguments: {
          addCustomRoles: [
            {
              charter: "核验 Shopify App Store 审核拒审条款与 API 限流。",
              priorityTier: "secondary",
              roleId: "shopify-app-reviewer",
              title: "Shopify 生态审核顾问",
              weight: 82,
            },
          ],
          primaryRoleIds: ["legal-advisor", "cross-border-tax"],
          reason: "用户要求提拔跨境财税为双主导并跳过市场泛分析",
          skipRoleOrTrackIds: ["market-analyst"],
          taskId: customTaskId,
          weightOverrides: { "cross-border-tax": 98 },
        },
        name: "vetoboard_update_council",
      }),
    );
    expect(updatedTree).toContain("跨境财税合规专家");
    expect(updatedTree).toContain("98");
    expect(updatedTree).toContain("Shopify 生态审核顾问");
    expect(updatedTree).toContain("⊘");

    const midTask = (await store.getTask(customTaskId))!;
    const taxTrack = midTask.tracks.find((t) => t.roleId === "cross-border-tax")!;
    expect(taxTrack.weight).toBe(98);
    expect(taxTrack.tierLabel).toBe("核心主导");
    const skippedMarket = midTask.tracks.find((t) => t.roleId === "market-analyst")!;
    expect(skippedMarket.status).toBe("skipped");

    // 4. Verify Reusable Library Persistence: Next task automatically retrieves `cross-border-tax` & `skill-shopify-vat-audit` from `~/.vetoboard-mcp/library/roles/`!
    const nextRunPlan = JSON.parse(
      firstText(
        await client.callTool({
          arguments: {
            domain: "commercial",
            goal: "再次评估欧洲独立站 VAT 税务插件",
            lang: "zh",
            workspaceDir: join(tempDir, "workspace"),
          },
          name: "vetoboard_plan_lineup",
        }),
      ),
    );
    expect(nextRunPlan.reusableRolesCount).toBeGreaterThanOrEqual(7); // 5 non-inspector builtins + 2 persisted custom/skill roles!
    expect(nextRunPlan.briefingMarkdown).toContain("已沉淀自定义库 `2` 个");
  });

  it("supports causal-dag topology mode, emits exact [Sx·§y] anchor catalog, exports 3-file workspace bundle, and auto-synthesizes full provenance", async () => {
    // 1. Verify explicit `topologyMode: "causal-dag"` schedules 4-Wave Causal Clash DAG
    const defaultStart = firstText(
      await client.callTool({
        arguments: {
          domain: "commercial",
          effortProfile: "fast",
          executionMode: "host-subscription",
          goal: "审计面向独立开发者的 GitHub PR 每日自动周报小工具（定价 $9/月，预计成本 $2.2，回本 100 户）",
          lang: "zh",
          lineupConfirmed: true,
          topologyMode: "causal-dag",
        },
        name: "vetoboard_start_council",
      }),
    );
    expect(defaultStart).toContain("4 波次因果交锋 DAG");
    const defaultTaskId = /watch\s+(vb_[a-z0-9_]+)/i.exec(defaultStart)![1]!;
    const defaultTask = (await store.getTask(defaultTaskId))!;
    expect(defaultTask.tracks.map((t) => [t.roleId, t.wave, Boolean(t.isTerminal)])).toEqual([
      ["market-analyst", 1, false],
      ["legal-advisor", 2, false],
      ["tech-feasibility", 2, false],
      ["profit-modeler", 3, true],
      ["quality-inspector", 4, false],
    ]);

    // 2. Run full multi-wave Cross-Role Debate + Workspace 3-file export (`-report.md`, `-briefing.md`, `-original-report.md`)
    const wsOutDir = join(tempDir, "testvetoboard-out");
    const startDebate = firstText(
      await client.callTool({
        arguments: {
          confirmedNotes: "开启角色交锋开跑",
          domain: "commercial",
          effortProfile: "deep",
          executionMode: "host-subscription",
          goal: "审计 GitHub PR 自动周报副业方案",
          lang: "zh",
          lineupConfirmed: true,
          roleIds: ["profit-modeler", "legal-advisor"],
          topologyMode: "causal-dag",
          workspaceDir: wsOutDir,
        },
        name: "vetoboard_start_council",
      }),
    );
    expect(startDebate).toContain("交叉质询与角色交锋官");
    const debateTaskId = /watch\s+(vb_[a-z0-9_]+)/i.exec(startDebate)![1]!;

    const task0 = (await store.getTask(debateTaskId))!;
    expect(task0.tracks).toHaveLength(4); // Wave 1: profit -> Wave 2: legal -> Wave 3: cross-examiner -> Wave 4: quality-inspector
    expect(task0.tracks[0]!.wave).toBe(1);
    expect(task0.tracks[1]!.wave).toBe(2);
    expect(task0.tracks[2]!.roleId).toBe("cross-examiner");
    expect(task0.tracks[2]!.wave).toBe(3);
    expect(task0.tracks[2]!.isTerminal).toBe(true);
    expect(task0.tracks[3]!.roleId).toBe("quality-inspector");
    expect(task0.tracks[3]!.wave).toBe(4);

    // Submit Wave 1 (`profit-modeler`) WITHOUT `catchHighlights`
    const sub1 = await client.callTool({
      arguments: {
        invokedTools: ["vetoboard_calc"],
        markdown: [
          "# 单位经济性与精算建模报告",
          "",
          "### 呈批摘要卡",
          "- **核心定论**：表面会计 BEP 实为 114 户而非心算的 100 户；计入创始人机会成本后真实经济 BEP 为 307 户。",
          "",
          "## 1. 盈亏平衡核算明细",
          "经 `vetoboard_calc` 核算单户边际贡献 $6.26。",
        ].join("\n"),
        taskId: debateTaskId,
        trackId: task0.tracks[0]!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    expect(sub1.isError).toBeFalsy();

    // Wave 2 (`legal-advisor`) promoted to `running`!
    expect((await store.getTask(debateTaskId))!.tracks[1]!.status).toBe("running");

    // Submit Wave 2 (`legal-advisor`) WITHOUT `catchHighlights`
    const sub2 = await client.callTool({
      arguments: {
        markdown: [
          "# 合规与法律风控审计报告",
          "",
          "### 呈批摘要卡",
          "- **硬红线排雷**：境内个人直接开海外 Stripe 极易触发 KYC 封号死穴，必须改走 Lemon Squeezy (MoR) 综合抽成 10.56%（条款：https://docs.lemonsqueezy.com/help/getting-started/fees）。",
          "",
          "### 横向交锋与上游回应",
          "- 点名推翻 `[S1]` 沿用的 6% Stripe 抽成假设，强制替换为 MoR 10.56% 合法收款口径。",
        ].join("\n"),
        taskId: debateTaskId,
        trackId: task0.tracks[1]!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    expect(sub2.isError).toBeFalsy();

    // Wave 3 (`cross-examiner`) should now be promoted to `running`, while Wave 4 (`quality-inspector`) stays `pending`!
    const afterWave2 = (await store.getTask(debateTaskId))!;
    expect(afterWave2.tracks[2]!.status).toBe("running");
    expect(afterWave2.tracks[3]!.status).toBe("pending");
    expect(afterWave2.tracks[0]!.catches.length).toBeGreaterThan(0);
    expect(afterWave2.tracks[1]!.catches[0]!.category).toBe("compliance_redline");

    // Submit Wave 3 (`cross-examiner`) — verify response emits the exact `[S1·§1]..[S3·§1]` Citation Anchor Catalog!
    const subDebate = await client.callTool({
      arguments: {
        markdown: [
          "# 跨席位交锋质询与参数强制修正表",
          "",
          "### 呈批摘要卡",
          "- **席位交锋裁定**：合规轨指出的 MoR 10.56% 真实税费直接推翻精算轨 6% 通道费假设，精算轨必须向合规硬红线让步重修边际贡献。",
          "",
          "## 1. 交锋点明细",
          "| 交锋维度 | 精算原假设 | 合规质询挑战 | 强制修正口径 |",
          "| :--- | :--- | :--- | :--- |",
          "| 支付抽成 | 6.00% | MoR 含固定费实为 10.56% | 强制采用 10.56% |",
          "",
          "```json",
          JSON.stringify({ checks: [{ formula: "7200 / 58.5", mode: "reconcile", unitContribution: 58.5 }] }, null, 2),
          "```",
        ].join("\n"),
        taskId: debateTaskId,
        trackId: task0.tracks[2]!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    expect(subDebate.isError).toBeFalsy();
    expect(firstText(subDebate)).toContain("可引用的真实页内锚点清单");
    expect(firstText(subDebate)).toContain("[[S3·§1]](#ref-s3-sec1)");

    // Wave 4 (`quality-inspector`) should now be promoted to `running`!
    const afterWave3 = (await store.getTask(debateTaskId))!;
    expect(afterWave3.tracks[3]!.status).toBe("running");

    // Submit Wave 4 (`quality-inspector`) OMITTING `executiveBriefingMarkdown` AND `catchHighlights`!
    const subInspector = await client.callTool({
      arguments: {
        invokedTools: ["vetoboard_calc"],
        markdown: [
          "# 独立终局算术复算与验收结论",
          "",
          "### 呈批摘要卡",
          "- **终局裁决（NO-GO / 需提价）**：按交锋修正后的 10.56% MoR 抽成独立复算，真实会计 BEP 上升至 123.08 户，建议提价至 $19/月。",
          "",
          "## 1. 对账矩阵",
          "| 指标 | 复算值 | 结果 |",
          "| :--- | :--- | :--- |",
          "| MoR 修正后 BEP | 123.08 户 | PASS |",
        ].join("\n"),
        taskId: debateTaskId,
        trackId: task0.tracks[3]!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    expect(subInspector.isError).toBeFalsy();

    // Verify workspace 3-file bundle (`-report.md`, `-briefing.md`, `-original-report.md`) & VetoBoard provenance sections!
    const wsReport = await readFile(join(wsOutDir, "审计 GitHub PR 自动周报副业方案-report.md"), "utf8");
    const wsBriefing = await readFile(join(wsOutDir, "审计 GitHub PR 自动周报副业方案-briefing.md"), "utf8");
    const wsOriginal = await readFile(join(wsOutDir, "审计 GitHub PR 自动周报副业方案-original-report.md"), "utf8");
    expect(wsBriefing).toContain("阅读与溯源导览");
    expect(wsOriginal).toContain("专员原始执行底稿");
    expect(wsReport).toContain("决策可用度与核验覆盖审计");
    expect(wsReport).toContain("多角色因果交锋与横向回应纪要");
    expect(wsReport).toContain("★ 终局收敛定稿");
    expect(wsReport).toContain("<details>");

    const finalReport = wsReport;
    const briefingSection = finalReport.split("<!-- VETOBOARD_EXECUTIVE_BRIEFING_END -->")[0]!;
    expect(briefingSection).toContain("[[V1]](#ref-v1)");
    expect(briefingSection).toContain("[[S1·§1]](#ref-s1-sec1)");
    expect(briefingSection).toContain("[[S2·§1]](#ref-s2-sec1)");
    expect(briefingSection).toContain("[[S3·§1]](#ref-s3-sec1)");
    expect(briefingSection).toContain("单位经济性与精算建模专员");
    expect(briefingSection).toContain("合规与法律风控护栏官");
    expect(briefingSection).toContain("交叉质询与角色交锋官");
    expect(finalReport).not.toContain("拦截并修正 **0 处潜在偏差**");
  });

  it("runs the Two-Stage Closed Loop (`deliberate-then-parallel`): Serial R1/R2 Clash -> Premise Brake -> 100% Parallel Execution -> Knowledge Base Save -> Phase 2 Auto-Mount", async () => {
    const wsDir = join(tempDir, "phase-loop-ws");

    // === PHASE 1: Launch `deliberate-then-parallel` Council ===
    const startP1 = firstText(
      await client.callTool({
        arguments: {
          domain: "commercial",
          effortProfile: "fast",
          executionMode: "host-subscription",
          goal: "评估 GitHub PR 团队周报 SaaS 定价 $9/月与 Stripe 收款方案",
          lang: "zh",
          lineupConfirmed: true,
          roleIds: ["profit-modeler", "legal-advisor", "tech-feasibility"],
          topologyMode: "deliberate-then-parallel",
          workspaceDir: wsDir,
        },
        name: "vetoboard_start_council",
      }),
    );
    expect(startP1).toContain("串行短交锋锁契约 → 满并发干重活");
    const taskId1 = /watch\s+(vb_[a-z0-9_]+)/i.exec(startP1)![1]!;
    const p1Init = (await store.getTask(taskId1))!;
    // All 3 specialists are Wave 1 (ready for 100% parallel execution!), Inspector is Wave 2
    expect(p1Init.tracks.map((t) => [t.roleId, t.wave])).toEqual([
      ["profit-modeler", 1],
      ["legal-advisor", 1],
      ["tech-feasibility", 1],
      ["quality-inspector", 2],
    ]);
    expect(p1Init.deliberationPhase).toBe("round1");

    // Gate test: attempting Round 2 BEFORE Round 1 is complete MUST be blocked!
    const prematureR2 = await client.callTool({
      arguments: {
        markdown: "抢跑第 2 轮",
        stage: "round2",
        taskId: taskId1,
        trackId: p1Init.tracks[0]!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    expect(prematureR2.isError).toBe(true);
    expect(firstText(prematureR2)).toContain("交锋轮次串行门禁拦截");

    // Submit Round 1 claims across all 3 specialists
    await client.callTool({
      arguments: {
        keyConstraints: ["计入创始人 $12,000/年机会成本后需测算真实 BEP"],
        markdown: "表面会计 BEP 约 96 户，但计入创始人机会成本后 $9/月客单过低。",
        stage: "round1",
        stance: "caution",
        taskId: taskId1,
        trackId: p1Init.tracks[0]!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    await client.callTool({
      arguments: {
        keyConstraints: ["禁个人直连海外 Stripe，须切 MoR 10.56%"],
        markdown: "大陆个人直连 Stripe 存在 KYC 封号与全球 VAT 漏报红线。",
        stage: "round1",
        stance: "challenge",
        taskId: taskId1,
        trackId: p1Init.tracks[1]!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    const r1Last = firstText(
      await client.callTool({
        arguments: {
          keyConstraints: ["Serverless Cron 单户变动成本 $0.35/月，固定杂费 $600/年"],
          markdown: "原 $7,200/年常驻集群过度工程化，Serverless 即可承载。",
          stage: "round1",
          stance: "support",
          taskId: taskId1,
          trackId: p1Init.tracks[2]!.trackId,
        },
        name: "vetoboard_submit_track_output",
      }),
    );
    // Completing Round 1 automatically emits the Round 1 Peer Blackboard!
    expect(r1Last).toContain("全员第 1 轮主张黑板");

    // Submit Round 2 rebuttals (with Legal triggering `altersCorePremise: true` to test the pre-execution brake!)
    await client.callTool({
      arguments: {
        constructiveAlternative: "吸收 MoR 10.56% 与 Serverless $0.35/月重算主表，建议提价至 $19/团队/月",
        markdown: "认可合规与工程修正，按 MoR + Serverless 口径统一精算。",
        replyTo: ["合规与法律风控护栏官", "工程边界与低阻力交付专员"],
        stage: "round2",
        stance: "support",
        taskId: taskId1,
        trackId: p1Init.tracks[0]!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    await client.callTool({
      arguments: {
        altersCorePremise: true,
        constructiveAlternative: "切换 Lemon Squeezy (MoR 10.56%) + 面向小团队 B2B 签约零留存 DPA",
        markdown: "若坚持个人直连 Stripe 收款则一票否决，切换收款主体与 B2B 客群需用户拍板。",
        replyTo: ["单位经济性与精算建模专员"],
        stage: "round2",
        stance: "challenge",
        taskId: taskId1,
        trackId: p1Init.tracks[1]!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    const r2Last = firstText(
      await client.callTool({
        arguments: {
          constructiveAlternative: "锁定 GitHub App Webhook + Serverless Cron ($0.35/户/月, $600/年)",
          markdown: "工程侧配合零数据落盘内存脱敏架构。",
          replyTo: ["合规与法律风控护栏官"],
          stage: "round2",
          stance: "support",
          taskId: taskId1,
          trackId: p1Init.tracks[2]!.trackId,
        },
        name: "vetoboard_submit_track_output",
      }),
    );
    expect(r2Last).toContain("PREMISE_CONFLICT_USER_DECISION_REQUIRED");
    expect((await store.getTask(taskId1))!.status).toBe("paused");

    // User resolves premise conflict in plain chat -> unlocks 100% Parallel Heavy Execution!
    const unlocked = firstText(
      await client.callTool({
        arguments: {
          resolvePremiseConflictChoice: "同意切换 Lemon Squeezy MoR (10.56%) 并转向 $19/月 B2B 小团队",
          taskId: taskId1,
        },
        name: "vetoboard_update_council",
      }),
    );
    expect(unlocked).toContain("路线冲突已拍板放行");
    expect((await store.getTask(taskId1))!.deliberationPhase).toBe("contract_locked");

    // Stage B: Submit all 3 Wave-1 full deliverables in parallel (`stage: "deliverable"` default)
    await Promise.all([
      client.callTool({
        arguments: {
          invokedTools: ["vetoboard_calc"],
          markdown: "# 精算底稿\n### 呈批摘要卡\n- 按冻结契约（$19/月 + MoR 7.63% + Serverless $0.35/月 + 固定 $600/年），真实经济 BEP 降至 62.4 团队。",
          taskId: taskId1,
          trackId: p1Init.tracks[0]!.trackId,
        },
        name: "vetoboard_submit_track_output",
      }),
      client.callTool({
        arguments: {
          invokedTools: ["search_web"],
          markdown: "# 合规底稿\n### 呈批摘要卡\n- 采用 Lemon Squeezy MoR 代扣全球 VAT（https://www.lemonsqueezy.com/pricing），签订 Zero-Data-Retention DPA，ToS 锁死 12 个月责任上限。",
          taskId: taskId1,
          trackId: p1Init.tracks[1]!.trackId,
        },
        name: "vetoboard_submit_track_output",
      }),
      client.callTool({
        arguments: {
          invokedTools: ["search_web"],
          markdown: "# 工程底稿\n### 呈批摘要卡\n- GitHub App 最小只读权限 + Cloudflare Workers Cron（https://developers.cloudflare.com/workers/platform/pricing/），单团队成本 $0.35/月，MVP 45 工时。",
          taskId: taskId1,
          trackId: p1Init.tracks[2]!.trackId,
        },
        name: "vetoboard_submit_track_output",
      }),
    ]);

    // Submit Wave 2 Inspector (`[V1]`) -> signs 3-file bundle, saves Knowledge Card, and exits cleanly!
    const finalP1 = firstText(
      await client.callTool({
        arguments: {
          invokedTools: ["vetoboard_calc"],
          markdown: "# 终验结论\n### 呈批摘要卡\n- `vetoboard_calc` 复算通过：$19/月 B2B 小团队路线真实经济 BEP = 62.4 户，全票放行。",
          taskId: taskId1,
          trackId: p1Init.tracks[3]!.trackId,
        },
        name: "vetoboard_submit_track_output",
      }),
    );
    expect(finalP1).toContain("已自动沉淀入实战知识库");
    expect(finalP1).toContain("回到普通对话");

    const p1Report = await readFile(
      join(wsDir, "评估 GitHub PR 团队周报 SaaS 定价 $9月与 Stripe-report.md"),
      "utf8",
    );
    expect(p1Report).toContain("多角色立项会商纪要（串行交锋锁契约 → 并行干重活）");
    expect(p1Report).toContain("冻结共享参数与边界契约");

    // === PHASE 2: Later in Chat (or New Session), Re-Invoke VetoBoard -> Automatically Retrieves Phase 1 Knowledge Card! ===
    const planP2 = JSON.parse(
      firstText(
        await client.callTool({
          arguments: {
            domain: "commercial",
            goal: "进入阶段 2：基于 GitHub PR 团队周报 $19/月方案设计 30 天冷启动获客与 MVP 排期",
            lang: "zh",
            workspaceDir: wsDir,
          },
          name: "vetoboard_plan_lineup",
        }),
      ),
    );
    expect(planP2.reusableKnowledgeCount).toBe(1);
    expect(planP2.briefingMarkdown).toContain("命中的前序实战知识库");
    expect(planP2.briefingMarkdown).toContain("【实战结论】");

    // Launch Phase 2 -> Verify Phase 1 Knowledge Card is mounted automatically into Phase 2!
    const startP2 = firstText(
      await client.callTool({
        arguments: {
          domain: "commercial",
          effortProfile: "fast",
          executionMode: "host-subscription",
          goal: "进入阶段 2：设计 GitHub PR 团队周报 30 天冷启动获客方案",
          lang: "zh",
          lineupConfirmed: true,
          roleIds: ["market-analyst", "tech-feasibility"],
          workspaceDir: wsDir,
        },
        name: "vetoboard_start_council",
      }),
    );
    expect(startP2).toContain("已挂载的前序实战知识库基线");
    const taskId2 = /watch\s+(vb_[a-z0-9_]+)/i.exec(startP2)![1]!;
    expect((await store.getTask(taskId2))!.mountedKnowledgeIds).toHaveLength(1);

    // Verify natural-language opt-out ("不挂旧知识卡") cleanly isolates a fresh run!
    const startFresh = firstText(
      await client.callTool({
        arguments: {
          confirmedNotes: "不挂旧知识卡开跑",
          domain: "commercial",
          effortProfile: "fast",
          executionMode: "host-subscription",
          goal: "进入阶段 2：全新重算 GitHub PR 工具方案",
          lang: "zh",
          lineupConfirmed: true,
          roleIds: ["market-analyst", "profit-modeler"],
          workspaceDir: wsDir,
        },
        name: "vetoboard_start_council",
      }),
    );
    const freshTaskId = /watch\s+(vb_[a-z0-9_]+)/i.exec(startFresh)![1]!;
    expect((await store.getTask(freshTaskId))!.mountedKnowledgeIds).toHaveLength(0);
  });

  it("runs the default Dynamic Shared Whiteboard + ELECTRE/QMV Mathematical Governance Engine (85v55 Dominated Pass, Sales vs Product Dynamic Consultation + Zero-Delta Early Stop, and Hard Veto)", async () => {
    const wsDirA = join(tempDir, "whiteboard-dom-ws");

    // === SCENARIO A: Market (85) vs Tech (55) -> D = 85/140 = 60.7% >= 60% & C = 75.9% >= 66.7% -> Dominated Pass + Minority Dissent Log ===
    const startA = firstText(
      await client.callTool({
        arguments: {
          domain: "commercial",
          effortProfile: "fast",
          executionMode: "host-subscription",
          goal: "构建 B2B 周报分析器：保留 PDF 矢量报表导出模块与 $29/月定价",
          lang: "zh",
          lineupConfirmed: true,
          roleIds: ["market-analyst", "profit-modeler", "tech-feasibility"],
          weightOverrides: {
            "market-analyst": 85,
            "profit-modeler": 88,
            "tech-feasibility": 55,
          },
          workspaceDir: wsDirA,
        },
        name: "vetoboard_start_council",
      }),
    );
    expect(startA).toContain("VetoBoard 动态共享白板剧本");
    expect(startA).toContain("ELECTRE + QMV 数学裁决引擎");
    const taskIdA = /watch\s+(vb_[a-z0-9_]+)/i.exec(startA)![1]!;
    const taskAInit = (await store.getTask(taskIdA))!;
    expect(taskAInit.topologyMode).toBe("whiteboard-electre");
    const mktTrack = taskAInit.tracks.find((t) => t.roleId === "market-analyst")!;
    const profTrack = taskAInit.tracks.find((t) => t.roleId === "profit-modeler")!;
    const techTrack = taskAInit.tracks.find((t) => t.roleId === "tech-feasibility")!;
    const inspTrack = taskAInit.tracks.find((t) => t.roleId === "quality-inspector")!;

    // Gate check: cannot review board before all specialists post variables!
    const prematureRev = await client.callTool({
      arguments: {
        decision: "approve",
        markdown: "抢先阅板",
        stage: "board_review",
        taskId: taskIdA,
        trackId: mktTrack!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    expect(prematureRev.isError).toBe(true);
    expect(firstText(prematureRev)).toContain("白板门禁拦截");

    // Step 1: 100% Concurrent Whiteboard Prep & Post (`Promise.all`)
    const postResults = await Promise.all([
      client.callTool({
        arguments: {
          invokedTools: ["search_web"],
          markdown: "B2B 采购经理刚需 PDF 高管汇报件（竞品基准 https://linear.app/pricing），砍掉将流失 40% 付费转化。",
          stage: "board_post",
          taskId: taskIdA,
          trackId: mktTrack!.trackId,
          variables: { coreFeature: "PDF矢量导出", targetPrice: "$29/月" },
        },
        name: "vetoboard_submit_track_output",
      }),
      client.callTool({
        arguments: {
          markdown: "$29/月毛利率高达 89%，吸收无头渲染成本后 BEP 仅需 38 团队。",
          stage: "board_post",
          taskId: taskIdA,
          trackId: profTrack!.trackId,
          variables: { bepTeams: "38户", unitRenderCost: "$0.45/月" },
        },
        name: "vetoboard_submit_track_output",
      }),
      client.callTool({
        arguments: {
          invokedTools: ["search_web"],
          markdown: "基础 Webhook 数据管线 30 工时可交付（Cloudflare Browser Rendering https://developers.cloudflare.com/browser-rendering/），PDF 排版增加额外维护负担。",
          stage: "board_post",
          taskId: taskIdA,
          trackId: techTrack!.trackId,
          variables: { baseEffort: "30h", pdfExtraEffort: "+14h" },
        },
        name: "vetoboard_submit_track_output",
      }),
    ]);
    const combinedPostOut = postResults.map((r) => firstText(r)).join("\n");
    expect(combinedPostOut).toContain("公开白板全员备课指标已上墙");
    expect(combinedPostOut).toContain("PDF矢量导出");

    // Step 2: Whiteboard Review -> Market (85) & Profit (88) approve; Tech (55) opposes Market (`85 / (85+55) = 60.7% >= 60%`)!
    await client.callTool({
      arguments: {
        decision: "approve",
        markdown: "精算已覆盖渲染成本，完全赞同。",
        stage: "board_review",
        taskId: taskIdA,
        trackId: mktTrack!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    await client.callTool({
      arguments: {
        decision: "approve",
        markdown: "+14h 工程投入可在首月收回，吸收通过。",
        stage: "board_review",
        taskId: taskIdA,
        trackId: profTrack!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    const reviewAOut = firstText(
      await client.callTool({
        arguments: {
          decision: "oppose",
          markdown: "倾向首期砍掉 PDF 矢量导出，仅做纯文本 Markdown 推送以降低前端复杂度。",
          stage: "board_review",
          targetTrackIds: [mktTrack!.trackId],
          taskId: taskIdA,
          trackId: techTrack!.trackId,
        },
        name: "vetoboard_submit_track_output",
      }),
    );
    expect(reviewAOut).toContain("白板加权支配裁决放行");
    expect(reviewAOut).toContain("D = 60.7%");
    expect(reviewAOut).toContain("C = 75.9%");
    expect(reviewAOut).toContain("少数派保留意见与风险备忘");

    const lockedA = (await store.getTask(taskIdA))!;
    expect(lockedA.deliberationPhase).toBe("contract_locked");
    expect(lockedA.minorityReportMarkdown).toContain("工程边界与低阻力交付专员");

    // Step 3: 100% Parallel Finalize + [V1] Inspector -> Verify Whiteboard Ledger & Minority Report in exported `-report.md`!
    await Promise.all([
      client.callTool({
        arguments: {
          invokedTools: ["search_web"],
          markdown: "# 市场底稿\n### 呈批摘要卡\n- 锁定 $29/月含 PDF 高管简报（对标 https://linear.app/pricing 与 https://swarmia.com/pricing/）。",
          taskId: taskIdA,
          trackId: mktTrack!.trackId,
        },
        name: "vetoboard_submit_track_output",
      }),
      client.callTool({
        arguments: {
          invokedTools: ["vetoboard_calc"],
          markdown: "# 精算底稿\n### 呈批摘要卡\n- 含 $0.45/月渲染成本，BEP = 38 户。",
          taskId: taskIdA,
          trackId: profTrack!.trackId,
        },
        name: "vetoboard_submit_track_output",
      }),
      client.callTool({
        arguments: {
          invokedTools: ["search_web"],
          markdown: "# 工程底稿\n### 呈批摘要卡\n- 按白板锁死契约排期 44h，采用异步队列隔离 PDF 渲染超时风险（https://developers.cloudflare.com/queues/）。",
          taskId: taskIdA,
          trackId: techTrack!.trackId,
        },
        name: "vetoboard_submit_track_output",
      }),
    ]);
    await client.callTool({
      arguments: {
        invokedTools: ["vetoboard_calc"],
        markdown: "# 终验底稿\n### 呈批摘要卡\n- 核验通过，加权支配放行有效。",
        taskId: taskIdA,
        trackId: inspTrack!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });

    const filesA = await readdir(wsDirA);
    expect(filesA).toHaveLength(3);
    const reportNameA = filesA.find(
      (f) => f.endsWith("-report.md") && !f.endsWith("-original-report.md"),
    )!;
    const reportA = await readFile(join(wsDirA, reportNameA), "utf8");
    expect(reportA).toContain("公开白板指标台账与 ELECTRE/QMV 数学裁决留痕");
    expect(reportA).toContain("少数派保留意见与风险备忘");
    expect(reportA).toContain("D = 60.7%");

    // === SCENARIO B: Sales (82) vs Product Design (80) Deadlock (`D = 49.4% < 60%`) -> Dynamic Routing to Market & Cost (Legal sleeps!) -> Belief-Delta=0 Early Stop ===
    const startB = firstText(
      await client.callTool({
        arguments: {
          customRoles: [
            {
              charter: "负责大客户签约诉求与商务渠道推进",
              priorityTier: "guardrail",
              roleId: "sales-rep",
              title: "销售代表",
              weight: 82,
            },
            {
              charter: "负责产品交互体验与功能范围管控",
              priorityTier: "guardrail",
              roleId: "product-designer",
              title: "产品设计负责人",
              weight: 80,
            },
          ],
          domain: "commercial",
          effortProfile: "fast",
          executionMode: "host-subscription",
          goal: "新产品立项：是否首期内置高定实时 3D 数据大屏",
          lang: "zh",
          lineupConfirmed: true,
          roleIds: ["market-analyst", "profit-modeler", "legal-advisor"],
          weightOverrides: {
            "legal-advisor": 85,
            "market-analyst": 85,
            "profit-modeler": 88,
          },
        },
        name: "vetoboard_start_council",
      }),
    );
    const taskIdB = /watch\s+(vb_[a-z0-9_]+)/i.exec(startB)![1]!;
    const taskBInit = (await store.getTask(taskIdB))!;
    const specTracksB = taskBInit.tracks.filter((t) => t.roleId !== "quality-inspector");
    const prodTrackB = specTracksB.find((t) => t.roleId === "product-designer")!;
    const salesTrackB = specTracksB.find((t) => t.roleId === "sales-rep")!;

    await Promise.all(
      specTracksB.map((tr) =>
        client.callTool({
          arguments: {
            invokedTools: ["search_web"],
            markdown: `${tr.roleLabel} 首轮备课指标已就绪（实证基准 https://echarts.apache.org/zh/index.html）`,
            stage: "board_post",
            taskId: taskIdB,
            trackId: tr.trackId,
            variables:
              tr.roleId === "product-designer"
                ? { mvpBudgetCap: "$15,000", screenScope: "标准2D看板" }
                : tr.roleId === "sales-rep"
                  ? { requestedFeature: "高定实时3D大屏" }
                  : { status: "ready" },
          },
          name: "vetoboard_submit_track_output",
        }),
      ),
    );

    // All non-sales tracks approve; Sales (82) opposes Product (80) requesting `market` & `cost` arbitration!
    for (const tr of specTracksB.filter((t) => t.roleId !== "sales-rep")) {
      await client.callTool({
        arguments: {
          decision: "approve",
          markdown: "本席位初审无异议。",
          stage: "board_review",
          taskId: taskIdB,
          trackId: tr.trackId,
        },
        name: "vetoboard_submit_track_output",
      });
    }
    const r1ConsultOut = firstText(
      await client.callTool({
        arguments: {
          decision: "oppose",
          markdown: "销售侧要求首期必须上高定 3D 大屏否则难签单，产品设计卡死 $15,000 预算上限，双方无法达成一致，需评估真实市场买单溢价与成本回本账！",
          neededDimensions: ["market", "cost"],
          stage: "board_review",
          targetTrackIds: [prodTrackB.trackId],
          taskId: taskIdB,
          trackId: salesTrackB.trackId,
        },
        name: "vetoboard_submit_track_output",
      }),
    );
    expect(r1ConsultOut).toContain("动态维度拉人精准协商（第 1/2 轮）");
    expect(r1ConsultOut).toContain("D = 49.4%");
    // Dynamically wakes Market & Cost/Profit, while Legal bystander stays completely unmentioned in consult list!
    const consultSection = r1ConsultOut.split("### 🎯 动态寻址匹配结果")[1]!;
    expect(consultSection).toContain("多路线市场与重置天花板专员");
    expect(consultSection).toContain("单位经济性与精算建模专员");
    expect(consultSection).not.toContain("合规与法律风控护栏官");

    // Round 2: Sales repeats `oppose` without any board revision -> triggers `Belief-Delta = 0` Anti-Debate-Collapse Early Stop!
    const r2EarlyStopOut = firstText(
      await client.callTool({
        arguments: {
          decision: "oppose",
          markdown: "销售仍坚持首期必须包含 3D 大屏，拒绝让步。",
          neededDimensions: ["market", "cost"],
          stage: "board_review",
          targetTrackIds: [prodTrackB.trackId],
          taskId: taskIdB,
          trackId: salesTrackB.trackId,
        },
        name: "vetoboard_submit_track_output",
      }),
    );
    expect(r2EarlyStopOut).toContain("PREMISE_CONFLICT_USER_DECISION_REQUIRED");
    expect(r2EarlyStopOut).toContain("Belief-Delta = 0");
    expect((await store.getTask(taskIdB))!.status).toBe("paused");

    // === SCENARIO C: ELECTRE Non-Compensatory Hard Veto blocks blind majority (`95 vs 55` = 63.3% >= 60%, yet blocked!) ===
    const startC = firstText(
      await client.callTool({
        arguments: {
          domain: "commercial",
          effortProfile: "fast",
          executionMode: "host-subscription",
          goal: "测试 ELECTRE 非补偿性硬否决门禁",
          lang: "zh",
          lineupConfirmed: true,
          roleIds: ["market-analyst", "profit-modeler", "legal-advisor"],
          weightOverrides: {
            "legal-advisor": 55,
            "market-analyst": 95,
            "profit-modeler": 90,
          },
        },
        name: "vetoboard_start_council",
      }),
    );
    const taskIdC = /watch\s+(vb_[a-z0-9_]+)/i.exec(startC)![1]!;
    const tracksC = (await store.getTask(taskIdC))!.tracks.filter(
      (t) => t.roleId !== "quality-inspector",
    );
    const mktC = tracksC.find((t) => t.roleId === "market-analyst")!;
    const profC = tracksC.find((t) => t.roleId === "profit-modeler")!;
    const legalC = tracksC.find((t) => t.roleId === "legal-advisor")!;
    await Promise.all(
      tracksC.map((tr) =>
        client.callTool({
          arguments: {
            invokedTools: ["search_web"],
            markdown: `${tr.roleLabel} 上板测试指标（实证 https://stripe.com/pricing）`,
            stage: "board_post",
            taskId: taskIdC,
            trackId: tr.trackId,
            variables: { check: "ok" },
          },
          name: "vetoboard_submit_track_output",
        }),
      ),
    );
    await client.callTool({
      arguments: {
        decision: "approve",
        markdown: "赞同",
        stage: "board_review",
        taskId: taskIdC,
        trackId: mktC.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    await client.callTool({
      arguments: {
        decision: "approve",
        markdown: "赞同",
        stage: "board_review",
        taskId: taskIdC,
        trackId: profC.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    const vetoOut = firstText(
      await client.callTool({
        arguments: {
          decision: "oppose",
          hardVetoEvidence: "vetoboard_calc 实测单笔净毛利为负毛利 -$2.30，卖一单亏一单",
          markdown: "存在非补偿性负毛利死穴，不可靠高权重强行放过！",
          stage: "board_review",
          targetTrackIds: [mktC.trackId],
          taskId: taskIdC,
          trackId: legalC.trackId,
        },
        name: "vetoboard_submit_track_output",
      }),
    );
    expect(vetoOut).not.toContain("白板加权支配裁决放行");
    expect(vetoOut).toContain("触发非补偿性客观死穴锁");
  });

  it("supports per-role heterogeneous modelBinding, standardized SKILL.md + Role distillation (vetoboard_distill_skill), and Method A consent-gated contribution with 1-click withdrawal (vetoboard_contribute_asset)", async () => {
    // Spin up a lightweight local mock OpenAI-compatible server to verify per-role BYOK `modelBinding` inheritance
    let capturedModelInHttp = "";
    const mockServer = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += String(chunk);
      });
      req.on("end", () => {
        const body = JSON.parse(raw) as { model?: string };
        capturedModelInHttp = body.model ?? "";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: "独立异构模型复核通过：BEP 公式与边界一致。" } }],
            model: body.model ?? "deepseek-reasoner",
          }),
        );
      });
    });
    await new Promise<void>((r) => mockServer.listen(0, "127.0.0.1", r));
    const port = (mockServer.address() as AddressInfo).port;
    const mockApiBaseUrl = `http://127.0.0.1:${port}/v1`;

    try {
      // === 1. Per-Role Heterogeneous Model Binding (`confirmedNotes` NL + `modelOverrides` BYOK) ===
      const startM = firstText(
        await client.callTool({
          arguments: {
            confirmedNotes: "精算用 pro，工程用 flash",
            domain: "commercial",
            effortProfile: "fast",
            executionMode: "host-subscription",
            goal: "SaaS 跨境收款与真实经济 BEP 模型核验",
            lang: "zh",
            lineupConfirmed: true,
            modelOverrides: {
              "quality-inspector": {
                apiBaseUrl: mockApiBaseUrl,
                kind: "byok",
                modelId: "deepseek-reasoner",
                providerId: "deepseek",
                reasoningLevel: "high",
              },
            },
            roleIds: ["profit-modeler", "tech-feasibility"],
          },
          name: "vetoboard_start_council",
        }),
      );
      expect(startM).toContain("[model: pro]");
      expect(startM).toContain("[model: flash]");
      expect(startM).toContain("[model: deepseek/deepseek-reasoner(high)]");
      expect(startM).toContain('invoke_subagent Model="pro"');
      expect(startM).toContain('invoke_subagent Model="flash"');

      const taskIdM = /watch\s+(vb_[a-z0-9_]+)/i.exec(startM)![1]!;

      // Verify `vetoboard_audit_output` automatically inherits `quality-inspector`'s independent BYOK `modelBinding`!
      const auditRes = JSON.parse(
        firstText(
          await client.callTool({
            arguments: {
              apiKey: "test-local-key",
              goal: "SaaS 跨境收款与真实经济 BEP 模型核验",
              invokedTools: ["vetoboard_calc"],
              outputText: "经 vetoboard_calc 独立复算，真实经济 BEP = 62.4 户。",
              roleId: "quality-inspector",
              taskId: taskIdM,
            },
            name: "vetoboard_audit_output",
          }),
        ),
      );
      expect(auditRes.passed).toBe(true);
      expect(capturedModelInHttp).toBe("deepseek-reasoner");
      expect(auditRes.externalCritique.model).toBe("deepseek-reasoner");

      // Mid-flight re-binding via `vetoboard_update_council`
      const midUpdate = firstText(
        await client.callTool({
          arguments: {
            modelOverrides: { "tech-feasibility": "pro" },
            taskId: taskIdM,
          },
          name: "vetoboard_update_council",
        }),
      );
      expect(midUpdate).not.toContain("[model: flash]");

      // === 2. Standardized Skill & Reusable Role Distillation (`vetoboard_distill_skill`) ===
      // Post a whiteboard variable on taskIdM first, then distill into a standardized `SKILL.md` + `Role`!
      const taskM = (await store.getTask(taskIdM))!;
      await client.callTool({
        arguments: {
          markdown: "必须计入 MoR 10.56% 综合费率与创始人机会成本。",
          stage: "board_post",
          taskId: taskIdM,
          trackId: taskM.tracks[0]!.trackId,
          variables: { morFeePct: "10.56%", targetPrice: "$19/月" },
        },
        name: "vetoboard_submit_track_output",
      });

      const distillOut = firstText(
        await client.callTool({
          arguments: {
            alsoCreateRole: true,
            pitfalls: [
              "严禁泄漏本地调试目录 C:\\Users\\alice\\secret_workspace\\config.json",
              "严禁硬编码密钥 sk-proj-1234567890abcdefghijklmnop 或私有邮箱 ceo@secret-startup.io",
            ],
            skillId: "saas-mor-bep-audit",
            taskId: taskIdM,
            title: "跨境 SaaS MoR 税费与真实 BEP 精算核验",
          },
          name: "vetoboard_distill_skill",
        }),
      );
      expect(distillOut).toContain("标准化技能提炼完成（`saas-mor-bep-audit`）");
      expect(distillOut).toContain("skill-saas-mor-bep-audit");

      // Verify `vetoboard_plan_lineup` immediately discovers the distilled standardized `SKILL.md` and companion Role!
      const planCheck = JSON.parse(
        firstText(
          await client.callTool({
            arguments: {
              domain: "commercial",
              goal: "核验跨境 SaaS MoR 税费与真实 BEP",
              lang: "zh",
            },
            name: "vetoboard_plan_lineup",
          }),
        ),
      );
      expect(
        planCheck.discoveredNativeSkills.some(
          (s: { skillId: string }) => s.skillId === "saas-mor-bep-audit",
        ),
      ).toBe(true);

      // === 3. Method A Asset Contribution + Mandatory Transparency Consent Gate + Privacy Scrub + 1-Click Withdrawal ===
      // 3a. Calling `submit` WITHOUT `confirmedConsent: true` MUST block silent upload & show the 3-point transparency notice + scrubbed payload!
      const unconsentedOut = firstText(
        await client.callTool({
          arguments: {
            action: "submit",
            assetId: "saas-mor-bep-audit",
            assetType: "skill",
            confirmedConsent: false,
            lang: "zh",
          },
          name: "vetoboard_contribute_asset",
        }),
      );
      expect(unconsentedOut).toContain("CONTRIBUTION_CONSENT_REQUIRED");
      expect(unconsentedOut).toContain("将被收录进 VetoBoard 资产库");
      expect(unconsentedOut).toContain("仅用于 VetoBoard 项目的升级、规则校准或体验优化");
      expect(unconsentedOut).toContain("100% 随时可撤回");
      // Verify local path, secret key, and private email were all scrubbed automatically!
      expect(unconsentedOut).not.toContain("C:\\Users\\alice");
      expect(unconsentedOut).not.toContain("sk-proj-1234567890");
      expect(unconsentedOut).not.toContain("ceo@secret-startup.io");
      expect(unconsentedOut).toContain("[REDACTED_LOCAL_PATH]");
      expect(unconsentedOut).toContain("[REDACTED_SECRET]");
      expect(unconsentedOut).toContain("[REDACTED_EMAIL]");

      // 3b. Calling `submit` WITH `confirmedConsent: true` creates Method A GitHub Issue URL + local withdrawable receipt!
      const submitOut = firstText(
        await client.callTool({
          arguments: {
            action: "submit",
            assetId: "saas-mor-bep-audit",
            assetType: "skill",
            authorHandle: "@founder-dev",
            confirmedConsent: true,
            lang: "zh",
            targetRepo: "vetoboard-mcp/community-assets",
          },
          name: "vetoboard_contribute_asset",
        }),
      );
      expect(submitOut).toContain("方法 A 标准化资产投递包已就绪");
      expect(submitOut).toContain("https://github.com/vetoboard-mcp/community-assets/issues/new?");
      const subIdMatch = /凭证号：`(sub_[a-z0-9_-]+)`/i.exec(submitOut);
      expect(subIdMatch).not.toBeNull();
      const submissionId = subIdMatch![1]!;

      // Verify bundle on disk contains zero secrets!
      const bundleMd = await readFile(
        join(store.rootDir, "contributions", `${submissionId}-bundle.md`),
        "utf8",
      );
      expect(bundleMd).toContain("project_upgrade_and_optimization_only");
      expect(bundleMd).not.toContain("sk-proj-1234567890");
      expect(bundleMd).not.toContain("C:\\Users\\alice");

      // 3c. List local contributions ledger
      const listOut = firstText(
        await client.callTool({
          arguments: { action: "list", lang: "zh" },
          name: "vetoboard_contribute_asset",
        }),
      );
      expect(listOut).toContain(submissionId);
      expect(listOut).toContain("已投递（可随时调 withdraw 撤回）");

      // 3d. Exercise 1-Click Unconditional Withdrawal (`action: "withdraw"`)!
      const withdrawOut = firstText(
        await client.callTool({
          arguments: {
            action: "withdraw",
            lang: "zh",
            reason: "内部业务调整，撤回该技能共享",
            submissionId,
          },
          name: "vetoboard_contribute_asset",
        }),
      );
      expect(withdrawOut).toContain("资产撤回登记已完成");
      expect(withdrawOut).toContain("status` → `withdrawn`".replace("status` → `", ""));
      expect(withdrawOut).toContain("https://github.com/vetoboard-mcp/community-assets/issues/new?");
      expect(withdrawOut).toContain("asset-withdrawal");

      const receiptJson = JSON.parse(
        await readFile(join(store.rootDir, "contributions", `${submissionId}.json`), "utf8"),
      );
      expect(receiptJson.status).toBe("withdrawn");
      expect(receiptJson.withdrawReason).toBe("内部业务调整，撤回该技能共享");
    } finally {
      await new Promise<void>((r) => mockServer.close(() => r()));
    }
  });

  it("enforces Universal Web-Grounding Hard Gate across Commercial & SWE, Effort-Scaling Search Quotas, Honest Readiness Downgrade, and Cross-Platform hostModels Picker", async () => {
    // === 1. Cross-Platform `hostModels` Pre-Flight Model Picker + Cross-Vendor Inspector Auto-Pairing ===
    const planWithModels = JSON.parse(
      firstText(
        await client.callTool({
          arguments: {
            domain: "commercial",
            goal: "评估实验室通用小设备第三方维修获客与单人产能上限",
            hostModels: [
              {
                family: "claude",
                id: "claude-opus-4-6-thinking",
                label: "Claude Opus 4.6 (Thinking)",
                quotaRemaining: "100%",
                tier: "frontier",
              },
              {
                family: "gemini",
                id: "gemini-4-hydrogen-medium",
                label: "Gemini 4 Hydrogen (Medium)",
                quotaRemaining: "79%",
                tier: "balanced",
              },
              {
                family: "gemini",
                id: "gemini-3.8-flash-high",
                label: "Gemini 3.8 Flash (High)",
                quotaRemaining: "79%",
                tier: "fast",
              },
              {
                family: "openai",
                id: "gpt-oss-120b-medium",
                label: "GPT-OSS 120B (Medium)",
                quotaRemaining: "100%",
                tier: "balanced",
              },
            ],
            hostPlatform: "antigravity",
            lang: "zh",
          },
          name: "vetoboard_plan_lineup",
        }),
      ),
    );
    expect(planWithModels.briefingMarkdown).toContain("推荐运行模型（可改）");
    expect(planWithModels.briefingMarkdown).toContain("Claude Opus 4.6 (Thinking) · 100%");
    expect(planWithModels.briefingMarkdown).toContain("当前平台可选模型池 (antigravity)");

    // Verify Primary Lead gets Claude Opus (`frontier`) while `quality-inspector` gets a DIFFERENT family (`gemini` or `openai`)!
    const leadRec = planWithModels.recommendedLineup[0];
    const inspectorRec = planWithModels.recommendedLineup.find(
      (x: { roleId: string }) => x.roleId === "quality-inspector",
    );
    expect(leadRec.recommendedModelId).toBe("claude-opus-4-6-thinking");
    expect(inspectorRec.recommendedModelId).not.toContain("claude");

    // === 2. Universal Web-Grounding Hard Gate on SWE Domain (`board_post` AND `deliverable`) + Effort-Scaling Quota ===
    const startSwe = firstText(
      await client.callTool({
        arguments: {
          domain: "swe",
          effortProfile: "fast",
          executionMode: "host-subscription",
          goal: "构建高并发多租户事件总线并评估云成本",
          lang: "zh",
          lineupConfirmed: true,
        },
        name: "vetoboard_start_council",
      }),
    );
    // Verify Effort-Scaling Search Quota & 20/60/20 stop-loss directive are injected into role charters!
    expect(startSwe).toContain("20 / 60 / 20 漏斗止损铁律");
    expect(startSwe).toContain("联网搜索/抓取总次数上限");
    expect(startSwe).toContain("严禁使用无网络权限的只读沙箱");

    const sweTaskId = /watch\s+(vb_[a-z0-9_]+)/i.exec(startSwe)![1]!;
    const sweTask = (await store.getTask(sweTaskId))!;
    const archTrack = sweTask.tracks.find((t) => t.roleId === "software-architect")!;

    // Attempting `board_post` on SWE WITHOUT `search_web` or `https://` URL MUST be blocked!
    const ungroundedPost = await client.callTool({
      arguments: {
        markdown: "凭记忆拍脑袋选用某旧版队列方案，未做任何联网核实。",
        stage: "board_post",
        taskId: sweTaskId,
        trackId: archTrack.trackId,
        variables: { queue: "guessed-v1" },
      },
      name: "vetoboard_submit_track_output",
    });
    expect(ungroundedPost.isError).toBe(true);
    expect(firstText(ungroundedPost)).toContain("白板前置联网实证硬门禁拦截");
    expect(firstText(ungroundedPost)).toContain("≤ 5 次查询上限");

    // Attempting `deliverable` on SWE WITHOUT `search_web` or `https://` URL MUST ALSO be blocked by `evaluateRuleGate`!
    const ungroundedDeliv = await client.callTool({
      arguments: {
        markdown: "# 架构方案\n### 呈批摘要卡\n- 未调用联网搜索也未附任何外部官方文档链接。",
        stage: "deliverable",
        taskId: sweTaskId,
        trackId: archTrack.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    expect(ungroundedDeliv.isError).toBe(true);
    expect(firstText(ungroundedDeliv)).toContain("未执行联网实证检索");

    // === 3. Honest 4-Tier Decision Readiness Downgrade (0 External URLs -> NEVER stamped `Verified`!) ===
    const offlineWs = join(tempDir, "offline-downgrade-ws");
    const startOffline = firstText(
      await client.callTool({
        arguments: {
          allowOfflineAssumptions: true,
          domain: "commercial",
          effortProfile: "fast",
          executionMode: "host-subscription",
          goal: "离线纯推演：无外网链接时检验评级诚实降级",
          lang: "zh",
          lineupConfirmed: true,
          roleIds: ["profit-modeler"],
          topologyMode: "flat",
          workspaceDir: offlineWs,
        },
        name: "vetoboard_start_council",
      }),
    );
    const offlineTaskId = /watch\s+(vb_[a-z0-9_]+)/i.exec(startOffline)![1]!;
    const offlineTask = (await store.getTask(offlineTaskId))!;
    await client.callTool({
      arguments: {
        invokedTools: ["vetoboard_calc"],
        markdown: "# 精算推演\n### 呈批摘要卡\n- 纯假设参数测算 BEP = 42 单/月（0 条外部 URL）。",
        taskId: offlineTaskId,
        trackId: offlineTask.tracks[0]!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    await client.callTool({
      arguments: {
        invokedTools: ["vetoboard_calc"],
        markdown: "# 督察复算\n### 呈批摘要卡\n- 公式代数自洽，但缺外部联网信源。",
        taskId: offlineTaskId,
        trackId: offlineTask.tracks[1]!.trackId,
      },
      name: "vetoboard_submit_track_output",
    });
    const offlineFiles = await readdir(offlineWs);
    const offlineReportName = offlineFiles.find(
      (f) => f.endsWith("-report.md") && !f.endsWith("-original-report.md"),
    )!;
    const offlineReport = await readFile(join(offlineWs, offlineReportName), "utf8");
    expect(offlineReport).toContain("模型推算（Model-Derived");
    expect(offlineReport).not.toContain("已验证（Verified");
  });

  it("emits post-task asset menu + 24h update banner, distills multi-target assets (skill/role/rule/project-pack + IDE sync), previews pack contribution, and guards self-update against dirty git trees", async () => {
    // 1. Spin up a local mock npm registry endpoint returning v9.9.0
    const mockRegistry = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          description: "Multi-target asset distillation & faster whiteboard",
          name: "vetoboard-mcp",
          version: "9.9.0",
        }),
      );
    });
    await new Promise<void>((r) => mockRegistry.listen(0, "127.0.0.1", r));
    const mockPort = (mockRegistry.address() as AddressInfo).port;
    const mockUrl = `http://127.0.0.1:${mockPort}/vetoboard-mcp/latest`;
    const prevEnvUrl = process.env.VETOBOARD_UPDATE_REGISTRY_URL;
    process.env.VETOBOARD_UPDATE_REGISTRY_URL = mockUrl;

    try {
      const wsDir = join(tempDir, "post-task-flywheel-ws");
      const startOut = firstText(
        await client.callTool({
          arguments: {
            domain: "commercial",
            effortProfile: "fast",
            executionMode: "host-subscription",
            goal: "实验室故障设备环保回收与开源维修公益促销方案",
            lang: "zh",
            lineupConfirmed: true,
            modelOverrides: { "profit-modeler": "claude-opus-4-6-thinking" },
            roleIds: ["profit-modeler"],
            topologyMode: "flat",
            workspaceDir: wsDir,
          },
          name: "vetoboard_start_council",
        }),
      );
      const taskId = /watch\s+(vb_[a-z0-9_]+)/i.exec(startOut)![1]!;
      const task = (await store.getTask(taskId))!;

      // Simulate a MCP-less Swarm worker: run deterministic CLI `calc` + drop deliverable Markdown on disk for Coordinator `markdownFilePath` zero-copy submission!
      const cliEntry = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
      const { stdout: cliCalcStdout } = await execFileAsync(process.execPath, [
        cliEntry,
        "calc",
        JSON.stringify({
          fixedCostAnnual: 36_000,
          mode: "unit_economics",
          unitCogs: 120,
          unitPrice: 450,
          variableRatePct: 10,
        }),
        `--task-id=${taskId}`,
        `--data-dir=${tempDir}`,
      ]);
      expect(JSON.parse(cliCalcStdout).ok).toBe(true);

      const workerDropDir = join(wsDir, ".vetoboard-tmp", taskId);
      await mkdir(workerDropDir, { recursive: true });
      const workerMdFile = join(workerDropDir, `${task.tracks[0]!.trackId}.md`);
      await writeFile(
        workerMdFile,
        "# 单位经济与三档维修定价核验\n### 呈批摘要卡\n- 低端水浴锅重置价 480 元（免修转拆件），中端移液器重置价 1800 元（维修客单 450 元），高端真空泵重置价 9800 元（维修客单 2200 元），综合盈亏平衡点 BEP = 18 单/月，见 https://example.org/lab-equip-2026 。",
        "utf8",
      );

      await client.callTool({
        arguments: {
          invokedTools: ["search_web", "vetoboard_calc"],
          markdownFilePath: workerMdFile,
          taskId,
          trackId: task.tracks[0]!.trackId,
        },
        name: "vetoboard_submit_track_output",
      });

      const finalOut = firstText(
        await client.callTool({
          arguments: {
            invokedTools: ["vetoboard_calc"],
            markdown:
              "# 终局督察复算\n### 呈批摘要卡\n- 三档损益与单人物理产能利用率（68%）复算通过，见 https://example.org/audit-bench 。",
            taskId,
            trackId: task.tracks[1]!.trackId,
          },
          name: "vetoboard_submit_track_output",
        }),
      );

      // Verify `.vetoboard-tmp/<taskId>` was auto-cleaned after final report export
      await expect(readdir(workerDropDir)).rejects.toThrow();

      // Verify Post-Task Asset Export & Community Contribution Menu + 24h Update Banner
      expect(finalOut).toContain("🎁 实战资产沉淀与社区共享菜单");
      expect(finalOut).toContain("「存为技能」 / 「存为角色」 / 「存为全局规则」 / 「存为项目模板」");
      expect(finalOut).toContain("「预览推送」");
      expect(finalOut).toContain("发现新版本 `v9.9.0`");
      expect(finalOut).toContain("「更新 VetoBoard」");

      // Verify 24h cache file was persisted
      const cacheJson = JSON.parse(await readFile(join(tempDir, "update-check.json"), "utf8"));
      expect(cacheJson.latestVersion).toBe("9.9.0");

      // 2. Multi-Target Distillation (`skill` + `role` + `rule` + `project-pack` + `syncToHostIde`)
      const fakeIdeHome = join(tempDir, "fake-ide-home");
      await mkdir(join(fakeIdeHome, ".gemini", "config"), { recursive: true });
      await mkdir(join(fakeIdeHome, ".claude"), { recursive: true });

      const distillMultiOut = firstText(
        await client.callTool({
          arguments: {
            exportTargets: ["skill", "role", "rule", "project-pack"],
            hostIdeRootOverride: fakeIdeHome,
            pitfalls: [
              "低端仪器新品 <500 元时拆检人工倒挂，必须引导转入环保拆件抵扣池（测试本地路径脱敏 C:\\Users\\bob\\private_lab\\notes.md）",
            ],
            scope: "user",
            skillId: "lab-repair-triage-sop",
            syncToHostIde: true,
            taskId,
            title: "实验室老旧仪器分档维修与环保拆件精算模板",
          },
          name: "vetoboard_distill_skill",
        }),
      );

      expect(distillMultiOut).toContain("标准化技能提炼完成（`lab-repair-triage-sop`）");
      expect(distillMultiOut).toContain(".vetoboard-pack.json");

      // Verify synced IDE skill files, guardrail rule, role agent, and project pack JSON on disk
      const geminiSkill = await readFile(
        join(fakeIdeHome, ".gemini", "config", "skills", "lab-repair-triage-sop", "SKILL.md"),
        "utf8",
      );
      const claudeSkill = await readFile(
        join(fakeIdeHome, ".claude", "skills", "lab-repair-triage-sop", "SKILL.md"),
        "utf8",
      );
      expect(geminiSkill).toContain("name: lab-repair-triage-sop");
      expect(claudeSkill).toContain("name: lab-repair-triage-sop");

      const ruleMd = await readFile(
        join(tempDir, "library", "rules", "lab-repair-triage-sop.md"),
        "utf8",
      );
      expect(ruleMd).toContain("<!-- vetoboard-rule:lab-repair-triage-sop:begin -->");

      const packJson = JSON.parse(
        await readFile(join(tempDir, "packs", "lab-repair-triage-sop.vetoboard-pack.json"), "utf8"),
      );
      expect(packJson.packId).toBe("pack-lab-repair-triage-sop");
      expect(
        packJson.roles.some(
          (r: { roleId: string; modelBinding?: { modelId?: string } }) =>
            r.roleId === "profit-modeler" && r.modelBinding?.modelId === "claude-opus-4-6-thinking",
        ),
      ).toBe(true);

      // 3. Preview Method A contribution for `assetType: "pack"` (privacy-scrubbed + 3-point guarantee)
      const packPreview = firstText(
        await client.callTool({
          arguments: {
            action: "preview",
            assetId: "pack-lab-repair-triage-sop",
            assetType: "pack",
            lang: "zh",
          },
          name: "vetoboard_contribute_asset",
        }),
      );
      expect(packPreview).toContain("标准化项目模板包推送前脱敏预览单");
      expect(packPreview).toContain("仅用于 VetoBoard 项目的升级、规则校准或体验优化");
      expect(packPreview).toContain("100% 随时可撤回");
      expect(packPreview).toContain("已自动扫描并剥离 **2** 处敏感路径/凭据/邮箱");
      expect(packPreview).not.toContain("bob");

      const packSubmit = firstText(
        await client.callTool({
          arguments: {
            action: "submit",
            assetId: "pack-lab-repair-triage-sop",
            assetType: "pack",
            confirmedConsent: true,
            lang: "zh",
          },
          name: "vetoboard_contribute_asset",
        }),
      );
      const packSubId = /(sub_[a-z0-9_]+)/i.exec(packSubmit)![1]!;
      const packBundle = await readFile(
        join(tempDir, "contributions", `${packSubId}-bundle.md`),
        "utf8",
      );
      expect(packBundle).toContain("[REDACTED_LOCAL_PATH]");
      expect(packBundle).not.toContain("bob");

      // 4. Self-Updater (`vetoboard_self_update`): clean git repo dry-run passes; dirty tree safely aborts!
      const fakeGitRepo = join(tempDir, "fake-git-install");
      await mkdir(fakeGitRepo, { recursive: true });
      await execFileAsync("git", ["init", fakeGitRepo]);
      await execFileAsync("git", ["-C", fakeGitRepo, "config", "user.email", "test@example.org"]);
      await execFileAsync("git", ["-C", fakeGitRepo, "config", "user.name", "Test Runner"]);
      await writeFile(
        join(fakeGitRepo, "package.json"),
        JSON.stringify({ name: "vetoboard-mcp", version: "1.1.0" }, null, 2),
        "utf8",
      );
      await execFileAsync("git", ["-C", fakeGitRepo, "add", "."]);
      await execFileAsync("git", ["-C", fakeGitRepo, "commit", "-m", "init"]);

      const cleanDryRun = await client.callTool({
        arguments: {
          action: "apply",
          dryRun: true,
          lang: "zh",
          registryUrlOverride: mockUrl,
          repoDirOverride: fakeGitRepo,
        },
        name: "vetoboard_self_update",
      });
      expect(cleanDryRun.isError).toBeFalsy();
      expect(firstText(cleanDryRun)).toContain("Dry-Run 演练通过");

      // Introduce uncommitted local edit -> must block auto-overwrite!
      await writeFile(join(fakeGitRepo, "local-wip.txt"), "uncommitted", "utf8");
      const dirtyApply = await client.callTool({
        arguments: {
          action: "apply",
          dryRun: false,
          lang: "zh",
          registryUrlOverride: mockUrl,
          repoDirOverride: fakeGitRepo,
        },
        name: "vetoboard_self_update",
      });
      expect(dirtyApply.isError).toBe(true);
      expect(firstText(dirtyApply)).toContain("安全保护拦截");
      expect(firstText(dirtyApply)).toContain("local-wip.txt");
    } finally {
      if (prevEnvUrl === undefined) {
        delete process.env.VETOBOARD_UPDATE_REGISTRY_URL;
      } else {
        process.env.VETOBOARD_UPDATE_REGISTRY_URL = prevEnvUrl;
      }
      await new Promise<void>((r) => mockRegistry.close(() => r()));
    }
  });
});
