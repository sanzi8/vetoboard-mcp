# VetoBoard MCP (`vetoboard-mcp`)

<p align="center">
  <img src="https://img.shields.io/badge/MCP-Protocol%202025-1a73e8?style=flat-square" alt="MCP Protocol" />
  <img src="https://img.shields.io/badge/Version-1.4.0-34a853?style=flat-square" alt="Version 1.4.0" />
  <img src="https://img.shields.io/badge/License-Apache%202.0-fbbc04?style=flat-square" alt="Apache 2.0 License" />
  <img src="https://img.shields.io/badge/Platform-Claude%20Code%20%7C%20Cursor%20%7C%20Antigravity%20%7C%20Codex%20%7C%20Hermes%20%7C%20T3%20Code-ea4335?style=flat-square" alt="Supported Platforms" />
</p>

<p align="center">
  <b>Eliminate single-model sycophancy, multi-agent mesh brawls, and mental-math hallucinations inside your AI coding IDE.</b><br/>
  Dynamic Shared Whiteboard, ELECTRE/QMV Mathematical Dominance Voting, 16 Bilingual Specialist Roles, 27 Pure-Text Governance Skills &amp; Zero-Hallucination Math Reconciliation (`vetoboard_calc`).
</p>

<p align="center">
  <a href="./README.md">简体中文</a> | <b><a href="./README.en.md">English</a></b>
</p>

---

## 📦 1. Installation

### Option 1: Download Pre-Built Release Bundle (Recommended · Zero Build Step)
1. Visit **[Releases](https://github.com/sanzi8/vetoboard-mcp/releases/latest)**, download `vetoboard-mcp-v1.4.0.zip`, and extract it to a permanent folder.
2. Run the 1-command installer inside the extracted folder:
   ```bash
   node ./dist/cli.js init --local-bin
   ```
3. The installer automatically detects **Antigravity, Claude Code, Cursor, OpenAI Codex, Hermes Agent, and OpenCode / T3 Code**, non-destructively installing:
   - **MCP Server** (13 tools with cross-vendor DeepSeek/OpenAI/Gemini JSON Schema sanitizer)
   - **Always-On Guardrail Rules (`AGENTS.md`)** + **`/vetoboard` Slash Command / Skill**
   - **16 Bilingual Specialist Roles + 27 Bundled Pure-Text Governance Skills**
4. Click **`MCP Servers > Refresh`** in your IDE and start using `/vetoboard`!

### Option 2: Clone & Build from Source
```bash
git clone https://github.com/sanzi8/vetoboard-mcp.git
cd vetoboard-mcp
pnpm install
pnpm run build
node ./dist/cli.js init --local-bin
```

---

## 🚀 2. Step-by-Step Usage Guide

> [!IMPORTANT]
> **Zero Extra API Cost by Default**: `vetoboard-mcp` defaults to `host-subscription` mode — reusing your existing IDE subscription with **\$0 extra third-party API cost**. Pre-flight model selection and role weight tuning happen right in normal chat prose with zero popups.

![VetoBoard Live Antigravity 3-Pane Shared Whiteboard & Swarm Demo](./assets/vetoboard-antigravity-demo.svg)

1. **Step 1 — Launch Pre-Flight Bench**: Type `/vetoboard <your business plan or software architecture goal>`. VetoBoard scans your reusable roles, skills, and historical Knowledge Cards, groups your host models & quotas, and prints a 6-column recommended lineup table.
2. **Step 2 — Confirm or Customize in Plain Language**: Reply **`Go`** (or e.g. *`"Use opus for profit-modeler, flash for tech-feasibility, add hr-roi-analyst, Go"`*). Specialists run live web grounding (`board_post`), adjudicate conflicts via **ELECTRE + EU QMV** (`board_review`, `D >= 60%/65%`, `C >= 66.7%`, `R <= 2` early stop), write parallel deliverables, and pass a cross-family **`[V1]` Quality Inspector** (`vetoboard_calc` 0.5% tolerance audit).
3. **Step 3 — Read Cited Bundle & Distill Assets**: Inspect the 3 exported workspace `.md` reports (`-briefing.md` with clickable `[[S1·§2]]` & `[[V1]]` anchors, `-report.md`, `-original-report.md`), and optionally reply *`"Save as skill"`* or *`"Save as project pack"`*.

---

## 🧩 3. Included MCP Tools (13 Tools) & Built-in Arsenal

- **13 Governance Tools**: `vetoboard_plan_lineup`, `vetoboard_start_council`, `vetoboard_update_council`, `vetoboard_submit_track_output`, `vetoboard_calc`, `vetoboard_audit_output`, `vetoboard_distill_skill`, `vetoboard_contribute_asset`, `vetoboard_self_update`, `vetoboard_clarify_routes`, `vetoboard_get_role_charter`, `vetoboard_compress_memorial`, `vetoboard_task_status`.
- **16 Built-in Specialist Roles**: `market-analyst`, `profit-modeler`, `legal-advisor`, `tech-feasibility`, `operations-sop`, `risk-assessor`, `product-strategist`, `hr-roi-analyst`, `plg-growth-strategist`, `saas-billing-architect`, `task-delegation-advisor`, `software-architect`, `backend-engineer`, `frontend-engineer`, `code-reviewer`, and `quality-inspector`.
- **27 Pure-Text Governance Skills**: Bundled in [`./skills/`](./skills) with original upstream `MIT` / `Apache-2.0` licenses preserved.

---

## 🛠️ Development & Verification

```bash
pnpm install
pnpm run build
pnpm test
pnpm run smoke:llm
```

---

## 📄 License

Licensed under the [Apache License 2.0](./LICENSE).
