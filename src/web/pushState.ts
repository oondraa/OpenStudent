import { api, cache } from "./api";

// Notifications: the push subscription of this device, stored on the server (`me.pushDevices`). The server sends a
// push when the school changes the student's class timetable. NotifyPrompt notices when the two drift apart.

/** Set while notifications are switched on on this device, so a lost subscription can be told from "never enabled here". */
const HERE = "pushHere";

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function currentSubscription() {
  const reg = await navigator.serviceWorker?.ready;
  return reg?.pushManager.getSubscription() ?? null;
}

export const enabledHere = () => cache.get<boolean>(HERE) === true;
export const markEnabledHere = () => cache.set(HERE, true);

/** Subscribes this device (reusing a live subscription). */
export async function enableNotifications(): Promise<"on" | "denied"> {
  const reg = await navigator.serviceWorker.ready;
  if ((await Notification.requestPermission()) !== "granted") return "denied";
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes((await api.pushKey()).key) }));
  await api.pushSubscribe(sub.toJSON());
  cache.set(HERE, true);
  return "on";
}

export async function disableNotifications() {
  cache.set(HERE, false);
  const sub = await currentSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  }
}
