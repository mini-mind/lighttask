import assert from "node:assert/strict";
import test from "node:test";
import type { PersistedLightTask } from "../core/types";
import type { GraphSnapshot, PlanSessionRecord } from "../data-structures";
import {
  createInMemoryGraphRepository,
  createInMemoryPlanRepository,
  createInMemoryTaskRepository,
  createSystemClock,
  createTaskIdGenerator,
} from "../ports/in-memory";

function createPersistedTask(taskId: string, revision = 1): PersistedLightTask {
  return {
    id: taskId,
    title: `任务 ${taskId}`,
    summary: `摘要 ${taskId}`,
    status: "queued",
    revision,
    createdAt: "2026-04-14T00:00:00.000Z",
    steps: [
      {
        id: `${taskId}_investigate`,
        title: "investigate",
        stage: "investigate",
        status: "doing",
      },
      {
        id: `${taskId}_design`,
        title: "design",
        stage: "design",
        status: "todo",
      },
    ],
  };
}

function createPlan(planId: string, revision = 1): PlanSessionRecord {
  return {
    id: planId,
    title: `计划 ${planId}`,
    status: "draft",
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
    revision,
    metadata: { owner: { name: "tester" } },
  };
}

function createGraphSnapshot(revision = 1): GraphSnapshot {
  return {
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
    revision,
    nodes: [
      {
        id: "node_1",
        taskId: "task_1",
        label: "任务一",
        metadata: { rank: 1 },
      },
      {
        id: "node_2",
        taskId: "task_2",
        label: "任务二",
      },
    ],
    edges: [
      {
        id: "edge_1",
        fromNodeId: "node_2",
        toNodeId: "node_1",
        kind: "depends_on",
        metadata: { weight: 1 },
      },
    ],
  };
}

