import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError, createLightTaskError, toLightTaskError } from "../core/lighttask-error";
import { createCoreError } from "../data-structures";

test("错误适配层：createLightTaskError 复用 data-structures 的唯一错误模型", () => {
  const details = {
    field: {
      name: "title",
    },
  };
  const error = createLightTaskError("VALIDATION_ERROR", "参数错误", details);
  details.field.name = "summary";

  assert.deepEqual(error, {
    code: "VALIDATION_ERROR",
    message: "参数错误",
    details: {
      field: {
        name: "title",
      },
    },
  });
});

test("错误适配层：toLightTaskError 遇到契约错误实例时直接返回原对象", () => {
  const error = new LightTaskError(createCoreError("STATE_CONFLICT", "状态冲突"));
  assert.equal(toLightTaskError(error), error);
});

test("错误适配层：toLightTaskError 可吸收带 coreError 的异常对象", () => {
  const error = toLightTaskError({
    coreError: createCoreError("NOT_FOUND", "未找到任务", {
      taskId: "task_1",
    }),
  });

  assert.ok(error instanceof LightTaskError);
  assert.equal(error.code, "NOT_FOUND");
  assert.deepEqual(error.details, { taskId: "task_1" });
});

test("错误适配层：toLightTaskError 可吸收裸错误形状对象", () => {
  const error = toLightTaskError(
    createCoreError("REVISION_CONFLICT", "revision 冲突", {
      currentRevision: 2,
      expectedRevision: 1,
    }),
  );

  assert.ok(error instanceof LightTaskError);
  assert.equal(error.code, "REVISION_CONFLICT");
  assert.deepEqual(error.details, {
    currentRevision: 2,
    expectedRevision: 1,
  });
});

test("错误适配层：toLightTaskError 会把原生 Error 归一化为 INVARIANT_VIOLATION", () => {
  const error = toLightTaskError(new TypeError("底层异常"));

  assert.ok(error instanceof LightTaskError);
  assert.equal(error.code, "INVARIANT_VIOLATION");
  assert.equal(error.message, "INVARIANT_VIOLATION: 底层异常");
  assert.deepEqual(error.details, {
    originalErrorName: "TypeError",
  });
});

test("错误适配层：Error 即使带有字符串 code 也不会被当作契约错误透传", () => {
  const source = Object.assign(new Error("底层异常"), {
    code: "EIO",
  });
  const error = toLightTaskError(source);

  assert.ok(error instanceof LightTaskError);
  assert.equal(error.code, "INVARIANT_VIOLATION");
  assert.deepEqual(error.details, {
    originalErrorName: "Error",
  });
});

test("错误适配层：非法裸错误形状会降级为 INVARIANT_VIOLATION", () => {
  const error = toLightTaskError({
    code: "E_INVALID",
    message: "非法错误码",
  });

  assert.ok(error instanceof LightTaskError);
  assert.equal(error.code, "INVARIANT_VIOLATION");
  assert.deepEqual(error.details, {
    originalError: "[object Object]",
  });
});

test("错误适配层：非法 coreError 形状会降级为 INVARIANT_VIOLATION", () => {
  const error = toLightTaskError({
    coreError: {
      code: "E_INVALID",
      message: "非法错误码",
    },
  });

  assert.ok(error instanceof LightTaskError);
  assert.equal(error.code, "INVARIANT_VIOLATION");
  assert.deepEqual(error.details, {
    originalError: "[object Object]",
  });
});

test("错误适配层：toLightTaskError 会把非 Error 异常值归一化为 INVARIANT_VIOLATION", () => {
  const error = toLightTaskError("panic");

  assert.ok(error instanceof LightTaskError);
  assert.equal(error.code, "INVARIANT_VIOLATION");
  assert.equal(error.message, "INVARIANT_VIOLATION: 捕获到非 Error 异常");
  assert.deepEqual(error.details, {
    originalError: "panic",
  });
});
