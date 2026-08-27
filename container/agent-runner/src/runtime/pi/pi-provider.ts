import type { Model } from '@earendil-works/pi-ai';
import { getModel } from '@earendil-works/pi-ai/compat';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

export type PiProviderResolution = {
  providerId: string;
  modelId: string;
  model: Model<any>;
};

function splitModelRef(value: string): { providerId: string; modelId: string } {
  const slash = value.indexOf('/');
  if (slash <= 0 || slash === value.length - 1) {
    return { providerId: 'openai', modelId: value };
  }
  return {
    providerId: value.slice(0, slash),
    modelId: value.slice(slash + 1),
  };
}

function openCodeProviderIdForBaseUrl(
  baseUrl?: string,
): 'opencode' | 'opencode-go' | undefined {
  const raw = baseUrl?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.hostname !== 'opencode.ai') return undefined;
    const path = url.pathname.replace(/\/+$/u, '');
    if (path === '/zen/go' || path.startsWith('/zen/go/')) return 'opencode-go';
    if (path === '/zen' || path.startsWith('/zen/')) return 'opencode';
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Bridge the existing TinyCode provider env contract to Pi ModelRuntime.
 * Custom Codex/OpenAI-compatible endpoints are registered as a separate
 * provider so Pi's built-in catalogs and credentials remain untouched.
 */
export async function resolvePiProvider(
  modelRuntime: ModelRuntime,
  input: {
    model?: string;
    endpointKind?: 'official' | 'custom';
    baseUrl?: string;
    apiKey?: string;
  },
): Promise<PiProviderResolution> {
  const rawModel = input.model?.trim() || '';
  if (!rawModel && input.endpointKind !== 'custom' && !input.baseUrl?.trim()) {
    const defaultModel = modelRuntime.getModels('openai')[0];
    if (!defaultModel) {
      throw new Error(
        'Pi has no built-in OpenAI model. Configure OPENAI_MODEL or Pi models.json.',
      );
    }
    if (input.apiKey?.trim()) {
      await modelRuntime.setRuntimeApiKey('openai', input.apiKey.trim());
    }
    return {
      providerId: defaultModel.provider,
      modelId: defaultModel.id,
      model: defaultModel,
    };
  }
  const split = splitModelRef(rawModel || 'gpt-5.4-codex');
  const openCodeProviderId = openCodeProviderIdForBaseUrl(input.baseUrl);
  if (openCodeProviderId) {
    const openCodeModel =
      modelRuntime.getModel(openCodeProviderId, split.modelId) ||
      (openCodeProviderId === 'opencode-go'
        ? modelRuntime.getModel('opencode', split.modelId)
        : modelRuntime.getModel('opencode-go', split.modelId));
    if (openCodeModel) {
      const resolvedProviderId = openCodeModel.provider;
      if (input.apiKey?.trim()) {
        await modelRuntime.setRuntimeApiKey(
          resolvedProviderId,
          input.apiKey.trim(),
        );
      }
      console.error(
        `[pi-provider] opencode route: ${resolvedProviderId}/${split.modelId}`,
      );
      return {
        providerId: resolvedProviderId,
        modelId: split.modelId,
        model: openCodeModel,
      };
    }
  }
  const custom = input.endpointKind === 'custom' || !!input.baseUrl?.trim();
  const providerId = custom
    ? `tinycode-${split.providerId}`
    : split.providerId;

  if (custom) {
    if (!input.baseUrl?.trim()) {
      throw new Error('Pi custom provider requires OPENAI_BASE_URL');
    }
    if (!rawModel) {
      throw new Error('Pi custom provider requires OPENAI_MODEL');
    }
    modelRuntime.registerProvider(providerId, {
      name: `TinyCode ${split.providerId} compatible provider`,
      baseUrl: input.baseUrl.trim(),
      api: 'openai-responses',
      ...(input.apiKey?.trim() ? { apiKey: input.apiKey.trim() } : {}),
      models: [
        {
          id: split.modelId,
          name: split.modelId,
          api: 'openai-responses',
          reasoning: true,
          input: ['text', 'image'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200_000,
          maxTokens: 32_000,
          compat: { sessionAffinityFormat: 'openai-nosession' },
        },
      ],
    });
  } else if (input.apiKey?.trim() && providerId === 'openai') {
    await modelRuntime.setRuntimeApiKey('openai', input.apiKey.trim());
  }

  const model =
    modelRuntime.getModel(providerId, split.modelId) ||
    (custom
      ? undefined
      : (
          getModel as unknown as (provider: string, model: string) => Model<any>
        )(providerId, split.modelId));
  if (!model) {
    throw new Error(
      `Pi model not found: ${providerId}/${split.modelId}. Configure OPENAI_MODEL or Pi models.json.`,
    );
  }
  return { providerId, modelId: split.modelId, model };
}
