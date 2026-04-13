import { LightTaskError, createLightTask } from "../index";

function printHelp(): void {
  console.log("LightTask CLI");
  console.log("用法:");
  console.log("  npm run dev:cli -- demo");
  console.log('  npm run dev:cli -- create "任务标题"');
}

function run(): void {
  const [, , command, ...rest] = process.argv;
  const lighttask = createLightTask();

  if (!command || command === "help") {
    printHelp();
    return;
  }

  if (command === "demo") {
    const task = lighttask.createTask({
      title: "演示：收敛 LightTask 通用内核",
      summary: "通过 CLI 冒烟验证公共 API",
    });
    lighttask.advanceTask(task.id, {
      expectedRevision: task.revision,
    });
    console.log(JSON.stringify(lighttask.getTask(task.id), null, 2));
    return;
  }

  if (command === "create") {
    const title = rest.join(" ").trim();
    if (!title) {
      throw new LightTaskError({
        code: "VALIDATION_ERROR",
        message: "create 命令需要任务标题",
      });
    }

    console.log(JSON.stringify(lighttask.createTask({ title }), null, 2));
    return;
  }

  throw new LightTaskError({
    code: "VALIDATION_ERROR",
    message: `未知命令: ${command}`,
  });
}

try {
  run();
} catch (error) {
  const message =
    error instanceof LightTaskError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  console.error(message);
  process.exitCode = 1;
}
