## Summary / 变更摘要
<!-- 简要说明本次 PR 解决的问题或新增的能力 / Briefly describe what this PR fixes or adds -->

- 

## Verification Checklist / 提交前自检清单

- [ ] `pnpm run build` 编译零报错 (Zero TypeScript errors)
- [ ] `pnpm test` 全量回归测试通过 (All E2E & cross-platform compatibility tests pass)
- [ ] `pnpm run smoke:llm` 跨厂商 Schema 门禁通过（零 `$schema` / `propertyNames` / `anyOf` 违规）
- [ ] 未包含任何本地绝对路径、私人业务数据或密钥凭据 (Zero personal paths, private data, or secrets)
