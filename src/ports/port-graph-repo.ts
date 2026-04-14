import type { RepositoryWriteResult } from "./port-repo-write-result";

export type GraphRepositoryWriteResult<TGraph> = RepositoryWriteResult<"graph", TGraph>;

export interface GraphRepository<TGraph extends { revision: number }> {
  /**
   * 返回图快照；若存在记录，返回值必须与存储态隔离。
   */
  get(planId: string): TGraph | undefined;
  /**
   * 仓储不得原地修改调用方传入对象。
   * 常规失败应通过 ok:false 返回结构化错误；直接抛异常仅视为违约/防御路径。
   */
  create(planId: string, graph: TGraph): GraphRepositoryWriteResult<TGraph>;
  /**
   * 仓储不得原地修改调用方传入对象。
   * 常规失败应通过 ok:false 返回结构化错误；成功返回的图快照也必须与存储态隔离。
   */
  saveIfRevisionMatches(
    planId: string,
    graph: TGraph,
    expectedRevision: number,
  ): GraphRepositoryWriteResult<TGraph>;
}
