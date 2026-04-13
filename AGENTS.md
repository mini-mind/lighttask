# AGENTS

## 定位

LightTask 是通用人机协作编排内核，不是 uTools 应用仓库。`linpo` 和 `TopoFlow` 是应用层，当前仓库只提供可复用公共能力。

## 版本基线

- Node.js：20.x
- npm：10.x
- TypeScript：5.9.x
- 模块配置：`module: Node20`
- 模块解析：`moduleResolution: Node16`（TypeScript 5.9 在 `module: Node20` 下的稳定配对）
- 编译目标：`target: ES2023`

## 协作规则

- 与用户沟通使用中文。
- 关键代码写中文注释，优先解释设计意图和边界。
- 主 agent 负责拆解、调度 subagents、验收与收敛。
- subagents 统一使用 `gpt-5.3-codex` 并行推进。
- 禁止频繁催促 subagents。

## 流程

- 困难任务必须遵循：`调查 -> 设计 -> 实现 -> 验证 -> 收敛`。
- 禁止未经用户同意的托底策略。
- 禁止未经用户同意的回退策略。

## 仓库约束

- 保持纯 TypeScript 内核库形态。
- 通过 CLI 调用和测试公共 API。
- 不在本仓库内叠加 uTools 壳和其他应用层冗余能力。
