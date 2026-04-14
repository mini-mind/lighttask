import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function toText(value: string | NodeJS.ArrayBufferView | null | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8");
}

function writeFixtureFile(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function withFixture(files: Record<string, string>, callback: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lighttask-arch-check-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      writeFixtureFile(root, relativePath, content);
    }
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function buildExportFrom(exportClause: string, specifier: string): string {
  return `export ${exportClause} ${"fr"}${`om "${specifier}";\n`}`;
}

function buildTypeImport(importClause: string, specifier: string): string {
  return `import type ${importClause} ${"fr"}${`om "${specifier}";\n`}`;
}

function buildSideEffectImport(specifier: string): string {
  return `im${`port "${specifier}";\n`}`;
}

function buildDynamicImport(specifier: string): string {
  return `await im${`port("${specifier}");\n`}`;
}

function buildRequire(specifier: string): string {
  return `re${`quire("${specifier}");\n`}`;
}

function runArchCheck(root: string): ReturnType<typeof spawnSync> {
  const scriptPath = path.resolve(process.cwd(), "scripts/arch-check.mjs");
  return spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      LIGHTTASK_ARCH_CHECK_ROOT: root,
    },
  });
}

test("架构守卫：合法分层导入可通过", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `${buildTypeImport("{ TaskRepository }", "../ports")}export function createLightTask(repo?: TaskRepository<unknown>) { return repo; }\n`,
      "src/ports/index.ts": "export interface TaskRepository<TTask> {}\n",
    },
    (root) => {
      const result = runArchCheck(root);
      assert.equal(result.status, 0);
      assert.match(toText(result.stdout), /Architecture guard passed/);
    },
  );
});

test("架构守卫：普通合法相对导入可通过", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `${buildSideEffectImport("./helper")}export function createLightTask() {}\n`,
      "src/core/helper.ts": "export const helper = true;\n",
    },
    (root) => {
      const result = runArchCheck(root);
      assert.equal(result.status, 0);
      assert.match(toText(result.stdout), /Architecture guard passed/);
    },
  );
});

test("架构守卫：src 下未归层文件会直接失败", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": "export function createLightTask() {}\n",
      "src/misc/orphan.ts": 'export const orphan = "orphan";\n',
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /不属于任何已知层/);
    },
  );
});

test("架构守卫：core 通过相对路径回流依赖 root 会失败", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `${buildSideEffectImport("../index")}export function createLightTask() {}\n`,
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /core 层文件禁止依赖 root 层/);
    },
  );
});

test("架构守卫：无法解析的相对导入会失败", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `${buildSideEffectImport("./missing")}export function createLightTask() {}\n`,
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /无法解析相对导入/);
    },
  );
});

test("架构守卫：相对路径导入 src 外文件会失败", () => {
  withFixture(
    {
      "shared.ts": 'export const shared = "shared";\n',
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `${buildSideEffectImport("../../shared")}export function createLightTask() {}\n`,
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /禁止通过相对路径导入 src 目录外文件/);
    },
  );
});

test("架构守卫：src 内 symlink 指向 src 外文件会失败且错误可诊断", () => {
  withFixture(
    {
      "shared.ts": 'export const shared = "shared";\n',
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `${buildSideEffectImport("./shared-link")}export function createLightTask() {}\n`,
    },
    (root) => {
      const symlinkPath = path.join(root, "src/core/shared-link.ts");
      fs.symlinkSync("../../shared.ts", symlinkPath);

      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      const stderr = toText(result.stderr);
      assert.match(stderr, /src\/core\/lighttask\.ts/);
      assert.match(stderr, /禁止通过相对路径导入 src 目录外文件/);
      assert.match(stderr, /"\.\/shared-link"/);
    },
  );
});

test("架构守卫：src 内 symlink 指向其他层实现时按真实目标层校验", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `${buildSideEffectImport("./ports-link")}export function createLightTask() {}\n`,
      "src/ports/in-memory.ts": "export const inMemory = true;\n",
    },
    (root) => {
      const symlinkPath = path.join(root, "src/core/ports-link.ts");
      fs.symlinkSync("../ports/in-memory.ts", symlinkPath);

      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /core 层禁止依赖 ports 实现文件/);
    },
  );
});

test("架构守卫：导入未归层目标文件会失败", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `${buildSideEffectImport("../misc/helper")}export function createLightTask() {}\n`,
      "src/misc/helper.ts": 'export const helper = "helper";\n',
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /导入目标不属于任何已知层/);
    },
  );
});

test("架构守卫：可疑的非相对内部导入会失败", () => {
  withFixture(
    {
      "package.json": JSON.stringify({
        name: "lighttask",
      }),
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `${buildSideEffectImport("lighttask/internal")}export function createLightTask() {}\n`,
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /可疑的非相对内部导入/);
    },
  );
});

