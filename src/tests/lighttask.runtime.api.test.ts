import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError, type LightTaskRuntime, createLightTask } from "../index";
import { assertInvalidDependencyCases, createTestLightTaskOptions } from "./ports-fixture";

test("LightTask Runtime API 支持创建、读取、列出与默认推进运行时", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  const runtime = lighttask.createRuntime({
    id: " runtime_alpha ",
    kind: " plan_launch ",
    title: " 发射主流程 ",
    parentRef: {
      kind: " plan ",
      id: " plan_alpha ",
    },
    ownerRef: {
      kind: " task ",
      id: " task_alpha ",
    },
    relatedRefs: [
      {
        kind: " task ",
        id: " task_beta ",
      },
      {
        kind: " graph_node ",
        id: " node_alpha ",
      },
    ],
    context: {
      goal: "launch",
    },
    metadata: {
      owner: { name: "tester" },
    },
    extensions: {
      properties: { priority: "p1" },
      namespaces: { runtime: { lane: "core" } },
    },
  });

  assert.equal(runtime.id, "runtime_alpha");
  assert.equal(runtime.kind, "plan_launch");
  assert.equal(runtime.title, "发射主流程");
  assert.equal(runtime.status, "queued");
  assert.equal(runtime.revision, 1);
  assert.deepEqual(runtime.parentRef, {
    kind: "plan",
    id: "plan_alpha",
  });
  assert.deepEqual(runtime.ownerRef, {
    kind: "task",
    id: "task_alpha",
  });
  assert.deepEqual(runtime.relatedRefs, [
    {
      kind: "task",
      id: "task_beta",
    },
    {
      kind: "graph_node",
      id: "node_alpha",
    },
  ]);
  assert.deepEqual(runtime.context, {
    goal: "launch",
  });

  const fetched = lighttask.getRuntime("runtime_alpha");
  assert.ok(fetched);
  assert.equal(fetched.kind, "plan_launch");
  assert.deepEqual(fetched.ownerRef, {
    kind: "task",
    id: "task_alpha",
  });
  assert.deepEqual(fetched.relatedRefs, [
    {
      kind: "task",
      id: "task_beta",
    },
    {
      kind: "graph_node",
      id: "node_alpha",
    },
  ]);

  const listed = lighttask.listRuntimes();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "runtime_alpha");
  assert.deepEqual(listed[0].ownerRef, {
    kind: "task",
    id: "task_alpha",
  });
  assert.deepEqual(listed[0].relatedRefs, [
    {
      kind: "task",
      id: "task_beta",
    },
    {
      kind: "graph_node",
      id: "node_alpha",
    },
  ]);

  const running = lighttask.advanceRuntime("runtime_alpha", {
    expectedRevision: 1,
  });
  assert.equal(running.status, "running");
  assert.equal(running.revision, 2);
  assert.deepEqual(running.ownerRef, {
    kind: "task",
    id: "task_alpha",
  });
  assert.deepEqual(running.relatedRefs, [
    {
      kind: "task",
      id: "task_beta",
    },
    {
      kind: "graph_node",
      id: "node_alpha",
    },
  ]);

  const completed = lighttask.advanceRuntime("runtime_alpha", {
    expectedRevision: 2,
    result: {
      outcome: "ok",
    },
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.revision, 3);
  assert.deepEqual(completed.result, {
    outcome: "ok",
  });
  assert.deepEqual(completed.ownerRef, {
    kind: "task",
    id: "task_alpha",
  });
  assert.deepEqual(completed.relatedRefs, [
    {
      kind: "task",
      id: "task_beta",
    },
    {
      kind: "graph_node",
      id: "node_alpha",
    },
  ]);
});

