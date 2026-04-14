import type { CoreError } from "../data-structures";
import { createCoreError } from "../data-structures";

export type IdempotencyDecisionType = "proceed" | "replay" | "conflict";

export interface DecideIdempotencyInput {
  incomingIdempotencyKey?: string;
  storedIdempotencyKey?: string;
  incomingFingerprint?: string;
  storedFingerprint?: string;
}

export interface IdempotencyDecision {
  decision: IdempotencyDecisionType;
  reason: string;
  error?: CoreError;
}

function normalizeOptionalKey(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function decideIdempotency(input: DecideIdempotencyInput): IdempotencyDecision {
  const incomingKey = normalizeOptionalKey(input.incomingIdempotencyKey);
  const storedKey = normalizeOptionalKey(input.storedIdempotencyKey);

  if (!incomingKey) {
    return {
      decision: "proceed",
      reason: "未提供 idempotencyKey，按普通写请求处理。",
    };
  }

  if (!storedKey) {
    return {
      decision: "proceed",
      reason: "当前实体尚无历史 idempotencyKey，按首次请求处理。",
    };
  }

  if (incomingKey !== storedKey) {
    return {
      decision: "proceed",
      reason: "idempotencyKey 与历史请求不同，视为新请求。",
    };
  }

  const hasIncomingFingerprint = input.incomingFingerprint !== undefined;
  const hasStoredFingerprint = input.storedFingerprint !== undefined;

  // 同 key 但指纹缺失不一致时，必须按冲突处理，避免同 key 被不同语义复用。
  if (hasIncomingFingerprint !== hasStoredFingerprint) {
    const error = createCoreError(
      "STATE_CONFLICT",
      "相同 idempotencyKey 的请求指纹不完整，无法判定为安全重放。",
      {
        idempotencyKey: incomingKey,
        incomingFingerprint: input.incomingFingerprint,
        storedFingerprint: input.storedFingerprint,
      },
    );
    return {
      decision: "conflict",
      reason: error.message,
      error,
    };
  }

  // 相同 key 时，只要指纹冲突就必须拒绝，避免“同 key 不同语义”污染状态。
  if (
    hasIncomingFingerprint &&
    hasStoredFingerprint &&
    input.incomingFingerprint !== input.storedFingerprint
  ) {
    const error = createCoreError(
      "STATE_CONFLICT",
      "相同 idempotencyKey 对应的请求内容不一致，拒绝处理。",
      {
        idempotencyKey: incomingKey,
        incomingFingerprint: input.incomingFingerprint,
        storedFingerprint: input.storedFingerprint,
      },
    );

    return {
      decision: "conflict",
      reason: error.message,
      error,
    };
  }

  return {
    decision: "replay",
    reason: "检测到重复 idempotencyKey，按重放请求处理。",
  };
}
