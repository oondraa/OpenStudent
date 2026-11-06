import { useMemo, useState } from "react";
import { api, type GradesResponse } from "./api";
import type { Subject } from "../worker/parse";
import { Chevron, Empty, LargeHeader, SkeletonList } from "./ui";
import { useCachedFetch } from "./useFetch";
import { BookIcon, TargetIcon } from "./icons";
import { BackContext } from "./layer";
import { GradeGoals } from "./GradeGoals";

export function tone(n: number | null) {
  if (n === null) return "neutral";
  if (n < 1.75) return "great";
  if (n < 2.75) return "good";
  if (n < 3.75) return "meh";
  return "bad";
}

export function Grades({ onError }: { onError: (e: unknown) => boolean }) {
  const { data, loading, error } = useCachedFetch<GradesResponse>("grades", api.grades, onError);
  const [open, setOpen] = useState<string | null>(null);
  const subjects = data?.subjects ?? [];
  const averages = subjects.map((s) => s.average).filter((a): a is number => a !== null);
  const overall = averages.length ? averages.reduce((a, b) => a + b, 0) / averages.length : null;
  const gradeCount = subjects.reduce((n, s) => n + s.grades.length, 0);
  // Target grades open inside this screen, like the absence calculator.
  const [goals, setGoals] = useState(false);
  const goalsBack = useMemo(() => ({ go: () => setGoals(false), label: "Známky" }), []);

  if (goals)
    return (
      <BackContext.Provider value={goalsBack}>
        <div className="subscreen">
          <GradeGoals subjects={subjects} />
        </div>
      </BackContext.Provider>
    );

  return (
    <div className="screen">
      <LargeHeader title="Známky" subtitle="Toto pololetí" loading={loading} />
      <div className="scroll">
        {error && <p className="banner">Známky se nepodařilo obnovit. Zobrazuji poslední uložené.</p>}
        {overall !== null && (
          <div className="summary-card stagger">
            <div>
              <p className="eyebrow">Průměr ze všech předmětů</p>
              <p className={`summary-value ${tone(overall)}`}>{overall.toFixed(2)}</p>
            </div>
            <div className="summary-side">
              <span>{subjects.length} předmětů</span>
              <span>{gradeCount} známek</span>
            </div>
          </div>
        )}
        {subjects.length > 0 && (
          <div className="list calc-entry calc-entry-bottom">
            <button className="row more-row tint-grades" onClick={() => setGoals(true)}>
              <span className="more-icon">
                <TargetIcon />
              </span>
              <span className="row-main">
                <span className="row-title">Cílové známky</span>
                <span className="row-sub">Co potřebuješ z dalších písemek</span>
              </span>
              <Chevron />
            </button>
          </div>
        )}
        {subjects.length > 0 ? (
          <div className="list grid">
            {subjects.map((s) => (
              <div key={s.name}>
                <SubjectRow s={s} open={open === s.name} onToggle={() => setOpen(open === s.name ? null : s.name)} />
              </div>
            ))}
          </div>
        ) : loading ? (
          <SkeletonList count={8} side />
        ) : (
          <Empty icon={<BookIcon size={40} />} title="Zatím žádné známky" />
        )}
        <p className="list-footer">Průměr počítá SIS a má jen informativní charakter.</p>
      </div>
    </div>
  );
}

function SubjectRow({ s, open, onToggle }: { s: Subject; open: boolean; onToggle: () => void }) {
  return (
    <div className={`subject ${open ? "open" : ""}`}>
      <button className="row subject-head" onClick={onToggle} aria-expanded={open}>
        <span className={`avg-badge ${tone(s.average)}`}>{s.average?.toFixed(2) ?? "–"}</span>
        <span className="row-main">
          <span className="row-title">{s.name}</span>
          <span className="chips">
            {s.grades.slice(-6).map((g, i) => (
              <span key={i} className={`chip ${tone(g.numeric)}`}>
                {g.value}
              </span>
            ))}
          </span>
        </span>
        <Chevron dir={open ? "down" : "right"} />
      </button>
      <div className="collapse" data-open={open} inert={!open}>
        <div className="collapse-inner">
          <ul className="grade-list">
            {[...s.grades].reverse().map((g, i) => (
              <li key={i} className="grade">
                <span className={`chip big ${tone(g.numeric)}`}>{g.value}</span>
                <div className="grade-main">
                  <div className="grade-name">{g.name || g.typeName}</div>
                  <div className="grade-meta">
                    {g.date} · {g.typeName || g.type}
                    {g.weight !== null && ` · váha ${g.weight}`}
                  </div>
                  {g.comment && <div className="grade-meta">„{g.comment}“</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
