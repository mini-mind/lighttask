import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultRuntimeLifecyclePolicy,
  defaultTaskLifecyclePolicy,
  getNextTaskStatus,
  listTaskActions,
  transitionRuntimeStatus,
  transitionTaskStatus,
} from "../rules";

test("规则层：Task FSM 只允许终局动作集合", () => {
  assert.equal(defaultTaskLifecyclePolicy.initialStatus, "draft");
  assert.deepEqual(listTaskActions("draft"), ["finalize"]);
  assert.equal(getNextTaskStatus("todo", "dispatch"), "dispatched");
  assert.deepEqual(transitionTaskStatus("running", "complete"), {
    ok: true,
    status: "completed",
  });
});

test("规则层：非法 Task 迁移会返回状态冲突", () => {
  const result = transitionTaskStatus("draft", "dispatch");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "STATE_CONFLICT");
  }
});

test("规则层：Runtime FSM 保持最小生命周期", () => {
  assert.equal(defaultRuntimeLifecyclePolicy.initialStatus, "queued");
  assert.deepEqual(transitionRuntimeStatus("queued", "start"), {
    ok: true,
    status: "running",
  });
});
