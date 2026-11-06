import { extractUserId, isLoginPage } from "./parse";

export const SIS = "https://sis.ssakhk.cz";

export type Jar = Record<string, string>;

export class SessionExpired extends Error {}
export class BadCredentials extends Error {}

function absorb(jar: Jar, res: Response): boolean {
  let changed = false;
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (jar[name] !== value) {
      jar[name] = value;
      changed = true;
    }
  }
  return changed;
}

const cookieHeader = (jar: Jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

// Errors may end up in the public GitHub Action logs: no query string (the timetable's has the SIS user id).
const bare = (path: string) => path.split("?")[0];

async function request(jar: Jar, path: string, init: RequestInit = {}) {
  const res = await fetch(SIS + path, {
    ...init,
    redirect: "manual",
    headers: { ...init.headers, cookie: cookieHeader(jar), "user-agent": "OpenSISAKHK/0.1 (+https://github.com/oondraa/OpenSISAKHK)" },
  });
  const changed = absorb(jar, res);
  return { res, changed };
}

/** Logs in and returns the cookie jar + SIS user id. */
export async function login(username: string, password: string): Promise<{ jar: Jar; userId: string }> {
  const jar: Jar = {};
  const { res: page } = await request(jar, "/Account/Login");
  const token = (await page.text()).match(/name="__RequestVerificationToken" type="hidden" value="([^"]+)"/)?.[1];
  if (!token) throw new Error("SIS login page changed: no verification token");

  const body = new URLSearchParams({
    __RequestVerificationToken: token,
    UserName: username,
    Password: password,
    RememberMe: "true",
  });
  const { res } = await request(jar, "/Account/Login", {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  const location = res.headers.get("location") ?? "";
  if (res.status !== 302 || location.includes("/Account/Login")) throw new BadCredentials();

  const { html } = await get(jar, "/TimeTable/PersonalNew");
  const userId = extractUserId(html);
  if (!userId) throw new Error("SIS timetable page changed: no user id");
  return { jar, userId };
}

/** GET an authenticated page. Throws SessionExpired when SIS bounces to the login page. */
export async function get(jar: Jar, path: string): Promise<{ html: string; changed: boolean }> {
  const { res, changed } = await request(jar, path);
  if (res.status >= 300 && res.status < 400) {
    if ((res.headers.get("location") ?? "").includes("/Account/Login")) throw new SessionExpired();
    throw new Error(`Unexpected redirect from ${bare(path)}`);
  }
  if (!res.ok) throw new Error(`SIS ${bare(path)} returned ${res.status}`);
  const html = await res.text();
  if (isLoginPage(html)) throw new SessionExpired();
  return { html, changed };
}

/** POST a form to an authenticated endpoint (SIS loads some page parts this way, e.g. the absence summary). */
export async function post(jar: Jar, path: string, form: Record<string, string>): Promise<{ html: string; changed: boolean }> {
  const { res, changed } = await request(jar, path, {
    method: "POST",
    body: new URLSearchParams(form),
    headers: { "content-type": "application/x-www-form-urlencoded", "x-requested-with": "XMLHttpRequest" },
  });
  if (res.status >= 300 && res.status < 400) throw new SessionExpired();
  if (!res.ok) throw new Error(`SIS ${bare(path)} returned ${res.status}`);
  const html = await res.text();
  if (isLoginPage(html)) throw new SessionExpired();
  return { html, changed };
}

export async function getBinary(jar: Jar, path: string): Promise<{ body: ArrayBuffer; type: string }> {
  const { res } = await request(jar, path);
  if (!res.ok) throw new Error(`SIS ${bare(path)} returned ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error(`SIS ${bare(path)} is not an image`);
  return { body: await res.arrayBuffer(), type };
}

export function timetablePath(userId: string, weekStart: string, permanent = false) {
  const q = new URLSearchParams({
    static: String(permanent), // true = the permanent timetable without substitutions
    partial: "true",
    date: `${weekStart}T00:00:00`,
    userid: userId,
  });
  return `/TimeTable/PersonalNew/?${q}`;
}
