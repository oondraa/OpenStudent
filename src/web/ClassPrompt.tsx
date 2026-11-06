import { useEffect, useState } from "react";
import { api, cache, type Me } from "./api";
import { CLASSES } from "../shared/schoolOcr";
import { guessClass } from "./classGuess";
import { useCachedFetch } from "./useFetch";

/** Asks for the class once, when the database doesn't have it yet: suggests a guess from the timetable to confirm or change. */
export function ClassPrompt({ onError }: { onError: (e: unknown) => boolean }) {
  const me = useCachedFetch<Me>("me", api.me, onError);
  const ask = !me.loading && me.data?.class === null; // undefined = an old cached answer, wait for the fresh one
  const [guess, setGuess] = useState<string | null | undefined>(undefined);
  const [chosen, setChosen] = useState<string | null>(null);
  const [state, setState] = useState<"open" | "busy" | "error" | "closed">("open");

  useEffect(() => {
    if (!ask) return;
    guessClass()
      .catch(() => null)
      .then((g) => {
        setGuess(g);
        setChosen((c) => c ?? g);
      });
  }, [ask]);

  if (!ask || state === "closed") return null;

  async function confirm() {
    if (!chosen) return;
    setState("busy");
    try {
      await api.setClass(chosen);
      cache.set("me", { ...me.data, class: chosen });
      setState("closed");
    } catch (e) {
      setState(onError(e) ? "closed" : "error");
    }
  }

  return (
    <div className="sheet-backdrop">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="class-title">
        <h2 id="class-title" className="sheet-title">Ve které jsi třídě?</h2>
        <p className="sheet-text">
          {guess === undefined
            ? "Hledám tě v rozvrhu školy…"
            : guess
              ? `Podle rozvrhu to vypadá na ${guess}. Potvrď, nebo vyber jinou.`
              : "Z rozvrhu se to poznat nepodařilo, vyber ji."}
        </p>
        <div className="class-grid" role="radiogroup" aria-label="Třída">
          {CLASSES.map((c) => (
            <button key={c} role="radio" aria-checked={chosen === c} className={chosen === c ? "selected" : ""} onClick={() => setChosen(c)}>
              {c}
            </button>
          ))}
        </div>
        {state === "error" && <p className="error">Třídu se nepodařilo uložit, zkus to znovu.</p>}
        <button className="primary" disabled={!chosen || state === "busy"} onClick={confirm}>
          {state === "busy" ? "Ukládám…" : "Potvrdit"}
        </button>
        <button className="sheet-later" onClick={() => setState("closed")}>
          Teď ne
        </button>
      </div>
    </div>
  );
}
