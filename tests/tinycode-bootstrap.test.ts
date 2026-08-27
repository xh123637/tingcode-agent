import { describe, expect, test } from 'vitest';

import {
  isTinyCodeBootstrapTurn,
  isTinyCodeOwnerProfileRuntimeStructurallyEligible,
} from '../src/tinycode-bootstrap.js';

describe('TinyCode first-wake eligibility', () => {
  test('allows only a real interactive Home turn of the built-in profile', () => {
    expect(
      isTinyCodeBootstrapTurn({
        turnId: 'owner-turn',
        isHome: true,
        isDefaultProfile: true,
      }),
    ).toBe(true);
    expect(
      isTinyCodeBootstrapTurn({
        isHome: true,
        isDefaultProfile: true,
      }),
    ).toBe(false);
    expect(
      isTinyCodeBootstrapTurn({
        turnId: 'scheduled-turn',
        isHome: true,
        isDefaultProfile: true,
        isScheduledTask: true,
      }),
    ).toBe(false);
    expect(
      isTinyCodeBootstrapTurn({
        turnId: 'custom-turn',
        isHome: true,
        isDefaultProfile: false,
      }),
    ).toBe(false);
    expect(
      isTinyCodeBootstrapTurn({
        turnId: 'project-turn',
        isHome: false,
        isDefaultProfile: true,
      }),
    ).toBe(false);
  });
});

describe('TinyCode Owner Profile structural runtime eligibility', () => {
  test('keeps capability across terminal warmup but denies unsafe runtime kinds', () => {
    const warmup = {
      isHome: true,
      isDefaultProfile: true,
    };
    expect(isTinyCodeOwnerProfileRuntimeStructurallyEligible(warmup)).toBe(
      true,
    );
    expect(
      isTinyCodeOwnerProfileRuntimeStructurallyEligible({
        ...warmup,
        runtimeAgentId: 'conversation-1',
        runtimeAgentKind: 'conversation',
      }),
    ).toBe(true);
    expect(
      isTinyCodeOwnerProfileRuntimeStructurallyEligible({
        ...warmup,
        isScheduledTask: true,
      }),
    ).toBe(false);
    for (const runtimeAgentKind of ['task', 'spawn'] as const) {
      expect(
        isTinyCodeOwnerProfileRuntimeStructurallyEligible({
          ...warmup,
          runtimeAgentId: `${runtimeAgentKind}-1`,
          runtimeAgentKind,
        }),
      ).toBe(false);
    }
    expect(
      isTinyCodeOwnerProfileRuntimeStructurallyEligible({
        ...warmup,
        isHome: false,
      }),
    ).toBe(false);
    expect(
      isTinyCodeOwnerProfileRuntimeStructurallyEligible({
        ...warmup,
        isDefaultProfile: false,
      }),
    ).toBe(false);
  });
});
