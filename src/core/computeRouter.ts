import type { VetoBoardLocale } from "../i18n/locales.js";
import { formatModelBindingLabel, renderRoleCharterPrompt } from "./roleCatalog.js";
import type { RoleModelBinding, RoleTemplate, VetoBoardExecutionMode, VetoBoardTaskRecord } from "./types.js";

function renderTrackModelInstruction(binding: RoleModelBinding | undefined, locale: VetoBoardLocale): string {
  if (!binding) return "";
  const zh = locale === "zh";
  if (binding.kind === "host-tier" && binding.hostModelTier) {
    return zh
      ? ` · 🎯 指定模型档位: \`invoke_subagent Model="${binding.hostModelTier}"\``
      : ` · 🎯 Bound Host Model: \`invoke_subagent Model="${binding.hostModelTier}"\``;
  }
  const label = formatModelBindingLabel(binding);
  if (label) {
    return zh
      ? ` · 🎯 独立绑定异构模型: \`${label}\` (可通过宿主指定或 \`vetoboard_audit_output\` 异构调用)`
      : ` · 🎯 Independent Bound Model: \`${label}\``;
  }
  return "";
}

/**
 * 3-Tier Flexible Compute Router (`ExecutionMode`):
 * 1. `host-subscription` (Default, 0 external API tokens): Emits structured subagent playbooks so Claude Code / Cursor / Antigravity
 *    runs inference on the user's existing monthly subscription while calling back VetoBoard for deterministic math, rule gates & memorial compression.
 * 2. `byok` (OpenAI-compatible / Relay / OpenRouter / DeepSeek): Calls user-configured HTTP endpoint for heterogeneous cross-model auditing.
 * 3. `cloud-pool` (VetoBoard Cloud Managed Token Pool): Routes to VetoBoard Cloud gateway with Bearer token (ready for token-credit monetization).
 */

export interface ExternalModelConfig {
  readonly mode: VetoBoardExecutionMode;
  readonly apiBaseUrl?: string | undefined;
  readonly apiKey?: string | undefined;
  readonly modelId?: string | undefined;
  readonly cloudPoolUrl?: string | undefined;
  readonly cloudPoolToken?: string | undefined;
}

export function resolveExternalModelConfig(
  requestedMode?: VetoBoardExecutionMode,
  overrides?: Partial<ExternalModelConfig>,
): ExternalModelConfig {
  const apiBaseUrl = overrides?.apiBaseUrl ?? process.env.VETOBOARD_API_BASE_URL?.trim();
  const apiKey = overrides?.apiKey ?? process.env.VETOBOARD_API_KEY?.trim();
  const modelId = overrides?.modelId ?? process.env.VETOBOARD_AUDIT_MODEL?.trim() ?? "deepseek-chat";
  const cloudPoolUrl = overrides?.cloudPoolUrl ?? process.env.VETOBOARD_CLOUD_URL?.trim();
  const cloudPoolToken = overrides?.cloudPoolToken ?? process.env.VETOBOARD_CLOUD_TOKEN?.trim();

  let mode: VetoBoardExecutionMode = requestedMode ?? "host-subscription";
  if (!requestedMode) {
    if (cloudPoolUrl && cloudPoolToken) mode = "cloud-pool";
    else if (apiBaseUrl && apiKey) mode = "byok";
  }

  return {
    apiBaseUrl,
    apiKey,
    cloudPoolToken,
    cloudPoolUrl,
    mode,
    modelId,
  };
}

