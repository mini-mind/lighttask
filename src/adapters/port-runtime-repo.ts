import type { RepositoryWriteResult } from "./port-repo-write-result";

export type RuntimeRepositoryWriteResult<TRuntime> = RepositoryWriteResult<"runtime", TRuntime>;

export interface RuntimeRepository<TRuntime extends { id: string; revision: number }> {
  /**
   * 返回运行时快照集合；调用方修改返回值时，不得污染仓储内部状态。
   */
  list(): TRuntime[];
  /**
   * 返回单个运行时快照；若存在记录，返回值必须与存储态隔离。
   */
  get(runtimeId: string): TRuntime | undefined;
  /**
   * 仓储不得原地修改调用方传入对象。
   * 常规失败应通过 ok:false 返回结构化错误；直接抛异常仅视为违约/防御路径。
   */
  create(runtime: TRuntime): RuntimeRepositoryWriteResult<TRuntime>;
  /**
   * 仓储不得原地修改调用方传入对象。
   * 常规失败应通过 ok:false 返回结构化错误；成功返回的运行时也必须与存储态隔离。
   */
  saveIfRevisionMatches(
    runtime: TRuntime,
    expectedRevision: number,
  ): RuntimeRepositoryWriteResult<TRuntime>;
  /**
   * 删除动作也必须遵循 revision 保护，避免留痕对象被并发覆盖后误删。
   */
  deleteIfRevisionMatches(
    runtimeId: string,
    expectedRevision: number,
  ): RuntimeRepositoryWriteResult<TRuntime>;
}
