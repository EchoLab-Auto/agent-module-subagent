# agent-module-subagent

EchoAgent 的独立 Subagent 委派模块，crate 名为 `echo-module-subagent`。

## 功能

- 提供 `spawn_subagent` 工具，把独立任务交给隔离上下文的子 Agent。
- 管理子任务注册表、取消、进度快照及完成条目的 TTL 清理。
- 执行独立推理与工具循环，不污染主会话 trunk。
- 通过结构化 `<subagent_event>` 把完成结果回灌主 Agent。
- 支持默认执行超时、无进展看门狗及联邦远程委派接缝。

## 依赖方向

本仓只依赖 Core 的基础定义、工具、协议与联邦 crate，不依赖 `echo-agent`。
宿主通过 `SubagentExecutionHost` 与执行闭包注入模型、技能和事件出口，
避免与 Agent 运行时形成循环依赖。

## 接入

```toml
echo-module-subagent = {
    git = "https://github.com/EchoLab-Auto/agent-module-subagent",
    branch = "main",
}
```

具体执行模型与宿主接缝见 [document/subagent.md](document/subagent.md)。

## 验证

```bash
cargo fmt --all -- --check
cargo test --workspace
```
