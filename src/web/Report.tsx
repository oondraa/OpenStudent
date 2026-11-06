import { useState } from "react";
import { api, cache } from "./api";
import { Segmented } from "./ui";
import { VERSION } from "./version";

type Kind = "bug" | "idea";
const MAX = 2000;

const PLACEHOLDER: Record<Kind, string> = {
  bug: "Co se stalo a kde? Třeba: v Rozvrhu se u čtvrtka ukazuje špatná místnost.",
  idea: "Co by ti v appce pomohlo?",
};

/** Device details that help reproduce a bug; shown to the student before sending. */
function meta() {
  return {
    version: VERSION,
    screen: `${innerWidth}×${innerHeight}`,
    layout: cache.get<string>("layout") === "tabs" ? "lišta" : "plocha",
    display: matchMedia("(display-mode: standalone)").matches ? "z plochy" : "v prohlížeči",
    device: navigator.userAgent,
  };
}

/** Bug report or idea, straight to the developer's Telegram (POST /api/report). */
export function ReportSheet({ onClose, onError }: { onClose: () => void; onError: (e: unknown) => boolean }) {
  const [kind, setKind] = useState<Kind>("bug");
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setState("busy");
    setError(null);
    try {
      await api.report(kind, text.trim(), meta());
      setState("sent");
    } catch (e) {
      setState("idle");
      if (onError(e)) return;
      const code = (e as Error).message;
      setError(
        code === "rate_limited"
          ? "Moc hlášení najednou. Zkus to za minutu."
          : code === "not_configured"
            ? "Hlášení teď nejde poslat."
            : "Nepodařilo se odeslat. Zkus to za chvíli.",
      );
    }
  }

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && state !== "busy" && onClose()}>
      <div className="sheet report-sheet" role="dialog" aria-modal="true" aria-labelledby="report-title">
        {state === "sent" ? (
          <div className="report-sent">
            <span className="report-tick" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <h2 id="report-title" className="sheet-title">
              Díky!
            </h2>
            <p className="sheet-text">Přišlo to rovnou autorovi appky.</p>
            <button className="primary" onClick={onClose}>
              Hotovo
            </button>
          </div>
        ) : (
          <>
            <h2 id="report-title" className="sheet-title">
              Nahlásit
            </h2>
            <Segmented<Kind>
              label="Co posíláš"
              value={kind}
              onChange={setKind}
              options={[
                { value: "bug", label: "Chybu" },
                { value: "idea", label: "Nápad" },
              ]}
            />
            <textarea
              className="report-text"
              value={text}
              maxLength={MAX}
              rows={6}
              placeholder={PLACEHOLDER[kind]}
              aria-label={kind === "bug" ? "Popis chyby" : "Nápad"}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
            <p className="report-note">
              Spolu s textem se pošle tvoje jméno a třída, verze appky a typ zařízení, ať se dá chyba najít a ozvat se ti.
              {text.length > MAX - 200 && ` ${MAX - text.length} znaků zbývá.`}
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={state === "busy" || !text.trim()} onClick={send}>
              {state === "busy" ? "Odesílám…" : "Odeslat"}
            </button>
            <button className="sheet-later" disabled={state === "busy"} onClick={onClose}>
              Zrušit
            </button>
          </>
        )}
      </div>
    </div>
  );
}
