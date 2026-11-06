import { useEffect, useState } from "react";
import { api, cache, type Me } from "./api";
import { useCachedFetch } from "./useFetch";
import { currentSubscription, disableNotifications, enableNotifications, enabledHere, markEnabledHere, pushSupported } from "./pushState";

/**
 * Notices when notifications fell apart on this device: the phone lost its push subscription (iOS can drop it when
 * the app updates) while the server still checks, or the server stopped checking while the phone is subscribed.
 * Fixes the first silently when it can, otherwise asks once with both ways out, so the state is consistent again.
 */
export function NotifyPrompt({ onError }: { onError: (e: unknown) => boolean }) {
  const me = useCachedFetch<Me>("me", api.me, onError);
  const ready = !me.loading && !!me.data && me.data.class !== null; // after ClassPrompt, never two sheets at once
  const watching = me.data?.watching;
  const [state, setState] = useState<"hidden" | "open" | "busy" | "error">("hidden");

  useEffect(() => {
    if (!ready || !pushSupported() || Notification.permission === "denied") return;
    let stale = false;
    (async () => {
      const sub = await currentSubscription().catch(() => null);
      if (sub && watching) return markEnabledHere(); // all good (and remembers it for devices from before this check)
      if (sub && !watching) return !stale && setState("open");
      if (!sub && watching && enabledHere()) {
        // Lost on this phone only: subscribe again without asking when the permission is still there.
        if (Notification.permission === "granted") {
          const healed = await enableNotifications().then(
            (r) => r === "on",
            () => false,
          );
          if (healed) return;
        }
        if (!stale) setState("open");
      }
    })();
    return () => {
      stale = true;
    };
  }, [ready, watching]);

  if (state === "hidden") return null;

  async function run(on: boolean) {
    setState("busy");
    try {
      if (on) {
        if ((await enableNotifications()) === "denied") return setState("hidden"); // Settings explains how to allow them
      } else await disableNotifications();
      if (me.data) cache.set("me", { ...me.data, watching: on });
      setState("hidden");
    } catch (e) {
      setState(onError(e) ? "hidden" : "error");
    }
  }

  return (
    <div className="sheet-backdrop">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="notify-title">
        <h2 id="notify-title" className="sheet-title">Notifikace se vypnuly</h2>
        <p className="sheet-text">
          Na tomhle telefonu ti přestaly chodit notifikace o změnách rozvrhu, nových známkách a absenci. Zapni je znovu
          jedním klepnutím.
        </p>
        {state === "error" && <p className="error">Nepodařilo se to, zkus to znovu nebo v Nastavení.</p>}
        <button className="primary" disabled={state === "busy"} onClick={() => run(true)}>
          {state === "busy" ? "Zapínám…" : "Zapnout znovu"}
        </button>
        <button className="sheet-later" disabled={state === "busy"} onClick={() => run(false)}>
          Nechat vypnuté
        </button>
      </div>
    </div>
  );
}
