import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { api } from '../../api/client';
import {
  buildDefaultProviderEnv,
  buildProviderModel,
  parseProviderModel,
} from '../../utils/provider-model';
import type { ProviderWithHealth, EnvRow } from './types';
import { getErrorMessage } from './types';

const RESERVED_ENV_KEYS = new Set([
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_MODEL',
]);

const DEFAULTED_THIRD_PARTY_ENV_KEYS = new Set(
  buildDefaultProviderEnv('', false).map((row) => row.key),
);

const MANAGED_ENV_SOURCE_LABELS = {
  model: '跟随模型',
  context: '跟随上下文',
  default: '系统默认',
} as const;

function buildCustomEnv(
  rows: EnvRow[],
  manageDefaults: boolean,
): {
  customEnv: Record<string, string>;
  error: string | null;
} {
  const customEnv: Record<string, string> = {};

  for (const [idx, row] of rows.entries()) {
    const key = row.key.trim();
    const value = row.value;

    if (!key && !value.trim()) continue;

    if (!key) {
      return { customEnv: {}, error: `第 ${idx + 1} 行环境变量 Key 不能为空` };
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return {
        customEnv: {},
        error: `环境变量 Key "${key}" 格式无效（需匹配 [A-Za-z_][A-Za-z0-9_]*）`,
      };
    }
    if (
      RESERVED_ENV_KEYS.has(key) ||
      (manageDefaults && DEFAULTED_THIRD_PARTY_ENV_KEYS.has(key))
    ) {
      return {
        customEnv: {},
        error: `${key} 已在系统预填列表中，请直接修改对应值`,
      };
    }
    if (customEnv[key] !== undefined) {
      return { customEnv: {}, error: `环境变量 Key "${key}" 重复` };
    }
    customEnv[key] = value;
  }

  return { customEnv, error: null };
}

interface ProviderEditorProps {
  open: boolean;
  /** null 表示创建模式 */
  provider: ProviderWithHealth | null;
  onSave: () => void;
  onCancel: () => void;
  setNotice: (msg: string | null) => void;
  setError: (msg: string | null) => void;
}

