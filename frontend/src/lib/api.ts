// Typed fetch wrappers for the Simha Edge Router NestJS API.
// The browser talks to same-origin BFF routes (/api/*) which proxy to the
// NestJS control plane; the cookie carries the simha_session automatically.

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function sessionToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)simha_session=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = sessionToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
  if (res.status === 401) {
    throw new ApiError('Session expired — sign in again', 401);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError((body as { error?: string }).error || `HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

// ── types ────────────────────────────────────────────────────────────────────

export interface UsageOverview {
  requests_today: number;
  requests_month: number;
  active_models: number;
  failover_events: number;
  daily_limit: number | null;
  monthly_limit: number | null;
  per_day: Array<{ date: string; requests: number }>;
  recent: Array<{
    timestamp: string;
    model: string;
    provider: string;
    tokens: number;
    latency_ms: number | null;
    status: number;
  }>;
  plan: { id: string; name: string; price_monthly_usd: string; renews_at?: string | null };
  plan_usage: { daily_percent: number; monthly_percent: number };
}

export interface Provider {
  id?: number;
  name: string;
  provider: 'OpenAI' | 'Anthropic' | 'Gemini' | 'Ollama' | string;
  alias?: string;
  key_last4?: string;
  model_count: number;
  healthy: boolean;
  requests_today: number;
  strikes: number;
  enabled: boolean;
  rpm?: number;
  rpd?: number;
  rpw?: number;
}

export interface ProviderInput {
  provider: string;
  alias: string;
  api_key?: string;
  rpm: number;
  rpd: number;
  rpw: number;
  enabled: boolean;
}

export interface ClientKey {
  id: number;
  name: string;
  key_prefix: string;
  active: boolean;
  created_at: string;
  last_used_at: string | null;
  requests_30d: number;
}

export interface ClientKeyCreated extends ClientKey {
  key: string; // full sek_ value, shown once
}

export interface BenchmarkModel {
  model: string;
  organization: string;
  open_weights: boolean;
  overall_score: number | null;
  reasoning_score: number | null;
  coding_score: number | null;
  agentic_coding_score: number | null;
  mathematics_score: number | null;
  data_analysis_score: number | null;
  language_score: number | null;
  instruction_following_score: number | null;
  llm_calls: number | null;
  errored_traces: number | null;
  p50_latency_ms: number | null;
  hallucination_rate: number | null;
  feedback_avg: number | null;
}

export interface OAuthConfig {
  provider: string;
  client_id: string;
  enabled: boolean;
  redirect_uri: string;
}

export interface WorkspaceInfo {
  name: string;
  slug: string;
}

export interface GlobalLimits {
  rpm: number;
  rpd: number;
  rpw: number;
}

export interface CacheSettings {
  enabled: boolean;
  similarity_threshold: number;
  ttl_hours: number;
}

export interface Invoice {
  id: number;
  amount_usd: string;
  status: string;
  created_at: string;
}

// ── endpoint wrappers ────────────────────────────────────────────────────────

export const api = {
  usageOverview: () => request<UsageOverview>('/api/v1/usage/overview'),
  providers: {
    list: () => request<{ providers: Provider[] }>('/api/v1/providers'),
    create: (input: ProviderInput) =>
      request<{ ok: boolean }>('/api/v1/providers', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: number, input: Partial<ProviderInput>) =>
      request<{ ok: boolean }>(`/api/v1/providers/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: number) =>
      request<{ ok: boolean }>(`/api/v1/providers/${id}`, { method: 'DELETE' }),
  },
  clientKeys: {
    list: () => request<{ keys: ClientKey[] }>('/api/v1/client-keys'),
    create: (name: string) =>
      request<ClientKeyCreated>('/api/v1/client-keys', { method: 'POST', body: JSON.stringify({ name }) }),
    revoke: (id: number) =>
      request<{ ok: boolean }>(`/api/v1/client-keys/${id}`, { method: 'PATCH', body: JSON.stringify({ active: false }) }),
    remove: (id: number) =>
      request<{ ok: boolean }>(`/api/v1/client-keys/${id}`, { method: 'DELETE' }),
  },
  oauth: {
    save: (input: { provider: string; client_id: string; client_secret: string; enabled: boolean }) =>
      request<{ ok: boolean }>('/api/v1/oauth-config', { method: 'PUT', body: JSON.stringify(input) }),
  },
  workspace: {
    get: () => request<WorkspaceInfo>('/api/v1/workspace'),
    rename: (name: string) =>
      request<{ ok: boolean }>('/api/v1/workspace', { method: 'PATCH', body: JSON.stringify({ name }) }),
    remove: () => request<{ ok: boolean }>('/api/v1/workspace', { method: 'DELETE' }),
  },
  settings: {
    limits: (limits: GlobalLimits) =>
      request<{ ok: boolean }>('/api/v1/settings/limits', { method: 'PATCH', body: JSON.stringify(limits) }),
    cache: (cache: CacheSettings) =>
      request<{ ok: boolean }>('/api/v1/settings/cache', { method: 'PATCH', body: JSON.stringify(cache) }),
  },
  billing: {
    portalUrl: () => request<{ portal_url: string }>('/api/v1/billing/portal-url'),
    invoices: () => request<{ invoices: Invoice[] }>('/api/v1/billing/invoices'),
  },
  benchmarks: () => request<{ models: BenchmarkModel[] }>('/api/v1/benchmarks'),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
};