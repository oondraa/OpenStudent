import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, cache, Unauthorized } from "./api";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Login({ onDone }: { onDone: (origin: { x: number; y: number }) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  // Bumped on every failed try, so the shake replays even when the message stays the same.
  const [shake, setShake] = useState(0);
  const button = useRef<HTMLButtonElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (state !== "idle" || !username || !password) return;
    setState("busy");
    setError(null);
    try {
      await api.login(username.trim(), password);
      setState("done");
      // The tick shows for a beat, then the welcome grows out of the button.
      const r = button.current!.getBoundingClientRect();
      setTimeout(() => onDone({ x: r.left + r.width / 2, y: r.top + r.height / 2 }), reduced() ? 0 : 320);
    } catch (err) {
      setState("idle");
      setShake((n) => n + 1);
      setError(
        err instanceof Unauthorized
          ? "Špatné jméno nebo heslo."
          : (err as Error).message === "rate_limited"
            ? "Moc pokusů o přihlášení. Zkus to za minutu."
            : "SIS teď neodpovídá. Zkus to za chvíli.",
      );
    }
  }

  return (
    <main className="login">
      <div className="login-glow" aria-hidden="true">
        <i />
        <i />
      </div>
      <div className="login-inner">
        <img src="/icon.svg" alt="" className="login-icon" />
        <h1 className="wordmark login-wordmark">
          <span className="lw-open">
            <span>
              <span>Open</span>
            </span>
          </span>
          <span className="lw-sis">SISAKHK</span>
        </h1>
        <p className="login-sub">Rozvrh, známky, absence a obědy. Přihlas se stejně jako do školního SIS.</p>
        <form onSubmit={submit} className="login-form" key={shake} data-shake={shake > 0}>
          <label className="field">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
            </svg>
            <input
              autoComplete="username"
              placeholder="Uživatelské jméno"
              aria-label="Uživatelské jméno"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              aria-describedby="username-hint"
            />
          </label>
          <p className="field-hint" id="username-hint">
            Je to část školního e-mailu před zavináčem. Z <b>novak.adam</b>@ssakhk.cz je to <b>novak.adam</b>.
          </p>
          <label className="field">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
              <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
            </svg>
            <input
              type={show ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Heslo"
              aria-label="Heslo"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="button" className="field-eye" aria-label={show ? "Skrýt heslo" : "Zobrazit heslo"} aria-pressed={show} onClick={() => setShow(!show)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
                <circle cx="12" cy="12" r="3" />
                {!show && <path d="M4 20L20 4" />}
              </svg>
            </button>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button ref={button} className={`primary login-button ${state}`} disabled={state === "idle" && (!username || !password)}>
            <span className="lb-label">Přihlásit se</span>
            <span className="lb-spinner" aria-hidden="true" />
            <svg className="lb-tick" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            <span className="sr-only" aria-live="polite">
              {state === "busy" ? "Přihlašuji" : state === "done" ? "Přihlášeno" : ""}
            </span>
          </button>
        </form>
        <p className="fineprint">
          Heslo zůstává zašifrované v tomhle zařízení. Na server se uloží jen se zapnutými notifikacemi. Neoficiální
          aplikace, není spojená se školou.
        </p>
      </div>
    </main>
  );
}

/**
 * After signing in: an ember circle grows out of the button over the login, the app mounts underneath while it
 * covers the screen (`onCovered`), the mark and a hello pop in, then the whole thing lifts away into the app.
 */
export function Welcome({ origin, onCovered, onDone }: { origin: { x: number; y: number }; onCovered: () => void; onDone: () => void }) {
  const [phase, setPhase] = useState<"cover" | "hold" | "out">("cover");
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .me()
      .then((m) => {
        cache.set("me", m);
        if (live) setName(m.name?.split(" ")[0] ?? null);
      })
      .catch(() => {});
    const fast = reduced();
    const timers = [
      setTimeout(() => (setPhase("hold"), onCovered()), fast ? 120 : 640),
      setTimeout(() => setPhase("out"), fast ? 900 : 1900),
      setTimeout(onDone, fast ? 1200 : 2450),
    ];
    return () => {
      live = false;
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className={`welcome ${phase}`} aria-hidden="true" style={{ "--x": `${origin.x}px`, "--y": `${origin.y}px` } as React.CSSProperties}>
      <div className="welcome-content">
        <div className="welcome-mark">
          <i className="welcome-ring" />
          <i className="welcome-ring" />
          <img src="/icon.svg" alt="" />
        </div>
        <p className="welcome-hello">Vítej{name ? "," : ""}</p>
        {name && <p className="welcome-name">{name}</p>}
      </div>
    </div>
  );
}
