'use client';

// (11) components/chat/CommandPalette.tsx — cmdk dialog: recent
// conversations, library prompts, models, actions. Arrow-key navigable.

import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { wbApi, type V1Conversation, type V1Prompt } from '@/lib/wb-api';
import { useChat } from '@/store/chat';

export function CommandPalette({
  open, onClose, onNewConversation,
}: {
  open: boolean;
  onClose: () => void;
  onNewConversation: () => void;
}) {
  const router = useRouter();
  const { setDraft, toggleCompareMode, setModel, conversations } = useChat();
  const [chats, setChats] = useState<V1Conversation[]>([]);
  const [prompts, setPrompts] = useState<V1Prompt[]>([]);
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try { setChats((await wbApi.conversations.list()).conversations || []); } catch { /* optional */ }
      try { setPrompts((await wbApi.prompts.list()).prompts || []); } catch { /* optional */ }
      try { setModels((await wbApi.models.list()).models || []); } catch { /* optional */ }
    })();
  }, [open]);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      label="Command palette"
      loop
      className="fixed inset-0 z-[100] bg-black/70 pt-[12vh]"
      overlayClassName=""
      contentClassName="mx-auto w-full max-w-xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden"
    >
      <Command.Input
        autoFocus
        placeholder="Search conversations, prompts, models, actions…"
        className="w-full border-b border-zinc-800 bg-transparent px-4 py-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
      />
      <Command.List className="max-h-[50vh] overflow-auto p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-xs text-zinc-600">No matches.</Command.Empty>

        <Command.Group heading="Recent conversations" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600">
          {(chats.length ? chats : conversations).slice(0, 6).map((c) => (
            <Item key={c.id} onSelect={() => { router.push(`/chat/${c.id}`); onClose(); }}>
              ⌁ {c.title}
            </Item>
          ))}
        </Command.Group>

        <Command.Group heading="Library prompts" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600">
          {prompts.slice(0, 5).map((p) => (
            <Item key={p.id} onSelect={() => { setDraft(p.content); onClose(); }}>
              ▤ {p.title}
            </Item>
          ))}
        </Command.Group>

        <Command.Group heading="Models" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600">
          {models.slice(0, 8).map((m) => (
            <Item key={m} onSelect={() => { setModel(m); window.localStorage.setItem('simha.model', m); onClose(); }}>
              ✦ {m}
            </Item>
          ))}
        </Command.Group>

        <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600">
          <Item onSelect={() => { onNewConversation(); onClose(); }}>＋ New conversation</Item>
          <Item onSelect={() => { toggleCompareMode(); onClose(); }}>⇄ Toggle compare mode</Item>
          <Item onSelect={() => { window.open('https://platform.simhaonline.ai', '_blank'); onClose(); }}>◈ Open Control Center</Item>
        </Command.Group>
      </Command.List>
      <div className="border-t border-zinc-800 px-4 py-2 text-[10px] text-zinc-600">
        ↑↓ navigate · Enter select · Esc close
      </div>
    </Command.Dialog>
  );
}

function Item({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-xs text-zinc-300 data-[selected=true]:bg-zinc-800 data-[selected=true]:text-violet-300"
    >
      {children}
    </Command.Item>
  );
}

export default CommandPalette;