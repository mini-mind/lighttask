import assert from "node:assert/strict";
import test from "node:test";
import {
  createInMemoryNotifyCollector,
  createInMemoryPlanRepository,
  createInMemoryTaskRepository,
  createMemoryAdapters,
} from "../adapters/memory";
import { createCoreError } from "../models";
import { createExampleTaskPolicies } from "./adapters-fixture";

test("in-memory 任务仓储支持创建、条件保存和条件删除", () => {
  const repository = createInMemoryTaskRepository<{
    id: string;
    revision: number;
    title: string;
  }>();
  const created = repository.create({
    id: "task_1",
    revision: 1,
    title: "任务一",
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const saved = repository.saveIfRevisionMatches(
    {
      id: "task_1",
      revision: 2,
      title: "任务一-更新",
    },
    1,
  );
  assert.equal(saved.ok, true);

  const deleted = repository.deleteIfRevisionMatches("task_1", 2);
  assert.equal(deleted.ok, true);
  assert.equal(repository.get("task_1"), undefined);
});

test("in-memory notify collector 保持事件快照隔离", () => {
  const collector = createInMemoryNotifyCollector();
  const event = {
    id: "event_1",
    type: "task.created" as const,
    aggregate: "task" as const,
    aggregateId: "task_1",
    occurredAt: "2026-04-16T00:00:00.000Z",
    revision: 1,
    version: 1 as const,
    payload: { title: "任务一" },
  };
  collector.publish(event);
  event.payload.title = "被改写";
  assert.deepEqual(collector.listPublished()[0].payload, { title: "任务一" });
});

test("createMemoryAdapters 返回完整最小端口集合", () => {
  const taskPolicies = createExampleTaskPolicies();
  const ports = createMemoryAdapters({
    notify: createInMemoryNotifyCollector(),
    planRepository: createInMemoryPlanRepository(),
    taskPolicies,
  });
  assert.equal(typeof ports.taskRepository.list, "function");
  assert.equal(typeof ports.planRepository.create, "function");
  assert.equal(typeof ports.consistency.run, "function");
  assert.equal(ports.taskPolicies, taskPolicies);
});

test("仓储错误工厂返回结构化领域错误", () => {
  const error = createCoreError("STATE_CONFLICT", "冲突");
  assert.equal(error.code, "STATE_CONFLICT");
});
