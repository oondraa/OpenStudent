import { useState } from "react";
import { api, type ProjectsResponse } from "./api";
import type { Project, ProjectChoice } from "../worker/parse";
import { Chevron, Empty, LargeHeader, Section, SkeletonList } from "./ui";
import { useCachedFetch } from "./useFetch";
import { ProjectIcon } from "./icons";

/** "21/3" → zapsaní over places; without a limit SIS shows just the count. */
const fill = (s: string) => {
  const [n, of] = s.split("/").map(Number);
  return { n: n || 0, of: of || null, over: !!of && n > of };
};

export function Projects({ onError }: { onError: (e: unknown) => boolean }) {
  const [election, setElection] = useState<string | null>(null);
  const { data, loading, error } = useCachedFetch<ProjectsResponse>(
    `projects:${election ?? "latest"}`,
    () => api.projects(election ?? undefined),
    onError,
  );
  const [open, setOpen] = useState<string | null>(null);
  const projects = data?.projects ?? [];
  const mine = data?.mine ?? [];
  const approved = mine.find((c) => c.approved);
  const profile = data?.profile;

  return (
    <div className="screen">
      <LargeHeader title="Projekty" subtitle={data?.election ? `Volba ${data.election.label.replace("-", " – ")}` : "Projektové dny"} loading={loading} />
      <div className="scroll">
        {error && <p className="banner">Projekty se nepodařilo obnovit. Zobrazuji poslední uložené.</p>}

        {approved ? (
          <MyProject choice={approved} project={projects.find((p) => p.number === approved.number)} />
        ) : mine.length > 0 ? (
          <Section title="Moje přihláška">
            {mine.map((c) => (
              <div key={`${c.number}-${c.role}`} className="row">
                <span className="project-num">{c.number}</span>
                <span className="row-main">
                  <span className="row-title">{c.name}</span>
                  <span className="row-sub">{c.order}. volba · {c.role}</span>
                </span>
              </div>
            ))}
          </Section>
        ) : !loading && data ? (
          <p className="list-footer">V téhle volbě nemáš vybraný žádný projekt.</p>
        ) : null}

        {profile && (
          <Section title="Ve škole">
            {profile.class && (
              <div className="row">
                <span className="row-title">Třída</span>
                <span className="row-value">{profile.class}</span>
              </div>
            )}
            {profile.groups.length > 0 && (
              <div className="row">
                <span className="row-title">Skupiny</span>
                <span className="chips">
                  {profile.groups.map((g) => (
                    <span key={g} className="chip">
                      {g}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {profile.blocks.map((b) => (
              <div key={b.subject} className="row">
                <span className="row-title">Blok {b.block}</span>
                <span className="row-value">{b.subject}</span>
              </div>
            ))}
            {profile.email && (
              <div className="row">
                <span className="row-title">E-mail</span>
                <span className="row-value ellipsis">{profile.email}</span>
              </div>
            )}
          </Section>
        )}

        {data && data.elections.length > 1 && (
          <Section title="Volba">
            <label className="row">
              <span className="row-title">Projektové dny</span>
              <select className="select" value={data.election?.id ?? ""} onChange={(e) => setElection(e.target.value)}>
                {data.elections.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label.replace("-", " – ")}
                  </option>
                ))}
              </select>
            </label>
          </Section>
        )}

        {projects.length > 0 ? (
          <Section grid title={`Všechny projekty · ${projects.length}`}>
            {projects.map((p) => (
              <ProjectRow key={p.number} p={p} mine={mine.some((c) => c.number === p.number)} open={open === p.number} onToggle={() => setOpen(open === p.number ? null : p.number)} />
            ))}
          </Section>
        ) : loading ? (
          <SkeletonList count={6} />
        ) : (
          <Empty icon={<ProjectIcon size={40} />} title="Žádné projekty" text="SIS zatím žádnou volbu projektů nemá." />
        )}
        <p className="list-footer">Přihlašuje se dál v SIS. Čísla u rolí: zapsaní / volná místa pro 1., 2. a 3. volbu.</p>
      </div>
    </div>
  );
}

function MyProject({ choice, project }: { choice: ProjectChoice; project?: Project }) {
  return (
    <div className="project-card stagger">
      <div className="project-card-top">
        <span className="project-num big">{choice.number}</span>
        <span className="project-status">Schváleno · {choice.role}</span>
      </div>
      <h2 className="project-title">{choice.name}</h2>
      {project && (
        <>
          <p className="project-meta">{[project.company, project.leader && `vede ${project.leader}`].filter(Boolean).join(" · ")}</p>
          {project.goal && <p className="project-goal">{project.goal}</p>}
          {project.comment && <p className="project-comment">{project.comment}</p>}
        </>
      )}
    </div>
  );
}

function ProjectRow({ p, mine, open, onToggle }: { p: Project; mine: boolean; open: boolean; onToggle: () => void }) {
  const total = fill(p.total);
  return (
    <div className={`subject ${open ? "open" : ""}`}>
      <button className="row subject-head" onClick={onToggle} aria-expanded={open}>
        <span className={`project-num ${mine ? "mine" : ""}`}>{p.number}</span>
        <span className="row-main">
          <span className="row-title">{p.name}</span>
          <span className="row-sub">{[p.company, p.leader].filter(Boolean).join(" · ")}</span>
        </span>
        {p.total && (
          <span className={`project-fill ${total.over ? "over" : ""}`}>
            {total.n}
            {total.of !== null && <small>/{total.of}</small>}
          </span>
        )}
        <Chevron dir={open ? "down" : "right"} />
      </button>
      <div className="collapse" data-open={open} inert={!open}>
        <div className="collapse-inner">
          <div className="project-detail">
            {p.goal && <p className="project-goal">{p.goal}</p>}
            {p.comment && <p className="project-comment">{p.comment}</p>}
            {p.roles.length > 0 && (
              <table className="roles">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>1.</th>
                    <th>2.</th>
                    <th>3.</th>
                  </tr>
                </thead>
                <tbody>
                  {p.roles.map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      {r.choices.map((c, j) => (
                        <td key={j} className={fill(c).over ? "over" : ""}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
