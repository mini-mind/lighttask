import { createCoreError, throwCoreError } from "../data-structures";

function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throwCoreError(
      createCoreError("VALIDATION_ERROR", `${fieldName} 必须是大于等于 1 的整数`, {
        [fieldName]: value,
      }),
    );
  }
}

export function assertExpectedRevision(currentRevision: number, expectedRevision: number): void {
  assertPositiveInteger(currentRevision, "currentRevision");
  assertPositiveInteger(expectedRevision, "expectedRevision");

  // 意图：保护乐观锁边界，客户端声明的期望版本必须与当前版本一致。
  if (currentRevision !== expectedRevision) {
    throwCoreError(
      createCoreError("REVISION_CONFLICT", "expectedRevision 与当前 revision 不一致", {
        currentRevision,
        expectedRevision,
      }),
    );
  }
}

export function assertNextRevision(previousRevision: number, nextRevision: number): void {
  assertPositiveInteger(previousRevision, "previousRevision");
  assertPositiveInteger(nextRevision, "nextRevision");

  // 边界：revision 只允许 +1，跳号或回退都算并发冲突。
  if (nextRevision !== previousRevision + 1) {
    throwCoreError(
      createCoreError("REVISION_CONFLICT", "nextRevision 必须严格等于 previousRevision + 1", {
        previousRevision,
        nextRevision,
      }),
    );
  }
}
