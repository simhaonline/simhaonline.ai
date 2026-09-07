'use client';

// components/PWARegister.tsx — registers the service worker + captures the
// beforeinstallprompt event and exposes an install button on mobile/tablet
// where browsers don't show an automatic install UI.

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PWARegister() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [hideBanner, setHideBanner] = useState(true);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
      // show the banner only if the user hasn't dismissed it this week
      const dismissed = window.localStorage.getItem('simha.pwa.dismissed');
      if (!dismissed || Date.now() - Number(dismissed) > 7 * 86400000) setHideBanner(false);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  function dismiss() {
    setHideBanner(true);
    window.localStorage.setItem('simha.pwa.dismissed', String(Date.now()));
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'accepted') dismiss();
    else dismiss();
  }

  if (hideBanner || !installEvent) return null;
  return (
    <div
      role="dialog"
      aria-label="Install Simha Workbench"
      className="fixed inset-x-3 bottom-4 z-[90] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-zinc-700 bg-zinc-900/95 p-3 shadow-2xl backdrop-blur"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500 text-lg text-black" aria-hidden>⌁</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-zinc-100">Install Simha Workbench</p>
        <p className="text-[11px] text-zinc-400">Full-screen app on your phone or tablet</p>
      </div>
      <button onClick={dismiss} aria-label="Dismiss install prompt" className="p-1 text-zinc-500 hover:text-zinc-200 cursor-pointer">✕</button>
      <button
        onClick={() => void install()}
        className="rounded-lg bg-violet-500 px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-violet-400 cursor-pointer"
      >
        Install
      </button>
    </div>
  );
}