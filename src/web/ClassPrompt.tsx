import { useEffect, useMemo, useState } from "react";
import { api, cache, type Me } from "./api";
import { useCachedFetch } from "./useFetch";
import { setPeriods } from "../shared/periods";
import { setSchoolPoint } from "./tripsData";
import type { SchoolInfo } from "../shared/types";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The school's logo on a white tile (logos are made for white), or its initials. */
export function SchoolLogo({ school, size = 36 }: { school: Pick<SchoolInfo, "logo" | "nick" | "id">; size?: number }) {
  if (school.logo)
    return (
      <span className="school-logo" style={{ width: size * 1.5, height: size }}>
        <img src={school.logo} alt="" loading="lazy" />
      </span>
    );
  const ini = school.nick.replace(/[^A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g, "").slice(0, 3) || school.nick.slice(0, 2);
  return (
    <span className="school-logo text" style={{ width: size * 1.5, height: size }}>
      {ini}
    </span>
  );
}

/**
 * Picks the school, the class and (optionally) the groups. Shown by itself right after signing up (nothing works
 * without a class), and from Settings to change it.
 */
export function SchoolPicker({ me, onSaved, onCancel, onError }: { me: Me | null; onSaved: () => void; onCancel?: () => void; onError: (e: unknown) => boolean }) {
  const list = useCachedFetch<{ schools: SchoolInfo[] }>("schools", api.schools, onError);
  const [school, setSchool] = useState<SchoolInfo | null>(me?.school ?? null);
  const [cls, setCls] = useState<string | null>(me?.class ?? null);
  const [groups, setGroups] = useState<string[]>(me?.groups ?? []);
  const [allGroups, setAllGroups] = useState<string[] | null>(null);
  const [step, setStep] = useState<"school" | "class" | "groups">(me?.school ? "class" : "school");
  const [q, setQ] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  useEffect(() => {
    if (step !== "groups" || !school || !cls) return;
    api.classGroups(school.id, cls).then((r) => setAllGroups(r.groups), () => setAllGroups([]));
  }, [step, school, cls]);

  const shown = useMemo(() => {
    const all = list.data?.schools ?? [];
    const f = fold(q.trim());
    return f ? all.filter((s) => fold(`${s.nick} ${s.name}`).includes(f)) : all;
  }, [list.data, q]);

  async function save(withGroups: string[]) {
    if (!school || !cls) return;
    setState("busy");
    try {
      await api.setProfile({ school: school.id, cls, groups: withGroups });
      cache.set("me", { ...(me ?? {}), school, class: cls, groups: withGroups });
      setPeriods(school.periods);
      onSaved();
    } catch (e) {
      setState(onError(e) ? "idle" : "error");
    }
  }

  return (
    <div className="sheet-backdrop">
      <div className="sheet school-sheet" role="dialog" aria-modal="true" aria-labelledby="school-title">
        {step === "school" && (
          <>
            <h2 id="school-title" className="sheet-title">Na jakou chodíš školu?</h2>
            <label className="search">
              <input placeholder="Hledat školu" aria-label="Hledat školu" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="school-list" role="listbox" aria-label="Školy">
              {list.loading && !list.data && <p className="sheet-text">Načítám školy…</p>}
              {shown.map((s) => (
                <button
                  key={s.id}
                  role="option"
                  aria-selected={school?.id === s.id}
                  className={`school-option ${school?.id === s.id ? "selected" : ""}`}
                  disabled={!s.supported}
                  onClick={() => {
                    setSchool(s);
                    setCls(null);
                    setGroups([]);
                    setStep("class");
                  }}
                >
                  <SchoolLogo school={s} />
                  <span className="school-option-text">
                    <b>{s.nick}</b>
                    <small>{s.supported ? (s.level === "ZŠ" ? "ZŠ · 2. stupeň" : s.level) : "Škola nezveřejňuje rozvrh, zatím nejde"}</small>
                  </span>
                </button>
              ))}
            </div>
            {onCancel && (
              <button className="sheet-later" onClick={onCancel}>
                Zrušit
              </button>
            )}
          </>
        )}
        {step === "class" && school && (
          <>
            <button className="sheet-back" onClick={() => setStep("school")}>
              ‹ Jiná škola
            </button>
            <div className="school-head">
              <SchoolLogo school={school} size={44} />
              <h2 id="school-title" className="sheet-title">Ve které jsi třídě?</h2>
            </div>
            <div className="class-grid" role="radiogroup" aria-label="Třída">
              {school.classes.map((c) => (
                <button key={c} role="radio" aria-checked={cls === c} className={cls === c ? "selected" : ""} onClick={() => setCls(c)}>
                  {c}
                </button>
              ))}
            </div>
            <button className="primary" disabled={!cls} onClick={() => setStep("groups")}>
              Pokračovat
            </button>
            {onCancel && (
              <button className="sheet-later" onClick={onCancel}>
                Zrušit
              </button>
            )}
          </>
        )}
        {step === "groups" && school && cls && (
          <>
            <button className="sheet-back" onClick={() => setStep("class")}>
              ‹ Jiná třída
            </button>
            <h2 id="school-title" className="sheet-title">Ve kterých jsi skupinách?</h2>
            <p className="sheet-text">
              Když se třída dělí (jazyky, cvičení), vyber svoje skupiny a v rozvrhu uvidíš jen svoje hodiny. Můžeš to
              přeskočit a vidět všechno.
            </p>
            {allGroups === null ? (
              <p className="sheet-text">Načítám skupiny…</p>
            ) : allGroups.length === 0 ? (
              <p className="sheet-text">Tahle třída se v rozvrhu na skupiny nedělí.</p>
            ) : (
              <div className="class-grid groups" role="group" aria-label="Skupiny">
                {allGroups.map((g) => (
                  <button
                    key={g}
                    aria-pressed={groups.includes(g)}
                    className={groups.includes(g) ? "selected" : ""}
                    onClick={() => setGroups((gs) => (gs.includes(g) ? gs.filter((x) => x !== g) : [...gs, g]))}
                  >
                    {g}
                  </button>
                ))}
              </div>
            )}
            {state === "error" && <p className="error">Nepodařilo se uložit, zkus to znovu.</p>}
            <button className="primary" disabled={state === "busy"} onClick={() => save(groups)}>
              {state === "busy" ? "Ukládám…" : groups.length ? "Hotovo" : "Hotovo, ukazuj všechno"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Asks for school and class right after signing up, when the account doesn't have them yet. */
export function ClassPrompt({ onError }: { onError: (e: unknown) => boolean }) {
  const me = useCachedFetch<Me>("me", api.me, onError);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (me.data?.school) {
      setPeriods(me.data.school.periods);
      setSchoolPoint(me.data.school);
    }
  }, [me.data]);
  const ask = !me.loading && !!me.data && (!me.data.school || !me.data.class);
  if (!ask || done) return null;
  return (
    <SchoolPicker
      me={me.data}
      onError={onError}
      onSaved={() => {
        setDone(true);
        // Every screen reads the class from the server: start them fresh.
        location.reload();
      }}
    />
  );
}
