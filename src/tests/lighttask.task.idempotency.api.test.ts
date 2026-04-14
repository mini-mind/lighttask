import assert from "node:assert/strict";
import test from "node:test";
import type { PersistedLightTask } from "../core/types";
import { LightTaskError, createLightTask } from "../index";
import type { TaskRepository } from "../ports";
import { createTestLightTaskOptions } from "./ports-fixture";

test("LightTask 公共 API 在同幂等键重复推进时会拒绝语义不一致请求", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "幂等冲突校验",
  });

  lighttask.advanceTask(task.id, {
    expectedRevision: 1,
    idempotencyKey: "req_1",
  });

  assert.throws(
    () =>
      lighttask.advanceTask(task.id, {
        expectedRevision: 2,
        idempotencyKey: "req_1",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      return true;
    },
  );
});

test("LightTask 公共 API 在同幂等键同版本重复推进时返回 replay 快照", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "幂等重放校验",
  });

  const first = lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 1,
    idempotencyKey: "req_replay_1",
  });
  const replay = lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 1,
    idempotencyKey: "req_replay_1",
  });

  assert.equal(first.status, "dispatched");
  assert.equal(first.revision, 2);
  assert.deepEqual(replay, first);
});

test("LightTask 幂等 replay 不应触发额外写入副作用", () => {
  const snapshots: PersistedLightTask[] = [];
  let saveCount = 0;
  const taskRepository: TaskRepository<PersistedLightTask> = {
    list() {
      return snapshots.map((task) => structuredClone(task));
    },
    get(taskId) {
      const task = snapshots.find((item) => item.id === taskId);
      return task ? structuredClone(task) : undefined;
    },
    create(task) {
      const snapshot = structuredClone(task);
      snapshots.push(snapshot);
      return {
        ok: true as const,
        task: snapshot,
      };
    },
    saveIfRevisionMatches(task, expectedRevision) {
      saveCount += 1;
      const index = snapshots.findIndex((item) => item.id === task.id);
      assert.notEqual(index, -1);
      assert.equal(snapshots[index].revision, expectedRevision);
      const snapshot = structuredClone(task);
      snapshots[index] = snapshot;
      return {
        ok: true as const,
        task: snapshot,
      };
    },
  };
  const lighttask = createLightTask(createTestLightTaskOptions({ taskRepository }));
  const task = lighttask.createTask({
    title: "幂等写入副作用校验",
  });

  const first = lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 1,
    idempotencyKey: "req_replay_write_once",
  });
  const replay = lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 1,
    idempotencyKey: "req_replay_write_once",
  });

  assert.equal(saveCount, 1);
  assert.deepEqual(replay, first);
  assert.equal(snapshots[0].revision, 2);
  assert.equal(snapshots[0].status, "dispatched");
});

test("LightTask 幂等 replay 返回快照也必须与内部状态隔离", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "幂等隔离校验",
  });

  lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 1,
    idempotencyKey: "req_replay_2",
  });
  const replay = lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 1,
    idempotencyKey: "req_replay_2",
  });

  replay.title = "被外部篡改";
  replay.steps[0].status = "todo";

  const stored = lighttask.getTask(task.id);
  assert.ok(stored);
  assert.equal(stored.title, "幂等隔离校验");
  assert.equal(stored.steps[0].status, "done");
});

test("LightTask 公共返回值不会泄漏内部指纹字段", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const created = lighttask.createTask({
    title: "内部字段隔离校验",
  });

  const createdRecord = created as unknown as Record<string, unknown>;
  assert.equal(Object.hasOwn(createdRecord, "lastAdvanceFingerprint"), false);

  const advanced = lighttask.advanceTask(created.id, {
    action: "dispatch",
    expectedRevision: 1,
    idempotencyKey: "req_public_contract",
  });
  const replay = lighttask.advanceTask(created.id, {
    action: "dispatch",
    expectedRevision: 1,
    idempotencyKey: "req_public_contract",
  });
  const fetched = lighttask.getTask(created.id);
  const listed = lighttask.listTasks()[0];

  for (const snapshot of [advanced, replay, fetched, listed]) {
    assert.ok(snapshot);
    assert.equal(
      Object.hasOwn(snapshot as unknown as Record<string, unknown>, "lastAdvanceFingerprint"),
      false,
    );
  }
});

test("LightTask 公共 API 传入空白幂等键时会回退为历史幂等键", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "幂等键回退校验",
  });

  lighttask.advanceTask(task.id, {
    expectedRevision: 1,
    idempotencyKey: "req_keep",
  });
  const second = lighttask.advanceTask(task.id, {
    expectedRevision: 2,
    idempotencyKey: "   ",
  });

  assert.equal(second.status, "running");
  assert.equal(second.revision, 3);
  assert.equal(second.idempotencyKey, "req_keep");
});
