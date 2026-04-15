import type { RepositoryWriteResult } from "./port-repo-write-result";

export type OutputRepositoryWriteResult<TOutput> = RepositoryWriteResult<"output", TOutput>;

export interface OutputRepository<TOutput extends { id: string; revision: number }> {
  /**
   * 返回输出快照集合；调用方修改返回值时，不得污染仓储内部状态。
   */
  list(): TOutput[];
  /**
   * 返回单个输出快照；若存在记录，返回值必须与存储态隔离。
   */
  get(outputId: string): TOutput | undefined;
  /**
   * 仓储不得原地修改调用方传入对象。
   * 常规失败应通过 ok:false 返回结构化错误；直接抛异常仅视为违约/防御路径。
   */
  create(output: TOutput): OutputRepositoryWriteResult<TOutput>;
  /**
   * 仓储不得原地修改调用方传入对象。
   * 常规失败应通过 ok:false 返回结构化错误；成功返回的输出也必须与存储态隔离。
   */
  saveIfRevisionMatches(
    output: TOutput,
    expectedRevision: number,
  ): OutputRepositoryWriteResult<TOutput>;
}
