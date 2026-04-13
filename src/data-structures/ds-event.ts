import { cloneValue } from "./ds-clone";

export type DomainEventType =
  | "task.created"
  | "task.updated"
  | "task.completed"
  | "task.failed"
  | "plan.created"
  | "plan.updated"
  | "plan.confirmed"
  | "graph.updated";

export interface DomainEvent<TPayload = Record<string, unknown>> {
  id: string;
  type: DomainEventType;
  aggregateId: string;
  occurredAt: string;
  revision: number;
  version: 1;
  idempotencyKey?: string;
  payload: TPayload;
}

export interface CreateDomainEventInput<TPayload = Record<string, unknown>> {
  id: string;
  type: DomainEventType;
  aggregateId: string;
  occurredAt: string;
  revision: number;
  idempotencyKey?: string;
  payload: TPayload;
}

export function createDomainEvent<TPayload = Record<string, unknown>>(
  input: CreateDomainEventInput<TPayload>,
): DomainEvent<TPayload> {
  // 显式 version 字段用于后续协议演进。
  return {
    id: input.id,
    type: input.type,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    revision: input.revision,
    version: 1,
    idempotencyKey: input.idempotencyKey,
    payload: cloneValue(input.payload),
  };
}
