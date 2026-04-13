import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

function runCli(args: string[]): ReturnType<typeof spawnSync> {
  const cliPath = path.resolve(process.cwd(), "dist/cli/smoke.js");
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
  });
}

test("CLI：无参数时返回帮助信息", () => {
  const result = runCli([]);
  const stdout = toText(result.stdout);
  assert.equal(result.status, 0);
  assert.match(stdout, /LightTask CLI/);
  assert.match(stdout, /用法/);
});

test("CLI：help 命令返回帮助信息", () => {
  const result = runCli(["help"]);
  const stdout = toText(result.stdout);
  assert.equal(result.status, 0);
  assert.match(stdout, /LightTask CLI/);
});

test("CLI：create 缺少标题时返回错误", () => {
  const result = runCli(["create"]);
  const stderr = toText(result.stderr);
  const stdout = toText(result.stdout);
  assert.notEqual(result.status, 0);
  assert.equal(stdout, "");
  assert.match(stderr, /create 命令需要任务标题/);
});

test("CLI：未知命令返回错误", () => {
  const result = runCli(["unknown"]);
  const stderr = toText(result.stderr);
  const stdout = toText(result.stdout);
  assert.notEqual(result.status, 0);
  assert.equal(stdout, "");
  assert.match(stderr, /未知命令/);
});

test("CLI：create 命令可创建任务并输出 JSON", () => {
  const result = runCli(["create", "新建任务"]);
  const stdout = toText(result.stdout);
  assert.equal(result.status, 0);

  const parsed = JSON.parse(stdout) as {
    title: string;
    steps: Array<{ status: string }>;
  };
  assert.equal(parsed.title, "新建任务");
  assert.equal(parsed.steps[0].status, "doing");
});

test("CLI：create 命令会拼接并 trim 多段标题参数", () => {
  const result = runCli(["create", "  多段", "任务标题  "]);
  const stdout = toText(result.stdout);
  assert.equal(result.status, 0);

  const parsed = JSON.parse(stdout) as {
    title: string;
  };
  assert.equal(parsed.title, "多段 任务标题");
});

test("CLI：demo 命令返回推进后的任务快照", () => {
  const result = runCli(["demo"]);
  const stdout = toText(result.stdout);
  assert.equal(result.status, 0);

  const parsed = JSON.parse(stdout) as {
    summary?: string;
    steps: Array<{ status: string }>;
  };
  assert.equal(parsed.summary, "通过 CLI 冒烟验证公共 API");
  assert.equal(parsed.steps[0].status, "done");
  assert.equal(parsed.steps[1].status, "doing");
});
