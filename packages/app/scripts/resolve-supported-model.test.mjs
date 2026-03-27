import { describe, expect, test } from "bun:test";

import * as utils from "../src/app/utils/index.ts";

describe("resolveSupportedModel", () => {
  const fallback = {
    providerID: "my-company",
    modelID: "Qwen3.5-397B-A17B",
  };

  const providers = [
    {
      id: "my-company",
      name: "My Company",
      env: [],
      models: {
        "Qwen3.5-397B-A17B": { id: "Qwen3.5-397B-A17B", name: "Qwen3.5-397B-A17B" },
        "MiniMax-2.5": { id: "MiniMax-2.5", name: "MiniMax-2.5" },
      },
    },
  ];

  test("falls back retired Kimi sessions to the supported default model", () => {
    const resolved = utils.resolveSupportedModel(
      { providerID: "my-company", modelID: "Kimi-K2.5" },
      providers,
      fallback,
    );

    expect(resolved).toEqual(fallback);
  });

  test("falls back retired GLM sessions to the supported default model", () => {
    const resolved = utils.resolveSupportedModel(
      { providerID: "my-company", modelID: "GLM-5" },
      providers,
      fallback,
    );

    expect(resolved).toEqual(fallback);
  });

  test("keeps Qwen sessions unchanged because Qwen is the supported default", () => {
    const resolved = utils.resolveSupportedModel(
      { providerID: "my-company", modelID: "Qwen3.5-397B-A17B" },
      providers,
      fallback,
    );

    expect(resolved).toEqual({ providerID: "my-company", modelID: "Qwen3.5-397B-A17B" });
  });

  test("keeps still-supported models unchanged", () => {
    const model = { providerID: "my-company", modelID: "MiniMax-2.5" };
    const resolved = utils.resolveSupportedModel(model, providers, fallback);

    expect(resolved).toEqual(model);
  });
});
