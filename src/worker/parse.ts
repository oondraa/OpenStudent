import { parse, type HTMLElement } from "node-html-parser";

// Personal timetable is laid out on a 7:00–19:00 axis; card positions are percentages of it.
const DAY_START_MIN = 7 * 60;
const DAY_SPAN_MIN = 12 * 60;

export interface Lesson {
  id: string | null;
  subject: string;
  start: string;
  end: string;
  room: string;
  group: string;
  teacher: string;
  changed: boolean;
  /** Struck out in SIS (`canceled-card`): stays in the list, but isn't taught. */
  cancelled: boolean;
  /** Put in on top of the timetable (`added-card`), often in place of a cancelled one. */
  added: boolean;
  meet: string | null;
}

export interface Day {
  date: string;
  label: string;
  lessons: Lesson[];
  lunch: { start: string; end: string } | null;
}

export interface Grade {
  date: string;
  value: string;
  numeric: number | null;
  type: string;
  typeName: string;
  weight: number | null;
  name: string;
  comment: string;
}

export interface Subject {
  name: string;
  average: number | null;
  grades: Grade[];
}

const text = (el: HTMLElement | null) => el?.text.replace(/\s+/g, " ").trim() ?? "";

const fmt = (min: number) =>
  `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")}`;

function percent(style: string, prop: string): number | null {
  const m = style.match(new RegExp(`${prop}:\\s*calc\\(([\\d.]+)%`));
  return m ? parseFloat(m[1]) : null;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Parses the `/TimeTable/PersonalNew/?partial=true` fragment. `weekStart` is the Monday (YYYY-MM-DD). */
export function parseTimetable(html: string, weekStart: string): Day[] {
  const root = parse(html);
  const days: Day[] = [];
  for (let i = 1; i <= 5; i++) {
    const col = root.querySelector(`.col${i}`);
    if (!col) continue;
    const lessons = col.querySelectorAll(".hour-card").map((card): Lesson => {
      const [start = "", end = ""] = text(card.querySelector(".time")).split("-").map((s) => s.trim());
      const href = card.getAttribute("href") ?? "";
      return {
        id: card.getAttribute("data-debugid") ?? null,
        subject: text(card.querySelector(".subject-name")),
        start,
        end,
        room: text(card.querySelector(".room-name")),
        group: text(card.querySelector(".group-name")),
        teacher: text(card.querySelector(".teacher")),
        changed: card.classList.contains("changed-card"),
        cancelled: card.classList.contains("canceled-card"),
        added: card.classList.contains("added-card"),
        meet: href.startsWith("https://meet.google.com/") ? href : null,
      };
    });
    const lunchEl = col.querySelector(".lunch-card");
    let lunch: Day["lunch"] = null;
    if (lunchEl) {
      const style = lunchEl.getAttribute("style") ?? "";
      const top = percent(style, "top");
      const height = percent(style, "height");
      if (top !== null && height !== null) {
        const s = DAY_START_MIN + (top / 100) * DAY_SPAN_MIN;
        lunch = { start: fmt(s), end: fmt(s + (height / 100) * DAY_SPAN_MIN) };
      }
    }
    // Hour-line markers are <label>s too; the day caption is the one like "12. pondělí".
    const label = col.querySelectorAll("label").map(text).find((t) => /^\d+\.\s/.test(t)) ?? "";
    days.push({ date: addDays(weekStart, i - 1), label, lessons, lunch });
  }
  return days;
}

export function extractUserId(html: string): string | null {
  return html.match(/userid:\s*(\d+)/)?.[1] ?? null;
}

export function gradeToNumber(value: string): number | null {
  const m = value.trim().match(/^([1-5])(-)?$/);
  if (!m) return null;
  return parseInt(m[1]) + (m[2] ? 0.5 : 0);
}

/** Parses `/Classification/Student`. */
export function parseGrades(html: string): Subject[] {
  const root = parse(html);
  return root.querySelectorAll(".panel.classification").map((panel): Subject => {
    let average: number | null = null;
    const grades: Grade[] = [];
    for (const tr of panel.querySelectorAll("tr")) {
      const tds = tr.querySelectorAll("td");
      if (tds.length < 5) continue; // header row
      const [date, value, type, weight] = tds.map(text);
      const name = text(tr.querySelector("td.name"));
      if (type === "!") {
        const n = parseFloat(value.replace(",", "."));
        average = Number.isFinite(n) ? n : null;
        continue;
      }
      grades.push({
        date,
        value,
        numeric: gradeToNumber(value),
        type,
        typeName: tds[2].getAttribute("title") ?? "",
        weight: weight ? parseInt(weight) : null,
        name,
        comment: text(tr.querySelector("td.comment")),
      });
    }
    return { name: text(panel.querySelector(".panel-heading")), average, grades };
  });
}

export interface AbsenceSubject {
  subject: string;
  /** Share of taught lessons missed, in %. */
  percent: number;
  taught: number;
  missed: number;
  unexcused: number;
}

export interface MissedLesson {
  date: string; // YYYY-MM-DD
  period: number;
  subject: string;
  teacher: string;
  /** SIS cell mark, e.g. "n". */
  code: string;
}

export interface Absence {
  subjects: AbsenceSubject[];
  total: AbsenceSubject | null;
  missed: MissedLesson[];
}

/** SIS id the absence page loads its summary with (`POST /Absent/SumarizedData { StudentID }`). */
export function absenceStudentId(html: string): string | null {
  return html.match(/StudentID:\s*(\d+)/)?.[1] ?? null;
}

/**
 * Parses `/Absent/My` (the month grids, day × period) and the per-subject summary table. The page itself ships
 * the summary empty and fills it with `POST /Absent/SumarizedData`, so that response is passed as `summaryHtml`.
 */
export function parseAbsence(html: string, summaryHtml = html): Absence {
  const root = parse(html);

  const lessons: MissedLesson[] = [];
  for (const panel of root.querySelectorAll(".absent-tables .panel")) {
    const year = panel.classList.value.find((c) => c.startsWith("year-"))?.slice(5);
    const month = panel.classList.value.find((c) => c.startsWith("month-"))?.slice(6);
    if (!year || !month) continue;
    for (const tr of panel.querySelectorAll("tr.day")) {
      const day = tr.classList.value.find((c) => /^day-\d+$/.test(c))?.slice(4);
      if (!day) continue;
      for (const td of tr.querySelectorAll("td.hour-absent")) {
        const period = Number(td.classList.value.find((c) => /^hour-\d+$/.test(c))?.slice(5));
        const [subject = "", teacher = ""] = (td.getAttribute("title") ?? "").trim().split(/\s+/);
        lessons.push({
          date: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
          period,
          subject,
          teacher,
          code: text(td),
        });
      }
    }
  }
  lessons.sort((a, b) => b.date.localeCompare(a.date) || a.period - b.period);

  // Summary table: a header row of subjects, then one row per measure ("Počet zameškaných hodin", …). Rows are
  // found by a keyword of their label (no diacritics, any case), in case the wording shifts; headers may be <th>.
  const rows = parse(summaryHtml).querySelectorAll("tr").map((tr) => tr.querySelectorAll("td, th").map(text));
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const row = (keyword: string) => rows.find((r) => norm(r[0] ?? "").includes(keyword)) ?? [];
  const num = (s: string | undefined) => {
    const n = parseFloat((s ?? "").replace("%", "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  const header = rows.find((r) => r.includes("Celkem")) ?? rows[0] ?? [];
  const taught = row("oducen");
  const missed = row("zamesk");
  const unexcused = row("neomluv");
  const sisPercent = row("procent");
  // Missed lessons straight from the month grids, as a fallback when the summary has no such row.
  const counted = new Map<string, number>();
  for (const l of lessons) counted.set(l.subject, (counted.get(l.subject) ?? 0) + 1);
  const all = header.slice(1).map((subject, i) => {
    const t = num(taught[i + 1]);
    const m = missed.length ? num(missed[i + 1]) : subject === "Celkem" ? lessons.length : (counted.get(subject) ?? 0);
    // Computed rather than read: SIS leaves its "Procenta" cell empty for some subjects.
    const percent = t ? Math.round((m / t) * 1000) / 10 : num(sisPercent[i + 1]);
    return { subject, percent, taught: t, missed: m, unexcused: num(unexcused[i + 1]) };
  });
  const total = all.find((s) => s.subject === "Celkem") ?? null;
  return { subjects: all.filter((s) => s.subject !== "Celkem"), total, missed: lessons };
}

export interface Profile {
  name: string | null;
  email: string | null;
  groups: string[];
  blocks: { subject: string; block: string }[];
  projects: string[];
}

/** Parses `/Account/UserProfile`: name, school e-mail, and the "Seznam skupin" tables (class groups, blocks, projects). */
export function parseProfile(html: string): Profile {
  const root = parse(html);
  const field = (label: string) =>
    text(root.querySelectorAll("tr").find((tr) => text(tr.querySelector("label")) === label)?.querySelectorAll("td")[1] ?? null);
  const name = [field("Jméno"), field("Přijmení") || field("Příjmení")].filter(Boolean).join(" ");
  const email = field("Školní e-mail");
  const table = (heading: string) =>
    root.querySelectorAll(".studyGroups table").find((t) => text(t.querySelector("th")).startsWith(heading));
  const rows = (heading: string) => (table(heading)?.querySelectorAll("tr") ?? []).map((tr) => tr.querySelectorAll("td").map(text)).filter((r) => r.length && r[0]);
  return {
    name: name || null,
    email: /^[^@\s]+@[^@\s]+$/.test(email) ? email : null,
    groups: [...new Set(rows("Rozdělení").map((r) => r[0]))],
    blocks: rows("Bloky").filter((r) => r[1]).map(([subject, block]) => ({ subject, block })),
    projects: [...new Set(rows("Projekty").map((r) => r[0]))],
  };
}

export interface ProjectRole {
  name: string;
  /** "zapsaní/míst" (or just "zapsaní" when SIS has no limit) for 1st, 2nd and 3rd choice */
  choices: string[];
}

export interface Project {
  number: string;
  name: string;
  /** teacher's code, e.g. "LN" */
  leader: string;
  company: string;
  goal: string;
  comment: string;
  roles: ProjectRole[];
  /** "zapsaní/míst" over all roles */
  total: string;
}

export interface ProjectChoice {
  order: number;
  number: string;
  name: string;
  role: string;
  approved: boolean;
}

/** `/Election/Project`: the project elections, newest first ("5.10.2025-6.10.2025"). */
export function parseElections(html: string): { id: string; label: string }[] {
  return parse(html)
    .querySelectorAll("#sel1 option")
    .map((o) => ({ id: o.getAttribute("value") ?? "", label: text(o) }))
    .filter((e) => /^\d+$/.test(e.id));
}

/** `POST /Election/ProjectDetail`: every project of one election with its roles and how full they are. */
export function parseProjects(html: string): Project[] {
  const out: Project[] = [];
  for (const tr of parse(html).querySelectorAll(".projectsTable tbody tr")) {
    const number = tr.querySelector(".projectNumber");
    if (number) {
      const tds = tr.querySelectorAll("td");
      out.push({
        number: text(number),
        name: text(tr.querySelector(".projectName")),
        leader: text(tds[2] ?? null),
        company: text(tr.querySelector(".company")),
        goal: (tr.querySelector(".goal")?.text ?? "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim(),
        comment: text(tr.querySelector(".comment")),
        roles: [],
        total: "",
      });
      continue;
    }
    const project = out[out.length - 1];
    const tds = tr.querySelectorAll("td").map(text);
    if (!project || !tr.classList.contains("professions") || tds.length < 4) continue;
    project.roles.push({ name: tds[0], choices: tds.slice(1, 4) });
    if (tds[4]) project.total = tds[4];
  }
  return out;
}

/** `POST /Election/ProjectElected`: the student's own choices; SIS lists an approved one twice, keep it once. */
export function parseProjectChoices(html: string): ProjectChoice[] {
  const rows = parse(`<table><tbody>${html}</tbody></table>`).querySelectorAll("tr");
  const out: ProjectChoice[] = [];
  for (const tr of rows) {
    const tds = tr.querySelectorAll("td").map(text);
    if (tds.length < 4 || !tds[1]) continue;
    const choice = { order: Number(tds[0]) || out.length + 1, number: tds[1], name: tds[2], role: tds[3], approved: tr.classList.contains("projectApproved") };
    const same = out.find((c) => c.number === choice.number && c.role === choice.role);
    if (same) same.approved ||= choice.approved;
    else out.push(choice);
  }
  return out;
}

export interface FinanceRow {
  date: string; // YYYY-MM-DD
  text: string;
  amount: number; // Kč
}

export interface FinanceAccount {
  id: string; // "fund", "school", …
  title: string; // "Fond", "Školné"
  /** e.g. "Čerpání fondu studenta" (charges) and "Platby do fondu studenta" (payments) */
  sections: { title: string; rows: FinanceRow[]; total: number | null }[];
  /** SIS's own verdict, e.g. overpaid 1341.33 ("Na fondu máte přeplatek 1341.331 Kč.") */
  balance: { kind: "overpaid" | "underpaid" | "even"; amount: number; text: string } | null;
}

export interface Finance {
  accounts: FinanceAccount[];
  /** variable symbols per account, e.g. { label: "VS pro školné", value: "13254709" } */
  symbols: { label: string; value: string }[];
  bankAccount: string | null;
  /** fee schedules (PDF on money.kyberna.cz) */
  documents: { label: string; url: string }[];
  /** the notice SIS shows above (data recovery etc.) */
  notice: string | null;
  /** how far SIS has loaded the bank payments ("Platby z banky aktuální k 19.7.2026"), YYYY-MM-DD */
  paymentsAsOf: string | null;
}

const czMoney = (s: string) => {
  const n = Number(s.replace(/\s|Kč/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const czDate = (s: string) => {
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};

/** Parses `/Finance/Info`: per account (fund, tuition, …) the charges, the payments and SIS's balance. */
export function parseFinance(html: string): Finance {
  const root = parse(html);
  const titles = new Map(root.querySelectorAll(".nav-tabs a[data-tabid]").map((a) => [a.getAttribute("data-tabid") ?? "", text(a)]));
  const accounts = root.querySelectorAll(".tab-content.finance .tab-pane").map((pane): FinanceAccount => {
    const sections: FinanceAccount["sections"] = [];
    let balance: FinanceAccount["balance"] = null;
    for (const tr of pane.querySelectorAll("tr")) {
      const ths = tr.querySelectorAll("th");
      const tds = tr.querySelectorAll("td");
      if (ths.length === 1 && !tds.length) {
        const t = text(ths[0]);
        const verdict = t.match(/(přeplatek|nedoplatek)\s+([\d\s.,]+)\s*Kč/i);
        if (verdict) balance = { kind: verdict[1].toLowerCase() === "přeplatek" ? "overpaid" : "underpaid", amount: Math.round((czMoney(verdict[2]) ?? 0) * 100) / 100, text: t };
        else if (/vyrovn/i.test(t)) balance = { kind: "even", amount: 0, text: t };
        else sections.push({ title: t, rows: [], total: null });
        continue;
      }
      const section = sections[sections.length - 1];
      if (!section || !tds.length) continue;
      if (/^celkem/i.test(text(ths[0] ?? null))) {
        section.total = czMoney(text(tds[tds.length - 1]));
        continue;
      }
      tds.forEach((td) => td.querySelectorAll("div, span").forEach((el) => el.remove())); // the hidden JSON detail
      const cells = tds.map(text);
      const date = czDate(cells[0]);
      const amount = czMoney(cells[2] ?? "");
      if (date && amount !== null) section.rows.push({ date, text: cells[1] ?? "", amount });
    }
    const id = pane.getAttribute("id") ?? "";
    return { id, title: titles.get(id) ?? id, sections, balance };
  });
  const info = root.querySelector(".alert-info");
  const symbols = (info?.querySelectorAll("table tr") ?? [])
    .map((tr) => tr.querySelectorAll("td").map(text))
    .filter((r) => r.length === 2 && /^\d+$/.test(r[1]))
    .map(([label, value]) => ({ label, value }));
  const bankAccount = info?.text.match(/účet je:\s*((?:\d{1,6}-)?\d{2,10}\/\d{4})/)?.[1] ?? null;
  // One sentence per school year, each with its link ("Předpis na školní rok 2025/2026 je ke stažení zde").
  const years = [...(info?.text.matchAll(/Předpis na školní rok (\d{4}\/\d{4})/g) ?? [])].map((m) => `Předpis ${m[1]}`);
  const documents = (info?.querySelectorAll("a[href^='https://money.kyberna.cz/']") ?? []).map((a, i) => ({
    label: years[i] ?? "Předpis",
    url: a.getAttribute("href") ?? "",
  }));
  return {
    accounts,
    symbols,
    bankAccount,
    documents,
    notice: text(root.querySelector(".container h4")) || null,
    paymentsAsOf: czDate(info?.text.match(/Platby z banky aktuální k\s*(\d{1,2}\.\d{1,2}\.\d{4})/)?.[1] ?? ""),
  };
}

export function isLoginPage(html: string): boolean {
  return /name="Password"/.test(html) && /action="\/Account\/Login"/.test(html);
}
