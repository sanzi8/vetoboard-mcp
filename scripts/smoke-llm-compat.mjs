#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { auditToolSchemaForAllVendors } from "../dist/index.js";

/**
 * Zero-Install Cross-Platform & Live DeepSeek/OpenAI Function-Calling Smoke Runner (`pnpm run smoke:llm`).
 *
 * 1. Always runs an offline real-Stdio subprocess handshake + 13-tool strict schema audit (`0` installs, `0` cost).
 * 2. When `DEEPSEEK_API_KEY` (or `OPENAI_API_KEY` / `OPENROUTER_API_KEY`) is set in environment variables,
 *    also performs a live real-LLM tool-calling round-trip against `vetoboard-mcp` without needing Hermes/Cursor installed!
 */

async function main() {
  const tempDir = await mkdtemp(join(tmpdir(), "vetoboard-smoke-"));
  const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const transport = new StdioClientTransport({
    args: [cliPath, "--data-dir", tempDir, "--lang", "auto"],
    command: process.execPath,
  });
  const client = new Client({ name: "vetoboard-smoke-runner", version: "1.2.0" });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    console.log(`[1/3] Stdio MCP handshake OK -> discovered ${tools.length} tools.`);

    const issues = tools.flatMap((t) =>
      auditToolSchemaForAllVendors({
        description: t.description,
        inputSchema: t.inputSchema,
        name: t.name,
      }),
    );
    if (issues.length > 0) {
      console.error("[FAIL] Cross-vendor JSON Schema violations found:", issues);
      process.exitCode = 1;
      return;
    }
    console.log(
      "[2/3] Strict Schema Gate OK -> 0 propertyNames / 0 $schema / 0 anyOf (100% DeepSeek, OpenAI Codex, Claude Code, Cursor & Hermes compatible).",
    );

    const apiKey =
      process.env.DEEPSEEK_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      process.env.OPENROUTER_API_KEY?.trim();

    if (!apiKey) {
      const localCalc = await client.callTool({
        arguments: {
          checks: [
            {
              claimedValue: 1200,
              formula: "180000 / (199 - 68 - 199 * 0.12)",
              label: "BEP sanity check",
            },
          ],
          lang: "zh",
          mode: "reconcile",
          tolerancePct: 0.5,
        },
        name: "vetoboard_calc",
      });
      const txt = localCalc.content?.[0]?.type === "text" ? localCalc.content[0].text : "";
      console.log(`[3/3] Local Stdio tool round-trip OK -> ${JSON.parse(txt).summary}`);
      console.log(
        "\nTip: To also run a live DeepSeek API model test (zero Hermes/IDE install needed), run:\n" +
          '  $env:DEEPSEEK_API_KEY="sk-..."; pnpm run smoke:llm',
      );
      return;
    }

    const baseUrl = (
      process.env.LLM_BASE_URL?.trim() ||
      (process.env.DEEPSEEK_API_KEY
        ? "https://api.deepseek.com"
        : process.env.OPENROUTER_API_KEY
          ? "https://openrouter.ai/api/v1"
          : "https://api.openai.com/v1")
    ).replace(/\/+$/, "");
    const model =
      process.env.LLM_MODEL?.trim() ||
      (process.env.DEEPSEEK_API_KEY
        ? "deepseek-chat"
        : process.env.OPENROUTER_API_KEY
          ? "deepseek/deepseek-chat"
          : "gpt-4o-mini");

    const openAiTools = tools.map((t) => ({
      function: {
        description: t.description ?? "",
        name: t.name,
        parameters: t.inputSchema,
      },
      type: "function",
    }));

    console.log(`[3/3] Calling live LLM (${model} @ ${baseUrl}) with all ${tools.length} VetoBoard MCP tools...`);
    const messages = [
      {
        content:
          "请必须调用 vetoboard_calc (mode='reconcile') 核验：单价 199 元、硬件成本 68 元、平台抽佣 12%、年固定成本 180000 元，宣称 1200 单回本是否算错？",
        role: "user",
      },
    ];

    const res1 = await fetch(`${baseUrl}/chat/completions`, {
      body: JSON.stringify({ messages, model, temperature: 0, tools: openAiTools }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    if (!res1.ok) {
      const errBody = await res1.text();
      throw new Error(`HTTP ${res1.status} from ${baseUrl}: ${errBody}`);
    }
    const data1 = await res1.json();
    const msg1 = data1.choices?.[0]?.message;
    const toolCalls = msg1?.tool_calls ?? [];
    if (toolCalls.length === 0) {
      console.log("Model response (no tool call):", msg1?.content);
      return;
    }

    messages.push(msg1);
    for (const tc of toolCalls) {
      console.log(`  -> Live model invoked MCP tool: ${tc.function.name}(${tc.function.arguments})`);
      const mcpRes = await client.callTool({
        arguments: JSON.parse(tc.function.arguments),
        name: tc.function.name,
      });
      const outText = mcpRes.content?.[0]?.type === "text" ? mcpRes.content[0].text : "";
      messages.push({
        content: outText,
        role: "tool",
        tool_call_id: tc.id,
      });
    }

    const res2 = await fetch(`${baseUrl}/chat/completions`, {
      body: JSON.stringify({ messages, model, temperature: 0, tools: openAiTools }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const data2 = await res2.json();
    console.log("\n=== Live LLM + VetoBoard Verdict ===\n" + (data2.choices?.[0]?.message?.content ?? ""));
  } finally {
    await client.close().catch(() => undefined);
    await rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[smoke:llm] Error:", err);
  process.exitCode = 1;
});
