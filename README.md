# vetoboard-mcp — Shared Whiteboard & Hard-Veto Mathematical Governance MCP

**[English](./README.md) | [简体中文](./README.zh-CN.md)**

> **Stop single-model sycophancy, mesh-debate chaos, and mental-math hallucinations inside Claude Code, Cursor, Antigravity, and Codex.**
> `vetoboard-mcp` brings an **Office Shared Whiteboard**, **ELECTRE + EU QMV Mathematical Dominance Engine**, **Non-Compensatory Hard Veto Gates**, **Zero-Hallucination `vetoboard_calc` Reconciliation**, and **Per-Role Heterogeneous Model Binding** into any MCP-compatible coding agent — **defaulting to `$0` extra API cost on your existing IDE subscription.**

---

## Why `vetoboard-mcp`?

1. **Dynamic Shared Whiteboard + `ELECTRE / QMV` Governance (Zero Mesh Brawls!)**:
   - **Step 1 · 100% Concurrent Prep (`board_post`)**: Specialist subagents research/compute in parallel and post key `variables` onto a shared public whiteboard.
   - **Step 2 · Diff & Mathematical Dominance (`board_review`)**: Roles mark `approve` (irrelevant or beneficial -> zero clash!), `conditional` (self-adapted), or `oppose` (`targetTrackIds` + `neededDimensions`).
   - **Step 3 · Operations-Research Gate**: Evaluates **Contention Dominance** ($D = W^+/(W^+ + W^-) \ge 60\% / 65\%$), **ELECTRE Global Concordance** ($C \ge 66.7\%$), **EU Double-Majority Seat Floor** ($\ge 50\%$), and **Non-Compensatory Hard Veto** (grounded negative margin, compile/test failure, or statutory ban). Dominant proposals pass automatically with Minority Dissent preserved; close ties wake *only* the matching capability-dimension specialists for at most `R <= 2` rounds (`Belief-Delta = 0` early-stops immediately to user decision).
   - **Step 4 · 100% Parallel Heavy Execution & `[V1]` Cited Audit**: Unlocks full parallel deliverable writing, independent `vetoboard_calc (reconcile)` verification, 3-file workspace report export (`-report.md`, `-briefing.md`, `-original-report.md`), automatic Knowledge Card distillation, and clean exit back to normal chat.
2. **Deterministic Math Verifier (`vetoboard_calc`)**: Recursive-descent formula, BEP/margin/sensitivity, and `reconcile` auditor catching `> 0.5%` arithmetic hallucinations before sign-off.
3. **Per-Role Heterogeneous `modelBinding`**: Bind different host tiers (`pro` / `flash`) or independent BYOK/OpenRouter/DeepSeek models per role (`modelOverrides`).
4. **Autonomous Asset Flywheel (`vetoboard_distill_skill` + `vetoboard_contribute_asset`)**: Distill verified runs into standardized `SKILL.md` & reusable role JSONs, with optional privacy-scrubbed Method A GitHub contribution (strictly scoped to project upgrades/optimization and **100% withdrawable anytime**).

---

## Quickstart (Local `npx` or Remote `Streamable HTTP`)

### Claude Code
```bash
claude mcp add vetoboard -- npx -y vetoboard-mcp --lang auto
```

### Cursor / Antigravity / Windsurf (`mcp_config.json` or `.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "vetoboard": {
      "command": "npx",
      "args": ["-y", "vetoboard-mcp", "--lang", "auto"]
    }
  }
}
```

### OpenAI Codex CLI (`~/.codex/config.toml`)
```toml
[mcp_servers.vetoboard]
command = "npx"
args = ["-y", "vetoboard-mcp", "--lang", "auto"]
```

### Remote Team HTTP Server
```bash
VETOBOARD_SERVER_TOKENS="sk-team-secret" npx vetoboard-mcp serve --host 0.0.0.0 --port 4399 --lang auto
```

---

## Included MCP Tools (12 Tools)

1. `vetoboard_plan_lineup` — Pre-flight 3-pillar asset retrieval (Roles, Native `SKILL.md`, Historical Knowledge Cards) & conversational score briefing.
2. `vetoboard_start_council` — Launch an isolated council (`whiteboard-electre` default, configurable `weightOverrides`, `modelOverrides`, `customRoles`, `spawnRoleFromSkillIds`).
3. `vetoboard_update_council` — Live mid-flight re-weighting, model re-binding, conflict resolution (`resolvePremiseConflictChoice`), and dynamic role injection.
4. `vetoboard_submit_track_output` — Submit `board_post`, `board_review`, or parallel `deliverable`; runs Rule Gate, exports 3-file cited report bundle, and distills Knowledge Cards.
5. `vetoboard_calc` — Deterministic `expression`, `unit_economics`, `weighted_score`, and `reconcile` math engine.
6. `vetoboard_audit_output` — Code-level `ExecutableRules` + premise-reversal guard + per-role heterogeneous BYOK critique.
7. `vetoboard_distill_skill` — Distill verified SOPs, checklists, and pitfalls into standardized `SKILL.md` & companion reusable roles.
8. `vetoboard_contribute_asset` — Privacy-scrubbed Method A GitHub contribution (`preview` -> explicit consent -> `submit` -> unconditional `withdraw` / `list`).
9. `vetoboard_clarify_routes` — Diverge-Then-Converge 4-route comparison matrix.
10. `vetoboard_get_role_charter` — Inspect weighted bilingual role charters.
11. `vetoboard_compress_memorial` — Compress 20k+ char artifacts by ~80% into `<workflow_memorial_card>` coordinate indexes.
12. `vetoboard_task_status` — Inspect live `docker build`-style progress tree & Catch Ticker (or run `npx vetoboard-mcp watch <taskId>`).

---

## Development & Verification

```bash
pnpm install
pnpm run build
pnpm test
```

## License

Licensed under the [Apache License 2.0](./LICENSE).
