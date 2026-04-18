import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError } from "../index";
import { createTestLightTask } from "./adapters-fixture";

test("Output API：支持创建、封口和过滤查询", () => {
  const { lighttask } = createTestLightTask();
  const output = lighttask.outputs.create({
    id: "output_1",
    kind: "artifact",
    payload: {
      ok: true,
    },
  });
  assert.equal(output.status, "open");

  const sealed = lighttask.outputs.update(output.id, {
    expectedRevision: output.revision,
    payload: {
      ok: true,
      sealed: true,
    },
  });
  assert.equal(sealed.status, "sealed");
  assert.deepEqual(
    lighttask.outputs
      .list({
        status: "sealed",
      })
      .map((item) => item.id),
    ["output_1"],
  );
});

test("Output API：上一次带 key，这一次不带 key 仍应按新请求处理", () => {
  const { lighttask } = createTestLightTask();
  const output = lighttask.outputs.create({
    id: "output_no_key_pollution",
    kind: "artifact",
  });
  const stillOpen = lighttask.outputs.update(output.id, {
    expectedRevision: output.revision,
    status: "open",
    payload: {
      step: 1,
    },
    idempotencyKey: "req_output_1",
  });

  const sealed = lighttask.outputs.update(output.id, {
    expectedRevision: stillOpen.revision,
    payload: {
      step: 2,
    },
  });

  assert.equal(sealed.status, "sealed");
  assert.equal(sealed.idempotencyKey, undefined);
});

test("Output API：非法 status 会直接报校验错误", () => {
  const { lighttask } = createTestLightTask();
  const output = lighttask.outputs.create({
    id: "output_invalid_status",
    kind: "artifact",
  });

  assert.throws(
    () =>
      lighttask.outputs.update(output.id, {
        expectedRevision: output.revision,
        status: "closed" as never,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      return true;
    },
  );
});

test("Output API：deleteOutput 只删除输出本身", () => {
  const { lighttask } = createTestLightTask();
  const output = lighttask.outputs.create({
    id: "output_to_remove",
    kind: "artifact",
  });

  const removed = lighttask.outputs.remove(output.id, {
    expectedRevision: output.revision,
  });
  assert.deepEqual(removed, { outputId: output.id });
  assert.equal(lighttask.outputs.get(output.id), undefined);
});
