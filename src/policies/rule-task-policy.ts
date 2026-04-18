import type { TaskStatus } from "../models";
import type { TaskAction, TaskPolicy } from "./rule-task-fsm";

export interface TaskPolicyInfo {
  id: string;
  initialStatus: TaskStatus;
  statusKeys: TaskStatus[];
  actionKeys: TaskAction[];
}

export interface TaskPolicies {
  get(policyId: string): TaskPolicy | undefined;
  list(): TaskPolicyInfo[];
}

export interface DefineTaskPoliciesInput {
  policies: Readonly<Record<string, TaskPolicy>>;
}

// 任务策略集合负责把应用层声明的策略稳定暴露给内核，不允许靠隐式默认值兜底。
export function defineTaskPolicies(input: DefineTaskPoliciesInput): TaskPolicies {
  const policyMap = new Map<string, TaskPolicy>();

  for (const [rawPolicyId, policy] of Object.entries(input.policies)) {
    const policyId = rawPolicyId.trim();
    if (!policyId) {
      throw new Error("taskPolicies 不允许出现空白 policyId");
    }
    if (policyMap.has(policyId)) {
      throw new Error(`taskPolicies 存在重复 policyId: ${policyId}`);
    }
    policyMap.set(policyId, policy);
  }

  return {
    get(policyId) {
      return policyMap.get(policyId.trim());
    },
    list() {
      return [...policyMap.entries()].map(([id, policy]) => ({
        id,
        initialStatus: policy.initialStatus,
        statusKeys: policy.listStatuses().map((status) => status.key),
        actionKeys: policy.listActionDefinitions().map((action) => action.key),
      }));
    },
  };
}
