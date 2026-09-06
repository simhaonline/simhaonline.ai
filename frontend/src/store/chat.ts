'use client';

// (2) store/chat.ts — Zustand global state for the Simha Workbench.
import { create } from 'zustand';

export interface Conversation {
  id: number;
  title: string;
  model: string;
  pinned?: boolean;
  message_count?: number;
  updated_at: string;
}

export interface ChatMessage {
  id: number | string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  model?: string;
  tokens?: number;
  latency_ms?: number;
  created_at?: string;
  rating?: 'up' | 'down' | null;
  branchCount?: number;
}

export interface AttachedFile {
  fileId: string;
  name: string;
  previewUrl?: string;
  isImage?: boolean;
  mimeType?: string;
}

export interface CompareMode {
  enabled: boolean;
  models: string[];
  messages: Record<string, ChatMessage[]>;
}

export interface Persona {
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

interface ChatState {
  conversations: Conversation[];
  activeConversationId: number | null;
  messages: Record<number, ChatMessage[]>;
  streamingMessageId: string | null;
  isStreaming: boolean;
  selectedModel: string;
  activePersona: Persona | null;
  enabledPlugins: string[];
  compareMode: CompareMode;
  attachedFiles: AttachedFile[];
  draft: string;
  // actions
  setConversations: (list: Conversation[]) => void;
  setActiveConversation: (id: number | null) => void;
  setMessages: (conversationId: number, messages: ChatMessage[]) => void;
  appendMessage: (conversationId: number, message: ChatMessage) => void;
  updateStreamingMessage: (conversationId: number, text: string) => void;
  finalizeStreamingMessage: (conversationId: number, opts?: { tokens?: number; latency_ms?: number; model?: string }) => void;
  removeMessage: (conversationId: number, messageId: number | string) => void;
  setModel: (model: string) => void;
  setActivePersona: (persona: Persona | null) => void;
  setEnabledPlugins: (ids: string[]) => void;
  toggleCompareMode: () => void;
  addCompareModel: (model: string) => void;
  setCompareMessages: (model: string, messages: ChatMessage[]) => void;
  appendCompareMessage: (model: string, message: ChatMessage) => void;
  updateCompareStreaming: (model: string, text: string) => void;
  addAttachedFile: (file: AttachedFile) => void;
  removeAttachedFile: (fileId: string) => void;
  setDraft: (text: string) => void;
  resetConversationState: () => void;
}

const STREAM_ID = 'streaming-assistant';

export const useChat = create<ChatState>((set) => ({
  conversations: [],
  activeConversationId: null,
  messages: {},
  streamingMessageId: null,
  isStreaming: false,
  selectedModel: 'auto',
  activePersona: null,
  enabledPlugins: [],
  compareMode: { enabled: false, models: [], messages: {} },
  attachedFiles: [],
  draft: '',

  setConversations: (list) => set({ conversations: list }),
  setActiveConversation: (id) => set({ activeConversationId: id }),
  setMessages: (conversationId, messages) =>
    set((s) => ({ messages: { ...s.messages, [conversationId]: messages } })),
  appendMessage: (conversationId, message) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: [...(s.messages[conversationId] || []), message],
      },
    })),
  updateStreamingMessage: (conversationId, text) =>
    set((s) => {
      const list = s.messages[conversationId] || [];
      const last = list[list.length - 1];
      const updated: ChatMessage =
        last && last.id === STREAM_ID
          ? { ...last, content: text }
          : { id: STREAM_ID, role: 'assistant', content: text, model: s.selectedModel };
      return {
        streamingMessageId: STREAM_ID,
        messages: {
          ...s.messages,
          [conversationId]: last && last.id === STREAM_ID
            ? [...list.slice(0, -1), updated]
            : [...list, updated],
        },
      };
    }),
  finalizeStreamingMessage: (conversationId, opts) =>
    set((s) => {
      const list = s.messages[conversationId] || [];
      const last = list[list.length - 1];
      const finalized: ChatMessage = last && last.id === STREAM_ID
        ? { ...last, tokens: opts?.tokens, latency_ms: opts?.latency_ms, model: opts?.model || s.selectedModel }
        : last;
      return {
        isStreaming: false,
        streamingMessageId: null,
        messages: finalized
          ? { ...s.messages, [conversationId]: [...list.slice(0, -1), finalized] }
          : s.messages,
      };
    }),
  removeMessage: (conversationId, messageId) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] || []).filter((m) => m.id !== messageId),
      },
    })),
  setModel: (model) => set({ selectedModel: model }),
  setActivePersona: (persona) => set({ activePersona: persona }),
  setEnabledPlugins: (ids) => set({ enabledPlugins: ids }),
  toggleCompareMode: () =>
    set((s) => ({ compareMode: { ...s.compareMode, enabled: !s.compareMode.enabled } })),
  addCompareModel: (model) =>
    set((s) => ({
      compareMode: {
        ...s.compareMode,
        models: s.compareMode.models.includes(model) || s.compareMode.models.length >= 4
          ? s.compareMode.models
          : [...s.compareMode.models, model],
      },
    })),
  setCompareMessages: (model, messages) =>
    set((s) => ({
      compareMode: {
        ...s.compareMode,
        messages: { ...s.compareMode.messages, [model]: messages },
      },
    })),
  appendCompareMessage: (model, message) =>
    set((s) => ({
      compareMode: {
        ...s.compareMode,
        messages: {
          ...s.compareMode.messages,
          [model]: [...(s.compareMode.messages[model] || []), message],
        },
      },
    })),
  updateCompareStreaming: (model, text) =>
    set((s) => {
      const list = s.compareMode.messages[model] || [];
      const last = list[list.length - 1];
      return {
        compareMode: {
          ...s.compareMode,
          messages: {
            ...s.compareMode.messages,
            [model]: last && String(last.id).startsWith('cmp-stream-')
              ? [...list.slice(0, -1), { ...last, content: text }]
              : [...list, { id: `cmp-stream-${model}`, role: 'assistant' as const, content: text, model }],
          },
        },
      };
    }),
  addAttachedFile: (file) =>
    set((s) => ({ attachedFiles: [...s.attachedFiles, file].slice(0, 10) })),
  removeAttachedFile: (fileId) =>
    set((s) => ({ attachedFiles: s.attachedFiles.filter((f) => f.fileId !== fileId) })),
  setDraft: (text) => set({ draft: text }),
  resetConversationState: () =>
    set({ activeConversationId: null, isStreaming: false, streamingMessageId: null }),
}));