test("LightTask Runtime API 返回快照并与内部状态隔离", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const runtime = lighttask.createRuntime({
    id: "runtime_snapshot",
    kind: "worker_session",
    title: "快照隔离",
    parentRef: {
      kind: "task",
      id: "task_1",
    },
    ownerRef: {
      kind: "plan",
      id: "plan_snapshot",
    },
    relatedRefs: [
      {
        kind: "task",
        id: "task_2",
      },
    ],
    context: {
      input: { name: "tester" },
    },
    metadata: {
      owner: { name: "tester" },
    },
    extensions: {
      presentation: { tab: "overview" },
    },
  });

  runtime.title = "外部篡改";
  assert.ok(runtime.parentRef);
  runtime.parentRef.kind = "mutated";
  assert.ok(runtime.ownerRef);
  runtime.ownerRef.kind = "changed";
  assert.ok(runtime.relatedRefs);
  runtime.relatedRefs[0].kind = "changed";
  runtime.relatedRefs.push({
    kind: "plan",
    id: "plan_mutated",
  });
  assert.ok(runtime.context);
  runtime.context.input = { name: "mutated" };

  const listed = lighttask.listRuntimes();
  listed[0].title = "列表篡改";
  assert.ok(listed[0].metadata);
  listed[0].metadata.owner = { name: "mutated" };

  const stored = lighttask.getRuntime("runtime_snapshot");
  assert.ok(stored);
  assert.equal(stored.title, "快照隔离");
  assert.deepEqual(stored.parentRef, {
    kind: "task",
    id: "task_1",
  });
  assert.deepEqual(stored.ownerRef, {
    kind: "plan",
    id: "plan_snapshot",
  });
  assert.deepEqual(stored.relatedRefs, [
    {
      kind: "task",
      id: "task_2",
    },
  ]);
  assert.deepEqual(stored.context, {
    input: { name: "tester" },
  });
  assert.deepEqual(stored.metadata, {
    owner: { name: "tester" },
  });
});

test("LightTask Runtime API expectedRevision 不匹配时返回 REVISION_CONFLICT", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createRuntime({
    id: "runtime_revision_conflict",
    kind: "plan_launch",
    title: "revision 冲突",
  });

  assert.throws(
    () =>
      lighttask.advanceRuntime("runtime_revision_conflict", {
        expectedRevision: 2,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "REVISION_CONFLICT");
      assert.equal(error.coreError.message, "expectedRevision 与当前 revision 不一致");
      assert.equal(error.details?.currentRevision, 1);
      assert.equal(error.details?.expectedRevision, 2);
      return true;
    },
  );
});

test("LightTask Runtime API 创建时会校验 ownerRef.kind 与 ownerRef.id", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () =>
      lighttask.createRuntime({
        id: "runtime_invalid_owner_kind",
        kind: "plan_launch",
        title: "ownerRef 校验",
        ownerRef: {
          kind: "   ",
          id: "task_1",
        },
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "运行时 ownerRef.kind 不能为空");
      return true;
    },
  );

  assert.throws(
    () =>
      lighttask.createRuntime({
        id: "runtime_invalid_owner_id",
        kind: "plan_launch",
        title: "ownerRef 校验",
        ownerRef: {
          kind: "task",
          id: "   ",
        },
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "运行时 ownerRef.id 不能为空");
      return true;
    },
  );
});

test("LightTask Runtime API 创建时会校验 parentRef 与 relatedRefs", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () =>
      lighttask.createRuntime({
        id: "runtime_invalid_parent_kind",
        kind: "plan_launch",
        title: "parentRef 校验",
        parentRef: {
          kind: "   ",
          id: "plan_1",
        },
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "运行时 parentRef.kind 不能为空");
      return true;
    },
  );

  assert.throws(
    () =>
      lighttask.createRuntime({
        id: "runtime_invalid_related_refs_shape",
        kind: "plan_launch",
        title: "relatedRefs 校验",
        relatedRefs: {
          kind: "task",
          id: "task_1",
        } as never,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "运行时 relatedRefs 必须是数组");
      return true;
    },
  );

  assert.throws(
    () =>
      lighttask.createRuntime({
        id: "runtime_invalid_related_ref_id",
        kind: "plan_launch",
        title: "relatedRefs 校验",
        relatedRefs: [
          {
            kind: "task",
            id: "   ",
          },
        ],
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "运行时 relatedRefs[0].id 不能为空");
      return true;
    },
  );
});