test("架构守卫：外部包名包含层关键字时不应误判为内部依赖", () => {
  withFixture(
    {
      "package.json": JSON.stringify({
        name: "lighttask",
        dependencies: {
          "@scope/core-tools": "1.0.0",
        },
      }),
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `${buildSideEffectImport("@scope/core-tools")}export function createLightTask() {}\n`,
    },
    (root) => {
      const result = runArchCheck(root);
      assert.equal(result.status, 0);
      assert.match(toText(result.stdout), /Architecture guard passed/);
    },
  );
});

test("架构守卫：未知的裸导入会失败，避免别名绕过层守卫", () => {
  withFixture(
    {
      "package.json": JSON.stringify({
        name: "lighttask",
      }),
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `${buildSideEffectImport("internal/core")}export function createLightTask() {}\n`,
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /未知的非相对导入/);
    },
  );
});

test("架构守卫：井号别名导入会按可疑内部导入拒绝", () => {
  withFixture(
    {
      "package.json": JSON.stringify({
        name: "lighttask",
      }),
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `${buildSideEffectImport("#/core/internal")}export function createLightTask() {}\n`,
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /可疑的非相对内部导入/);
    },
  );
});

test("架构守卫：core 深层依赖 data-structures 叶子模块会失败", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `${buildSideEffectImport("../data-structures/ds-clone")}export function createLightTask() {}\n`,
      "src/data-structures/ds-clone.ts": "export function cloneValue(value) { return value; }\n",
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /core 层禁止深层依赖 data-structures 叶子模块/);
    },
  );
});

test("架构守卫：ports 深层依赖 data-structures 叶子模块会失败", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": "export function createLightTask() {}\n",
      "src/ports/in-memory.ts": `${buildSideEffectImport("../data-structures/ds-clone")}export const inMemory = true;\n`,
      "src/data-structures/ds-clone.ts": "export function cloneValue(value) { return value; }\n",
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /ports 层禁止深层依赖 data-structures 叶子模块/);
    },
  );
});

test("架构守卫：rules 依赖 ports 会失败", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": "export function createLightTask() {}\n",
      "src/rules/rule-task-fsm.ts": `${buildTypeImport("{ TaskRepository }", "../ports")}export type RuleDep = TaskRepository<unknown>;\n`,
      "src/ports/index.ts": "export interface TaskRepository<TTask> {}\n",
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /rules 层文件禁止依赖 ports 层/);
    },
  );
});

test("架构守卫：ports 依赖 rules 会失败", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": "export function createLightTask() {}\n",
      "src/ports/port-task-repo.ts": `${buildTypeImport("{ TaskAction }", "../rules")}export type PortDep = TaskAction;\n`,
      "src/rules/index.ts": 'export type TaskAction = "dispatch";\n',
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /ports 层文件禁止依赖 rules 层/);
    },
  );
});

test("架构守卫：core 依赖 ports 实现文件会失败", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `${buildSideEffectImport("../ports/in-memory")}export function createLightTask() {}\n`,
      "src/ports/in-memory.ts": "export const inMemory = true;\n",
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /core 层禁止依赖 ports 实现文件/);
    },
  );
});

test("架构守卫：core 通过 dynamic import 依赖 ports 实现文件会失败", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `export async function createLightTask() { ${buildDynamicImport("../ports/in-memory")} }\n`,
      "src/ports/in-memory.ts": "export const inMemory = true;\n",
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /core 层禁止依赖 ports 实现文件/);
    },
  );
});

test("架构守卫：core 通过 require 依赖 ports 实现文件会失败", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `export function createLightTask() { ${buildRequire("../ports/in-memory")} }\n`,
      "src/ports/in-memory.ts": "export const inMemory = true;\n",
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /core 层禁止依赖 ports 实现文件/);
    },
  );
});

test("架构守卫：src 下的 JS 源文件也会参与层级检查", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.js": `${buildSideEffectImport("../ports/in-memory")}export function createLightTask() {}\n`,
      "src/ports/in-memory.js": "export const inMemory = true;\n",
    },
    (root) => {
      const result = runArchCheck(root);
      assert.notEqual(result.status, 0);
      assert.match(toText(result.stderr), /core 层禁止依赖 ports 实现文件/);
    },
  );
});

test("架构守卫：core 走 data-structures 稳定入口可通过", () => {
  withFixture(
    {
      "src/index.ts": buildExportFrom("{ createLightTask }", "./core/lighttask"),
      "src/core/lighttask.ts": `${buildSideEffectImport("../data-structures")}export function createLightTask() {}\n`,
      "src/data-structures/index.ts": "export const cloneValue = (value) => value;\n",
    },
    (root) => {
      const result = runArchCheck(root);
      assert.equal(result.status, 0);
      assert.match(toText(result.stdout), /Architecture guard passed/);
    },
  );
});
