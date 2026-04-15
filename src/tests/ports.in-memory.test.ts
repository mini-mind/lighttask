import assert from "node:assert/strict";
import test from "node:test";
import type {
  DomainEvent,
  GraphSnapshot,
  OutputRecord,
  PlanSessionRecord,
  RuntimeRecord,
} from "../data-structures";
import {
  createInMemoryGraphRepository,
  createInMemoryNotifyCollector,
  createInMemoryOutputRepository,
  createInMemoryPlanRepository,
  createInMemoryRuntimeRepository,
  createInMemoryTaskRepository,
  createSystemClock,
  createTaskIdGenerator,
} from "../ports/in-memory";

type TaskStepFixture = {
  id: string;
  title: string;
  stage: string;
  status: string;
};

type TaskRecordFixture = {
  id: string;
  title: string;
  summary: string;
  status: string;
  revision: number;
  createdAt: string;
  steps: TaskStepFixture[];
  metadata?: Record<string, unknown>;
  extensions?: {
    properties?: Record<string, unknown>;
    namespaces?: Record<string, Record<string, unknown>>;
  };
};

function createPersistedTask(taskId: string, revision = 1): TaskRecordFixture {
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
    metadata: { source: { name: "tester" } },
    extensions: {
      properties: { priority: "high" },
      namespaces: { worker: { lane: "core" } },
    },
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
    extensions: {
      properties: { priority: "p1" },
      namespaces: { planner: { lane: "core" } },
    },
  };
}

function createRuntime(runtimeId: string, revision = 1): RuntimeRecord {
  return {
    id: runtimeId,
    kind: "plan_launch",
    title: `运行时 ${runtimeId}`,
    status: revision > 1 ? "running" : "queued",
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
    revision,
    parentRef: {
      kind: "plan",
      id: "plan_1",
    },
    ownerRef: {
      kind: "task",
      id: "task_1",
    },
    context: { source: { name: "tester" } },
    metadata: { owner: { name: "tester" } },
    extensions: {
      properties: { priority: "p1" },
      namespaces: { runtime: { lane: "core" } },
    },
  };
}

function createOutput(outputId: string, revision = 1): OutputRecord {
  return {
    id: outputId,
    kind: "summary",
    status: revision > 1 ? "sealed" : "open",
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
    revision,
    runtimeRef: {
      id: "runtime_1",
    },
    ownerRef: {
      kind: "task",
      id: "task_1",
    },
    payload: { content: { text: "draft" } },
    items: [
      {
        id: "artifact_1",
        kind: "text",
        status: "declared",
        metadata: { owner: { name: "tester" } },
        extensions: {
          namespaces: { outputItem: { lane: "core" } },
        },
      },
    ],
    metadata: { owner: { name: "tester" } },
    extensions: {
      properties: { priority: "p1" },
      namespaces: { output: { lane: "core" } },
    },
  };
}

function createGraphSnapshot(revision = 1): GraphSnapshot {
  return {
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
    revision,
    metadata: { owner: { name: "tester" } },
    extensions: {
      presentation: { zoom: 1 },
      namespaces: { graphEditor: { lane: "core" } },
    },
    nodes: [
      {
        id: "node_1",
        taskId: "task_1",
        label: "任务一",
        metadata: { rank: 1 },
        extensions: { presentation: { x: 1, y: 2 } },
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
        extensions: { properties: { required: true } },
      },
    ],
  };
}

