import { createCoreError, throwCoreError } from "./ds-error";

export interface RevisionState {
  revision: number;
  updatedAt: string;
  idempotencyKey?: string;
}

export function createInitialRevision(nowIso: string, idempotencyKey?: string): RevisionState {
  return {
    revision: 1,
    updatedAt: nowIso,
    idempotencyKey,
  };
}

export function bumpRevision(
  current: RevisionState,
  nowIso: string,
  idempotencyKey?: string,
): RevisionState {
  return {
    revision: current.revision + 1,
    updatedAt: nowIso,
    idempotencyKey,
  };
}

export function assertRevisionMonotonic(previous: RevisionState, next: RevisionState): void {
  if (
    !Number.isInteger(previous.revision) ||
    !Number.isInteger(next.revision) ||
    previous.revision < 1 ||
    next.revision < 1
  ) {
    throwCoreError(
      createCoreError("VALIDATION_ERROR", "revision 必须是大于等于 1 的整数", {
        previous: previous.revision,
        next: next.revision,
      }),
    );
  }

  if (next.revision <= previous.revision) {
    throwCoreError(
      createCoreError("REVISION_CONFLICT", "revision 必须单调递增", {
        previous: previous.revision,
        next: next.revision,
      }),
    );
  }
}
