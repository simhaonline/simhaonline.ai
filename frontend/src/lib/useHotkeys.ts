'use client';

import { useEffect } from 'react';

export interface HotkeyHandlers {
  onNewConversation?: () => void;
  onCommandPalette?: () => void;
  onToggleCompare?: () => void;
  onExport?: () => void;
}

/** Global hotkeys (ignored while typing in inputs except Ctrl combos). */
export function useHotkeys(handlers: HotkeyHandlers): void {
  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      return t instanceof HTMLElement && (
        t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
      );
    }
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      switch (e.key.toLowerCase()) {
        case 'n':
          e.preventDefault();
          handlers.onNewConversation?.();
          break;
        case 'k':
          e.preventDefault();
          handlers.onCommandPalette?.();
          break;
        case 'e':
          e.preventDefault();
          handlers.onExport?.();
          break;
        case 'c':
          if (e.shiftKey) {
            e.preventDefault();
            handlers.onToggleCompare?.();
          }
          break;
        default:
          break;
      }
      void isTypingTarget; // Ctrl combos work even while typing
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}