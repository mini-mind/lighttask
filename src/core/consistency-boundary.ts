import { requireLightTaskFunction } from "./lighttask-error";
import type { CreateLightTaskOptions } from "./types";

export function runInConsistencyBoundary<TResult>(
  options: CreateLightTaskOptions,
  scope: string,
  work: () => TResult,
): TResult {
  if (!options.consistency) {
    return work();
  }

  const run = requireLightTaskFunction(options.consistency.run, "consistency.run");
  return run(scope, work);
}