export function ProviderEditor({
  open,
  provider,
  onSave,
  onCancel,
  setNotice,
  setError,
}: ProviderEditorProps) {
  const isCreate = provider === null;

  // 基础字段
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [oneMillionContext, setOneMillionContext] = useState(false);

  // 第三方 API 认证
  const [authToken, setAuthToken] = useState('');
  const [authTokenDirty, setAuthTokenDirty] = useState(false);
  const [clearTokenOnSave, setClearTokenOnSave] = useState(false);

  // 环境变量
  const [customEnvRows, setCustomEnvRows] = useState<EnvRow[]>([]);
  const [providerEnvOverrides, setProviderEnvOverrides] = useState<
    Record<string, string>
  >({});
  const [showCustomEnvValues, setShowCustomEnvValues] = useState<
    Record<number, boolean>
  >({});

  // 状态
  const [saving, setSaving] = useState(false);

  const defaultProviderEnv = buildDefaultProviderEnv(model, oneMillionContext);

  // 初始化表单
  useEffect(() => {
    if (!open) return;
    setShowCustomEnvValues({});

    setName(provider?.name || '');
    setBaseUrl(provider?.anthropicBaseUrl || '');
    const modelSelection = parseProviderModel(provider?.anthropicModel || '');
    setModel(modelSelection.model);
    setOneMillionContext(modelSelection.oneMillionContext);
    setAuthToken('');
    setAuthTokenDirty(false);
    setClearTokenOnSave(false);

    const providerCustomEnv = provider?.customEnv || {};
    const defaultEnv = Object.fromEntries(
      buildDefaultProviderEnv(
        modelSelection.model,
        modelSelection.oneMillionContext,
      ).map((row) => [row.key, row.value]),
    );
    const initialProviderEnvOverrides: Record<string, string> = {};
    for (const [key, value] of Object.entries(providerCustomEnv)) {
      if (
        DEFAULTED_THIRD_PARTY_ENV_KEYS.has(key) &&
        value !== defaultEnv[key]
      ) {
        initialProviderEnvOverrides[key] = value;
      }
    }
    setProviderEnvOverrides(initialProviderEnvOverrides);

    const envRows = Object.entries(providerCustomEnv)
      .filter(
        ([key]) => !DEFAULTED_THIRD_PARTY_ENV_KEYS.has(key),
      )
      .map(([key, value]) => ({ key, value }));
    setCustomEnvRows(envRows);
  }, [open, provider]);

  const addRow = () =>
    setCustomEnvRows((prev) => [...prev, { key: '', value: '' }]);
  const removeRow = (index: number) =>
    setCustomEnvRows((prev) => prev.filter((_, i) => i !== index));
  const updateRow = (index: number, field: keyof EnvRow, value: string) =>
    setCustomEnvRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );

  const updateProviderEnv = (
    key: string,
    value: string,
    defaultValue: string,
  ) => {
    setProviderEnvOverrides((current) => {
      const next = { ...current };
      if (value === defaultValue) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  const resetProviderEnv = (key: string) => {
    setProviderEnvOverrides((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  // ─── 保存 ──────────────────────────────────────────────────
  const handleSave = async () => {
    const normalizedModel = buildProviderModel(model, oneMillionContext);
    if (!normalizedModel) {
      setError('请填写转发服务支持的模型名称');
      return;
    }
    const trimmedName = name.trim() || parseProviderModel(normalizedModel).model;
    if (!trimmedName) {
      setError('请填写模型配置名称');
      return;
    }

    const trimmedBaseUrl = baseUrl.trim();
    if (!trimmedBaseUrl) {
      setError('请填写 OPENAI_BASE_URL（OpenAI 兼容接口地址）');
      return;
    }

    const envResult = buildCustomEnv(customEnvRows, true);
    if (envResult.error) {
      setError(envResult.error);
      return;
    }
    const savedCustomEnv = {
      ...envResult.customEnv,
      ...providerEnvOverrides,
    };

    setSaving(true);
    setError(null);

    try {
      if (isCreate) {
        const trimmedToken = authToken.trim();
        if (!trimmedToken) {
          setError('新建 Codex 渠道时必须填写 OPENAI_API_KEY');
          setSaving(false);
          return;
        }
        await api.post('/api/config/claude/providers', {
          name: trimmedName,
          type: 'third_party',
          anthropicBaseUrl: trimmedBaseUrl,
          anthropicAuthToken: trimmedToken,
          anthropicModel: normalizedModel,
          customEnv: savedCustomEnv,
        });
        setNotice('Codex 渠道已创建。');
      } else {
        await api.patch(
          `/api/config/claude/providers/${provider!.id}`,
          {
            name: trimmedName,
            anthropicBaseUrl: trimmedBaseUrl,
            anthropicModel: normalizedModel,
            customEnv: savedCustomEnv,
          },
        );

        const secretsBody: Record<string, unknown> = {};
        let hasSecretsChange = false;
        if (clearTokenOnSave) {
          secretsBody.clearAnthropicAuthToken = true;
          hasSecretsChange = true;
        } else if (authTokenDirty && authToken.trim()) {
          secretsBody.anthropicAuthToken = authToken.trim();
          hasSecretsChange = true;
        }
        if (hasSecretsChange) {
          await api.put(
            `/api/config/claude/providers/${provider!.id}/secrets`,
            secretsBody,
          );
        }
        setNotice('Codex 渠道已保存。');
      }

      onSave();
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          isCreate ? '创建 Codex 渠道失败' : '保存 Codex 渠道失败',
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      onCancel();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="z-[10001] max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isCreate ? '添加 Codex 渠道' : `编辑 Codex 渠道：${provider?.name}`}
          </DialogTitle>
          <DialogDescription className="text-left text-xs leading-5">
            填写 Base URL、API Key 和模型名称即可；TinyCode 会自动注入
            Codex/OpenAI 兼容运行环境，也可在高级设置中调整。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 名称 */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              配置名称（可选）
            </label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              placeholder="留空时使用模型名称"
            />
          </div>

          <div className="space-y-5">
            <div>
              <label className="mb-1.5 flex items-center justify-between gap-3 text-xs font-medium text-foreground">
                <span>API 端点</span>
                <span className="font-normal text-muted-foreground">
                  OPENAI_BASE_URL
                </span>
              </label>
              <Input
                type="url"
                inputMode="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={saving}
                placeholder="https://your-relay.example.com/v1"
                autoComplete="off"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                填到 OpenAI 兼容接口根地址，不要带 /responses 或 /v1/messages
                后缀。
              </p>
            </div>

            <div>
              <label className="mb-1.5 flex items-center justify-between gap-3 text-xs font-medium text-foreground">
                <span>API Key</span>
                <span className="font-normal text-muted-foreground">
                  {!isCreate && provider?.hasAnthropicAuthToken
                    ? `当前 ${provider.anthropicAuthTokenMasked}`
                    : 'OPENAI_API_KEY'}
                </span>
              </label>
              <Input
                type="password"
                value={authToken}
                onChange={(e) => {
                  setAuthToken(e.target.value);
                  setAuthTokenDirty(true);
                  setClearTokenOnSave(false);
                }}
                disabled={saving || clearTokenOnSave}
                placeholder={
                  isCreate
                    ? '输入转发服务 API Key'
                    : provider?.hasAnthropicAuthToken
                      ? '留空保留当前密钥；输入新值覆盖'
                      : '输入转发服务 API Key'
                }
                autoComplete="new-password"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                从你的转发服务（中转站）后台获取，系统会加密保存。
              </p>
              {!isCreate && provider?.hasAnthropicAuthToken && (
                <label className="mt-2 inline-flex min-h-8 items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={clearTokenOnSave}
                    onChange={(e) => {
                      setClearTokenOnSave(e.target.checked);
                      if (e.target.checked) {
                        setAuthToken('');
                        setAuthTokenDirty(false);
                      }
                    }}
                    disabled={saving}
                  />
                  保存时清空当前密钥
                </label>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem] sm:items-end">
              <div className="min-w-0">
                <label className="mb-1.5 flex items-center justify-between gap-3 text-xs font-medium text-foreground">
                  <span>模型名称</span>
                  <span className="font-normal text-muted-foreground">
                    OPENAI_MODEL
                  </span>
                </label>
                <Input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={saving}
                  placeholder="例如 gpt-5.4-codex、gpt-4.1"
                  autoComplete="off"
                />
              </div>

              <div className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-border/80 bg-muted/35 px-3.5 py-2.5">
                <label
                  htmlFor="provider-one-million-context"
                  className="min-w-0"
                >
                  <span className="block text-xs font-medium text-foreground">
                    1M 上下文
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                    自动添加 [1m]
                  </span>
                </label>
                <Switch
                  id="provider-one-million-context"
                  checked={oneMillionContext}
                  onCheckedChange={setOneMillionContext}
                  disabled={saving}
                  aria-label="启用 1M 上下文"
                />
              </div>
            </div>

            <div className="rounded-xl border border-primary/15 bg-primary/[0.035] px-3.5 py-3">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">
                    系统预填 Codex/OpenAI 运行环境
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    实际模型：
                    <code className="break-all font-medium text-foreground">
                      {buildProviderModel(model, oneMillionContext) ||
                        '填写模型后生成'}
                    </code>
                    {' · '}
                    上下文窗口：
                    {oneMillionContext ? '1,000,000' : '200,000'} tokens
                  </p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    默认同步模型映射、压缩窗口、请求超时与兼容参数；可在高级设置中调整。
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ─── 环境变量 ─── */}
          <details className="border-t border-border pt-4">
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              高级设置 · 环境变量
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {defaultProviderEnv.length} 项默认配置
              </span>
              {customEnvRows.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {customEnvRows.length} 项自定义
                </span>
              )}
            </summary>

            <div className="mt-4 space-y-5">
              <section aria-labelledby="default-provider-env-heading">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h3
                      id="default-provider-env-heading"
                      className="text-xs font-medium text-foreground"
                    >
                      系统预填环境变量
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      默认值会随模型和上下文更新；修改后以你的自定义值为准。
                    </p>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {defaultProviderEnv.length} 项
                  </span>
                </div>

                <div className="overflow-hidden rounded-lg border border-border/80 bg-muted/20">
                  {defaultProviderEnv.map((row, index) => {
                    const hasOverride = Object.hasOwn(
                      providerEnvOverrides,
                      row.key,
                    );
                    const value = hasOverride
                      ? providerEnvOverrides[row.key]
                      : row.value;
                    const inputId = `provider-env-default-${index}`;

                    return (
                      <div
                        key={row.key}
                        className={`grid min-w-0 gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.8fr)] sm:items-center sm:gap-4 ${
                          index > 0 ? 'border-t border-border/70' : ''
                        }`}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <label
                            htmlFor={inputId}
                            className="min-w-0 break-all font-mono text-[11px] text-foreground"
                          >
                            {row.key}
                          </label>
                          <span
                            className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${
                              hasOverride
                                ? 'border-primary/25 bg-primary/5 text-primary'
                                : 'border-border bg-background text-muted-foreground'
                            }`}
                          >
                            {hasOverride
                              ? '已自定义'
                              : MANAGED_ENV_SOURCE_LABELS[row.source]}
                          </span>
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Input
                            id={inputId}
                            type="text"
                            value={value}
                            onChange={(event) =>
                              updateProviderEnv(
                                row.key,
                                event.target.value,
                                row.value,
                              )
                            }
                            disabled={saving}
                            placeholder="填写模型后生成"
                            autoComplete="off"
                            className="h-9 min-w-0 px-2.5 font-mono text-xs"
                          />
                          {hasOverride && (
                            <button
                              type="button"
                              onClick={() => resetProviderEnv(row.key)}
                              disabled={saving}
                              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 sm:size-9"
                              aria-label={`恢复 ${row.key} 的默认值`}
                              title="恢复默认值"
                            >
                              <RotateCcw className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section
                aria-labelledby="custom-provider-env-heading"
                className="border-t border-border pt-4"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <h3
                      id="custom-provider-env-heading"
                      className="text-xs font-medium text-foreground"
                    >
                      自定义环境变量
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      仅用于 API 自定义 Header 等特殊需求。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addRow}
                    className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-muted"
                  >
                    <Plus className="size-3.5" />
                    添加
                  </button>
                </div>

                {customEnvRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    没有自定义环境变量，大多数配置无需添加。
                  </p>
                ) : (
                  <div className="space-y-2">
                    {customEnvRows.map((row, idx) => (
                      <div
                        key={idx}
                        className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center"
                      >
                        <Input
                          type="text"
                          value={row.key}
                          onChange={(e) =>
                            updateRow(idx, 'key', e.target.value)
                          }
                          placeholder="KEY"
                          className="h-auto w-full px-2.5 py-1.5 font-mono text-xs sm:w-[38%]"
                        />
                        <Input
                          type={showCustomEnvValues[idx] ? 'text' : 'password'}
                          value={row.value}
                          onChange={(e) =>
                            updateRow(idx, 'value', e.target.value)
                          }
                          placeholder="value"
                          className="h-auto flex-1 px-2.5 py-1.5 font-mono text-xs"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowCustomEnvValues((current) => ({
                              ...current,
                              [idx]: !current[idx],
                            }))
                          }
                          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label={
                            showCustomEnvValues[idx]
                              ? '隐藏环境变量值'
                              : '显示环境变量值'
                          }
                        >
                          {showCustomEnvValues[idx] ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          className="flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-red-500"
                          aria-label="删除环境变量"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </details>

          {/* ─── 操作按钮 ─── */}
          <div className="sticky -bottom-4 z-10 -mx-4 flex justify-end gap-2 border-t border-border bg-background/95 px-4 pb-4 pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <Button variant="outline" onClick={handleClose} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isCreate ? '创建' : '保存'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
