import { useState } from "react";
import { cache } from "./api";
import type { Subject } from "../worker/parse";
import { Chevron, LargeHeader, Segmented } from "./ui";
import { tone } from "./Grades";
import { average, finalGrade, gradeLabel, need, weights, type Need } from "./gradePlan";

const TARGETS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));
const plural = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n > 1 && n < 5 ? few : many);

/** Short form for the collapsed row. */
function short(n: Need) {
  if (n.kind === "safe") return "v suchu";
  if (n.kind === "grade") return `aspoň ${gradeLabel(n.worst)}`;
  return `${n.count}× 1`;
}

function sentence(n: Need, target: number, w: number) {
  const test = `z příští známky s váhou ${w}`;
  if (n.kind === "safe") return `Na ${target} to vyjde, i kdybys ${test} dostal pětku.`;
  if (n.kind === "grade") return `Na ${target} potřebuješ ${test} aspoň ${gradeLabel(n.worst)}.`;
  return `Jedna jednička na ${target} nestačí. Potřebuješ ${n.count} ${plural(n.count, "jedničku", "jedničky", "jedniček")} s váhou ${w} za sebou.`;
}

/**
 * Pick the final grade wanted from each subject and see what the next test has to be. The targets stay on this
 * device (a preference, nothing SIS needs to know).
 */
export function GradeGoals({ subjects }: { subjects: Subject[] }) {
  const [targets, setTargets] = useState<Record<string, number>>(() => cache.get("gradeTargets") ?? {});
  const [chosenWeights, setChosenWeights] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string | null>(null);
  const setTarget = (subject: string, t: number) => {
    const next = { ...targets, [subject]: t };
    setTargets(next);
    cache.set("gradeTargets", next);
  };

  return (
    <div className="screen">
      <LargeHeader title="Cílové známky" subtitle="Toto pololetí" />
      <div className="scroll">
        <div className="list stagger">
          {subjects.map((s) => {
            const avg = average(s.grades);
            const now = avg === null ? null : finalGrade(avg);
            const target = targets[s.name] ?? now ?? 1;
            const ws = weights(s.grades);
            const w = chosenWeights[s.name] ?? ws[0] ?? 5;
            const n = need(s.grades, target, w);
            const isOpen = open === s.name;
            return (
              <div key={s.name} className={`subject goal ${isOpen ? "open" : ""}`}>
                <button className="row subject-head" onClick={() => setOpen(isOpen ? null : s.name)} aria-expanded={isOpen}>
                  <span className={`avg-badge ${tone(avg)}`}>{avg?.toFixed(2) ?? "–"}</span>
                  <span className="row-main">
                    <span className="row-title">{s.name}</span>
                    <span className="goal-line">
                      Chci <b className={`chip ${tone(target)}`}>{target}</b>
                      <span className={`goal-need goal-${n.kind}`}>{short(n)}</span>
                    </span>
                  </span>
                  <Chevron dir={isOpen ? "down" : "right"} />
                </button>
                <div className="collapse" data-open={isOpen} inert={!isOpen}>
                  <div className="collapse-inner">
                    <div className="goal-body">
                      <p className="goal-label">Výsledná známka</p>
                      <Segmented label={`Výsledná známka z ${s.name}`} value={String(target)} options={TARGETS} onChange={(v) => setTarget(s.name, Number(v))} />
                      {ws.length > 1 && (
                        <>
                          <p className="goal-label">Váha příští známky</p>
                          <Segmented
                            label={`Váha příští známky z ${s.name}`}
                            value={String(w)}
                            options={ws.map((x) => ({ value: String(x), label: `${x}` }))}
                            onChange={(v) => setChosenWeights({ ...chosenWeights, [s.name]: Number(v) })}
                          />
                        </>
                      )}
                      <p className={`goal-sentence goal-${n.kind}`}>{sentence(n, target, w)}</p>
                      {avg !== null && (
                        <p className="goal-now">
                          Teď {avg.toFixed(2)}, to je {now}.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="list-footer">
          Počítám vážený průměr ze známek v SIS. Cíl platí, jen když je průměr pod hranicí, např. na 2 pod 2,50, protože přesné
          zaokrouhlení na půlce záleží na vyučujícím. Cíle si pamatuje jen tohle zařízení.
        </p>
      </div>
    </div>
  );
}
