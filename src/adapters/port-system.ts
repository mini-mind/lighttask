export interface ClockPort {
  now(): string;
}

export interface IdGeneratorPort {
  nextTaskId(): string;
}