export async function runExternalChatCompletion(params: {
  readonly config: ExternalModelConfig;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly timeoutMs?: number;
}): Promise<{ readonly ok: true; readonly content: string; readonly model: string } | { readonly ok: false; readonly error: string }> {
  const { config } = params;
  const endpointBase =
    config.mode === "cloud-pool" ? config.cloudPoolUrl : config.apiBaseUrl;
  const token =
    config.mode === "cloud-pool" ? config.cloudPoolToken : config.apiKey;

  if (!endpointBase || !token) {
    return {
      error:
        config.mode === "cloud-pool"
          ? "Missing VETOBOARD_CLOUD_URL or VETOBOARD_CLOUD_TOKEN for cloud-pool mode."
          : "Missing VETOBOARD_API_BASE_URL or VETOBOARD_API_KEY for byok mode.",
      ok: false,
    };
  }

  const normalizedUrl = endpointBase.replace(/\/+$/, "").endsWith("/chat/completions")
    ? endpointBase.replace(/\/+$/, "")
    : `${endpointBase.replace(/\/+$/, "")}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 60_000);
  try {
    const response = await fetch(normalizedUrl, {
      body: JSON.stringify({
        messages: [
          { content: params.systemPrompt, role: "system" },
          { content: params.userPrompt, role: "user" },
        ],
        model: config.modelId ?? "deepseek-chat",
        temperature: 0.2,
      }),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        error: `Upstream HTTP ${response.status}: ${errText.slice(0, 240)}`,
        ok: false,
      };
    }

    const json = (await response.json()) as {
      model?: string;
      choices?: readonly { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      return { error: "Upstream model returned empty content.", ok: false };
    }
    return { content, model: json.model ?? config.modelId ?? "unknown", ok: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      ok: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generates the zero-token Host-Subscription Execution Playbook so Claude Code / Cursor / Antigravity
 * executes each role track using its own native subagent quota while preserving VetoBoard's strict gates.
 */
export function buildHostSubscriptionPlaybook(params: {
  readonly task: VetoBoardTaskRecord;
  readonly roleByTrackId: ReadonlyMap<string, RoleTemplate>;
  readonly locale: VetoBoardLocale;
}): string {
  const { task, roleByTrackId, locale } = params;
  const zh = locale === "zh";

  const kbBlock = task.mountedKnowledgeMarkdown?.trim()
    ? ["", task.mountedKnowledgeMarkdown.trim()]
    : [];

  if (task.topologyMode === "whiteboard-electre") {
    const wave1 = task.tracks.filter((tr) => tr.roleId !== "quality-inspector");
    const inspector = task.tracks.find((tr) => tr.roleId === "quality-inspector");
    const domPct = task.effortProfile === "deep" ? 65 : 60;

    const header = zh
      ? [
          `## VetoBoard 动态共享白板剧本（Task ID: \`${task.taskId}\` · ELECTRE + QMV 数学裁决引擎 · 0 外部 API Token）`,
          `> **办公室共享白板铁律**：严禁拉群混战或全员陪聊！只启动 **1 批专员 Subagent（保留 \`conversationId\`）**：先 **100% 并发备课贴关键变量上白板** → **全员阅板留痕（无关/有利直接赞同吸收；意见相反按缺失维度精准寻人协商）** → **跑运筹学数学支配公式（D ≥ ${domPct}% · C ≥ 66.7% · 席位 ≥ 50% · 最多 2 轮零变化早停转人工）** → **并发收口定稿 + [V1] 质检存库退回普通对话**！`,
          ...kbBlock,
          "",
          "### 执行步骤指令（商业审计与软件代码构建通用 4 步状态机）：",
          "0. **⚠️ 子智能体联网与双通道 MCP 网关铁律（防 `[blocked_on_mcp]` 死锁！）**：",
          "   - **联网要求**：严禁使用无网络权限的只读沙箱（如反重力 `TypeName: \"research\"` 默认无网！必须用 `TypeName: \"self\"` 或 `swarm` 指定模型 Worker；Claude Code 用带 `WebSearch` 的 `Task`；Hermes Agent 用 `delegate_task`；Codex / T3 Code 用带网代理）。",
          "   - **单代理客户端自动降级（Cursor 单窗 / 未开子代理的 Hermes·DeepSeek 会话）**：若当前宿主环境未开启多子代理并发工具，允许当前主模型按下方轨道顺序**分席位独立视角串行执行**（每席仍必须遵守配额内联网检索、`vetoboard_calc` 算账与白板门禁）！",
          "   - **MCP 网关分工（关键！）**：若使用 **`invoke_subagent(TypeName=\"self\")`**，子代理自带 `call_mcp_tool`，可直接调 `vetoboard_calc` 与 `vetoboard_submit_track_output`；**但若使用反重力 `swarm` 指定跨厂商模型 Worker（或任何不暴露 `call_mcp_tool` 的受限子代理），只有主控 `@coordinator` 拥有 `call_mcp_tool`！此时严禁要求 Worker 自己调 `call_mcp_tool`（否则会报 `blocked_on_mcp`）**：请明确告知各 Worker：*「无需寻找 `call_mcp_tool`！`board_post`/`board_review` 直接在看板 `@coordinator [done]` 贴出摘要、真实 `https://` URL 与 `variables` JSON 由 `@coordinator` 代交；`deliverable` 阶段用 `write_file` 将完整 Markdown 写入 `<workspaceDir>/.vetoboard-tmp/" + task.taskId + "/<trackId>.md`（算账可调命令行 `npx vetoboard-mcp calc` 或贴公式 JSON 块），看板仅发文件路径，由 `@coordinator` 调 `vetoboard_calc` + `vetoboard_submit_track_output({ markdownFilePath })` 零拷贝秒交！」*",
          "1. **步骤 1 · 并发联网摸底贴白板（100% 并发，`stage: \"board_post\"`）**：并发启动全部专员（保存 `conversationId`！），**上白板前必须先在配额上限内（≤5~8 次查询，连续 2 次无果立刻标 `[ASSUMPTION]` 止损防死循环！）执行 `search_web`/`WebSearch` 抓取真实在售低/中/高具体型号现价、现行法规或最新 SDK 文档（附至少 1 条真实 `https://` URL 并将 `" + `search_web` + "` 记入 `invokedTools`）**，再提交 **核心摘要（≤200字）+ 结构化公开变量 `variables`** 至 `vetoboard_submit_track_output`（`stage: \"board_post\"`）。未联网无 URL 将被代码硬门禁直接打回！",
          `2. **步骤 2 · 全员阅板留痕 & ELECTRE+QMV 数学裁决（\`stage: "board_review"\`）**：将工具返回的《公开白板看板》通过 \`send_message\` 发给同一批专员核对留痕：无关/有利/补充填 \`decision: "approve"\`（0 争吵）；自兼容填 \`"conditional"\`；意见相反填 \`"oppose"\` 并声明冲突对象 \`targetTrackIds\` 与卡点缺失维度 \`neededDimensions\`（如 \`["market", "cost"]\`）。满足 \`D ≥ ${domPct}% & C ≥ 66.7%\` 时自动带《少数派风险备忘》直接放行；僵持时仅精准唤醒对应维度角色协商（超 2 轮或票型零变化自动早停转交用户人工拍板）！`,
          "3. **步骤 3 · 并发收口定稿（100% 并发，`stage: \"deliverable\"`）**：白板锁定后，通过 `send_message` 同时唤醒全部专员对齐白板变量并发提交完整底稿/代码方案（涉及算账必调 `vetoboard_calc` 传 `taskId`）。",
          "4. **步骤 4 · 质量检查 `[V1]` & 决策统帅全角标报告落盘 + 存知识库退场**：运行 `quality-inspector` 执行 `vetoboard_calc (mode='reconcile', taskId=...)` 并提交带 `≥10` 处 `[[Sx·§y]](#ref-sx-secy)` 角标的 `executiveBriefingMarkdown`。系统落盘三件套、存入实战知识库后，**立即干净退出 VetoBoard 模式回到普通对话**！",
        ]
      : [
          `## VetoBoard Dynamic Shared Whiteboard Playbook (Task ID: \`${task.taskId}\` · ELECTRE + QMV Governance Engine)`,
          `> **Shared Office Whiteboard Law**: Zero mesh brawls! Spawn 1 persistent batch of subagents: **① 100% Concurrent Prep & Post Variables (\`stage='board_post'\`)** -> **② Review & React (\`stage='board_review'\`: approve/absorb vs dynamic dimension consult)** -> **③ Mathematical Dominance Gate (D >= ${domPct}%, C >= 66.7%, Seats >= 50%, R<=2 Early Stop)** -> **④ Parallel Finalize (\`stage='deliverable'\`) + [V1] Audit, Knowledge Save & Exit**.`,
          ...kbBlock,
          "",
          "### Orchestration Protocol (4 Steps):",
          "0. **⚠️ Subagent Network, Coordinator MCP Gateway & Single-Agent Fallback**: NEVER spawn network-disabled sandboxes (e.g. Antigravity's `TypeName: \"research\"` has NO network access — use `TypeName: \"self\"` or `swarm` workers; Claude Code `Task`; Hermes `delegate_task`). **Crucial for `swarm` / MCP-less workers**: child workers without `call_mcp_tool` MUST write full deliverables to `<workspaceDir>/.vetoboard-tmp/" + task.taskId + "/<trackId>.md` so `@coordinator` submits via `vetoboard_submit_track_output({ markdownFilePath })` with zero copy-paste! **Single-Agent Hosts (Cursor / single-thread DeepSeek)**: if subagent spawning is unavailable, execute each track sequentially in isolated role passes while obeying all web-search & `vetoboard_calc` gates.",
          "1. **Step 1 · Concurrent Web-Grounded Prep & Post (`stage: \"board_post\"`)**: Spawn persistent specialist subagents in parallel; each specialist MUST run live `search_web`/`WebSearch` FIRST (within `<= 5-8` quota calls; stop after 2 empty queries as `[ASSUMPTION]`) and cite `>= 1` real `https://` URL before submitting `variables` + summary via `vetoboard_submit_track_output (stage='board_post')`.",
          `2. **Step 2 · Board Review & ELECTRE/QMV Gate (\`stage: "board_review"\`)**: Send the Public Whiteboard via \`send_message\` to existing subagents. Submit \`decision: "approve" | "conditional" | "oppose"\` (with \`targetTrackIds\` & \`neededDimensions\`). Dominated contentions (\`D >= ${domPct}%\`) pass automatically with Minority Report preserved; ties route ONLY to matching dimension specialists (capped at 2 rounds + zero-delta early stop to human intervention).`,
          "3. **Step 3 · 100% Parallel Finalization (`stage: \"deliverable\"`)**: Wake all specialists in parallel via `send_message` to submit full deliverables aligned with the locked whiteboard (`vetoboard_calc` with `taskId`).",
          "4. **Step 4 · Quality Inspector `[V1]`, Knowledge Distillation & Clean Exit**: Run `quality-inspector` with `executiveBriefingMarkdown` (`[[Sx·§y]]` citations), export 3 workspace files, save Knowledge Card, and exit to normal chat!",
        ];

    const renderBrief = (tr: (typeof task.tracks)[number]) => {
      const tpl = roleByTrackId.get(tr.trackId);
      const baseCharter = tr.customCharter ?? (tpl ? renderRoleCharterPrompt(tpl, locale) : tr.title);
      const modelTag = renderTrackModelInstruction(tr.modelBinding ?? tpl?.modelBinding, locale);
      return [`#### Track \`${tr.trackId}\` (${tr.tierLabel} · Weight ${tr.weight}${modelTag})`, baseCharter].join("\n");
    };

    return [
      ...header,
      "",
      zh ? "### 办公室在场专员宪章（持久化会话：并发贴白板 → 阅板数学裁决 → 并发定稿）" : "### In-Room Specialist Charters",
      ...wave1.map(renderBrief),
      ...(inspector
        ? [
            "",
            zh ? "### 质量检查与终局统帅核验宪章" : "### Final Quality Inspector Charter",
            renderBrief(inspector),
          ]
        : []),
    ].join("\n\n");
  }

  if (task.topologyMode === "deliberate-then-parallel") {
    const wave1 = task.tracks.filter((tr) => tr.roleId !== "quality-inspector");
    const inspector = task.tracks.find((tr) => tr.roleId === "quality-inspector");

    const header = zh
      ? [
          `## VetoBoard 宿主订阅驱动剧本（Task ID: \`${task.taskId}\` · 串行短交锋锁契约 → 满并发干重活 · 0 外部 API Token）`,
          `> **VetoBoard 两段式黄金铁律**：交锋不可跨轮盲跑（必须 R1 亮牌 → R2 互怼锁死共享参数契约），干重活必须 100% 满并发冲刺！请全程**只启动 1 批专员 Subagent 并记录各自的 \`conversationId\`**，用 \`send_message\` 复用会话缓存推进！`,
          ...kbBlock,
          "",
          "### 执行步骤指令（请宿主 Agent 严格按以下 4 步推进）：",
          "1. **步骤 1 · 交锋第 1 轮（亮底牌，200字短拳）**：通过 `invoke_subagent` 启动下方全部专员会话（保存返回的 `conversationId`！），要求先围绕课题（及上方已挂载的知识库基线）在 **200 字内** 抛出破题核心主张与 2 条硬红线/成本底数（暂不写长篇底稿！），分别调用 `vetoboard_submit_track_output`（传 `stage: \"round1\"`）提交。",
          "2. **步骤 2 · 交锋第 2 轮（串行于 R1 之后！点名互怼锁契约，240字）**：待 R1 齐备后，将工具自动返回的《全员第 1 轮主张黑板》通过 **`send_message` 发回给同一批专员 `conversationId`**，完成点名回应与合法/极简替代参数设计，调用 `vetoboard_submit_track_output`（传 `stage: \"round2\"`）。若触发 `altersCorePremise: true` 重大路线冲突则停下问用户；否则系统自动生成《🔒 冻结共享参数契约》。",
          "3. **步骤 3 · 重装干活阶段（100% 满并发冲刺！）**：再次用 **`send_message` 同时唤醒同一批全部专员会话**，注入《🔒 冻结共享参数契约》，**全轨同时并发**完成查证、`vetoboard_calc`（必传 `taskId`）核算与完整底稿撰写，调用 `vetoboard_submit_track_output`（`stage: \"deliverable\"`）。",
          "4. **步骤 4 · 独立终验 `[V1]` & 存知识库退回普通对话**：启动只读督察官 `quality-inspector`，结合自动返回的《真实页内 `[Sx·§y]` 锚点清单》执行 `vetoboard_calc (mode='reconcile', taskId=...)` 并传入 `executiveBriefingMarkdown` 提交。系统自动落盘工作区三件套、提炼《实战结论卡》存入知识库，随后**干净退出 VetoBoard 模式回到普通对话**！",
        ]
      : [
          `## VetoBoard Host-Subscription Playbook (Task ID: \`${task.taskId}\` · 2-Round Serial Clash -> 100% Parallel Execution)`,
          `> **VetoBoard Two-Stage Law**: Spawn 1 persistent batch of specialist subagents (` + "`invoke_subagent`" + `), reuse their ` + "`conversationId`" + `s via ` + "`send_message`" + ` across Round 1 -> Round 2 Serial Clash to lock shared parameters, then unleash 100% Parallel Heavy Execution!`,
          ...kbBlock,
          "",
          "### Orchestration Protocol (4 Steps):",
          "1. **Step 1 · Clash Round 1 (`stage: \"round1\"`, <=200 words)**: Spawn persistent subagents for the specialist tracks below; submit each 200-word baseline claim & hard constraints via `vetoboard_submit_track_output (stage='round1')`.",
          "2. **Step 2 · Clash Round 2 (`stage: \"round2\"`, serial after R1, <=240 words)**: Send the returned Round 1 Peer Blackboard via `send_message` to the SAME subagent `conversationId`s; submit rebuttals & constructive alternatives via `vetoboard_submit_track_output (stage='round2')` to lock the Shared Baseline Contract.",
          "3. **Step 3 · 100% Parallel Heavy Execution (`stage: \"deliverable\"`)**: Wake ALL existing specialist subagents simultaneously in parallel via `send_message` with the Locked Contract, run `vetoboard_calc (taskId=...)`, and submit full deliverables via `vetoboard_submit_track_output (stage='deliverable')`.",
          "4. **Step 4 · Final Audit `[V1]`, Knowledge Distillation & Exit**: Run `quality-inspector` with `vetoboard_calc (mode='reconcile', taskId=...)` and `executiveBriefingMarkdown` using the emitted `[Sx·§y]` Anchor Catalog. VetoBoard exports the 3-file bundle, saves the Knowledge Card, and exits cleanly to normal chat!",
        ];

    const renderBrief = (tr: (typeof task.tracks)[number]) => {
      const tpl = roleByTrackId.get(tr.trackId);
      const baseCharter = tr.customCharter ?? (tpl ? renderRoleCharterPrompt(tpl, locale) : tr.title);
      const modelTag = renderTrackModelInstruction(tr.modelBinding ?? tpl?.modelBinding, locale);
      return [`#### Track \`${tr.trackId}\` (${tr.tierLabel} · Weight ${tr.weight}${modelTag})`, baseCharter].join("\n");
    };

    return [
      ...header,
      "",
      zh ? "### 参审专员宪章（同批会话驻留：先串行交锋 R1/R2，再 100% 并行干活）" : "### Specialist Track Charters (Persistent: Serial R1/R2 -> 100% Parallel Execution)",
      ...wave1.map(renderBrief),
      ...(inspector
        ? [
            "",
            zh ? "### 殿后独立终验宪章（待全员重活底稿收齐后启动）" : "### Final Read-Only Inspector Charter",
            renderBrief(inspector),
          ]
        : []),
    ].join("\n\n");
  }

  const waveNumbers = [...new Set(task.tracks.map((tr) => tr.wave))].sort((a, b) => a - b);
  const maxWave = waveNumbers.at(-1) ?? 1;

  const waveStepInstructions = waveNumbers.map((w, idx) => {
    const tracksInWave = task.tracks.filter((tr) => tr.wave === w);
    const isFinalInspectorWave =
      w === maxWave && tracksInWave.every((tr) => tr.roleId === "quality-inspector");
    const hasTerminalSpecialist = tracksInWave.some((tr) => tr.isTerminal);

    if (w === 1) {
      return zh
        ? `${idx + 1}. **第 1 波（核心主导破题定锚 · 严禁全员盲跑平行线）**：启动第 1 波 Subagent 完成赛道/架构破题与重置成本天花板预检（涉及算式调 \`vetoboard_calc\` 并传 \`taskId\`），提交 \`vetoboard_submit_track_output\` 获取《结构化奏折呈批卡》。`
        : `${idx + 1}. **Wave 1 (Primary Lead Framing & Ceiling Anchor)**: Run Wave 1 track(s) first, invoke \`vetoboard_calc\` (passing \`taskId\`), and submit via \`vetoboard_submit_track_output\` to obtain the \`<workflow_memorial_card>\`.`;
    }
    if (isFinalInspectorWave) {
      return zh
        ? `${idx + 1}. **第 ${w} 波（独立只读终验 [V1] + 论文级全角标穿透解读）**：将前序全部卡片与系统自动生成的《可引用标准角标清单》注入 \`quality-inspector\`，调用 \`vetoboard_calc (mode='reconcile', taskId=...)\` 独立复算，并在提交 \`vetoboard_submit_track_output\` 时同步传入带 \`[[Sx·§y]](#ref-sx-secy)\` 内联角标的 \`executiveBriefingMarkdown\`，签发双层溯源报告并落盘工作区三件套！`
        : `${idx + 1}. **Wave ${w} (Independent Reconcile [V1] + Paper-Grade Cited Briefing)**: Feed upstream Memorial Cards + the auto-emitted Citation Anchor Directory into \`quality-inspector\`, run \`vetoboard_calc (mode='reconcile', taskId=...)\`, and submit \`executiveBriefingMarkdown\` with inline \`[[Sx·§y]](#ref-sx-secy)\` citations via \`vetoboard_submit_track_output\`.`;
    }
    if (hasTerminalSpecialist) {
      return zh
        ? `${idx + 1}. **第 ${w} 波（★ 跨轨交锋吸收与终局收敛定稿）**：将前序全部波次的《结构化奏折呈批卡》注入本波收敛主笔，**必须正面吸收上游合规替代路径与工程压降后的真实成本底数**，调用 \`vetoboard_calc\` 对比修正前后盈亏方程，输出 ★ 终局收敛定稿并提交 \`vetoboard_submit_track_output\`。`
        : `${idx + 1}. **Wave ${w} (★ Cross-Wave Absorption & Final Converged Baseline)**: Feed all upstream Wave 1..${w - 1} Memorial Cards into this convergence track, absorb statutory/engineering revisions, recompute via \`vetoboard_calc\`, and submit via \`vetoboard_submit_track_output\`.`;
    }
    return zh
      ? `${idx + 1}. **第 ${w} 波（横向质询交锋与护栏/工程重构，并发执行本波轨道）**：将前序波次《结构化奏折呈批卡》传给本波各专员，要求必须单列 \`### 横向交锋与上游回应\` 点名挑战或重构上游不切实际的假设（如高危收款通道、过度工程化成本），完成后提交 \`vetoboard_submit_track_output\`。`
      : `${idx + 1}. **Wave ${w} (Cross-Role Challenge, Statutory Restructure & Engineering Scope)**: Pass upstream Memorial Cards into Wave ${w} subagents in parallel; each track MUST include \`### Cross-Role Challenge & Upstream Response\` challenging/revising upstream assumptions before calling \`vetoboard_submit_track_output\`.`;
  });

  const header = zh
    ? [
        `## VetoBoard 宿主订阅驱动剧本（Task ID: \`${task.taskId}\` · ${waveNumbers.length} 波次因果交锋 DAG · 0 外部 API Token 消耗）`,
        `> **VetoBoard 核心编排铁律**：严禁把多个专业角色排成互不阅读产物的孤立平行线！当前已编排 **${task.tracks.length} 轨 · ${waveNumbers.length} 波次因果交锋链路（档位：${task.effortProfile}）**，下游角色必须读取上游《奏折呈批卡》正面交锋、推翻伪假设并收敛定稿。`,
        ...kbBlock,
        "",
        `### 执行步骤指令（请宿主 Agent 严格按以下 ${waveNumbers.length} 个因果波次推进）：`,
        ...waveStepInstructions,
      ]
    : [
        `## VetoBoard Host-Subscription Playbook (Task ID: \`${task.taskId}\` · ${waveNumbers.length}-Wave Causal Clash DAG · 0 External API Tokens)`,
        `> **VetoBoard Causal DAG Law**: Specialists NEVER run as isolated blind parallel lines! VetoBoard has scheduled **${task.tracks.length} tracks across ${waveNumbers.length} causal waves (profile: ${task.effortProfile})** so downstream guardrails & actuaries directly challenge and revise upstream assumptions.`,
        ...kbBlock,
        "",
        `### Orchestration Protocol (${waveNumbers.length} Causal Waves):`,
        ...waveStepInstructions,
      ];

  const renderTrackBrief = (tr: (typeof task.tracks)[number]) => {
    const tpl = roleByTrackId.get(tr.trackId);
    const baseCharter = tr.customCharter ?? (tpl ? renderRoleCharterPrompt(tpl, locale) : tr.title);
    const crossClashMandate =
      tr.wave >= 2 && tr.roleId !== "quality-inspector"
        ? zh
          ? tr.isTerminal
            ? `\n\n## ⚔️ 本波跨轨合流与终局定稿强制指令（dependsOn: ${tr.dependsOn.join(", ")}）\n- 你是本项目的 **【★ 终局收敛定稿】** 席位！必须完整读取前序波次《结构化奏折呈批卡》，单列 \`### 横向交锋与跨轨参数修正对照表\`，将用户原始假设、第 1 波破题假设与合规/工程修正后的真实底数并表对撞，并用 \`vetoboard_calc\` 算出修正前后的双口径对比！`
            : `\n\n## ⚔️ 本波横向交锋强制指令（dependsOn: ${tr.dependsOn.join(", ")}）\n- 严禁脱离上游自说自话！你必须读取上游波次《结构化奏折呈批卡》，在正文中单列 \`### 横向交锋与上游回应\`，明确点名指出上游/用户原方案中哪些费率、架构、买单方或合规前提不成立，并给出可落地的重构参数供下一波收敛精算使用！`
          : tr.isTerminal
            ? `\n\n## ⚔️ Mandatory Final Convergence Mandate (dependsOn: ${tr.dependsOn.join(", ")})\n- You own the **[★ Final Converged Baseline]**! Read all upstream Memorial Cards, include a \`### Cross-Wave Parameter Revision Matrix\` contrasting naive vs post-clash assumptions, and compute both via \`vetoboard_calc\`.`
            : `\n\n## ⚔️ Mandatory Cross-Role Challenge Mandate (dependsOn: ${tr.dependsOn.join(", ")})\n- Read upstream Memorial Cards and include \`### Cross-Role Challenge & Upstream Response\` explicitly naming which upstream claims/costs/redlines must be revised!`
        : "";
    const modelTag = renderTrackModelInstruction(tr.modelBinding ?? tpl?.modelBinding, locale);
    return [
      `#### Track \`${tr.trackId}\` (Wave ${tr.wave}${tr.isTerminal ? " · ★ Terminal Convergence" : ""}${tr.dependsOn.length > 0 ? ` · dependsOn: ${tr.dependsOn.join(", ")}` : ""}${modelTag})`,
      `${baseCharter}${crossClashMandate}`,
    ].join("\n");
  };

  const waveBlocks = waveNumbers.flatMap((w) => {
    const inWave = task.tracks.filter((tr) => tr.wave === w);
    const waveTitle = zh
      ? `### 第 ${w} 波轨道宪章`
      : `### Wave ${w} Track Charters`;
    return ["", waveTitle, ...inWave.map(renderTrackBrief)];
  });

  return [...header, ...waveBlocks].join("\n\n");
}
