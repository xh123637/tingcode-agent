import {
  Activity,
  Copy,
  Edit3,
  Key,
  Loader2,
  Plus,
  RotateCcw,
  Shield,
  Star,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { ProviderWithHealth, ProviderHealthStatus } from './types';

interface ProviderListProps {
  providers: ProviderWithHealth[];
  defaultProviderId: string | null;
  onEdit: (provider: ProviderWithHealth) => void;
  onDelete: (provider: ProviderWithHealth) => void;
  onToggle: (provider: ProviderWithHealth) => void;
  onResetHealth: (provider: ProviderWithHealth) => void;
  onSetDefault: (provider: ProviderWithHealth) => void;
  onDuplicate: (provider: ProviderWithHealth) => void;
  onAdd: () => void;
  togglingId: string | null;
  deletingId: string | null;
  disabled: boolean;
}

/** 健康指示灯 */
function HealthDot({
  health,
  enabled,
}: {
  health: ProviderHealthStatus | null;
  enabled: boolean;
}) {
  if (!enabled)
    return (
      <div className="w-2 h-2 rounded-full shrink-0 bg-muted-foreground/50" />
    );
  if (!health)
    return (
      <div className="w-2 h-2 rounded-full shrink-0 bg-muted-foreground/50" />
    );

  const color = health.healthy
    ? 'bg-emerald-400'
    : health.consecutiveErrors > 0
      ? 'bg-red-400'
      : 'bg-amber-400';

  return <div className={`w-2 h-2 rounded-full shrink-0 ${color}`} />;
}

/** 凭据标签：显示 Codex 渠道的密钥状态 */
function CredentialBadges({ provider }: { provider: ProviderWithHealth }) {
  if (
    !provider.hasAnthropicAuthToken &&
    !provider.hasAnthropicApiKey
  ) {
    return (
      <span className="text-xs text-muted-foreground italic">未配置凭据</span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <Key className="w-3 h-3 text-muted-foreground shrink-0" />
      <span className="text-[11px] px-1.5 py-0.5 rounded border bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800">
        Codex 密钥
      </span>
    </span>
  );
}

export function ProviderList({
  providers,
  defaultProviderId,
  onEdit,
  onDelete,
  onToggle,
  onResetHealth,
  onSetDefault,
  onDuplicate,
  onAdd,
  togglingId,
  deletingId,
  disabled,
}: ProviderListProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-foreground">
              模型配置列表
            </div>
            <span className="text-xs text-muted-foreground">
              {providers.length} 个模型配置
            </span>
          </div>
        </div>

        {providers.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            暂无模型配置，请点击下方按钮添加。
          </div>
        ) : (
          <div className="divide-y divide-border">
            {providers.map((provider) => {
              const toggling = togglingId === provider.id;
              const deleting = deletingId === provider.id;
              const health = provider.health;
              const isDefault = provider.id === defaultProviderId;

              return (
                <div
                  key={provider.id}
                  className={`px-4 py-3 transition-colors ${
                    !provider.enabled ? 'bg-muted/50 opacity-60' : ''
                  }`}
                >
                  {/* 第一行：名称 + 类型 + 操作 */}
                  <div className="flex items-center gap-2 justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <HealthDot health={health} enabled={provider.enabled} />
                      <span className="text-sm font-medium text-foreground truncate">
                        {provider.name}
                      </span>
                      {isDefault && (
                        <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                          <Star className="size-3 fill-current" />
                          系统默认
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Switch
                        checked={provider.enabled}
                        disabled={disabled || toggling || deleting || isDefault}
                        onCheckedChange={() => onToggle(provider)}
                        aria-label={
                          provider.enabled ? '禁用模型配置' : '启用模型配置'
                        }
                      />
                      {provider.enabled && !isDefault && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onSetDefault(provider)}
                          disabled={disabled || toggling || deleting}
                          className="h-7 px-2 text-xs"
                        >
                          <Star className="size-3.5" />
                          设为默认
                        </Button>
                      )}
                      {health && !health.healthy && provider.enabled && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onResetHealth(provider)}
                          disabled={disabled}
                          title="重置健康状态"
                          className="h-7 w-7 p-0"
                        >
                          <RotateCcw className="size-3.5" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onEdit(provider)}
                        disabled={disabled || toggling || deleting}
                        className="h-7 px-2 text-xs"
                      >
                        <Edit3 className="size-3.5" />
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onDuplicate(provider)}
                        disabled={disabled || toggling || deleting}
                        className="h-7 px-2 text-xs"
                      >
                        <Copy className="size-3.5" />
                        复制
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onDelete(provider)}
                        disabled={disabled || toggling || deleting || isDefault}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-red-600"
                      >
                        {deleting ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* 第二行：关键信息摘要 */}
                  <div className="mt-1.5 ml-4 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    {provider.type === 'third_party' &&
                      provider.anthropicBaseUrl && (
                        <span
                          className="font-mono truncate max-w-[200px]"
                          title={provider.anthropicBaseUrl}
                        >
                          {provider.anthropicBaseUrl}
                        </span>
                      )}
                    {provider.anthropicModel && (
                      <span className="font-mono text-muted-foreground">
                        {provider.anthropicModel}
                      </span>
                    )}
                    <CredentialBadges provider={provider} />
                  </div>

                  {/* 第三行：健康异常信息（仅异常时显示） */}
                  {health &&
                    provider.enabled &&
                    (!health.healthy || health.consecutiveErrors > 0) && (
                      <div className="mt-1.5 ml-4 flex items-center gap-3 text-xs flex-wrap">
                        {health.activeSessionCount > 0 && (
                          <span className="text-teal-600">
                            <Activity className="w-3 h-3 inline mr-0.5" />
                            {health.activeSessionCount} 活跃会话
                          </span>
                        )}
                        {health.consecutiveErrors > 0 && (
                          <span className="text-red-500">
                            连续错误 {health.consecutiveErrors}
                          </span>
                        )}
                        {!health.healthy && (
                          <span className="text-red-500 font-medium">
                            <Shield className="w-3 h-3 inline mr-0.5" />
                            不健康
                          </span>
                        )}
                      </div>
                    )}

                  {/* 活跃会话（健康正常时） */}
                  {health &&
                    provider.enabled &&
                    health.healthy &&
                    health.activeSessionCount > 0 && (
                      <div className="mt-1 ml-4 text-xs text-teal-600">
                        <Activity className="w-3 h-3 inline mr-0.5" />
                        {health.activeSessionCount} 活跃会话
                      </div>
                    )}

                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex justify-start">
        <Button variant="outline" size="sm" onClick={onAdd} disabled={disabled}>
          <Plus className="size-4" />
          添加模型配置
        </Button>
      </div>
    </div>
  );
}
