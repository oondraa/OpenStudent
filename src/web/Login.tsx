import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, cache, Unauthorized } from "./api";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Login({ onDone }: { onDone: (origin: { x: number; y: number }) => void }) {
  const [email, setEmail] = useState(() => cache.get<string>("lastEmail") ?? "");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  // Bumped on every failed try, so the shake replays even when the message stays the same.
  const [shake, setShake] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  const fail = (msg: string) => {
    setState("idle");
    setShake((n) => n + 1);
    setError(msg);
  };

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    if (state !== "idle" || !email) return;
    setState("busy");
    setError(null);
    try {
      const r = await api.authStart(email.trim());
      cache.set("lastEmail", email.trim());
      setDevCode(r.dev ?? null);
      setStep("code");
      setState("idle");
      setTimeout(() => codeInput.current?.focus(), 50);
    } catch (err) {
      const m = (err as Error).message;
      fail(
        m === "bad_email"
          ? "Tohle nevypadá jako e-mail."
          : m === "too_soon" || m === "rate_limited"
            ? "Kód už jsme poslali. Další půjde za chvilku."
            : m === "mail_failed"
              ? "E-mail se nepodařilo odeslat. Zkus to za chvíli."
              : "Server teď neodpovídá. Zkus to za chvíli.",
      );
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (state !== "idle" || code.length !== 6) return;
    setState("busy");
    setError(null);
    try {
      await api.authVerify(email.trim(), code);
      setState("done");
      const r = button.current!.getBoundingClientRect();
      setTimeout(() => onDone({ x: r.left + r.width / 2, y: r.top + r.height / 2 }), reduced() ? 0 : 320);
    } catch (err) {
      const m = (err as Error).message;
      setCode("");
      fail(m === "code_expired" ? "Kód vypršel nebo už neplatí. Pošli si nový." : "Kód nesedí. Zkontroluj ho v e-mailu.");
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
          <span className="lw-sis">Študent</span>
        </h1>
        <p className="login-sub">
          {step === "email"
            ? "Rozvrh, obědy, volné učebny a cesty po Hradci. Pro všechny školy v Hradci Králové."
            : `Poslali jsme ti 6místný kód na ${email.trim()}.`}
        </p>
        {step === "email" ? (
          <form onSubmit={sendCode} className="login-form" key={`e${shake}`} data-shake={shake > 0}>
            <label className="field">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
                <path d="M4 7l8 6 8-6" />
              </svg>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="E-mail"
                aria-label="E-mail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-describedby="email-hint"
              />
            </label>
            <p className="field-hint" id="email-hint">
              Jakýkoli tvůj e-mail, nemusí být školní. Žádné heslo: pokaždé ti přijde kód.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button ref={button} className={`primary login-button ${state}`} disabled={state === "idle" && !email}>
              <span className="lb-label">Poslat kód</span>
              <span className="lb-spinner" aria-hidden="true" />
              <span className="sr-only" aria-live="polite">
                {state === "busy" ? "Posílám kód" : ""}
              </span>
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="login-form" key={`c${shake}`} data-shake={shake > 0}>
            <label className="field">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
                <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
              </svg>
              <input
                ref={codeInput}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="Kód z e-mailu"
                aria-label="Kód z e-mailu"
                className="code-input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
              />
            </label>
            {devCode && (
              <p className="field-hint">
                Vývojový režim (e-maily se neposílají): kód je <b>{devCode}</b>
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button ref={button} className={`primary login-button ${state}`} disabled={state === "idle" && code.length !== 6}>
              <span className="lb-label">Přihlásit se</span>
              <span className="lb-spinner" aria-hidden="true" />
              <svg className="lb-tick" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <span className="sr-only" aria-live="polite">
                {state === "busy" ? "Přihlašuji" : state === "done" ? "Přihlášeno" : ""}
              </span>
            </button>
            <button
              type="button"
              className="sheet-later"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            >
              Jiný e-mail nebo poslat znovu
            </button>
          </form>
        )}
        <p className="fineprint">
          E-mail slouží jen k přihlášení. Rozvrhy bereme z veřejných rozvrhů škol. Neoficiální aplikace, není spojená se
          žádnou školou.
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
