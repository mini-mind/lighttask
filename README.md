# LightTask

LightTask 是通用人机协作编排内核，不是 uTools 应用。目标是为 `linpo`、`TopoFlow` 等应用层提供可复用的核心能力。

## 定位

- `multica`：作为核心功能参考，挖其芯为核。
- `lazyai`：只取极简 harness 思路，补足 codex 式编排、验证与协作能力。
- `linpo`、`TopoFlow`：属于应用层，当前仓库只提供通用内核。

## 范围

- 纯 TypeScript 内核库。
- 只保留公共 API 与 CLI 冒烟入口（根入口 + `data-structures`/`rules`/`ports` 子入口）。
- 不承载 uTools 壳、页面、预加载脚本和应用层策略。

## 当前能力

- 任务创建、查询、推进、幂等重放。
- 任务状态机、DAG 校验、revision 规则。
- 最小端口：任务仓储、时钟、ID 生成器。
- 统一错误面：`LightTaskError`。

## 目录

```text
lighttask/
├─ README.md
├─ AGENTS.md
├─ .gitignore
├─ package.json            # 包定义与脚本入口
├─ tsconfig.json           # TypeScript 编译配置
├─ src/                    # 源码根目录
│  ├─ data-structures/     # 数据结构层：实体、状态、事件、错误、revision
│  ├─ rules/               # 规则层：FSM、DAG、幂等、revision 规则
│  ├─ ports/               # 端口层：仓储、时钟、ID 生成等接口契约
│  ├─ core/                # 内核编排入口（组合规则层，不承载应用层策略）
│  ├─ cli/                 # 命令行入口与冒烟验证
│  └─ tests/               # API 与规则回归测试
```

## 契约

- `createTask`：`title.trim()` 后必须非空。
- `advanceTask`：必须显式传入 `expectedRevision`。
- 错误：统一抛 `LightTaskError`，可按 `code`、`message`、`details` 判别。

## 使用

```bash
npm install
npm run check
npm run dev:cli -- demo
```
