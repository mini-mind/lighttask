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
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
}

test("CLI：无参数时返回帮助信息", () => {
  const result = runCli([]);
  assert.equal(result.status, 0);
  assert.match(toText(result.stdout), /LightTask CLI/);
});

test("CLI：create 缺少标题时返回错误", () => {
  const result = runCli(["create"]);
  assert.notEqual(result.status, 0);
  assert.match(toText(result.stderr), /create 命令需要任务标题/);
});

test("CLI：create 命令默认创建 draft 任务", () => {
  const result = runCli(["create", "新建任务"]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(toText(result.stdout)) as {
    title: string;
    status: string;
    planId: string;
  };
  assert.equal(parsed.title, "新建任务");
  assert.equal(parsed.status, "draft");
  assert.equal(parsed.planId, "plan_cli_default");
});

test("CLI：demo 命令返回推进后的任务快照", () => {
  const result = runCli(["demo"]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(toText(result.stdout)) as { status: string };
  assert.equal(parsed.status, "dispatched");
});
