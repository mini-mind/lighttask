import type { RepositoryWriteResult } from "./port-repo-write-result";

export type GraphRepositoryWriteResult<TGraph> = RepositoryWriteResult<"graph", TGraph>;

export interface GraphRepository<TGraph extends { revision: number }> {
  get(planId: string): TGraph | undefined;
  create(planId: string, graph: TGraph): GraphRepositoryWriteResult<TGraph>;
  saveIfRevisionMatches(
    planId: string,
    graph: TGraph,
    expectedRevision: number,
  ): GraphRepositoryWriteResult<TGraph>;
}