test("端口层 in-memory：task create/get/list 返回快照与内部状态隔离", () => {
  const repository = createInMemoryTaskRepository<TaskRecordFixture>();
  const created = repository.create(createPersistedTask("task_repo_1"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  created.task.title = "外部篡改";
  created.task.steps[0].status = "done";
  assert.ok(created.task.metadata);
  created.task.metadata.source = { name: "mutated" };
  assert.ok(created.task.extensions);
  created.task.extensions.properties = { priority: "low" };

  const fetched = repository.get("task_repo_1");
  assert.ok(fetched);
  assert.equal(fetched.title, "任务 task_repo_1");
  assert.equal(fetched.steps[0].status, "doing");
  assert.deepEqual(fetched.metadata, { source: { name: "tester" } });
  assert.deepEqual(fetched.extensions, {
    properties: { priority: "high" },
    namespaces: { worker: { lane: "core" } },
  });

  const listed = repository.list();
  listed[0].title = "列表篡改";
  listed[0].steps[0].status = "done";

  const refetched = repository.get("task_repo_1");
  assert.ok(refetched);
  assert.equal(refetched.title, "任务 task_repo_1");
  assert.equal(refetched.steps[0].status, "doing");
});

test("端口层 in-memory：task create 后外部篡改原入参不会污染仓储", () => {
  const repository = createInMemoryTaskRepository<TaskRecordFixture>();
  const original = createPersistedTask("task_input_create");

  const created = repository.create(original);
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  original.title = "外部修改原入参";
  original.steps[0].status = "done";

  const fetched = repository.get("task_input_create");
  assert.ok(fetched);
  assert.equal(fetched.title, "任务 task_input_create");
  assert.equal(fetched.steps[0].status, "doing");
});

test("端口层 in-memory：task 重复创建相同 taskId 会返回冲突错误", () => {
  const repository = createInMemoryTaskRepository<TaskRecordFixture>();
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
  const repository = createInMemoryTaskRepository<TaskRecordFixture>();
  const saved = repository.saveIfRevisionMatches(createPersistedTask("task_missing", 2), 1);

  assert.equal(saved.ok, false);
  if (saved.ok) {
    assert.fail("保存不存在任务必须失败");
  }
  assert.equal(saved.error.code, "NOT_FOUND");
  assert.equal(saved.error.details?.taskId, "task_missing");
});

test("端口层 in-memory：task saveIfRevisionMatches 在 revision 冲突时返回 REVISION_CONFLICT", () => {
  const repository = createInMemoryTaskRepository<TaskRecordFixture>();
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
  const repository = createInMemoryTaskRepository<TaskRecordFixture>();
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
  const repository = createInMemoryTaskRepository<TaskRecordFixture>();
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

test("端口层 in-memory：task saveIfRevisionMatches 后外部篡改原入参不会污染仓储", () => {
  const repository = createInMemoryTaskRepository<TaskRecordFixture>();
  const created = repository.create(createPersistedTask("task_input_save"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const next = createPersistedTask("task_input_save", 2);
  next.status = "dispatched";
  next.steps[0].status = "done";

  const saved = repository.saveIfRevisionMatches(next, 1);
  assert.equal(saved.ok, true);
  if (!saved.ok) {
    assert.fail("revision 匹配时必须成功");
  }

  next.title = "外部修改原入参";
  next.steps[0].status = "todo";

  const fetched = repository.get("task_input_save");
  assert.ok(fetched);
  assert.equal(fetched.title, "任务 task_input_save");
  assert.equal(fetched.steps[0].status, "done");
});

test("端口层 in-memory：task get 返回值与内部状态隔离", () => {
  const repository = createInMemoryTaskRepository<TaskRecordFixture>();
  const created = repository.create(createPersistedTask("task_get_snapshot"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const fetched = repository.get("task_get_snapshot");
  assert.ok(fetched);
  fetched.title = "外部篡改";
  fetched.steps[0].status = "done";

  const refetched = repository.get("task_get_snapshot");
  assert.ok(refetched);
  assert.equal(refetched.title, "任务 task_get_snapshot");
  assert.equal(refetched.steps[0].status, "doing");
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
  assert.ok(created.plan.extensions);
  created.plan.extensions.properties = { priority: "p2" };

  const fetched = repository.get("plan_repo_1");
  assert.ok(fetched);
  assert.equal(fetched.title, "计划 plan_repo_1");
  assert.deepEqual(fetched.metadata, { owner: { name: "tester" } });
  assert.deepEqual(fetched.extensions, {
    properties: { priority: "p1" },
    namespaces: { planner: { lane: "core" } },
  });

  const listed = repository.list();
  listed[0].title = "列表篡改";

  const refetched = repository.get("plan_repo_1");
  assert.ok(refetched);
  assert.equal(refetched.title, "计划 plan_repo_1");
});

test("端口层 in-memory：plan create 后外部篡改原入参不会污染仓储", () => {
  const repository = createInMemoryPlanRepository<PlanSessionRecord>();
  const original = createPlan("plan_input_create");

  const created = repository.create(original);
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  original.title = "外部修改原入参";
  assert.ok(original.metadata);
  original.metadata.owner = { name: "changed" };

  const fetched = repository.get("plan_input_create");
  assert.ok(fetched);
  assert.equal(fetched.title, "计划 plan_input_create");
  assert.deepEqual(fetched.metadata, { owner: { name: "tester" } });
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

test("端口层 in-memory：plan saveIfRevisionMatches 成功返回值与内部状态隔离", () => {
  const repository = createInMemoryPlanRepository<PlanSessionRecord>();
  const created = repository.create(createPlan("plan_save_snapshot"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const next = createPlan("plan_save_snapshot", 2);
  next.status = "ready";

  const saved = repository.saveIfRevisionMatches(next, 1);
  assert.equal(saved.ok, true);
  if (!saved.ok) {
    assert.fail("revision 匹配时必须成功");
  }

  saved.plan.title = "外部篡改";
  assert.ok(saved.plan.metadata);
  saved.plan.metadata.owner = { name: "mutated" };

  const fetched = repository.get("plan_save_snapshot");
  assert.ok(fetched);
  assert.equal(fetched.title, "计划 plan_save_snapshot");
  assert.deepEqual(fetched.metadata, { owner: { name: "tester" } });
});

test("端口层 in-memory：plan saveIfRevisionMatches 后外部篡改原入参不会污染仓储", () => {
  const repository = createInMemoryPlanRepository<PlanSessionRecord>();
  const created = repository.create(createPlan("plan_input_save"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const next = createPlan("plan_input_save", 2);
  next.status = "ready";

  const saved = repository.saveIfRevisionMatches(next, 1);
  assert.equal(saved.ok, true);
  if (!saved.ok) {
    assert.fail("revision 匹配时必须成功");
  }

  next.title = "外部修改原入参";
  assert.ok(next.metadata);
  next.metadata.owner = { name: "changed" };

  const fetched = repository.get("plan_input_save");
  assert.ok(fetched);
  assert.equal(fetched.title, "计划 plan_input_save");
  assert.deepEqual(fetched.metadata, { owner: { name: "tester" } });
});

test("端口层 in-memory：plan get 返回值与内部状态隔离", () => {
  const repository = createInMemoryPlanRepository<PlanSessionRecord>();
  const created = repository.create(createPlan("plan_get_snapshot"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const fetched = repository.get("plan_get_snapshot");
  assert.ok(fetched);
  fetched.title = "外部篡改";
  assert.ok(fetched.metadata);
  fetched.metadata.owner = { name: "changed" };

  const refetched = repository.get("plan_get_snapshot");
  assert.ok(refetched);
  assert.equal(refetched.title, "计划 plan_get_snapshot");
  assert.deepEqual(refetched.metadata, { owner: { name: "tester" } });
});

test("端口层 in-memory：runtime create/get/list 返回快照与内部状态隔离", () => {
  const repository = createInMemoryRuntimeRepository<RuntimeRecord>();
  const created = repository.create(createRuntime("runtime_repo_1"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  created.runtime.title = "外部篡改";
  assert.ok(created.runtime.parentRef);
  created.runtime.parentRef.kind = "mutated";
  assert.ok(created.runtime.ownerRef);
  created.runtime.ownerRef.kind = "changed";

  const fetched = repository.get("runtime_repo_1");
  assert.ok(fetched);
  assert.equal(fetched.title, "运行时 runtime_repo_1");
  assert.deepEqual(fetched.parentRef, {
    kind: "plan",
    id: "plan_1",
  });
  assert.deepEqual(fetched.ownerRef, {
    kind: "task",
    id: "task_1",
  });

  const listed = repository.list();
  listed[0].title = "列表篡改";
  assert.ok(listed[0].metadata);
  listed[0].metadata.owner = { name: "mutated" };

  const refetched = repository.get("runtime_repo_1");
  assert.ok(refetched);
  assert.equal(refetched.title, "运行时 runtime_repo_1");
  assert.deepEqual(refetched.metadata, { owner: { name: "tester" } });
});

test("端口层 in-memory：runtime 重复创建相同 runtimeId 会返回冲突错误", () => {
  const repository = createInMemoryRuntimeRepository<RuntimeRecord>();
  const first = repository.create(createRuntime("runtime_duplicate"));
  assert.equal(first.ok, true);

  const duplicated = repository.create(createRuntime("runtime_duplicate"));
  assert.equal(duplicated.ok, false);
  if (duplicated.ok) {
    assert.fail("重复创建必须失败");
  }
  assert.equal(duplicated.error.code, "STATE_CONFLICT");
  assert.equal(duplicated.error.details?.runtimeId, "runtime_duplicate");
});

test("端口层 in-memory：runtime saveIfRevisionMatches 在 revision 冲突时返回 REVISION_CONFLICT", () => {
  const repository = createInMemoryRuntimeRepository<RuntimeRecord>();
  const created = repository.create(createRuntime("runtime_revision"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const next = createRuntime("runtime_revision", 2);
  next.status = "running";
  next.result = { outcome: "ok" };

  const saved = repository.saveIfRevisionMatches(next, 2);
  assert.equal(saved.ok, false);
  if (saved.ok) {
    assert.fail("revision 冲突必须失败");
  }
  assert.equal(saved.error.code, "REVISION_CONFLICT");
  assert.equal(saved.error.details?.runtimeId, "runtime_revision");
  assert.equal(saved.error.details?.expectedRevision, 2);
  assert.equal(saved.error.details?.actualRevision, 1);
});

test("端口层 in-memory：runtime saveIfRevisionMatches 在 revision 匹配时成功保存", () => {
  const repository = createInMemoryRuntimeRepository<RuntimeRecord>();
  const created = repository.create(createRuntime("runtime_save"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const next = createRuntime("runtime_save", 2);
  next.status = "running";
  next.result = { outcome: "ok" };

  const saved = repository.saveIfRevisionMatches(next, 1);
  assert.equal(saved.ok, true);
  if (!saved.ok) {
    assert.fail("revision 匹配时必须成功");
  }
  assert.equal(saved.runtime.status, "running");
  assert.deepEqual(saved.runtime.result, { outcome: "ok" });

  const fetched = repository.get("runtime_save");
  assert.ok(fetched);
  assert.equal(fetched.status, "running");
  assert.equal(fetched.revision, 2);
  assert.deepEqual(fetched.result, { outcome: "ok" });
});

test("端口层 in-memory：output create/get/list 返回快照并与内部状态隔离", () => {
  const repository = createInMemoryOutputRepository<OutputRecord>();
  const created = repository.create(createOutput("output_repo_1"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  created.output.kind = "外部篡改";
  created.output.payload = { content: { text: "mutated" } };
  assert.ok(created.output.metadata);
  created.output.metadata.owner = { name: "mutated" };
  assert.ok(created.output.items);
  created.output.items[0].status = "mutated";
  assert.ok(created.output.items[0].metadata);
  created.output.items[0].metadata.owner = { name: "mutated" };

  const fetched = repository.get("output_repo_1");
  assert.ok(fetched);
  assert.equal(fetched.kind, "summary");
  assert.deepEqual(fetched.payload, { content: { text: "draft" } });
  assert.deepEqual(fetched.items, [
    {
      id: "artifact_1",
      kind: "text",
      status: "declared",
      metadata: { owner: { name: "tester" } },
      extensions: {
        namespaces: { outputItem: { lane: "core" } },
      },
    },
  ]);
  assert.deepEqual(fetched.metadata, { owner: { name: "tester" } });

  const listed = repository.list();
  listed[0].status = "sealed";
  listed[0].runtimeRef = { id: "runtime_mutated" };
  assert.ok(listed[0].items);
  listed[0].items[0].kind = "mutated";

  const refetched = repository.get("output_repo_1");
  assert.ok(refetched);
  assert.equal(refetched.status, "open");
  assert.deepEqual(refetched.runtimeRef, { id: "runtime_1" });
  assert.deepEqual(refetched.items, [
    {
      id: "artifact_1",
      kind: "text",
      status: "declared",
      metadata: { owner: { name: "tester" } },
      extensions: {
        namespaces: { outputItem: { lane: "core" } },
      },
    },
  ]);
});

test("端口层 in-memory：output create 后外部篡改原入参不会污染仓储", () => {
  const repository = createInMemoryOutputRepository<OutputRecord>();
  const original = createOutput("output_input_create");

  const created = repository.create(original);
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  original.kind = "外部修改原入参";
  original.payload = { content: { text: "changed" } };
  assert.ok(original.items);
  original.items[0].label = "changed";

  const fetched = repository.get("output_input_create");
  assert.ok(fetched);
  assert.equal(fetched.kind, "summary");
  assert.deepEqual(fetched.payload, { content: { text: "draft" } });
  assert.deepEqual(fetched.items, [
    {
      id: "artifact_1",
      kind: "text",
      status: "declared",
      metadata: { owner: { name: "tester" } },
      extensions: {
        namespaces: { outputItem: { lane: "core" } },
      },
    },
  ]);
});

test("端口层 in-memory：output saveIfRevisionMatches 在 revision 冲突时返回 REVISION_CONFLICT", () => {
  const repository = createInMemoryOutputRepository<OutputRecord>();
  const created = repository.create(createOutput("output_revision"));
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const next = createOutput("output_revision", 2);

  const saved = repository.saveIfRevisionMatches(next, 2);
  assert.equal(saved.ok, false);
  if (saved.ok) {
    assert.fail("revision 冲突必须失败");
  }
  assert.equal(saved.error.code, "REVISION_CONFLICT");
  assert.equal(saved.error.details?.outputId, "output_revision");
  assert.equal(saved.error.details?.expectedRevision, 2);
  assert.equal(saved.error.details?.actualRevision, 1);
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
  assert.ok(created.graph.nodes[0].extensions);
  created.graph.nodes[0].extensions.presentation = { x: 99, y: 99 };
  assert.ok(created.graph.metadata);
  created.graph.metadata.owner = { name: "mutated" };
  assert.ok(created.graph.extensions);
  created.graph.extensions.presentation = { zoom: 3 };

  const fetched = repository.get("plan_graph_1");
  assert.ok(fetched);
  assert.equal(fetched.nodes[0].label, "任务一");
  assert.deepEqual(fetched.nodes[0].metadata, { rank: 1 });
  assert.deepEqual(fetched.nodes[0].extensions, { presentation: { x: 1, y: 2 } });
  assert.deepEqual(fetched.metadata, { owner: { name: "tester" } });
  assert.deepEqual(fetched.extensions, {
    presentation: { zoom: 1 },
    namespaces: { graphEditor: { lane: "core" } },
  });
});

test("端口层 in-memory：graph create 后外部篡改原入参不会污染仓储", () => {
  const repository = createInMemoryGraphRepository<GraphSnapshot>();
  const original = createGraphSnapshot();

  const created = repository.create("plan_graph_input_create", original);
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  original.nodes[0].label = "外部修改原入参";
  assert.ok(original.nodes[0].metadata);
  original.nodes[0].metadata.rank = 99;

  const fetched = repository.get("plan_graph_input_create");
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

test("端口层 in-memory：graph saveIfRevisionMatches revision 冲突失败后不会污染已存状态", () => {
  const repository = createInMemoryGraphRepository<GraphSnapshot>();
  const created = repository.create("plan_graph_revision_keep_snapshot", createGraphSnapshot());
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const before = repository.get("plan_graph_revision_keep_snapshot");
  assert.ok(before);

  const conflicting = createGraphSnapshot(2);
  conflicting.nodes[0].label = "冲突写入";
  assert.ok(conflicting.nodes[0].metadata);
  conflicting.nodes[0].metadata.rank = 999;
  conflicting.edges = [];

  const saved = repository.saveIfRevisionMatches(
    "plan_graph_revision_keep_snapshot",
    conflicting,
    2,
  );
  assert.equal(saved.ok, false);
  if (saved.ok) {
    assert.fail("revision 冲突必须失败");
  }
  assert.equal(saved.error.code, "REVISION_CONFLICT");
  assert.equal(saved.error.details?.planId, "plan_graph_revision_keep_snapshot");
  assert.equal(saved.error.details?.expectedRevision, 2);
  assert.equal(saved.error.details?.actualRevision, 1);

  const fetched = repository.get("plan_graph_revision_keep_snapshot");
  assert.ok(fetched);
  assert.deepEqual(fetched, before);
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

test("端口层 in-memory：graph saveIfRevisionMatches 后外部篡改原入参不会污染仓储", () => {
  const repository = createInMemoryGraphRepository<GraphSnapshot>();
  const created = repository.create("plan_graph_input_save", createGraphSnapshot());
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const next = createGraphSnapshot(2);
  next.nodes[0].label = "已保存图";

  const saved = repository.saveIfRevisionMatches("plan_graph_input_save", next, 1);
  assert.equal(saved.ok, true);
  if (!saved.ok) {
    assert.fail("revision 匹配时必须成功");
  }

  next.nodes[0].label = "外部修改原入参";
  assert.ok(next.nodes[0].metadata);
  next.nodes[0].metadata.rank = 99;

  const fetched = repository.get("plan_graph_input_save");
  assert.ok(fetched);
  assert.equal(fetched.nodes[0].label, "已保存图");
  assert.deepEqual(fetched.nodes[0].metadata, { rank: 1 });
});

test("端口层 in-memory：graph get 返回值与内部状态隔离", () => {
  const repository = createInMemoryGraphRepository<GraphSnapshot>();
  const created = repository.create("plan_graph_get_snapshot", createGraphSnapshot());
  assert.equal(created.ok, true);
  if (!created.ok) {
    assert.fail("create 应成功");
  }

  const fetched = repository.get("plan_graph_get_snapshot");
  assert.ok(fetched);
  fetched.nodes[0].label = "外部篡改";
  assert.ok(fetched.nodes[0].metadata);
  fetched.nodes[0].metadata.rank = 99;

  const refetched = repository.get("plan_graph_get_snapshot");
  assert.ok(refetched);
  assert.equal(refetched.nodes[0].label, "任务一");
  assert.deepEqual(refetched.nodes[0].metadata, { rank: 1 });
});

test("端口层 in-memory：graph draft 与 published 作用域互相隔离", () => {
  const repository = createInMemoryGraphRepository<GraphSnapshot>();
  const draft = createGraphSnapshot(2);
  const published = createGraphSnapshot(1);
  published.nodes[0].label = "已发布任务";

  const createdDraft = repository.create("plan_graph_scope", draft);
  const createdPublished = repository.create("plan_graph_scope", published, "published");

  assert.equal(createdDraft.ok, true);
  assert.equal(createdPublished.ok, true);
  if (!createdDraft.ok || !createdPublished.ok) {
    assert.fail("不同 graph scope 下的 create 都应成功");
  }

  const fetchedDraft = repository.get("plan_graph_scope");
  const fetchedPublished = repository.get("plan_graph_scope", "published");

  assert.ok(fetchedDraft);
  assert.ok(fetchedPublished);
  assert.equal(fetchedDraft.revision, 2);
  assert.equal(fetchedDraft.nodes[0].label, "任务一");
  assert.equal(fetchedPublished.revision, 1);
  assert.equal(fetchedPublished.nodes[0].label, "已发布任务");
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

test("端口层 in-memory：notify collector 返回事件快照并与内部状态隔离", () => {
  const collector = createInMemoryNotifyCollector<DomainEvent>();
  const event: DomainEvent = {
    id: "evt_notify_1",
    type: "graph.saved",
    aggregate: "graph",
    aggregateId: "plan_notify",
    occurredAt: "2026-04-14T00:00:00.000Z",
    revision: 2,
    version: 1,
    payload: {
      graph: {
        nodes: [{ id: "node_1", label: "任务一" }],
      },
    },
  };

  collector.publish(event);
  event.payload = {
    graph: {
      nodes: [{ id: "node_1", label: "外部篡改" }],
    },
  };

  const listed = collector.listPublished();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].type, "graph.saved");
  assert.deepEqual(listed[0].payload, {
    graph: {
      nodes: [{ id: "node_1", label: "任务一" }],
    },
  });

  listed[0].payload = {
    graph: {
      nodes: [{ id: "node_1", label: "再次篡改" }],
    },
  };

  assert.deepEqual(collector.listPublished()[0].payload, {
    graph: {
      nodes: [{ id: "node_1", label: "任务一" }],
    },
  });

  collector.clear();
  assert.deepEqual(collector.listPublished(), []);
});
