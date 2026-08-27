import { useEffect, useState } from 'react';
import { ArrowRight, KeyRound, Loader2, Link2, Plus, Server, ShieldCheck, SkipForward, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '../api/client';
import type { UnifiedProviderPublic, EnvRow } from '../components/settings/types';
import { getErrorMessage } from '../components/settings/types';
import { useAuthStore } from '../stores/auth';

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

function buildCustomEnv(rows: EnvRow[]): { customEnv: Record<string, string>; error: string | null } {
  const customEnv: Record<string, string> = {};
  for (const [idx, row] of rows.entries()) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key && !value) continue;
    if (!key || !value) {
      return { customEnv: {}, error: `第 ${idx + 1} 行环境变量的 Key 和 Value 都要填写` };
    }
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      return { customEnv: {}, error: `环境变量 Key "${key}" 格式无效（仅允许大写字母/数字/下划线，且不能数字开头）` };
    }
    if (RESERVED_ENV_KEYS.has(key)) {
      return { customEnv: {}, error: `${key} 属于系统保留字段，请在必填区域填写` };
    }
    if (customEnv[key] !== undefined) {
      return { customEnv: {}, error: `环境变量 Key "${key}" 重复` };
    }
    customEnv[key] = value;
  }
  return { customEnv, error: null };
}

