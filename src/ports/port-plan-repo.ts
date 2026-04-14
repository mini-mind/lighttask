import type { RepositoryWriteResult } from "./port-repo-write-result";

export type PlanRepositoryWriteResult<TPlan> = RepositoryWriteResult<"plan", TPlan>;

export interface PlanRepository<TPlan extends { id: string; revision: number }> {
  list(): TPlan[];
  get(planId: string): TPlan | undefined;
  create(plan: TPlan): PlanRepositoryWriteResult<TPlan>;
  saveIfRevisionMatches(plan: TPlan, expectedRevision: number): PlanRepositoryWriteResult<TPlan>;
}
