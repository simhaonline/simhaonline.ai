'use client';

// Typed fetch wrappers for the Workbench v1 API (cookie auth, workspace scope).

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export function getWorkspaceId(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem('simha.workspace-id') || '';
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const workspaceId = getWorkspaceId();
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError((body as { error?: string }).error || `HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export interface V1Conversation {
  id: number;
  title: string;
  model: string;
  pinned?: boolean;
  message_count?: number;
  updated_at: string;
}

export interface V1Message {
  id: number | string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  model?: string;
  tokens?: number;
  created_at?: string;
}

export interface V1Prompt {
  id: number;
  title: string;
  content: string;
  category?: string;
  tags?: string[];
  created_at?: string;
}

export interface V1Persona {
  id: string;
  name: string;
  color: string;
  system_prompt: string;
  model: string;
  temperature: number;
  max_tokens: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  active?: boolean;
}

export interface V1Plugin {
  id: number;
  name: string;
  description: string;
  category: string;
  icon?: string;
  enabled: boolean;
  effective_permission?: string;
}

export const wbApi = {
  conversations: {
    list: () => request<{ conversations: V1Conversation[] }>('/chat/api/v1/conversations'),
    create: (title?: string) =>
      request<V1Conversation>('/chat/api/v1/conversations', { method: 'POST', body: JSON.stringify({ title }) }),
    rename: (id: number, title: string) =>
      request<V1Conversation>(`/chat/api/v1/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
    pin: (id: number, pinned: boolean) =>
      request<V1Conversation>(`/chat/api/v1/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ pinned }) }),
    remove: (id: number) =>
      request<{ ok: boolean }>(`/chat/api/v1/conversations/${id}`, { method: 'DELETE' }),
    messages: (id: number, cursor?: string) =>
      request<{ messages: V1Message[]; next_cursor: string | null }>(
        `/chat/api/v1/conversations/${id}/messages${cursor ? `?cursor=${cursor}` : ''}`),
    share: (id: number) =>
      request<{ url: string }>(`/chat/api/v1/conversations/${id}/share`, { method: 'POST' }),
    branch: (id: number, messageId: number | string) =>
      request<{ id: number }>(`/chat/api/v1/conversations/${id}/branch`, {
        method: 'POST', body: JSON.stringify({ message_id: messageId }),
      }),
  },
  messages: {
    save: (conversationId: number, message: { role: string; content: string; model?: string; tokens?: number }) =>
      request<{ id: number }>(`/chat/api/v1/conversations/${conversationId}/messages`, {
        method: 'POST', body: JSON.stringify(message),
      }),
    delete: (conversationId: number, messageId: number | string) =>
      request<{ ok: boolean }>(`/chat/api/v1/conversations/${conversationId}/messages?message_id=${messageId}`, { method: 'DELETE' }),
    rate: (messageId: number | string, rating: 'up' | 'down') =>
      request<{ ok: boolean }>(`/chat/api/v1/messages/${messageId}/rating`, {
        method: 'PATCH', body: JSON.stringify({ rating }),
      }),
  },
  prompts: {
    list: () => request<{ prompts: V1Prompt[] }>('/chat/api/v1/prompts'),
    create: (input: { title: string; content: string; category?: string; tags?: string[] }) =>
      request<V1Prompt>('/chat/api/v1/prompts', { method: 'POST', body: JSON.stringify(input) }),
    remove: (id: number) =>
      request<{ ok: boolean }>(`/chat/api/v1/prompts/${id}`, { method: 'DELETE' }),
  },
  personas: {
    list: () => request<{ personas: V1Persona[] }>('/chat/api/v1/personas'),
    create: (persona: Omit<V1Persona, 'id' | 'active'>) =>
      request<V1Persona>('/chat/api/v1/personas', { method: 'POST', body: JSON.stringify(persona) }),
    activate: (id: string, active: boolean) =>
      request<{ ok: boolean }>(`/chat/api/v1/personas/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  },
  plugins: {
    list: () => request<{ plugins: V1Plugin[] }>('/chat/api/v1/plugins'),
    toggle: (id: number, enabled: boolean) =>
      request<{ ok: boolean }>(`/chat/api/v1/plugins/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
    test: (id: number) =>
      request<{ ok: boolean; name: string; reachable: boolean; latency_ms: number }>(`/chat/api/v1/plugins/${id}/test`, { method: 'POST' }),
  },
  models: {
    list: () => request<{ models: string[] }>('/chat/api/models'),
  },
  files: {
    upload: async (file: File): Promise<{ fileId: string; name: string; previewUrl?: string }> => {
      const data = new FormData();
      data.append('file', file);
      const res = await fetch('/chat/api/v1/uploads', { method: 'POST', body: data, credentials: 'include' });
      if (!res.ok) throw new ApiError(`Upload failed (${res.status})`, res.status);
      const d = (await res.json()) as { file_id?: string; id?: number; url?: string };
      return { fileId: String(d.file_id ?? d.id ?? ''), name: file.name, previewUrl: d.url };
    },
  },
  health: () => request<{ status: string; latency_ms: number }>('/chat/api/v1/health'),
  share: (token: string) =>
    request<{ title: string; model: string; createdAt: string; messages: V1Message[] }>(`/chat/api/v1/share/${token}`),
};