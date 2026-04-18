import type { CoreError, CoreErrorCode } from "../models";
import { CORE_ERROR_CODES, LightTaskError, createCoreError } from "../models";

export type LightTaskErrorCode = CoreErrorCode;
export type LightTaskErrorShape = CoreError;
export { LightTaskError };

export function createLightTaskError(
  code: LightTaskErrorCode,
  message: string,
  details?: Record<string, unknown>,
): LightTaskErrorShape {
  // 错误模型以 models 为唯一来源，api 只负责异常适配，不再维护第二套 shape。
  return createCoreError(code, message, details);
}

const CORE_ERROR_CODE_SET = new Set<string>(CORE_ERROR_CODES);

function isLightTaskErrorShape(value: unknown): value is LightTaskErrorShape {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<LightTaskErrorShape>;
  return (
    typeof candidate.code === "string" &&
    CORE_ERROR_CODE_SET.has(candidate.code) &&
    typeof candidate.message === "string"
  );
}

function hasCoreError(value: unknown): value is { coreError: LightTaskErrorShape } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { coreError?: unknown };
  return isLightTaskErrorShape(candidate.coreError);
}

function hasErrorShape(value: unknown): value is LightTaskErrorShape {
  if (value instanceof Error) {
    return false;
  }
  return isLightTaskErrorShape(value);
}

export function throwLightTaskError(coreError: LightTaskErrorShape): never {
  throw new LightTaskError(coreError);
}

export function requireLightTaskFunction<TValue>(
  value: TValue | undefined,
  path: string,
): Exclude<TValue, undefined> {
  if (typeof value === "function") {
    return value as Exclude<TValue, undefined>;
  }

  throwLightTaskError(
    createLightTaskError("VALIDATION_ERROR", `${path} 必须是函数`, {
      path,
    }),
  );
}

export function toLightTaskError(error: unknown): LightTaskError {
  if (error instanceof LightTaskError) {
    return error;
  }

  if (hasCoreError(error)) {
    return new LightTaskError(error.coreError);
  }

  if (hasErrorShape(error)) {
    return new LightTaskError(error);
  }

  if (error instanceof Error) {
    // 进入这里说明异常不属于内核契约错误，统一降级为 INVARIANT_VIOLATION，避免原生异常泄漏到上层。
    return new LightTaskError(
      createLightTaskError("INVARIANT_VIOLATION", error.message, {
        originalErrorName: error.name,
      }),
    );
  }

  // 兜底处理非 Error 异常值，保证公共 API 的异常面保持统一。
  return new LightTaskError(
    createLightTaskError("INVARIANT_VIOLATION", "捕获到非 Error 异常", {
      originalError: String(error),
    }),
  );
}
