import { describe, expect, test } from 'vitest';

import {
  piUsageEventId,
  piUsageFromMessage,
} from '../container/agent-runner/src/runtime/pi/pi-session.js';

describe('Pi usage mapping for the host usage ledger', () => {
  test('maps Pi usage, cost and model into a ledger-friendly payload', () => {
    const usage = piUsageFromMessage({
      role: 'assistant',
      responseModel: 'glm-5.2',
      usage: {
        input: 1_024,
        output: 512,
        cacheRead: 2_048,
        cacheWrite: 256,
        reasoning: 128,
        totalTokens: 3_840,
        cost: {
          input: 0.001,
          output: 0.002,
          cacheRead: 0.0005,
          cacheWrite: 0.0001,
          total: 0.0036,
        },
      },
    });

    expect(usage).toEqual({
      inputTokens: 1_024,
      outputTokens: 512,
      reasoningTokens: 128,
      cacheReadInputTokens: 2_048,
      cacheCreationInputTokens: 256,
      costUSD: 0.0036,
      modelUsage: {
        'glm-5.2': {
          inputTokens: 1_024,
          outputTokens: 512,
          reasoningTokens: 128,
          cacheReadInputTokens: 2_048,
          cacheCreationInputTokens: 256,
          costUSD: 0.0036,
        },
      },
    });
  });

  test('prefers responseModel and does not invent usage when Pi omits it', () => {
    expect(
      piUsageFromMessage({
        role: 'assistant',
        model: 'deepseek-v4-pro',
        usage: {
          input: 42,
          output: 7,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 49,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
      }),
    ).toMatchObject({
      inputTokens: 42,
      outputTokens: 7,
      modelUsage: { 'deepseek-v4-pro': {} },
    });
    expect(piUsageFromMessage({ role: 'assistant' })).toBeUndefined();
  });

  test('derives a stable event id from responseId and falls back locally', () => {
    expect(
      piUsageEventId({ responseId: 'resp_abc' }, 'session-1'),
    ).toBe('pi-result:resp_abc');
    expect(
      piUsageEventId(
        { timestamp: 1_234 },
        'session-1',
      ),
    ).toBe('pi-result:session-1:1234');
  });
});