export function SetupProvidersPage() {
  const navigate = useNavigate();
  const { user, setupStatus, checkAuth, initialized } = useAuthStore();

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Feishu (no prefilled defaults)
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');

  // Codex / OpenAI-compatible channel
  const [baseUrl, setBaseUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [model, setModel] = useState('');
  const [customEnvRows, setCustomEnvRows] = useState<EnvRow[]>([]);

  useEffect(() => {
    if (user === null && initialized === true) {
      navigate('/login', { replace: true });
    } else if (user && user.role !== 'admin') {
      navigate('/chat', { replace: true });
    }
  }, [user, initialized, navigate]);

  useEffect(() => {
    if (setupStatus && !setupStatus.needsSetup) {
      navigate('/settings?tab=claude', { replace: true });
    }
  }, [setupStatus, navigate]);

  const addCustomEnvRow = () => setCustomEnvRows((rows) => [...rows, { key: '', value: '' }]);
  const removeCustomEnvRow = (idx: number) =>
    setCustomEnvRows((rows) => rows.filter((_, i) => i !== idx));
  const updateCustomEnvRow = (idx: number, field: keyof EnvRow, value: string) =>
    setCustomEnvRows((rows) =>
      rows.map((row, i) => (i === idx ? { ...row, [field]: value } : row)),
    );

  const handleFinish = async () => {
    setError(null);
    setNotice(null);

    if (feishuAppSecret.trim() && !feishuAppId.trim()) {
      setError('填写飞书 Secret 时，App ID 也必须填写');
      return;
    }

    let customEnv: Record<string, string> = {};
    if (!baseUrl.trim()) {
      setError('请填写 OPENAI_BASE_URL（OpenAI 兼容接口地址）');
      return;
    }
    if (!model.trim()) {
      setError('请填写 OPENAI_MODEL（转发服务支持的模型名称）');
      return;
    }
    if (!authToken.trim()) {
      setError('请填写 OPENAI_API_KEY（转发服务密钥）');
      return;
    }
    const envResult = buildCustomEnv(customEnvRows);
    if (envResult.error) {
      setError(envResult.error);
      return;
    }
    customEnv = envResult.customEnv;

    setSaving(true);
    try {
      // Feishu is optional. Only save when user entered anything.
      if (feishuAppId.trim() || feishuAppSecret.trim()) {
        const payload: Record<string, string> = { appId: feishuAppId.trim() };
        if (feishuAppSecret.trim()) payload.appSecret = feishuAppSecret.trim();
        await api.put('/api/config/user-im/feishu', payload);
      }

      await api.post<UnifiedProviderPublic>(
        '/api/config/claude/providers',
        {
          name: '默认 Codex 渠道',
          type: 'third_party',
          anthropicBaseUrl: baseUrl.trim(),
          anthropicAuthToken: authToken.trim(),
          anthropicModel: model.trim(),
          customEnv,
          enabled: true,
        },
      );

      await checkAuth();
      // 确认 setupStatus 已更新后再跳转，避免 AuthGuard 检测到 needsSetup 仍为 true 导致重定向循环
      const { setupStatus: latestStatus } = useAuthStore.getState();
      if (latestStatus?.needsSetup) {
        setError('配置已保存但验证未通过，请检查填写的配置是否正确');
        return;
      }
      navigate('/settings?tab=claude', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, '保存初始化配置失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await api.put('/api/config/system', { providerSetupSkipped: true });
      await checkAuth();
      navigate('/chat', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, '暂时跳过初始化失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-screen bg-background overflow-y-auto p-4">
      <div className="w-full max-w-4xl mx-auto space-y-5">
        <div className="text-center">
          <p className="text-xs font-semibold text-primary tracking-wider mb-2">STEP 2 / 2</p>
          <h1 className="text-2xl font-bold text-foreground mb-2">系统接入初始化</h1>
          <p className="text-sm text-muted-foreground">此页面保存的是系统全局默认配置。你也可以先跳过，稍后在设置中完成。</p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error-bg border border-error/30 text-error text-sm">{error}</div>
        )}
        {notice && (
          <div className="p-3 rounded-lg bg-success-bg border border-success/30 text-success text-sm">{notice}</div>
        )}

        <section className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Link2 className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold text-foreground">飞书配置（可选）</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">首装不预填任何默认值，全部由你手动输入。</p>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">App ID</label>
              <Input
                type="text"
                value={feishuAppId}
                onChange={(e) => setFeishuAppId(e.target.value)}
                placeholder="输入飞书 App ID"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">App Secret</label>
              <Input
                type="password"
                value={feishuAppSecret}
                onChange={(e) => setFeishuAppSecret(e.target.value)}
                placeholder="输入飞书 App Secret"
              />
            </div>
          </div>
        </section>

        <section className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <KeyRound className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Codex 渠道配置</h2>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Server className="w-4 h-4 text-primary" />
            填写你的 Codex / OpenAI 兼容转发服务（中转站）信息，TinyCode 会用它运行所有智能体。
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">OPENAI_BASE_URL（必填）</label>
                <Input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://your-relay.example.com/v1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  填到 OpenAI 兼容接口根地址，不要带 /responses 或 /v1/messages 后缀。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">OPENAI_MODEL（必填）</label>
                <Input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gpt-5.4-codex"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  填写转发服务支持的模型名称，例如 gpt-5.4-codex、gpt-4.1 等。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">OPENAI_API_KEY（必填）</label>
                <Input
                  type="password"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder="输入转发服务 API Key"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  从你的转发服务后台获取，系统会加密保存。
                </p>
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">其他自定义环境变量（可选）</label>
                <button
                  type="button"
                  onClick={addCustomEnvRow}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加
                </button>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">
                用于 API 自定义 Header 等特殊需求；OPENAI_* / ANTHROPIC_* 等系统字段请在必填区域填写。
              </p>

              {customEnvRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无</p>
              ) : (
                <div className="space-y-2">
                  {customEnvRows.map((row, idx) => (
                    <div key={idx} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <Input
                        type="text"
                        value={row.key}
                        onChange={(e) => updateCustomEnvRow(idx, 'key', e.target.value)}
                        placeholder="KEY"
                        className="w-full sm:w-[38%] px-2.5 py-1.5 text-xs font-mono h-auto"
                      />
                      <Input
                        type="text"
                        value={row.value}
                        onChange={(e) => updateCustomEnvRow(idx, 'value', e.target.value)}
                        placeholder="value"
                        className="flex-1 px-2.5 py-1.5 text-xs font-mono h-auto"
                      />
                      <button
                        type="button"
                        onClick={() => removeCustomEnvRow(idx)}
                        className="w-8 h-8 rounded-md hover:bg-muted text-muted-foreground hover:text-error flex items-center justify-center cursor-pointer"
                        aria-label="删除环境变量"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="bg-card rounded-xl border border-border shadow-sm p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="text-sm text-muted-foreground flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <span>当前页保存的数据会作为系统全局默认配置，后续可在后台设置页继续修改。</span>
          </div>
          <div className="flex items-center justify-end gap-2 shrink-0">
            <Button variant="ghost" onClick={handleSkip} disabled={saving}>
              <SkipForward className="size-4" />
              稍后设置
            </Button>
            <Button onClick={handleFinish} disabled={saving} className="min-w-52">
              {saving && <Loader2 className="size-4 animate-spin" />}
              保存并进入后台
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