test("端口层 in-memory：task create/get/list 返回快照与内部状态隔离", () => {
  const repository = createInMemoryTaskRepository<PersistedLightTask>();
  const created = repository.create(createPersistedTask("task_repo_1"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  created.task.title = "外部篡改";
  created.task.steps[0].status = "done";

  const fetched = repository.get("task_repo_1");
  assert.ok(fetched);
  assert.equal(fetched.title, "任务 task_repo_1");
  assert.equal(fetched.steps[0].status, "doing");

  const listed = repository.list();
  listed[0].title = "列表篡改";
  listed[0].steps[0].status = "done";

  const refetched = repository.get("task_repo_1");
  assert.ok(refetched);
  assert.equal(refetched.title, "任务 task_repo_1");
  assert.equal(refetched.steps[0].status, "doing");
});

test("端口层 in-memory：task 重复创建相同 taskId 会返回冲突错误", () => {
  const repository = createInMemoryTaskRepository<PersistedLightTask>();
  const first = repository.create(createPersistedTask("task_duplicate"));
  assert.equal(first.ok, true);

  const duplicated = repository.create(createPersistedTask("task_duplicate"));
  assert.equal(duplicated.ok, false);
  if (duplicated.ok) {
    assert.fail("重复创建必须失败");
  }
  assert.equal(duplicated.error.code, "STATE_CONFLICT");
  assert.equal(duplicated.error.details?.taskId, "task_duplicate");
});

test("端口层 in-memory：task saveIfRevisionMatches 在任务不存在时返回 NOT_FOUND", () => {
  const repository = createInMemoryTaskRepository<PersistedLightTask>();
  const saved = repository.saveIfRevisionMatches(createPersistedTask("task_missing", 2), 1);

  assert.equal(saved.ok, false);
  if (saved.ok) {
    assert.fail("保存不存在任务必须失败");
  }
  assert.equal(saved.error.code, "NOT_FOUND");
  assert.equal(saved.error.details?.taskId, "task_missing");
});

test("端口层 in-memory：task saveIfRevisionMatches 在 revision 冲突时返回 REVISION_CONFLICT", () => {
  const repository = createInMemoryTaskRepository<PersistedLightTask>();
  const created = repository.create(createPersistedTask("task_revision"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const next = createPersistedTask("task_revision", 2);
  next.status = "dispatched";
  next.steps[0].status = "done";
  next.steps[1].status = "doing";

  const saved = repository.saveIfRevisionMatches(next, 2);
  assert.equal(saved.ok, false);
  if (saved.ok) {
    assert.fail("revision 冲突必须失败");
  }
  assert.equal(saved.error.code, "REVISION_CONFLICT");
  assert.equal(saved.error.details?.taskId, "task_revision");
  assert.equal(saved.error.details?.expectedRevision, 2);
  assert.equal(saved.error.details?.actualRevision, 1);
});

test("端口层 in-memory：task saveIfRevisionMatches 在 revision 匹配时成功保存", () => {
  const repository = createInMemoryTaskRepository<PersistedLightTask>();
  const created = repository.create(createPersistedTask("task_save"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const next = createPersistedTask("task_save", 2);
  next.status = "dispatched";
  next.steps[0].status = "done";
  next.steps[1].status = "doing";

  const saved = repository.saveIfRevisionMatches(next, 1);
  assert.equal(saved.ok, true);
  if (!saved.ok) {
    assert.fail("revision 匹配时必须成功");
  }
  assert.equal(saved.task.status, "dispatched");
  assert.equal(saved.task.steps[0].status, "done");
  assert.equal(saved.task.steps[1].status, "doing");

  const fetched = repository.get("task_save");
  assert.ok(fetched);
  assert.equal(fetched.status, "dispatched");
  assert.equal(fetched.revision, 2);
  assert.equal(fetched.steps[0].status, "done");
  assert.equal(fetched.steps[1].status, "doing");
});

test("端口层 in-memory：task saveIfRevisionMatches 成功返回值与内部状态隔离", () => {
  const repository = createInMemoryTaskRepository<PersistedLightTask>();
  const created = repository.create(createPersistedTask("task_save_snapshot"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const next = createPersistedTask("task_save_snapshot", 2);
  next.status = "dispatched";
  next.steps[0].status = "done";
  next.steps[1].status = "doing";

  const saved = repository.saveIfRevisionMatches(next, 1);
  assert.equal(saved.ok, true);
  if (!saved.ok) {
    assert.fail("revision 匹配时必须成功");
  }

  saved.task.title = "外部篡改";
  saved.task.steps[0].status = "todo";

  const fetched = repository.get("task_save_snapshot");
  assert.ok(fetched);
  assert.equal(fetched.title, "任务 task_save_snapshot");
  assert.equal(fetched.steps[0].status, "done");
});

test("端口层 in-memory：plan create/get/list 返回快照与内部状态隔离", () => {
  const repository = createInMemoryPlanRepository<PlanSessionRecord>();
  const created = repository.create(createPlan("plan_repo_1"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  created.plan.title = "外部篡改";
  assert.ok(created.plan.metadata);
  created.plan.metadata.owner = { name: "mutated" };

  const fetched = repository.get("plan_repo_1");
  assert.ok(fetched);
  assert.equal(fetched.title, "计划 plan_repo_1");
  assert.deepEqual(fetched.metadata, { owner: { name: "tester" } });

  const listed = repository.list();
  listed[0].title = "列表篡改";

  const refetched = repository.get("plan_repo_1");
  assert.ok(refetched);
  assert.equal(refetched.title, "计划 plan_repo_1");
});

test("端口层 in-memory：plan 重复创建相同 planId 会返回冲突错误", () => {
  const repository = createInMemoryPlanRepository<PlanSessionRecord>();
  const first = repository.create(createPlan("plan_duplicate"));
  assert.equal(first.ok, true);

  const duplicated = repository.create(createPlan("plan_duplicate"));
  assert.equal(duplicated.ok, false);
  if (duplicated.ok) {
    assert.fail("重复创建必须失败");
  }
  assert.equal(duplicated.error.code, "STATE_CONFLICT");
  assert.equal(duplicated.error.details?.planId, "plan_duplicate");
});

test("端口层 in-memory：plan saveIfRevisionMatches 在计划不存在时返回 NOT_FOUND", () => {
  const repository = createInMemoryPlanRepository<PlanSessionRecord>();
  const saved = repository.saveIfRevisionMatches(createPlan("plan_missing", 2), 1);

  assert.equal(saved.ok, false);
  if (saved.ok) {
    assert.fail("保存不存在计划必须失败");
  }
  assert.equal(saved.error.code, "NOT_FOUND");
  assert.equal(saved.error.details?.planId, "plan_missing");
});

test("端口层 in-memory：plan saveIfRevisionMatches 在 revision 冲突时返回 REVISION_CONFLICT", () => {
  const repository = createInMemoryPlanRepository<PlanSessionRecord>();
  const created = repository.create(createPlan("plan_revision"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const next = createPlan("plan_revision", 2);
  next.status = "planning";

  const saved = repository.saveIfRevisionMatches(next, 2);
  assert.equal(saved.ok, false);
  if (saved.ok) {
    assert.fail("revision 冲突必须失败");
  }
  assert.equal(saved.error.code, "REVISION_CONFLICT");
  assert.equal(saved.error.details?.planId, "plan_revision");
  assert.equal(saved.error.details?.expectedRevision, 2);
  assert.equal(saved.error.details?.actualRevision, 1);
});

test("端口层 in-memory：plan saveIfRevisionMatches 在 revision 匹配时成功保存", () => {
  const repository = createInMemoryPlanRepository<PlanSessionRecord>();
  const created = repository.create(createPlan("plan_save"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const next = createPlan("plan_save", 2);
  next.status = "ready";

  const saved = repository.saveIfRevisionMatches(next, 1);
  assert.equal(saved.ok, true);
  if (!saved.ok) {
    assert.fail("revision 匹配时必须成功");
  }
  assert.equal(saved.plan.status, "ready");

  const fetched = repository.get("plan_save");
  assert.ok(fetched);
  assert.equal(fetched.status, "ready");
  assert.equal(fetched.revision, 2);
});

test("端口层 in-memory：graph get/create 返回快照与内部状态隔离", () => {
  const repository = createInMemoryGraphRepository<GraphSnapshot>();
  const created = repository.create("plan_graph_1", createGraphSnapshot());
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  created.graph.nodes[0].label = "外部篡改";
  assert.ok(created.graph.nodes[0].metadata);
  created.graph.nodes[0].metadata.rank = 99;

  const fetched = repository.get("plan_graph_1");
  assert.ok(fetched);
  assert.equal(fetched.nodes[0].label, "任务一");
  assert.deepEqual(fetched.nodes[0].metadata, { rank: 1 });
});

test("端口层 in-memory：graph 重复创建相同 planId 会返回冲突错误", () => {
  const repository = createInMemoryGraphRepository<GraphSnapshot>();
  const first = repository.create("plan_graph_duplicate", createGraphSnapshot());
  assert.equal(first.ok, true);

  const duplicated = repository.create("plan_graph_duplicate", createGraphSnapshot());
  assert.equal(duplicated.ok, false);
  if (duplicated.ok) {
    assert.fail("重复创建必须失败");
  }
  assert.equal(duplicated.error.code, "STATE_CONFLICT");
  assert.equal(duplicated.error.details?.planId, "plan_graph_duplicate");
});

test("端口层 in-memory：graph saveIfRevisionMatches 在图不存在时返回 NOT_FOUND", () => {
  const repository = createInMemoryGraphRepository<GraphSnapshot>();
  const saved = repository.saveIfRevisionMatches("plan_graph_missing", createGraphSnapshot(2), 1);

  assert.equal(saved.ok, false);
  if (saved.ok) {
    assert.fail("保存不存在图必须失败");
  }
  assert.equal(saved.error.code, "NOT_FOUND");
  assert.equal(saved.error.details?.planId, "plan_graph_missing");
});

test("端口层 in-memory：graph saveIfRevisionMatches 在 revision 冲突时返回 REVISION_CONFLICT", () => {
  const repository = createInMemoryGraphRepository<GraphSnapshot>();
  const created = repository.create("plan_graph_revision", createGraphSnapshot());
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const saved = repository.saveIfRevisionMatches("plan_graph_revision", createGraphSnapshot(2), 2);
  assert.equal(saved.ok, false);
  if (saved.ok) {
    assert.fail("revision 冲突必须失败");
  }
  assert.equal(saved.error.code, "REVISION_CONFLICT");
  assert.equal(saved.error.details?.planId, "plan_graph_revision");
  assert.equal(saved.error.details?.expectedRevision, 2);
  assert.equal(saved.error.details?.actualRevision, 1);
});

test("端口层 in-memory：graph saveIfRevisionMatches 在 revision 匹配时成功保存", () => {
  const repository = createInMemoryGraphRepository<GraphSnapshot>();
  const created = repository.create("plan_graph_save", createGraphSnapshot());
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const next = createGraphSnapshot(2);
  next.nodes.push({ id: "node_3", taskId: "task_3", label: "任务三" });

  const saved = repository.saveIfRevisionMatches("plan_graph_save", next, 1);
  assert.equal(saved.ok, true);
  if (!saved.ok) {
    assert.fail("revision 匹配时必须成功");
  }
  assert.equal(saved.graph.nodes.length, 3);

  const fetched = repository.get("plan_graph_save");
  assert.ok(fetched);
  assert.equal(fetched.nodes.length, 3);
  assert.equal(fetched.revision, 2);
});

test("端口层 in-memory：graph saveIfRevisionMatches 成功返回值与内部状态隔离", () => {
  const repository = createInMemoryGraphRepository<GraphSnapshot>();
  const created = repository.create("plan_graph_save_isolation", createGraphSnapshot());
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const next = createGraphSnapshot(2);
  const saved = repository.saveIfRevisionMatches("plan_graph_save_isolation", next, 1);
  assert.equal(saved.ok, true);
  if (!saved.ok) {
    assert.fail("revision 匹配时必须成功");
  }

  saved.graph.nodes[0].label = "外部篡改";
  assert.ok(saved.graph.nodes[0].metadata);
  saved.graph.nodes[0].metadata.rank = 99;

  const fetched = repository.get("plan_graph_save_isolation");
  assert.ok(fetched);
  assert.equal(fetched.nodes[0].label, "任务一");
  assert.deepEqual(fetched.nodes[0].metadata, { rank: 1 });
});
test("端口层 in-memory：系统时钟返回 ISO 时间字符串", () => {
  const clock = createSystemClock();
  const now = clock.now();

  assert.match(now, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(Number.isNaN(Date.parse(now)), false);
});

test("端口层 in-memory：任务 ID 生成器返回唯一前缀 ID", () => {
  const generator = createTaskIdGenerator();
  const first = generator.nextTaskId();
  const second = generator.nextTaskId();

  assert.match(first, /^task_/);
  assert.match(second, /^task_/);
  assert.notEqual(first, second);
});
