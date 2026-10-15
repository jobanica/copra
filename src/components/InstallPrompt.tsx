"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "coprabooks:install-dismissed";

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Already installed?
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (dismissed) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const onInstalled = () => setVisible(false);
    window.addEventListener("appinstalled", onInstalled);

    // iOS has no beforeinstallprompt — show a one-time hint.
    const ua = window.navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/crios|fxios|chrome/i.test(ua);
    if (isIos && isSafari) {
      setIosHint(true);
      setVisible(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] print:hidden">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-lg">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white">
          C
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">Install CopraBooks</div>
          {iosHint ? (
            <div className="text-xs text-gray-500">
              Tap the Share button, then “Add to Home Screen”.
            </div>
          ) : (
            <div className="text-xs text-gray-500">Add to your home screen for quick access.</div>
          )}
        </div>
        {!iosHint && (
          <button onClick={install} className="btn-primary px-4 py-2 text-sm">
            Install
          </button>
        )}
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
