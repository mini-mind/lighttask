import { cloneValue } from "./clone";
import { createLightTaskError, throwLightTaskError } from "./lighttask-error";
import type {
  LightTaskStep,
  LightTaskTask,
  PersistedLightTask,
  TaskStepDefinitionInput,
} from "./types";

function stripInternalTaskFields(task: PersistedLightTask): LightTaskTask {
  const {
    lastCreateFingerprint: _lastCreateFingerprint,
    lastUpdateFingerprint: _lastUpdateFingerprint,
    lastAdvanceFingerprint: _lastAdvanceFingerprint,
    ...publicTask
  } = task;
  return publicTask;
}

export function clonePersistedTask(task: PersistedLightTask): PersistedLightTask {
  return cloneValue(task);
}

export function toPublicTask(task: PersistedLightTask): LightTaskTask {
  return cloneValue(stripInternalTaskFields(task));
}

export function normalizeDefinitionSteps(
  taskId: string,
  steps: TaskStepDefinitionInput[] | null | undefined,
): LightTaskStep[] {
  if (steps == null) {
    return [];
  }

  if (!Array.isArray(steps)) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "steps 必须是数组", {
        taskId,
        steps,
      }),
    );
  }

  const seenIds = new Set<string>();
  return steps.map((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throwLightTaskError(
        createLightTaskError("VALIDATION_ERROR", "steps 只允许对象条目", {
          taskId,
          step,
          stepIndex: index,
        }),
      );
    }

    const id = step.id.trim();
    const title = step.title.trim();
    if (!id) {
      throwLightTaskError(
        createLightTaskError("VALIDATION_ERROR", "steps[].id 不能为空", {
          taskId,
          stepIndex: index,
        }),
      );
    }
    if (!title) {
      throwLightTaskError(
        createLightTaskError("VALIDATION_ERROR", "steps[].title 不能为空", {
          taskId,
          stepIndex: index,
        }),
      );
    }
    if (seenIds.has(id)) {
      throwLightTaskError(
        createLightTaskError("STATE_CONFLICT", "steps 中存在重复 id", {
          taskId,
          stepId: id,
        }),
      );
    }

    seenIds.add(id);
    return {
      id,
      title,
      stage: step.stage,
      // 应用层在 draft 只定义步骤结构；运行态留痕统一从 todo 起步。
      status: "todo",
    };
  });
}

export function resetTaskStepsToTodo(steps: LightTaskStep[]): LightTaskStep[] {
  return steps.map((step) => ({
    ...step,
    status: "todo",
  }));
}

export function advanceTaskStepsOne(steps: LightTaskStep[]): LightTaskStep[] {
  if (steps.length === 0) {
    return [];
  }

  const nextSteps = cloneValue(steps);
  const doingIndex = nextSteps.findIndex((step) => step.status === "doing");
  if (doingIndex >= 0) {
    nextSteps[doingIndex].status = "done";
    const nextTodo = nextSteps[doingIndex + 1];
    if (nextTodo) {
      nextTodo.status = "doing";
    }
    return nextSteps;
  }

  const firstTodoIndex = nextSteps.findIndex((step) => step.status === "todo");
  if (firstTodoIndex >= 0) {
    nextSteps[firstTodoIndex].status = "doing";
  }
  return nextSteps;
}

export function completeAllTaskSteps(steps: LightTaskStep[]): LightTaskStep[] {
  return steps.map((step) => ({
    ...step,
    status: "done",
  }));
}
