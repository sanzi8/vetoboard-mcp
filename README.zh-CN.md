# vetoboard-mcp — 共享白板与硬否决数学治理 MCP 中枢

**[English](./README.md) | [简体中文](./README.zh-CN.md)**

> **终结 Claude Code、Cursor、Antigravity 与 Codex 单模型对话中的“顺从迎合”、“多智能体群聊混战”与“心算幻觉”。**
> `vetoboard-mcp` 通过标准 MCP 协议，将**办公室动态共享白板**、**ELECTRE + 欧盟 QMV 运筹学数学支配引擎**、**非补偿性硬死穴一票否决（Hard Veto）**、**零幻觉 `vetoboard_calc` 确定性核账器**与**分角色异构模型绑定**直接接入你现有的编程工具——**默认复用宿主 IDE 订阅额度，额外 API 成本为 `$0`。**

---

## 核心特性

1. **办公室动态共享白板 + `ELECTRE / QMV` 数学治理（拒绝拉群混战）**：
   - **步骤 1 · 100% 并发备课贴白板（`board_post`）**：各专业角色并发查证/初算，将核心摘要与公开指标 `variables` 贴上共享白板；
   - **步骤 2 · 全员阅板留痕（`board_review`）**：无关或有利直接 `approve` 吸收放过（0 争吵秒过）；单方微调填 `conditional`；意见相反填 `oppose` 并声明缺失维度 `neededDimensions`；
   - **步骤 3 · 运筹学数学支配门禁**：自动计算**焦点支配率**（$D = W^+/(W^+ + W^-) \ge 60\% / 65\%$）、**全场和谐度**（$C \ge 66.7\%$）、**防寡头席位线**（$\ge 50\%$）与**非补偿性客观硬死穴锁**（实测负毛利、编译报错、违法红线）。主导方显著占优时无需全员同意即可直接带《少数派保留意见备忘》放行；势均力敌时仅精准唤醒对应维度专员协商（硬上限 `R <= 2` 轮 + `Belief-Delta = 0` 票型零变化早停转人工拍板）；
   - **步骤 4 · 100% 满并发定稿 + `[V1]` 全角标终验存库退场**：并发产出完整底稿/代码，经独立只读督察复算后导出工作区三件套（`-report.md`、`-briefing.md`、`-original-report.md`），自动沉淀入本地实战知识库（`~/.vetoboard-mcp/library/knowledge/`）并干净退回普通对话。
2. **分角色异构模型绑定（`modelBinding`）**：支持为不同席位分配不同宿主模型档位（`pro` / `flash`）或独立第三方 BYOK 模型（如 DeepSeek / OpenRouter / GPT）。
3. **自主多形态资产沉淀、方法 A 可撤回共享与一句话自更新闭环**：
   - `vetoboard_distill_skill`：任务完成后支持一句话将实战成果沉淀为 **标准技能 (`SKILL.md` + 自动同步宿主 IDE)**、**标准角色 (`Role`)**、**护栏规则 (`Rule`)** 或 **整套项目委员会阵容模板 (`.vetoboard-pack.json`)**；
   - `vetoboard_contribute_asset`：强制先本地脱敏预览并明确告知**「收录进库、仅用于项目升级或优化、凭单号 100% 随时可撤回」**，经用户确认后生成方法 A GitHub 投递单，随时支持 `withdraw` 一键撤回；
   - `vetoboard_self_update`：内置 24 小时非阻塞低频版本检查（有新版才在报告末尾附 1 行提示，支持 `VETOBOARD_NO_UPDATE_CHECK=1` 禁用），回复「更新 VetoBoard」即可自动完成 Git 拉取重编译（含脏工作区保护）或 `npm i -g vetoboard-mcp@latest` 升级。

---

## 10 秒快速挂载

### Claude Code
```bash
claude mcp add vetoboard -- npx -y vetoboard-mcp@latest --lang auto
```

### Cursor / Antigravity / Windsurf (`mcp_config.json` 或 `.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "vetoboard": {
      "command": "npx",
      "args": ["-y", "vetoboard-mcp@latest", "--lang", "auto"]
    }
  }
}
```

### Hermes Agent + DeepSeek (`~/.hermes/config.yaml`) / OpenAI Codex (`~/.codex/config.toml`)
```yaml
# ~/.hermes/config.yaml
mcp_servers:
  vetoboard:
    command: "npx"
    args: ["-y", "vetoboard-mcp@latest", "--lang", "auto"]
```

### 远程团队 HTTP 模式
```bash
VETOBOARD_SERVER_TOKENS="sk-team-secret" npx vetoboard-mcp@latest serve --host 0.0.0.0 --port 4399 --lang auto
```

---

## 内置 13 大 MCP 工具

1. `vetoboard_plan_lineup` — 战前检索可复用角色、本机 `SKILL.md` 与历史实战知识卡，输出跨平台模型选配与打分单。
2. `vetoboard_start_council` — 启动隔离审理任务（默认激活 `whiteboard-electre`，支持 `weightOverrides`、`modelOverrides`、`customRoles`）。
3. `vetoboard_update_council` — 运行中动态调权、改绑模型、人工拍板解锁冲突（`resolvePremiseConflictChoice`）。
4. `vetoboard_submit_track_output` — 提交白板指标（`board_post`）、阅板裁决（`board_review`）或并发底稿（`deliverable`），自动签发三件套、沉淀知识卡并附带资产沉淀菜单。
5. `vetoboard_calc` — 零幻觉递归下降公式求值、单位经济 BEP 敏感度矩阵与 `reconcile` 独立核账引擎。
6. `vetoboard_audit_output` — 代码级 `ExecutableRules` 硬门禁 + 偷换前提检测 + 分角色 BYOK 异构审查。
7. `vetoboard_distill_skill` — 多形态资产沉淀引擎（支持导出 `skill`、`role`、`rule`、`project-pack` 并自动同步宿主 IDE）。
8. `vetoboard_contribute_asset` — 方法 A 隐私脱敏预览、透明授权投递（支持 `role` / `skill` / `pack`）与 `withdraw` 一键无条件撤回。
9. `vetoboard_self_update` — 版本检查与一句话自更新引擎（支持 Git 仓库安全拉取重编译与 npm 全局升级）。
10. `vetoboard_clarify_routes` — 先发散后收敛 4 候选路线对比矩阵。
11. `vetoboard_get_role_charter` — 读取内置双语高权重角色宪章。
12. `vetoboard_compress_memorial` — 数万字长底稿 `-80%` 零损耗压缩为行号坐标卡。
13. `vetoboard_task_status` — 查看类 `docker build` 分轨进度树与抓虫播报（或终端运行 `npx vetoboard-mcp watch <taskId>`）。

---

## 构建与回归测试

```bash
pnpm install
pnpm run build
pnpm test
```

## 开源协议

基于标准 [Apache License 2.0](./LICENSE) 开源发布。
