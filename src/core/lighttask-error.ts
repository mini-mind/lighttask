export type LightTaskErrorCode =
  | "VALIDATION_ERROR"
  | "STATE_CONFLICT"
  | "REVISION_CONFLICT"
  | "NOT_FOUND"
  | "INVARIANT_VIOLATION";

export interface LightTaskErrorShape {
  code: LightTaskErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function createLightTaskError(
  code: LightTaskErrorCode,
  message: string,
  details?: Record<string, unknown>,
): LightTaskErrorShape {
  return {
    code,
    message,
    details,
  };
}

function isCoreError(value: unknown): value is LightTaskErrorShape {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<LightTaskErrorShape>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

function hasCoreError(value: unknown): value is { coreError: LightTaskErrorShape } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { coreError?: unknown };
  return isCoreError(candidate.coreError);
}

function hasErrorShape(value: unknown): value is LightTaskErrorShape {
  return isCoreError(value);
}

export class LightTaskError extends Error {
  readonly code: LightTaskErrorCode;
  readonly details?: Record<string, unknown>;
  readonly coreError: LightTaskErrorShape;

  constructor(coreError: LightTaskErrorShape) {
    super(`${coreError.code}: ${coreError.message}`);
    this.name = "LightTaskError";
    this.code = coreError.code;
    this.details = coreError.details;
    this.coreError = coreError;
  }
}

export function throwLightTaskError(coreError: LightTaskErrorShape): never {
  throw new LightTaskError(coreError);
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
    return new LightTaskError(
      createLightTaskError("INVARIANT_VIOLATION", error.message, {
        originalErrorName: error.name,
      }),
    );
  }

  return new LightTaskError(
    createLightTaskError("INVARIANT_VIOLATION", "捕获到非 Error 异常", {
      originalError: String(error),
    }),
  );
}
