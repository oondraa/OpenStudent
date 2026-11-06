// Imported into the generated service worker.
// Notifications carry an encrypted JSON payload {title, body, tag, url?} (scripts/school-changes.ts, scripts/watch.ts);
// the test notification from the Worker has no payload.

// Only this app's own pages: even with leaked push keys, a notification can't send anyone to another site.
function appUrl(url) {
  try {
    const u = new URL(url || "/", self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data && event.data.text() };
  }
  const title = data.title || "OpenSISAKHK";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Notifikace fungují. Ozveme se, až se ti změní rozvrh.",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: data.tag || "osis",
      renotify: true,
      data: { url: appUrl(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = appUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => "focus" in w);
      if (!win) return self.clients.openWindow(url);
      // An open app jumps to the notification's tab (e.g. /?tab=grades).
      return (url === "/" ? Promise.resolve(win) : win.navigate(url).catch(() => win)).then((w) => (w || win).focus());
    }),
  );
});
