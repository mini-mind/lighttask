import type { DomainEvent } from "../models";

export interface NotifyPort<TEvent extends DomainEvent = DomainEvent> {
  publish(event: TEvent): void;
}
