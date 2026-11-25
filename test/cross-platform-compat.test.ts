import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  auditToolSchemaForAllVendors,
  createVetoBoardMcpServer,
  discoverNativeSkills,
  runExternalChatCompletion,
  runHostInit,
  VetoBoardTaskStore,
} from "../src/index.js";

function firstText(res: Awaited<ReturnType<Client["callTool"]>>): string {
  const block = res.content?.[0];
  return block && block.type === "text" ? block.text : "";
}

describe("Zero-Install 6-Platform Compatibility Matrix (DeepSeek/Hermes, Claude Code, Codex, Cursor, T3 Code)", () => {
  let tempDir = "";
  let store!: VetoBoardTaskStore;
  let client!: Client;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vetoboard-compat-"));
    store = new VetoBoardTaskStore(tempDir);
    const server = createVetoBoardMcpServer({ defaultLocale: "auto", store });
    client = new Client({ name: "compat-matrix-client", version: "1.2.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
  });

  afterEach(async () => {
    await client.close().catch(() => undefined);
    if (tempDir) {
      await rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
    }
  });

  it("1. DeepSeek API / OpenAI Strict / Gemini / Anthropic Wire Schema Gate: 0 propertyNames, 0 $schema, 0 anyOf across all 13 tools while preserving Zod union runtime support", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(13);

    const allIssues = tools.flatMap((tool) =>
      auditToolSchemaForAllVendors({
        description: tool.description,
        inputSchema: tool.inputSchema,
        name: tool.name,
      }),
    );
    expect(allIssues).toEqual([]);

    // Confirm both string and structured BYOK object `modelOverrides` still pass runtime Zod validation!
    const startRes = await client.callTool({
      arguments: {
        domain: "commercial",
        effortProfile: "fast",
        goal: "测试跨平台模型绑定兼容",
        lang: "zh",
        lineupConfirmed: true,
        modelOverrides: {
          "profit-modeler": "deepseek/deepseek-reasoner",
          "quality-inspector": {
            apiBaseUrl: "https://api.deepseek.com/v1",
            kind: "byok",
            modelId: "deepseek-chat",
            providerId: "deepseek",
          },
        },
        roleIds: ["profit-modeler"],
        topologyMode: "flat",
      },
      name: "vetoboard_start_council",
    });
    expect(startRes.isError).toBeFalsy();
    expect(firstText(startRes)).toContain("deepseek/deepseek-reasoner");
    expect(firstText(startRes)).toContain("deepseek/deepseek-chat");
  });

  it("2. Hermes Agent + DeepSeek Simulation: discovers ~/.hermes/skills, syncs distilled SKILL.md to .hermes/.codex/.cursor, and completes full OpenAI tool_calls loop", async () => {
    const fakeHome = join(tempDir, "fake-multi-ide-home");
    const hermesSkillDir = join(fakeHome, ".hermes", "skills", "deepseek-quant-sanity");
    const codexSkillDir = join(fakeHome, ".codex", "skills", "codex-rust-bench");
    const cursorSkillDir = join(fakeHome, ".cursor", "skills", "cursor-ui-audit");
    await mkdir(hermesSkillDir, { recursive: true });
    await mkdir(codexSkillDir, { recursive: true });
    await mkdir(cursorSkillDir, { recursive: true });

    await writeFile(
      join(hermesSkillDir, "SKILL.md"),
      "---\nname: deepseek-quant-sanity\ndescription: Hermes + DeepSeek deterministic margin & cashflow sanity checklist\n---\n# DeepSeek Quant Sanity\n- Check AR cycle.",
      "utf8",
    );
    await writeFile(
      join(codexSkillDir, "SKILL.md"),
      "---\nname: codex-rust-bench\ndescription: Codex CLI latency benchmark checklist\n---\n# Codex Bench",
      "utf8",
    );
    await writeFile(
      join(cursorSkillDir, "SKILL.md"),
      "---\nname: cursor-ui-audit\ndescription: Cursor frontend accessibility check\n---\n# Cursor UI",
      "utf8",
    );

    // 2a. Verify Skill Radar discovers `.hermes`, `.codex`, and `.cursor` skills natively
    const discovered = await discoverNativeSkills({
      dataRootDir: tempDir,
      homeDirOverride: fakeHome,
      includeBuiltinIdeSkills: false,
      workspaceDir: join(tempDir, "empty-ws"),
    });
    expect(discovered.some((s) => s.skillId === "deepseek-quant-sanity" && s.source === "hermes")).toBe(true);
    expect(discovered.some((s) => s.skillId === "codex-rust-bench" && s.source === "codex")).toBe(true);
    expect(discovered.some((s) => s.skillId === "cursor-ui-audit" && s.source === "cursor")).toBe(true);

    // 2b. Verify `vetoboard_distill_skill({ syncToHostIde: true })` syncs into `.hermes`, `.codex`, and `.cursor`
    await client.callTool({
      arguments: {
        exportTargets: ["skill"],
        hostIdeRootOverride: fakeHome,
        scope: "user",
        skillId: "hermes-shared-sop",
        syncToHostIde: true,
        title: "Hermes 跨会话可复用审计技能",
      },
      name: "vetoboard_distill_skill",
    });
    const syncedHermesMd = await readFile(
      join(fakeHome, ".hermes", "skills", "hermes-shared-sop", "SKILL.md"),
      "utf8",
    );
    const syncedCodexMd = await readFile(
      join(fakeHome, ".codex", "skills", "hermes-shared-sop", "SKILL.md"),
      "utf8",
    );
    expect(syncedHermesMd).toContain("name: hermes-shared-sop");
    expect(syncedCodexMd).toContain("name: hermes-shared-sop");

    // 2c. Strict Mock DeepSeek API `/v1/chat/completions` Function-Calling Round-Trip (Hermes / LiteLLM bridge)
    const mockDeepSeek = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const ch of req) chunks.push(ch as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        model: string;
        tools?: Array<{ type: string; function: { name: string; parameters: unknown } }>;
        messages: Array<{ role: string; content?: string; tool_call_id?: string }>;
      };

      // Simulate DeepSeek API's strict schema gate: reject HTTP 400 if any tool contains `propertyNames` or `anyOf`!
      const rawToolsJson = JSON.stringify(body.tools ?? []);
      if (rawToolsJson.includes('"propertyNames"') || rawToolsJson.includes('"anyOf"')) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid function parameters schema" } }));
        return;
      }

      const hasToolResult = body.messages.some((m) => m.role === "tool");
      res.writeHead(200, { "Content-Type": "application/json" });
      if (!hasToolResult) {
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  role: "assistant",
                  tool_calls: [
                    {
                      function: {
                        arguments: JSON.stringify({
                          checks: [
                            {
                              claimedValue: 1200,
                              formula: "180000 / (199 - 68 - 199 * 0.12)",
                              label: "宣称回本销量核查",
                            },
                          ],
                          lang: "zh",
                          mode: "reconcile",
                          tolerancePct: 0.5,
                        }),
                        name: "vetoboard_calc",
                      },
                      id: "call_ds_001",
                      type: "function",
                    },
                  ],
                },
              },
            ],
            model: body.model,
          }),
        );
      } else {
        const toolMsg = body.messages.find((m) => m.role === "tool")!;
        const parsedTool = JSON.parse(toolMsg.content ?? "{}") as { summary?: string };
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: `DeepSeek + Hermes 已通过 vetoboard_calc 抓出算术偏差：${parsedTool.summary ?? ""}`,
                  role: "assistant",
                },
              },
            ],
            model: body.model,
          }),
        );
      }
    });

    await new Promise<void>((r) => mockDeepSeek.listen(0, "127.0.0.1", r));
    const dsPort = (mockDeepSeek.address() as AddressInfo).port;
    try {
      const { tools } = await client.listTools();
      const openAiTools = tools.map((t) => ({
        function: {
          description: t.description ?? "",
          name: t.name,
          parameters: t.inputSchema,
        },
        type: "function",
      }));

      const messages: Array<Record<string, unknown>> = [
        { content: "核验单价199、成本68、抽佣12%、年固定成本18万时宣称1200单回本是否算错", role: "user" },
      ];

      // Turn 1: Send all 13 MCP tool schemas to strict DeepSeek endpoint
      const r1 = await fetch(`http://127.0.0.1:${dsPort}/v1/chat/completions`, {
        body: JSON.stringify({ messages, model: "deepseek-chat", tools: openAiTools }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      expect(r1.status).toBe(200);
      const j1 = (await r1.json()) as {
        choices: Array<{
          message: {
            role: string;
            tool_calls: Array<{ id: string; function: { name: string; arguments: string } }>;
          };
        }>;
      };
      const call = j1.choices[0]!.message.tool_calls[0]!;
      expect(call.function.name).toBe("vetoboard_calc");

      // Execute MCP tool call locally (just as Hermes Agent does)
      const mcpOut = await client.callTool({
        arguments: JSON.parse(call.function.arguments),
        name: call.function.name,
      });
      messages.push(j1.choices[0]!.message as unknown as Record<string, unknown>);
      messages.push({
        content: firstText(mcpOut),
        role: "tool",
        tool_call_id: call.id,
      });

      // Turn 2: Feed MCP result back to DeepSeek
      const r2 = await fetch(`http://127.0.0.1:${dsPort}/v1/chat/completions`, {
        body: JSON.stringify({ messages, model: "deepseek-chat", tools: openAiTools }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      expect(r2.status).toBe(200);
      const j2 = (await r2.json()) as { choices: Array<{ message: { content: string } }> };
      expect(j2.choices[0]!.message.content).toContain("数学矛盾");
    } finally {
      await new Promise<void>((r) => mockDeepSeek.close(() => r()));
    }
  });

  it("3. Raw Stdio Wire Handshakes (`2024-11-05` Codex/Cursor & `2025-03-26` Claude Code/Hermes) + T3 Code Cross-Harness Pairing + Single-Agent Fallback", async () => {
    const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

    // Helper that spawns `node dist/cli.js` over raw OS pipes and speaks raw JSON-RPC 2.0 like Cursor / Codex / Claude Code
    const runRawStdioHandshake = async (protocolVersion: string, clientName: string) =>
      new Promise<{ initResult: Record<string, unknown>; toolCount: number }>((resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, [cliPath, "--data-dir", tempDir], {
          stdio: ["pipe", "pipe", "pipe"],
        });
        let buffer = "";
        let initResult: Record<string, unknown> | undefined;

        const timer = setTimeout(() => {
          child.kill();
          rejectPromise(new Error(`Stdio handshake timeout for ${clientName}`));
        }, 8_000);

        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          // Cursor & Claude Code crash immediately if BOM or non-JSON banner appears on stdout!
          expect(chunk.startsWith("\uFEFF")).toBe(false);
          buffer += chunk;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const msg = JSON.parse(line) as { id?: number; result?: Record<string, unknown> };
            if (msg.id === 1 && msg.result) {
              initResult = msg.result;
              child.stdin.write(
                `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
              );
              child.stdin.write(
                `${JSON.stringify({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} })}\n`,
              );
            } else if (msg.id === 2 && msg.result) {
              clearTimeout(timer);
              const toolsArr = (msg.result.tools as unknown[]) ?? [];
              child.kill();
              resolvePromise({ initResult: initResult!, toolCount: toolsArr.length });
            }
          }
        });

        child.on("error", (err) => {
          clearTimeout(timer);
          rejectPromise(err);
        });

        child.stdin.write(
          `${JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method: "initialize",
            params: {
              capabilities: {},
              clientInfo: { name: clientName, version: "1.0.0" },
              protocolVersion,
            },
          })}\n`,
        );
      });

    // Test legacy 2024-11-05 (Codex CLI / older Cursor) AND modern 2025-03-26 (Claude Code / Hermes Agent)
    const codexWire = await runRawStdioHandshake("2024-11-05", "codex-cli");
    expect(codexWire.toolCount).toBe(13);
    const claudeWire = await runRawStdioHandshake("2025-03-26", "claude-code");
    expect(claudeWire.toolCount).toBe(13);

    // Verify T3 Code multi-harness (`codex` + `claude` + `deepseek`) cross-family inspector pairing
    const t3Plan = JSON.parse(
      firstText(
        await client.callTool({
          arguments: {
            domain: "swe",
            goal: "Audit distributed lock safety & failover latency",
            hostModels: [
              { family: "openai", id: "codex-gpt-5.4", label: "Codex GPT-5.4", tier: "frontier" },
              { family: "anthropic", id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", tier: "balanced" },
              { family: "deepseek", id: "deepseek-reasoner", label: "DeepSeek R1/V4", tier: "frontier" },
            ],
            hostPlatform: "t3code",
            lang: "en",
          },
          name: "vetoboard_plan_lineup",
        }),
      ),
    );
    const leadRec = t3Plan.recommendedLineup.find(
      (r: { roleId: string }) => r.roleId === "software-architect",
    );
    const inspRec = t3Plan.recommendedLineup.find(
      (r: { roleId: string }) => r.roleId === "quality-inspector",
    );
    expect(leadRec.recommendedModelId).toBe("codex-gpt-5.4");
    // Inspector MUST automatically avoid `openai` family so it doesn't grade its own homework!
    expect(inspRec.recommendedModelId).not.toBe("codex-gpt-5.4");

    // Verify Cursor / Single-Agent sequential fallback instruction is present in playbook
    const cursorPlaybook = firstText(
      await client.callTool({
        arguments: {
          domain: "commercial",
          effortProfile: "fast",
          goal: "单线程宿主顺序执行兜底核查",
          lang: "zh",
          lineupConfirmed: true,
          roleIds: ["profit-modeler"],
        },
        name: "vetoboard_start_council",
      }),
    );
    expect(cursorPlaybook).toContain("单代理客户端自动降级");
    expect(cursorPlaybook).toContain("Hermes Agent 用 `delegate_task`");
  });

  it("4. Zero-Omission rawHostModelsJson + 11-Family Effort Folding + Generation/Quota Ranking (fixes 23-variant truncation & retiring model bias)", async () => {
    const swarm23Payload = JSON.stringify({
      display_names: {
        "claude-opus-4-6-thinking": "Claude Opus 4.6 (Thinking)",
        "claude-sonnet-4-6": "Claude Sonnet 4.6 (Thinking)",
        "gemini-3.8-flash-high": "Gemini 3.8 Flash (High)",
        "gemini-3.8-flash-low": "Gemini 3.8 Flash (Low)",
        "gemini-3.8-flash-medium": "Gemini 3.8 Flash (Medium)",
        "gemini-4-argon-high": "Gemini 4 Argon (High)",
        "gemini-4-argon-low": "Gemini 4 Argon (Low)",
        "gemini-4-argon-medium": "Gemini 4 Argon (Medium)",
        "gemini-4-carbon-high": "Gemini 4 Carbon (High)",
        "gemini-4-carbon-low": "Gemini 4 Carbon (Low)",
        "gemini-4-carbon-medium": "Gemini 4 Carbon (Medium)",
        "gemini-4-hydrogen-high": "Gemini 4 Hydrogen (High)",
        "gemini-4-hydrogen-low": "Gemini 4 Hydrogen (Low)",
        "gemini-4-hydrogen-medium": "Gemini 4 Hydrogen (Medium)",
        "gemini-4-hydrogen-xhigh": "Gemini 4 Hydrogen (XHigh)",
        "gemini-4-neon-high": "Gemini 4 Neon (High)",
        "gemini-4-neon-low": "Gemini 4 Neon (Low)",
        "gemini-4-neon-medium": "Gemini 4 Neon (Medium)",
        "gemini-4-neon-xhigh": "Gemini 4 Neon (XHigh)",
        "gemini-pro-orchestrator": "Orchestrator (Carbon)",
        "gemini-pro-orchestrator-argon": "Orchestrator (Argon)",
        "gemini-pro-orchestrator-neon": "Orchestrator (Neon)",
        "gpt-oss-120b-medium": "GPT-OSS 120B (Medium)",
      },
      models: [
        "claude-opus-4-6-thinking",
        "claude-sonnet-4-6",
        "gemini-3.8-flash-high",
        "gemini-3.8-flash-low",
        "gemini-3.8-flash-medium",
        "gemini-4-argon-high",
        "gemini-4-argon-low",
        "gemini-4-argon-medium",
        "gemini-4-carbon-high",
        "gemini-4-carbon-low",
        "gemini-4-carbon-medium",
        "gemini-4-hydrogen-high",
        "gemini-4-hydrogen-low",
        "gemini-4-hydrogen-medium",
        "gemini-4-hydrogen-xhigh",
        "gemini-4-neon-high",
        "gemini-4-neon-low",
        "gemini-4-neon-medium",
        "gemini-4-neon-xhigh",
        "gemini-pro-orchestrator",
        "gemini-pro-orchestrator-argon",
        "gemini-pro-orchestrator-neon",
        "gpt-oss-120b-medium",
      ],
      quotas: Object.fromEntries([
        ["claude-opus-4-6-thinking", { quota_remaining: "100%" }],
        ["claude-sonnet-4-6", { quota_remaining: "100%" }],
        ["gpt-oss-120b-medium", { quota_remaining: "100%" }],
        ...[
          "gemini-3.8-flash-high",
          "gemini-3.8-flash-low",
          "gemini-3.8-flash-medium",
          "gemini-4-argon-high",
          "gemini-4-argon-low",
          "gemini-4-argon-medium",
          "gemini-4-carbon-high",
          "gemini-4-carbon-low",
          "gemini-4-carbon-medium",
          "gemini-4-hydrogen-high",
          "gemini-4-hydrogen-low",
          "gemini-4-hydrogen-medium",
          "gemini-4-hydrogen-xhigh",
          "gemini-4-neon-high",
          "gemini-4-neon-low",
          "gemini-4-neon-medium",
          "gemini-4-neon-xhigh",
          "gemini-pro-orchestrator",
          "gemini-pro-orchestrator-argon",
          "gemini-pro-orchestrator-neon",
        ].map((id) => [id, { quota_remaining: "35%" }]),
      ]),
    });

    const plan = JSON.parse(
      firstText(
        await client.callTool({
          arguments: {
            activeHostModel: "Gemini 4 Carbon",
            domain: "commercial",
            goal: "评估科研仪器维修过渡方案与年度维保定价",
            hostPlatform: "antigravity",
            lang: "zh",
            rawHostModelsJson: swarm23Payload,
          },
          name: "vetoboard_plan_lineup",
        }),
      ),
    );

    // All 23 underlying models ingested, and all 11 UI families rendered without truncation!
    expect(plan.availableHostModels).toHaveLength(23);
    const md: string = plan.briefingMarkdown;
    expect(md).toContain("`Gemini 4 Carbon [Low/Med/High] ★当前`(35%)");
    expect(md).toContain("`Gemini 4 Neon [Low/Med/High/XHigh]`(35%)");
    expect(md).toContain("`Gemini 4 Hydrogen [Low/Med/High/XHigh]`(35%)");
    expect(md).toContain("`Gemini 4 Argon [Low/Med/High]`(35%)");
    expect(md).toContain("`Orchestrator (Carbon)`(35%)");
    expect(md).toContain("`Orchestrator (Neon)`(35%)");
    expect(md).toContain("`Orchestrator (Argon)`(35%)");
    expect(md).toContain("`Claude Opus 4.6 (Thinking)`(100%)");
    expect(md).toContain("`Claude Sonnet 4.6 (Thinking)`(100%)");
    expect(md).toContain("`GPT-OSS 120B (Medium)`(100%)");
    expect(md).toContain("`Gemini 3.8 Flash [Low/Med/High]`(35%)");

    // Verify NO duplicate top Quick-Start prompt, ONLY bottom Model/Weight Confirmation prompt (and zero `~...~` GFM strikethrough bug)!
    expect(md).not.toContain("⚡ **极速开跑");
    expect(md.indexOf("| 拟上场席位 |")).toBeGreaterThan(0);
    expect(md.indexOf("💬 **请确认或直接对话选模型 / 调权重**")).toBeGreaterThan(
      md.indexOf("🛡️ 已激活底座硬门禁"),
    );
    expect(md).toContain("白板 ≤5–8 次 / 定稿 ≤12–18 次");
    expect(md).not.toMatch(/\d~\d.*\d~\d/);

    // Verify retiring `3.8 Flash` and `Orchestrator` are NEVER recommended ahead of 4.x / 4.6 / GPT-OSS!
    for (const item of plan.recommendedLineup as Array<{ recommendedModelId: string }>) {
      expect(item.recommendedModelId).not.toContain("3.8-flash");
      expect(item.recommendedModelId).not.toContain("orchestrator");
    }
  });

  it("5. `vetoboard-mcp init` 1-Command Auto-Installer: configures Antigravity, Claude Code, Cursor, Codex, Hermes, OpenCode & T3 Code (with Windows `cmd /c npx` guard)", async () => {
    const fakeHome = join(tempDir, "fake-init-home");
    await mkdir(join(fakeHome, ".gemini", "config"), { recursive: true });
    await mkdir(join(fakeHome, ".claude"), { recursive: true });
    await mkdir(join(fakeHome, ".cursor"), { recursive: true });
    await mkdir(join(fakeHome, ".codex"), { recursive: true });
    await mkdir(join(fakeHome, ".hermes"), { recursive: true });
    await mkdir(join(fakeHome, ".t3code"), { recursive: true });

    // Pre-seed existing user MCP configs to prove non-destructive merging!
    await writeFile(
      join(fakeHome, ".claude.json"),
      JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "gh-mcp"] } }, theme: "dark" }, null, 2),
      "utf8",
    );
    await writeFile(
      join(fakeHome, ".hermes", "config.yaml"),
      "model: deepseek-chat\nmcp_servers:\n  filesystem:\n    command: \"npx\"\n",
      "utf8",
    );
    await mkdir(join(fakeHome, ".config", "opencode"), { recursive: true });
    await writeFile(
      join(fakeHome, ".config", "opencode", "opencode.json"),
      JSON.stringify({ mcp: { existing: { command: ["echo", "ok"], enabled: true, type: "local" } } }, null, 2),
      "utf8",
    );

    const initResWin = await runHostInit({
      homeDirOverride: fakeHome,
      locale: "zh",
      platformOverride: "win32",
      preferNpx: true,
    });

    expect(initResWin.commandMode).toBe("npx");
    expect(initResWin.installed.map((i) => i.target).sort()).toEqual([
      "antigravity",
      "claude",
      "codex",
      "cursor",
      "hermes",
      "opencode",
      "t3code",
    ]);

    // 1. Antigravity full 3-in-1 plugin bundle check
    const agyRule = await readFile(
      join(fakeHome, ".gemini", "config", "plugins", "vetoboard-mcp", "rules", "AGENTS.md"),
      "utf8",
    );
    const agySkill = await readFile(
      join(fakeHome, ".gemini", "config", "plugins", "vetoboard-mcp", "skills", "vetoboard", "SKILL.md"),
      "utf8",
    );
    expect(agyRule).toContain("rawHostModelsJson");
    expect(agyRule).toContain("markdownFilePath");
    expect(agySkill).toContain("name: vetoboard");

    // 2. Claude Code on Windows wraps npx with `cmd /c` while preserving `github` + `theme`!
    const claudeJson = JSON.parse(await readFile(join(fakeHome, ".claude.json"), "utf8"));
    expect(claudeJson.theme).toBe("dark");
    expect(claudeJson.mcpServers.github).toBeDefined();
    expect(claudeJson.mcpServers.vetoboard.command).toBe("cmd");
    expect(claudeJson.mcpServers.vetoboard.args.slice(0, 3)).toEqual(["/c", "npx", "-y"]);
    const claudeSlash = await readFile(join(fakeHome, ".claude", "commands", "vetoboard.md"), "utf8");
    expect(claudeSlash).toContain("$ARGUMENTS");

    // 3. Codex, Hermes & OpenCode (T3 Code) preserved existing entries and added `vetoboard`!
    const codexToml = await readFile(join(fakeHome, ".codex", "config.toml"), "utf8");
    expect(codexToml).toContain("[mcp_servers.vetoboard]");
    const hermesYaml = await readFile(join(fakeHome, ".hermes", "config.yaml"), "utf8");
    expect(hermesYaml).toContain("model: deepseek-chat");
    expect(hermesYaml).toContain("filesystem:");
    expect(hermesYaml).toContain("vetoboard:");

    const opencodeJson = JSON.parse(
      await readFile(join(fakeHome, ".config", "opencode", "opencode.json"), "utf8"),
    );
    expect(opencodeJson.$schema).toBe("https://opencode.ai/config.json");
    expect(opencodeJson.mcp.existing).toBeDefined();
    expect(opencodeJson.mcp.vetoboard).toEqual({
      command: ["cmd", "/c", "npx", "-y", "vetoboard-mcp@latest", "--lang", "auto"],
      enabled: true,
      type: "local",
    });

    // 4. Verify POSIX (`linux` / `darwin`) keeps direct `npx` command without `cmd /c`
    const fakeLinuxHome = join(tempDir, "fake-linux-home");
    await mkdir(join(fakeLinuxHome, ".claude"), { recursive: true });
    await runHostInit({
      homeDirOverride: fakeLinuxHome,
      locale: "en",
      platformOverride: "linux",
      preferNpx: true,
    });
    const linuxClaudeJson = JSON.parse(await readFile(join(fakeLinuxHome, ".claude.json"), "utf8"));
    expect(linuxClaudeJson.mcpServers.vetoboard.command).toBe("npx");
  });

  it("6. Reasoning Model BYOK Guard: omits `temperature` for OpenAI o3/gpt-5 & DeepSeek R1 while keeping `temperature: 0.2` for standard chat models", async () => {
    const seenBodies: Array<Record<string, unknown>> = [];
    const strictReasoningServer = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const ch of req) chunks.push(ch as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      seenBodies.push(body);
      const modelStr = String(body.model ?? "");
      if (
        (modelStr.includes("o3") || modelStr.includes("gpt-5") || modelStr.includes("reasoner")) &&
        "temperature" in body
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Unsupported value: temperature" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: `OK:${modelStr}` } }],
          model: modelStr,
        }),
      );
    });

    await new Promise<void>((r) => strictReasoningServer.listen(0, "127.0.0.1", r));
    const port = (strictReasoningServer.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}/v1`;

    try {
      for (const reasoningModel of ["o3-mini", "gpt-5", "deepseek/deepseek-reasoner"]) {
        const res = await runExternalChatCompletion({
          config: { apiBaseUrl: baseUrl, apiKey: "sk-test", mode: "byok", modelId: reasoningModel },
          systemPrompt: "sys",
          userPrompt: "usr",
        });
        expect(res.ok).toBe(true);
      }

      const stdRes = await runExternalChatCompletion({
        config: { apiBaseUrl: baseUrl, apiKey: "sk-test", mode: "byok", modelId: "deepseek-chat" },
        systemPrompt: "sys",
        userPrompt: "usr",
      });
      expect(stdRes.ok).toBe(true);
      expect(seenBodies.at(-1)?.temperature).toBe(0.2);
    } finally {
      await new Promise<void>((r) => strictReasoningServer.close(() => r()));
    }
  });
});
