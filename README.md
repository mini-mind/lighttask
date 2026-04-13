# LightTask

LightTask 是通用人机协作编排内核，不是 uTools 应用。目标是为 `linpo`、`TopoFlow` 等应用层提供可复用的核心能力。

## 定位

- `multica`：作为核心功能参考，挖其芯为核。
- `lazyai`：只取极简 harness 思路，补足 codex 式编排、验证与协作能力。
- `linpo`、`TopoFlow`：属于应用层，当前仓库只提供通用内核。

## 范围

- 纯 TypeScript 内核库。
- 只保留公共 API 与 CLI 冒烟入口。
- 不承载 uTools 壳、页面、预加载脚本和应用层策略。

## 目录

```text
lighttask/
├─ README.md
├─ AGENTS.md
├─ .gitignore
├─ package.json            # 包定义与脚本入口
├─ tsconfig.json           # TypeScript 编译配置
├─ src/                    # 源码根目录
│  ├─ core/                # 内核模型、状态与编排能力
│  ├─ cli/                 # 命令行入口与冒烟验证
│  └─ tests/               # API 行为测试
```

## 使用

```bash
npm install
npm run check
npm run dev:cli -- demo
```
