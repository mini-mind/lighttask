import type { DomainEvent } from "../data-structures";

export interface NotifyPort<TEvent extends DomainEvent = DomainEvent> {
  publish(event: TEvent): void;
}
