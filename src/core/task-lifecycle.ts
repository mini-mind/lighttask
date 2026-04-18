import { type TaskLifecyclePolicy, defaultTaskLifecyclePolicy } from "../rules";
import type { CreateLightTaskOptions } from "./types";

export function resolveTaskLifecyclePolicy(options: CreateLightTaskOptions): TaskLifecyclePolicy {
  // 统一从这里解析任务生命周期策略，避免主链再回到硬编码状态判断。
  return options.taskLifecycle ?? defaultTaskLifecyclePolicy;
}
