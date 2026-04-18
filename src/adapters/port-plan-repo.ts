import type { RepositoryWriteResult } from "./port-repo-write-result";

export type PlanRepositoryWriteResult<TPlan> = RepositoryWriteResult<"plan", TPlan>;

export interface PlanRepository<TPlan extends { id: string; revision: number }> {
  /**
   * 返回计划快照集合；调用方修改返回值时，不得污染仓储内部状态。
   */
  list(): TPlan[];
  /**
   * 返回单个计划快照；若存在记录，返回值必须与存储态隔离。
   */
  get(planId: string): TPlan | undefined;
  /**
   * 仓储不得原地修改调用方传入对象。
   * 常规失败应通过 ok:false 返回结构化错误；直接抛异常仅视为违约/防御路径。
   */
  create(plan: TPlan): PlanRepositoryWriteResult<TPlan>;
  /**
   * 仓储不得原地修改调用方传入对象。
   * 常规失败应通过 ok:false 返回结构化错误；成功返回的计划也必须与存储态隔离。
   */
  saveIfRevisionMatches(plan: TPlan, expectedRevision: number): PlanRepositoryWriteResult<TPlan>;
  /**
   * 删除动作也必须遵循 revision 保护，避免应用层误删已经被并发修改的计划。
   */
  deleteIfRevisionMatches(
    planId: string,
    expectedRevision: number,
  ): PlanRepositoryWriteResult<TPlan>;
}
