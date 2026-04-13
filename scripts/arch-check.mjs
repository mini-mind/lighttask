import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const SRC_DIR = path.join(ROOT, "src");
const SRC_INDEX_FILE = path.join(SRC_DIR, "index.ts");

const KNOWN_LAYERS = ["data-structures", "rules", "core", "cli", "tests", "ports"];

/**
 * 最小依赖矩阵（allow-list）：
 * - 未显式允许的层间依赖一律视为违规。
 * - 相对导入若无法识别层名，默认按“同层文件内部导入”放行。
 */
const ALLOW_IMPORT_MATRIX = {
  "data-structures": new Set(["data-structures"]),
  rules: new Set(["rules", "data-structures"]),
  core: new Set(["core", "rules", "ports", "root"]),
  cli: new Set(["cli", "core", "root"]),
  tests: new Set(["tests", "core", "rules", "data-structures", "cli", "ports", "root"]),
  ports: new Set(["ports", "data-structures"]),
  root: new Set(["root", "core", "rules", "data-structures"]),
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
      if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) {
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

function pointsToLayer(specifier, layerName) {
  const normalized = specifier.replaceAll("\\", "/");
  const pattern = new RegExp(`(^|/)${layerName}(/|$)`);
  return pattern.test(normalized);
}

function getFileLayer(filePath) {
  if (filePath === SRC_INDEX_FILE) {
    return "root";
  }
  for (const layerName of KNOWN_LAYERS) {
    if (filePath.includes(`${path.sep}src${path.sep}${layerName}${path.sep}`)) {
      return layerName;
    }
  }
  return "unknown";
}

function pointsToRootIndex(specifier) {
  if (!specifier.startsWith(".")) {
    return false;
  }
  const normalized = specifier.replaceAll("\\", "/").replace(/\.(ts|tsx|mts|cts|js|mjs|cjs)$/, "");
  return normalized === "../index" || normalized === "./index" || normalized.endsWith("/index");
}

function detectTargetLayers(specifier) {
  const layers = new Set();
  for (const layerName of KNOWN_LAYERS) {
    if (pointsToLayer(specifier, layerName)) {
      layers.add(layerName);
    }
  }
  if (pointsToRootIndex(specifier)) {
    layers.add("root");
  }
  return [...layers];
}

const violations = [];

for (const filePath of listSourceFiles(SRC_DIR)) {
  const sourceLayer = getFileLayer(filePath);
  const allowedTargets = ALLOW_IMPORT_MATRIX[sourceLayer];
  if (!allowedTargets) {
    continue;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const imports = collectImportSpecifiers(content);
  const rel = path.relative(ROOT, filePath);

  for (const specifier of imports) {
    const targetLayers = detectTargetLayers(specifier);
    for (const targetLayer of targetLayers) {
      if (!allowedTargets.has(targetLayer)) {
        violations.push(
          `${rel}: ${sourceLayer} 层文件禁止依赖 ${targetLayer} 层 -> "${specifier}"`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Architecture guard failed:");
  for (const v of violations) {
    console.error(`- ${v}`);
  }
  process.exit(1);
}

console.log("Architecture guard passed.");
