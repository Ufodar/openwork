import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { parse } from "jsonc-parser";

function parseConfig(text) {
  const errors = [];
  const parsed = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  return errors.length ? null : parsed;
}

function inferProviderID(config) {
  const providers = config?.provider && typeof config.provider === "object"
    ? Object.keys(config.provider)
    : [];
  return providers.length === 1 ? providers[0] : null;
}

function toModelRef(model, providerID) {
  if (typeof model !== "string" || !model.trim()) return null;
  if (model.includes("/")) return model;
  if (!providerID) return null;
  return `${providerID}/${model}`;
}

async function readConfigModel(path) {
  try {
    const text = await readFile(path, "utf8");
    const config = parseConfig(text);
    if (!config || typeof config !== "object") return null;
    return toModelRef(config.model, inferProviderID(config));
  } catch {
    return null;
  }
}

export async function resolveSimulationModel({
  explicitModel,
  envModel,
  workspaceRoot,
  workspaceConfigPaths,
  userConfigPaths,
  fallbackModel = "my-company/Qwen3.5-397B-A17B",
}) {
  if (typeof explicitModel === "string" && explicitModel.trim()) return explicitModel.trim();
  if (typeof envModel === "string" && envModel.trim()) return envModel.trim();

  const configPaths = [
    ...(workspaceConfigPaths ?? [
      join(workspaceRoot, "opencode.json"),
      join(workspaceRoot, "opencode.jsonc"),
    ]),
    ...(userConfigPaths ?? [
      join(homedir(), ".config", "opencode", "opencode.json"),
      join(homedir(), ".config", "opencode", "opencode.jsonc"),
    ]),
  ];

  for (const path of configPaths) {
    const model = await readConfigModel(path);
    if (model) return model;
  }

  return fallbackModel;
}
