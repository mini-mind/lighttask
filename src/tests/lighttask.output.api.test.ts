import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError, type LightTaskOutput, createLightTask } from "../index";
import { assertInvalidDependencyCases, createTestLightTaskOptions } from "./ports-fixture";

test("LightTask Output API 支持创建、读取、列出与推进输出", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  const output = lighttask.createOutput({
    id: " output_alpha ",
    kind: " summary ",
    runtimeRef: {
      id: " runtime_missing_but_allowed ",
    },
    ownerRef: {
      kind: " task ",
      id: " task_alpha ",
    },
    payload: {
      text: "draft",
    },
    metadata: {
      owner: { name: "tester" },
    },
    extensions: {
      properties: { priority: "p1" },
      namespaces: { output: { lane: "core" } },
    },
  });

  assert.equal(output.id, "output_alpha");
  assert.equal(output.kind, "summary");
  assert.equal(output.status, "open");
  assert.equal(output.revision, 1);
  assert.deepEqual(output.runtimeRef, {
    id: "runtime_missing_but_allowed",
  });
  assert.deepEqual(output.ownerRef, {
    kind: "task",
    id: "task_alpha",
  });
  assert.deepEqual(output.payload, {
    text: "draft",
  });

  const fetched = lighttask.getOutput("output_alpha");
  assert.ok(fetched);
  assert.equal(fetched.kind, "summary");
  assert.deepEqual(fetched.runtimeRef, {
    id: "runtime_missing_but_allowed",
  });

  const listed = lighttask.listOutputs();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "output_alpha");

  const revised = lighttask.advanceOutput("output_alpha", {
    expectedRevision: 1,
    status: "open",
    payload: {
      text: "draft v2",
    },
  });
  assert.equal(revised.status, "open");
  assert.equal(revised.revision, 2);
  assert.deepEqual(revised.payload, {
    text: "draft v2",
  });

  const sealed = lighttask.advanceOutput("output_alpha", {
    expectedRevision: 2,
  });
  assert.equal(sealed.status, "sealed");
  assert.equal(sealed.revision, 3);
  assert.deepEqual(sealed.ownerRef, {
    kind: "task",
    id: "task_alpha",
  });
  assert.deepEqual(sealed.payload, {
    text: "draft v2",
  });
});

test("LightTask Output API 返回快照并与内部状态隔离", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const output = lighttask.createOutput({
    id: "output_snapshot",
    kind: "report",
    runtimeRef: {
      id: "runtime_1",
    },
    ownerRef: {
      kind: "plan",
      id: "plan_snapshot",
    },
    payload: {
      content: { text: "draft" },
    },
    metadata: {
      owner: { name: "tester" },
    },
    extensions: {
      presentation: { tab: "overview" },
    },
  });

  output.kind = "外部篡改";
  assert.ok(output.runtimeRef);
  output.runtimeRef.id = "runtime_mutated";
  assert.ok(output.ownerRef);
  output.ownerRef.kind = "changed";
  assert.ok(output.payload);
  output.payload.content = { text: "mutated" };

  const listed = lighttask.listOutputs();
  listed[0].kind = "列表篡改";
  assert.ok(listed[0].metadata);
  listed[0].metadata.owner = { name: "mutated" };

  const stored = lighttask.getOutput("output_snapshot");
  assert.ok(stored);
  assert.equal(stored.kind, "report");
  assert.deepEqual(stored.runtimeRef, {
    id: "runtime_1",
  });
  assert.deepEqual(stored.ownerRef, {
    kind: "plan",
    id: "plan_snapshot",
  });
  assert.deepEqual(stored.payload, {
    content: { text: "draft" },
  });
  assert.deepEqual(stored.metadata, {
    owner: { name: "tester" },
  });
});

test("LightTask Output API expectedRevision 不匹配时返回 REVISION_CONFLICT", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createOutput({
    id: "output_revision_conflict",
    kind: "summary",
  });

  assert.throws(
    () =>
      lighttask.advanceOutput("output_revision_conflict", {
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

test("LightTask Output API 创建时会校验 runtimeRef.id 与 ownerRef", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () =>
      lighttask.createOutput({
        id: "output_invalid_runtime_ref",
        kind: "summary",
        runtimeRef: {
          id: "   ",
        },
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "输出 runtimeRef.id 不能为空");
      return true;
    },
  );

  assert.throws(
    () =>
      lighttask.createOutput({
        id: "output_invalid_owner_kind",
        kind: "summary",
        ownerRef: {
          kind: "   ",
          id: "task_1",
        },
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "输出 ownerRef.kind 不能为空");
      return true;
    },
  );
});

test("LightTask Output API 终态默认推进会返回 STATE_CONFLICT", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createOutput({
    id: "output_terminal",
    kind: "summary",
  });
  lighttask.advanceOutput("output_terminal", {
    expectedRevision: 1,
  });

  assert.throws(
    () =>
      lighttask.advanceOutput("output_terminal", {
        expectedRevision: 2,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      assert.equal(error.coreError.message, "当前输出没有可推进动作");
      assert.equal(error.details?.outputId, "output_terminal");
      assert.equal(error.details?.currentStatus, "sealed");
      return true;
    },
  );
});

test("LightTask Output API 缺失 expectedRevision 或推进无变化时会抛校验错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createOutput({
    id: "output_missing_revision",
    kind: "summary",
  });

  assert.throws(
    () => lighttask.advanceOutput("output_missing_revision", {} as never),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "expectedRevision 为必填字段");
      assert.equal(error.details?.outputId, "output_missing_revision");
      return true;
    },
  );

  assert.throws(
    () =>
      lighttask.advanceOutput("output_missing_revision", {
        expectedRevision: 1,
        status: "open",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "推进输出至少需要提供 payload 或 status 变更");
      assert.equal(error.details?.outputId, "output_missing_revision");
      return true;
    },
  );
});

test("LightTask Output API 按路径校验 output 依赖", () => {
  assertInvalidDependencyCases([
    {
      name: "outputRepository.create",
      options: {
        outputRepository: {},
      },
      invoke(lighttask) {
        lighttask.createOutput({
          id: "output_invalid_dep_create",
          kind: "summary",
        });
      },
    },
    {
      name: "outputRepository.get",
      options: {
        outputRepository: {},
      },
      invoke(lighttask) {
        lighttask.getOutput("output_invalid_dep_get");
      },
    },
    {
      name: "outputRepository.list",
      options: {
        outputRepository: {},
      },
      invoke(lighttask) {
        lighttask.listOutputs();
      },
    },
    {
      name: "outputRepository.saveIfRevisionMatches",
      options: {
        outputRepository: {
          get(outputId: string): LightTaskOutput | undefined {
            return {
              id: outputId,
              kind: "summary",
              status: "open",
              revision: 1,
              createdAt: "2026-04-14T00:00:00.000Z",
              updatedAt: "2026-04-14T00:00:00.000Z",
            };
          },
        },
      },
      invoke(lighttask) {
        lighttask.advanceOutput("output_invalid_dep_save", {
          expectedRevision: 1,
        });
      },
    },
  ]);
});
