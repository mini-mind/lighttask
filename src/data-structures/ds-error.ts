import { cloneOptional } from "./ds-clone";

export type CoreErrorCode =
  | "VALIDATION_ERROR"
  | "STATE_CONFLICT"
  | "REVISION_CONFLICT"
  | "NOT_FOUND"
  | "INVARIANT_VIOLATION";

export interface CoreError {
  code: CoreErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export class CoreContractError extends Error {
  readonly code: CoreErrorCode;
  readonly details?: Record<string, unknown>;
  readonly coreError: CoreError;

  constructor(coreError: CoreError) {
    super(`${coreError.code}: ${coreError.message}`);
    this.name = "LightTaskError";
    this.code = coreError.code;
    this.details = coreError.details;
    this.coreError = coreError;
  }
}

export function createCoreError(
  code: CoreErrorCode,
  message: string,
  details?: Record<string, unknown>,
): CoreError {
  return {
    code,
    message,
    details: cloneOptional(details),
  };
}

export function throwCoreError(coreError: CoreError): never {
  throw new CoreContractError(coreError);
}
