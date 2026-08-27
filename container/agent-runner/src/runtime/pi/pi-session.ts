import type {
  AgentSession,
  AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import type {
  AgentRuntime,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeInput,
  RuntimeResult,
  RuntimeSession,
} from '../types.js';
import { PiSubAgentAdapter } from './pi-subagents.js';
import { formatProviderEndpointError } from '../../utils.js';

const ABORT_WAIT_TIMEOUT_MS = 8_000;

function textFromMessage(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        !!item &&
        typeof item === 'object' &&
        (item as { type?: unknown }).type === 'text' &&
        typeof (item as { text?: unknown }).text === 'string',
    )
    .map((item) => item.text)
    .join('');
}

export function piUsageFromMessage(message: unknown) {
  const record = (message ?? {}) as Record<string, unknown>;
  const usage = record.usage as Record<string, unknown> | undefined;
  if (!usage) return undefined;
  const inputTokens = Number(usage.input ?? 0);
  const outputTokens = Number(usage.output ?? 0);
  const reasoningTokens =
    typeof usage.reasoning === 'number' ? usage.reasoning : undefined;
  const cacheReadInputTokens =
    typeof usage.cacheRead === 'number' ? usage.cacheRead : undefined;
  const cacheCreationInputTokens =
    typeof usage.cacheWrite === 'number' ? usage.cacheWrite : undefined;
  const costUSD =
    typeof (usage.cost as { total?: unknown } | undefined)?.total === 'number'
      ? (usage.cost as { total: number }).total
      : undefined;
  const model =
    typeof record.responseModel === 'string' && record.responseModel.trim()
      ? record.responseModel.trim()
      : typeof record.model === 'string' && record.model.trim()
        ? record.model.trim()
        : undefined;
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    costUSD,
    ...(model
      ? {
          modelUsage: {
            [model]: {
              inputTokens,
              outputTokens,
              cacheReadInputTokens,
              cacheCreationInputTokens,
              reasoningTokens,
              costUSD,
            },
          },
        }
      : {}),
  };
}

export function piUsageEventId(message: unknown, sessionId: string): string {
  const record = (message ?? {}) as Record<string, unknown>;
  const responseId =
    typeof record.responseId === 'string' && record.responseId.trim()
      ? record.responseId.trim()
      : undefined;
  if (responseId) return `pi-result:${responseId}`;
  const timestamp =
    typeof record.timestamp === 'number' ? record.timestamp : Date.now();
  return `pi-result:${sessionId}:${timestamp}`;
}

function mapPiEvent(
  event: AgentSessionEvent,
  sessionId: string,
): RuntimeEvent | undefined {
  switch (event.type) {
    case 'message_update': {
      const update = event.assistantMessageEvent;
      if (update.type === 'text_delta') {
        return { type: 'text_delta', delta: update.delta, sessionId };
      }
      if (update.type === 'thinking_delta') {
        return { type: 'thinking_delta', delta: update.delta, sessionId };
      }
      if (update.type === 'toolcall_start') {
        const toolCall = update.partial.content.find(
          (item) => item.type === 'toolCall',
        );
        if (toolCall?.type === 'toolCall') {
          return {
            type: 'tool_start',
            sessionId,
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            input: toolCall.arguments,
          };
        }
      }
      if (update.type === 'toolcall_end') {
        return {
          type: 'tool_end',
          sessionId,
          toolName: update.toolCall.name,
          toolCallId: update.toolCall.id,
          input: update.toolCall.arguments,
        };
      }
      return undefined;
    }
    case 'tool_execution_start':
      return {
        type: 'tool_start',
        sessionId,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        input: event.args,
      };
    case 'tool_execution_update':
      return {
        type: 'tool_update',
        sessionId,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        input: event.args,
        result: event.partialResult,
      };
    case 'tool_execution_end':
      return {
        type: 'tool_end',
        sessionId,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        result: event.result,
        isError: event.isError,
      };
    case 'compaction_start':
      return { type: 'compaction_start', sessionId, reason: event.reason };
    case 'compaction_end':
      return {
        type: 'compaction_end',
        sessionId,
        reason: event.reason,
        error:
          typeof event.errorMessage === 'string'
            ? formatProviderEndpointError(event.errorMessage)
            : event.errorMessage,
      };
    case 'queue_update':
      return {
        type: 'status',
        sessionId,
        statusText: `queued: ${event.steering.length} steer / ${event.followUp.length} follow-up`,
      };
    case 'agent_end': {
      const assistant = [...event.messages]
        .reverse()
        .find((message) => message.role === 'assistant');
      if (!assistant) return undefined;
      const usage = piUsageFromMessage(assistant);
      const error =
        'errorMessage' in assistant
          ? typeof assistant.errorMessage === 'string'
            ? formatProviderEndpointError(assistant.errorMessage)
            : assistant.errorMessage
          : undefined;
      const result: RuntimeResult = {
        text: textFromMessage(assistant),
        sessionId,
        finalizationReason:
          assistant.stopReason === 'aborted'
            ? 'interrupted'
            : assistant.stopReason === 'error'
              ? 'error'
              : 'completed',
        stopReason: assistant.stopReason,
        usage: usage
          ? {
              ...usage,
              eventId: piUsageEventId(assistant, sessionId),
            }
          : undefined,
        ...(error ? { error } : {}),
      };
      return { type: 'result', sessionId, result };
    }
    default:
      return undefined;
  }
}

export class PiRuntimeSession implements RuntimeSession {
  readonly kind = 'pi' as const;
  private readonly listeners = new Set<RuntimeEventListener>();
  private readonly unsubscribeFromPi: () => void;
  private readonly unsubscribeFromSubagents: () => void;
  private disposed = false;

  constructor(
    private readonly session: AgentSession,
    eventBus?: ConstructorParameters<typeof PiSubAgentAdapter>[0],
  ) {
    this.unsubscribeFromPi = session.subscribe((event) => {
      const mapped = mapPiEvent(event, session.sessionId);
      if (mapped) this.emit(mapped);
    });
    this.unsubscribeFromSubagents = eventBus
      ? new PiSubAgentAdapter(eventBus).onLifecycle(
          session.sessionId,
          (event) => this.emit(event),
        )
      : () => {};
  }

  get sessionId(): string {
    return this.session.sessionId;
  }

  get isStreaming(): boolean {
    return this.session.isStreaming;
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async prompt(input: RuntimeInput): Promise<void> {
    await this.session.prompt(input.text, {
      images: input.images
        ?.filter((image) => !!image.mimeType)
        .map((image) => ({
          type: 'image' as const,
          data: image.data,
          mimeType: image.mimeType || 'image/jpeg',
        })),
    });
  }

  async steer(input: RuntimeInput): Promise<void> {
    await this.session.steer(input.text);
  }

  async followUp(input: RuntimeInput): Promise<void> {
    await this.session.followUp(input.text);
  }

  async abort(): Promise<void> {
    // Pi waits for the agent loop to become idle; a stuck third-party HTTP
    // request can make that wait unbounded, so bound it and let the caller
    // dispose the session instead of hanging the stop flow.
    await Promise.race([
      this.session.abort().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, ABORT_WAIT_TIMEOUT_MS)),
    ]);
  }

  async compact(instructions?: string): Promise<void> {
    await this.session.compact(instructions);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeFromPi();
    this.unsubscribeFromSubagents();
    this.session.dispose();
    this.listeners.clear();
  }
}
