import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.LIGHTTASK_ARCH_CHECK_ROOT
  ? path.resolve(process.env.LIGHTTASK_ARCH_CHECK_ROOT)
  : path.resolve(SCRIPT_DIR, "..");
const SRC_DIR = path.join(ROOT, "src");
const SRC_DIR_REALPATH = fs.existsSync(SRC_DIR) ? fs.realpathSync(SRC_DIR) : undefined;
const SRC_INDEX_FILE_REALPATH = SRC_DIR_REALPATH
  ? path.join(SRC_DIR_REALPATH, "index.ts")
  : undefined;
const SRC_INDEX_FILE = path.join(SRC_DIR, "index.ts");
const SOURCE_FILE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"];
const PACKAGE_JSON_FILE = path.join(ROOT, "package.json");
const PACKAGE_JSON = fs.existsSync(PACKAGE_JSON_FILE)
  ? JSON.parse(fs.readFileSync(PACKAGE_JSON_FILE, "utf8"))
  : undefined;

const KNOWN_LAYERS = ["models", "policies", "api", "cli", "tests", "adapters"];
const INTERNAL_ALIAS_PREFIXES = ["@/", "~/", "src/"];
const PACKAGE_NAME = PACKAGE_JSON?.name;
const DECLARED_EXTERNAL_PACKAGES = new Set([
  ...Object.keys(PACKAGE_JSON?.dependencies ?? {}),
  ...Object.keys(PACKAGE_JSON?.devDependencies ?? {}),
  ...Object.keys(PACKAGE_JSON?.peerDependencies ?? {}),
  ...Object.keys(PACKAGE_JSON?.optionalDependencies ?? {}),
]);
const BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

/**
 * 最小依赖矩阵（allow-list）：
 * - 未显式允许的层间依赖一律视为违规。
 * - `src/` 下的文件必须落到已知层或根入口，不能处于“未归层”状态。
 * - 相对导入必须先解析到真实文件，再判断其目标层，避免通过 `../foo` 绕过守卫。
 * - 非相对导入只接受包自身子入口与显式内部别名前缀，避免再靠层名关键字做猜测。
 */
const ALLOW_IMPORT_MATRIX = {
  models: new Set(["models"]),
  policies: new Set(["policies", "models"]),
  api: new Set(["api", "policies", "adapters", "models"]),
  cli: new Set(["cli", "api", "adapters", "models", "root"]),
  tests: new Set(["tests", "api", "policies", "models", "cli", "adapters", "root"]),
  adapters: new Set(["adapters", "models"]),
  root: new Set(["root", "api", "policies", "models"]),
};

function listSourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  const queue = [dir];
  const files = [];

  while (queue.length > 0) {
    const current = queue.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (SOURCE_FILE_EXTENSIONS.includes(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function collectImportSpecifiers(content) {
  const specifiers = new Set();
  const fromRegex = /\b(?:import|export)\b[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g;
  const sideEffectRegex = /\bimport\s+['"]([^'"]+)['"]/g;
  const dynamicImportRegex = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const requireRegex = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const regex of [fromRegex, sideEffectRegex, dynamicImportRegex, requireRegex]) {
    for (const match of content.matchAll(regex)) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

function tryResolveCandidate(candidatePath) {
  if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
    return candidatePath;
  }

  for (const extension of SOURCE_FILE_EXTENSIONS) {
    const withExtension = `${candidatePath}${extension}`;
    if (fs.existsSync(withExtension) && fs.statSync(withExtension).isFile()) {
      return withExtension;
    }
  }

  for (const extension of SOURCE_FILE_EXTENSIONS) {
    const indexFile = path.join(candidatePath, `index${extension}`);
    if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
      return indexFile;
    }
  }

  return undefined;
}

function tryRealpath(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return undefined;
  }
}

function isPathInside(parentPath, childPath) {
  const rel = path.relative(parentPath, childPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function getFileLayer(filePath) {
  if (
    filePath === SRC_INDEX_FILE ||
    (SRC_INDEX_FILE_REALPATH && filePath === SRC_INDEX_FILE_REALPATH)
  ) {
    return "root";
  }
  for (const layerName of KNOWN_LAYERS) {
    if (filePath.includes(`${path.sep}src${path.sep}${layerName}${path.sep}`)) {
      return layerName;
    }
  }
  return "unknown";
}

function resolveRelativeImport(fromFilePath, specifier) {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const absoluteSpecifier = path.resolve(path.dirname(fromFilePath), specifier);
  return tryResolveCandidate(absoluteSpecifier);
}

function getPackageBase(specifier) {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    if (!scope || !name) {
      return specifier;
    }
    return `${scope}/${name}`;
  }
  const [name] = specifier.split("/");
  return name;
}

function detectTargetLayers(fromFilePath, specifier) {
  if (specifier.startsWith(".")) {
    const resolvedPath = resolveRelativeImport(fromFilePath, specifier);
    if (!resolvedPath) {
      return ["unresolved"];
    }

    // 相对导入必须按真实路径做边界判定，防止 src 内 symlink 指向 src 外绕过检查。
    const resolvedRealPath = tryRealpath(resolvedPath);
    if (!resolvedRealPath) {
      return ["unresolved"];
    }
    const isInsideSrc = SRC_DIR_REALPATH
      ? isPathInside(SRC_DIR_REALPATH, resolvedRealPath)
      : resolvedPath.startsWith(SRC_DIR);
    if (!isInsideSrc) {
      return ["outside_src"];
    }

    // 层归属也要基于真实路径，避免 src 内 symlink 伪装成当前层文件。
    return [getFileLayer(resolvedRealPath)];
  }

  const normalized = specifier.replaceAll("\\", "/");
  if (PACKAGE_NAME && normalized === PACKAGE_NAME) {
    return ["root"];
  }
  if (PACKAGE_NAME) {
    for (const layerName of KNOWN_LAYERS) {
      if (normalized === `${PACKAGE_NAME}/${layerName}`) {
        return [layerName];
      }
    }
  }

  const looksInternalAlias =
    INTERNAL_ALIAS_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    (PACKAGE_NAME !== undefined && normalized.startsWith(`${PACKAGE_NAME}/`));
  if (looksInternalAlias) {
    return ["suspicious_non_relative"];
  }

  if (normalized.startsWith("node:")) {
    return [];
  }

  if (BUILTIN_MODULES.has(normalized)) {
    return [];
  }

  if (DECLARED_EXTERNAL_PACKAGES.has(getPackageBase(normalized))) {
    return [];
  }

  if (normalized.startsWith("#")) {
    return ["suspicious_non_relative"];
  }

  return ["unknown_non_relative"];
}

function describeUnknownNonRelativeImport(specifier) {
  return `未知的非相对导入，既不是包自身子入口，也不是已声明外部依赖 -> "${specifier}"`;
}

function isForbiddenDataStructuresLeafImport(sourceLayer, specifier) {
  if (sourceLayer !== "api" && sourceLayer !== "adapters") {
    return false;
  }
  if (!specifier.startsWith(".")) {
    return false;
  }

  const normalized = specifier.replaceAll("\\", "/");
  return normalized.includes("/models/ds-");
}

function isAllowedCorePortsTarget(filePath) {
  const filename = path.basename(filePath);
  return filename.startsWith("port-") || /^index\.[^.]+$/.test(filename);
}

function isForbiddenCorePortsImplementationImport(sourceLayer, fromFilePath, specifier) {
  if (sourceLayer !== "api" || !specifier.startsWith(".")) {
    return false;
  }

  const resolvedPath = resolveRelativeImport(fromFilePath, specifier);
  if (!resolvedPath) {
    return false;
  }
  const resolvedRealPath = tryRealpath(resolvedPath);
  if (!resolvedRealPath || getFileLayer(resolvedRealPath) !== "adapters") {
    return false;
  }

  return !isAllowedCorePortsTarget(resolvedRealPath);
}

function reportViolation(violations, rel, sourceLayer, specifier, targetLayer, allowedTargets) {
  if (targetLayer === "unresolved") {
    violations.push(`${rel}: 无法解析相对导入 -> "${specifier}"`);
    return;
  }

  if (targetLayer === "outside_src") {
    violations.push(`${rel}: 禁止通过相对路径导入 src 目录外文件 -> "${specifier}"`);
    return;
  }

  if (targetLayer === "unknown") {
    violations.push(`${rel}: 导入目标不属于任何已知层 -> "${specifier}"`);
    return;
  }

  if (targetLayer === "unknown_non_relative") {
    violations.push(`${rel}: ${describeUnknownNonRelativeImport(specifier)}`);
    return;
  }

  if (targetLayer === "suspicious_non_relative") {
    violations.push(`${rel}: 可疑的非相对内部导入，无法判定层归属 -> "${specifier}"`);
    return;
  }

  if (!allowedTargets.has(targetLayer)) {
    violations.push(`${rel}: ${sourceLayer} 层文件禁止依赖 ${targetLayer} 层 -> "${specifier}"`);
  }
}

function checkSourceFile(filePath, violations) {
  const sourceLayer = getFileLayer(filePath);
  const rel = path.relative(ROOT, filePath);
  const allowedTargets = ALLOW_IMPORT_MATRIX[sourceLayer];
  if (!allowedTargets) {
    violations.push(`${rel}: 文件位于 src 下但不属于任何已知层`);
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const imports = collectImportSpecifiers(content);

  for (const specifier of imports) {
    if (isForbiddenDataStructuresLeafImport(sourceLayer, specifier)) {
      violations.push(
        `${rel}: ${sourceLayer} 层禁止深层依赖 models 叶子模块，应改走稳定入口或本层私有封装 -> "${specifier}"`,
      );
      continue;
    }
    if (isForbiddenCorePortsImplementationImport(sourceLayer, filePath, specifier)) {
      violations.push(
        `${rel}: api 层禁止依赖 adapters 实现文件，应改走 adapters 稳定入口（index/port-*） -> "${specifier}"`,
      );
      continue;
    }
    const targetLayers = detectTargetLayers(filePath, specifier);
    for (const targetLayer of targetLayers) {
      reportViolation(violations, rel, sourceLayer, specifier, targetLayer, allowedTargets);
    }
  }
}

const violations = [];

for (const filePath of listSourceFiles(SRC_DIR)) {
  checkSourceFile(filePath, violations);
}

if (violations.length > 0) {
  console.error("Architecture guard failed:");
  for (const v of violations) {
    console.error(`- ${v}`);
  }
  process.exit(1);
}

console.log("Architecture guard passed.");