test("LightTask Runtime API 推进时不允许修改关系字段", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createRuntime({
    id: "runtime_relations_readonly",
    kind: "plan_launch",
    title: "关系只读",
    parentRef: {
      kind: "plan",
      id: "plan_1",
    },
    ownerRef: {
      kind: "task",
      id: "task_1",
    },
    relatedRefs: [
      {
        kind: "task",
        id: "task_2",
      },
    ],
  });

  assert.throws(
    () =>
      lighttask.advanceRuntime("runtime_relations_readonly", {
        expectedRevision: 1,
        parentRef: {
          kind: "plan",
          id: "plan_2",
        },
        ownerRef: {
          kind: "task",
          id: "task_9",
        },
        relatedRefs: [
          {
            kind: "plan",
            id: "plan_3",
          },
        ],
      } as never),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "advanceRuntime 不允许修改关系字段");
      assert.deepEqual(error.details?.fields, ["parentRef", "ownerRef", "relatedRefs"]);
      return true;
    },
  );

  const fetched = lighttask.getRuntime("runtime_relations_readonly");
  assert.ok(fetched);
  assert.equal(fetched.status, "queued");
  assert.deepEqual(fetched.parentRef, {
    kind: "plan",
    id: "plan_1",
  });
  assert.deepEqual(fetched.ownerRef, {
    kind: "task",
    id: "task_1",
  });
  assert.deepEqual(fetched.relatedRefs, [
    {
      kind: "task",
      id: "task_2",
    },
  ]);
});

test("LightTask Runtime API 推进空白 runtimeId 时会抛校验错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () =>
      lighttask.advanceRuntime("   ", {
        expectedRevision: 1,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "运行时 ID 不能为空");
      assert.equal(error.details?.runtimeId, "   ");
      return true;
    },
  );
});

test("LightTask Runtime API 缺失 expectedRevision 时会抛校验错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createRuntime({
    id: "runtime_missing_revision",
    kind: "plan_launch",
    title: "缺失 revision",
  });

  assert.throws(
    () => lighttask.advanceRuntime("runtime_missing_revision", {} as never),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "expectedRevision 为必填字段");
      assert.equal(error.details?.runtimeId, "runtime_missing_revision");
      return true;
    },
  );
});

test("LightTask Runtime API 不存在运行时时返回 NOT_FOUND", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () =>
      lighttask.advanceRuntime("runtime_missing", {
        expectedRevision: 1,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "NOT_FOUND");
      assert.equal(error.coreError.message, "未找到运行时");
      assert.equal(error.details?.runtimeId, "runtime_missing");
      return true;
    },
  );
});

test("LightTask Runtime API 终态默认推进会返回 STATE_CONFLICT", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createRuntime({
    id: "runtime_terminal",
    kind: "plan_launch",
    title: "终态推进",
  });
  lighttask.advanceRuntime("runtime_terminal", {
    expectedRevision: 1,
  });
  lighttask.advanceRuntime("runtime_terminal", {
    expectedRevision: 2,
    result: { outcome: "ok" },
  });

  assert.throws(
    () =>
      lighttask.advanceRuntime("runtime_terminal", {
        expectedRevision: 3,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      assert.equal(error.coreError.message, "当前运行时没有可推进动作");
      assert.equal(error.details?.runtimeId, "runtime_terminal");
      assert.equal(error.details?.currentStatus, "completed");
      return true;
    },
  );
});

test("LightTask Runtime API 按路径校验 runtime 依赖", () => {
  assertInvalidDependencyCases([
    {
      name: "runtimeRepository.create",
      options: {
        runtimeRepository: {},
      },
      invoke(lighttask) {
        lighttask.createRuntime({
          id: "runtime_invalid_dep_create",
          kind: "plan_launch",
          title: "依赖校验",
        });
      },
    },
    {
      name: "runtimeRepository.get",
      options: {
        runtimeRepository: {},
      },
      invoke(lighttask) {
        lighttask.getRuntime("runtime_invalid_dep_get");
      },
    },
    {
      name: "runtimeRepository.list",
      options: {
        runtimeRepository: {},
      },
      invoke(lighttask) {
        lighttask.listRuntimes();
      },
    },
    {
      name: "runtimeRepository.saveIfRevisionMatches",
      options: {
        runtimeRepository: {
          get(runtimeId: string): LightTaskRuntime | undefined {
            return {
              id: runtimeId,
              kind: "plan_launch",
              title: "依赖校验",
              status: "queued",
              revision: 1,
              createdAt: "2026-04-14T00:00:00.000Z",
              updatedAt: "2026-04-14T00:00:00.000Z",
            };
          },
        },
      },
      invoke(lighttask) {
        lighttask.advanceRuntime("runtime_invalid_dep_save", {
          expectedRevision: 1,
        });
      },
    },
  ]);
});
