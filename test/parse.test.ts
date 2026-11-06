import { describe, expect, it } from "vitest";
import { parseAbsence, extractUserId, gradeToNumber, isLoginPage, parseElections, parseFinance, parseGrades, parseProfile, parseProjectChoices, parseProjects, parseTimetable } from "../src/worker/parse";

// Synthetic fixtures that mirror the markup SIS serves (structure only, no real data).
const card = (subject: string, time: string, room: string, group: string, teacher: string, extra = "") =>
  `<a href="https://meet.google.com/abc-defg-hij" rel="noreferrer" class="hour-card ${extra}" data-debugid="1" style="top: calc(6.9%)">
    <div class="subject-name">${subject}</div><div class="time">${time}</div>
    <div class="room-name">${room}</div><div class="group-name">${group}</div><div class="teacher">${teacher}</div></a>`;

const timetable = (mondayCards: string) => `
  <div class="col col1 active"><div class="hour-lines"><div class="hour-line"><label>7:00</label></div></div>
    <div class="hour-cards"><div class="absent-card"></div>${mondayCards}
      <div class="lunch-card" style="top: calc(44.8611111111111%);height: calc(4.02777777777778%)"><div class="lunch-text">Oběd</div></div>
    </div><label>12. pondělí</label></div>
  <div class="col col2 "><div class="hour-cards">
    <div class="hour-card "><div class="subject-name">DIC</div><div class="time">8:45 - 9:30</div><div class="room-name">306</div><div class="group-name">1</div><div class="teacher">HU</div></div>
  </div><label>13. úterý</label></div>`;

describe("parseTimetable", () => {
  const actual = parseTimetable(
    timetable(card("ELZ", "7:50 - 8:35", "211", "", "HU") + card("AGJ", "9:45 - 10:30", "205", "1", "SA", "changed-card")),
    "2026-10-12",
  );

  it("reads days, dates and lessons", () => {
    expect(actual.map((d) => [d.date, d.label])).toEqual([
      ["2026-10-12", "12. pondělí"],
      ["2026-10-13", "13. úterý"],
    ]);
    expect(actual[0].lessons[0]).toMatchObject({
      subject: "ELZ", start: "7:50", end: "8:35", room: "211", teacher: "HU", changed: false,
      meet: "https://meet.google.com/abc-defg-hij",
    });
    expect(actual[0].lessons[1]).toMatchObject({ subject: "AGJ", group: "1", changed: true });
    expect(actual[1].lessons[0]).toMatchObject({ subject: "DIC", meet: null });
  });

  it("marks cancelled and added lessons", () => {
    const [day] = parseTimetable(
      timetable(
        card("CJL", "8:45 - 9:30", "202", "", "RE", "added-card") +
          `<div class="hour-card canceled-card"><div class="subject-name">CJL</div><div class="time">8:45 - 9:30</div><div class="room-name">317</div><div class="group-name">p</div><div class="teacher">RE</div></div>`,
      ),
      "2026-10-19",
    );
    expect(day.lessons.map((l) => [l.room, l.added, l.cancelled])).toEqual([
      ["202", true, false],
      ["317", false, true],
    ]);
  });

  it("derives lunch time from card position", () => {
    expect(actual[0].lunch).toEqual({ start: "12:23", end: "12:52" });
  });
});

describe("parseGrades", () => {
  const html = `<div class="classification-container">
    <div class="panel panel-default classification"><div class="panel-heading">Matematika</div>
      <table class="table"><tbody>
        <tr><th>Datum</th><th>Známka</th><th>Typ</th><th>Váha</th><th>Název</th><th>Komentář</th></tr>
        <tr><td>9.9.</td><td>3-</td><td title="Písemné zkoušení">p</td><td>5</td><td class="name">Test</td><td class="comment"></td></tr>
        <tr><td>6.10.</td><td>x</td><td title="Domácí úkol">d</td><td>2</td><td class="name">Úkol</td><td class="comment">neodevzdáno</td></tr>
        <tr><td>Dnes</td><td>3.50</td><td>!</td><td></td><td class="name">Vypočtená známka</td><td class="comment">Tato známka má pouze informativní charakter!</td></tr>
      </tbody></table></div></div>`;

  it("reads subjects, grades and the computed average", () => {
    const [s] = parseGrades(html);
    expect(s.name).toBe("Matematika");
    expect(s.average).toBe(3.5);
    expect(s.grades).toHaveLength(2);
    expect(s.grades[0]).toMatchObject({ date: "9.9.", value: "3-", numeric: 3.5, type: "p", typeName: "Písemné zkoušení", weight: 5 });
    expect(s.grades[1]).toMatchObject({ value: "x", numeric: null, comment: "neodevzdáno" });
  });
});

describe("helpers", () => {
  it("parses grade values", () => {
    expect(gradeToNumber("1")).toBe(1);
    expect(gradeToNumber("4-")).toBe(4.5);
    expect(gradeToNumber("N")).toBeNull();
  });
  it("extracts user id from page script", () => {
    expect(extractUserId(`data: { date: d, userid:12345}`)).toBe("12345");
  });
  it("detects the login page", () => {
    expect(isLoginPage(`<form action="/Account/Login"><input name="Password" type="password" />`)).toBe(true);
    expect(isLoginPage(`<div class="timetable"></div>`)).toBe(false);
  });
});

describe("parseAbsence", () => {
  const html = `<div class="absent-sumarized-table"><table class="table"><tbody>
    <tr><td></td><td>AGJ</td><td>TEV</td><td>Celkem</td></tr>
    <tr><td>Procenta</td><td>6.67%</td><td></td><td></td></tr>
    <tr><td>Počet odučených hodin</td><td>15</td><td>9</td><td>167</td></tr>
    <tr><td>Počet zameškaných hodin</td><td>1</td><td>2</td><td>3</td></tr>
    <tr><td>Počet celkem neomluvených hodin</td><td>1</td><td>2</td><td>3</td></tr>
  </tbody></table></div>
  <div class="absent-tables">
    <div class="panel panel-default year-2026 month-9"><table class="table"><tbody>
      <tr class="day day-14"><td class="hour-2 hour" title="ELZ HU"></td><td class="hour-3 hour  hour-absent" title="AGJ SA">n</td></tr>
    </tbody></table></div>
    <div class="panel panel-default year-2026 month-10"><table class="table"><tbody>
      <tr class="day day-1"><td class="hour-5 hour  hour-absent" title="TEV RO">n</td><td class="hour-6 hour  hour-absent" title="TEV RO">n</td></tr>
    </tbody></table></div>
  </div>`;

  it("reads the per-subject summary and the total", () => {
    const a = parseAbsence(html);
    expect(a.subjects).toEqual([
      { subject: "AGJ", percent: 6.7, taught: 15, missed: 1, unexcused: 1 },
      { subject: "TEV", percent: 22.2, taught: 9, missed: 2, unexcused: 2 },
    ]);
    expect(a.total).toMatchObject({ taught: 167, missed: 3, unexcused: 3, percent: 1.8 });
  });

  it("copes with <th> headers, other row wording and a missing count row", () => {
    const other = html
      .replace("<tr><td></td><td>AGJ</td><td>TEV</td><td>Celkem</td></tr>", "<tr><th></th><th>AGJ</th><th>TEV</th><th>Celkem</th></tr>")
      .replace("<td>Počet odučených hodin</td>", "<td>Odučeno hodin</td>")
      .replace(/<tr><td>Počet zameškaných hodin<\/td>.*?<\/tr>/, "");
    const a = parseAbsence(other);
    // TEV: 2 missed (counted from the grid) of 9
    expect(a.subjects.find((s) => s.subject === "TEV")).toMatchObject({ missed: 2, taught: 9, percent: 22.2 });
    expect(a.total).toMatchObject({ missed: 3, taught: 167 });
  });

  it("lists missed lessons newest first", () => {
    expect(parseAbsence(html).missed).toEqual([
      { date: "2026-10-01", period: 5, subject: "TEV", teacher: "RO", code: "n" },
      { date: "2026-10-01", period: 6, subject: "TEV", teacher: "RO", code: "n" },
      { date: "2026-09-14", period: 3, subject: "AGJ", teacher: "SA", code: "n" },
    ]);
  });
});

describe("parseProfile", () => {
  const groups = (heading: string, rows: string) =>
    `<div class="studyGroups"><table class="table"><tr><th>${heading}</th></tr>${rows}</table></div>`;
  const html = `
    <table><tr><td><label>Jméno</label></td><td>Jan</td></tr><tr><td><label>Přijmení</label></td><td>Novák</td></tr>
    <tr><td><label>Školní e-mail</label></td><td> novak.jan@example.cz </td></tr></table>
    ${groups("Rozdělení třídy", ["1", "p", "r", "r"].map((g) => `<tr><td> ${g} </td></tr>`).join(""))}
    <div class="studyGroups"><table class="table"><tr><th colspan="2">Bloky</th></tr><tr><th>Předmět</th><th>Název</th></tr>
      <tr><td>MPT</td><td>B09</td></tr></table></div>
    ${groups("Projekty", "<tr><td>P21</td></tr>")}`;

  it("reads name, e-mail, groups, blocks and projects", () => {
    expect(parseProfile(html)).toEqual({
      name: "Jan Novák",
      email: "novak.jan@example.cz",
      groups: ["1", "p", "r"],
      blocks: [{ subject: "MPT", block: "B09" }],
      projects: ["P21"],
    });
  });

  it("copes with a profile without the group tables", () => {
    expect(parseProfile("<table></table>")).toEqual({ name: null, email: null, groups: [], blocks: [], projects: [] });
  });
});

describe("project elections", () => {
  const roleRows = (rows: string[][], total: string) =>
    `<tr class="professions even"><th>Profese</th><th colspan="3">Stav</th><th rowspan="2">Celkem</th></tr>
     <tr class="professions even"><th>Volba</th><th>1</th><th>2</th><th>3</th></tr>` +
    rows.map((r, i) => `<tr class="professions even">${r.map((c) => `<td>${c}</td>`).join("")}${i === 0 ? `<td class="table-cell-center" rowspan="${rows.length}">${total}</td>` : ""}</tr>`).join("");
  const detail = `<table class="projectsTable table"><tbody>
    <tr class="even"><td class="table-cell-center projectNumber" rowspan="5">7</td><td colspan="5" class="projectName">Robot</td>
      <td class="table-cell-center" rowspan="5">HS</td>
      <td rowspan="5"><span class="company">Firma s.r.o.</span><span class="goal">Postavit robota.
  •	Arduino</span><span class="comment">Pro všechny</span></td></tr>
    ${roleRows([["vedoucí", "3/1", "0/1", "0/1"], ["programátor", "7/2", "1/2", "3/2"]], "26/6")}
    <tr class="odd"><td class="table-cell-center projectNumber" rowspan="4">8</td><td colspan="5" class="projectName">Šperky</td>
      <td class="table-cell-center" rowspan="4"></td><td rowspan="4"><span class="goal">Návrh</span></td></tr>
    ${roleRows([["šperkař", "7", "3", "0"]], "10/1")}
  </tbody></table>`;

  it("reads every project with its roles", () => {
    const [robot, jewels] = parseProjects(detail);
    expect(robot).toEqual({
      number: "7",
      name: "Robot",
      leader: "HS",
      company: "Firma s.r.o.",
      goal: "Postavit robota.\n• Arduino",
      comment: "Pro všechny",
      roles: [
        { name: "vedoucí", choices: ["3/1", "0/1", "0/1"] },
        { name: "programátor", choices: ["7/2", "1/2", "3/2"] },
      ],
      total: "26/6",
    });
    expect(jewels).toMatchObject({ number: "8", leader: "", company: "", roles: [{ name: "šperkař", choices: ["7", "3", "0"] }], total: "10/1" });
  });

  it("lists the elections newest first", () => {
    expect(parseElections(`<select id="sel1"><option value="26">5.10.2025-6.10.2025</option><option value="24">12.10.2024-15.10.2024</option></select>`)).toEqual([
      { id: "26", label: "5.10.2025-6.10.2025" },
      { id: "24", label: "12.10.2024-15.10.2024" },
    ]);
  });

  it("keeps an approved choice once", () => {
    const row = (cls: string) => `<tr class="${cls}"><td>1</td><td>21</td><td>Fontány</td><td> programátor </td></tr>`;
    expect(parseProjectChoices(row("projectApproved ") + row(" "))).toEqual([
      { order: 1, number: "21", name: "Fontány", role: "programátor", approved: true },
    ]);
  });
});

describe("parseFinance", () => {
  const html = `<div class="container"><h4>Finance doplníme v lednu.</h4>
    <div class="alert alert-info"><div><table>
      <tr><td>VS pro školné</td><td>11112222</td></tr><tr><td>VS pro fond</td><td>33334444</td></tr></table></div>
      <div style="display:table"><div>Bankovní účet je:</div><div> 123456789/0100 </div></div>
      <ul><li>Platby z banky aktuální k 19.7.2026</li></ul>
      <div>Předpis na školní rok 2025/2026 je ke stažení <a href="https://money.kyberna.cz/Report/a">zde</a>.<br />
      Předpis na školní rok 2026/2027 je ke stažení <a href="https://money.kyberna.cz/Report/b">zde</a>.</div></div></div>
    <ul class="nav nav-tabs"><li><a href="#" data-tabid="fund">Fond</a></li><li><a href="#" data-tabid="school">Školné</a></li></ul>
    <div class="tab-content finance">
      <div role="tabpanel" class="tab-pane active" id="fund"><table>
        <tr><th colspan="3">Čerpání fondu studenta</th></tr><tr><th>Datum</th><th>Text</th><th>Částka</th></tr>
        <tr><td>30.9.2025</td><td>Jídelna Obědy <span onclick="x">+</span><div style="display:none">{"Data": 1}</div></td><td>295.83 Kč</td></tr>
        <tr><th colspan="2">Celkem:</th><td>295.83 Kč</td></tr><tr></tr>
        <tr><th colspan="3">Platby do fondu studenta</th></tr><tr><th>Datum</th><th>Text</th><th>Částka</th></tr>
        <tr><td>29.4.2026</td><td>Platba</td><td>7000 Kč</td></tr>
        <tr><th colspan="2">Celkem:</th><td>7000 Kč</td></tr>
        <tr><th colspan="3">Na fondu máte přeplatek 6704.17 Kč.</th></tr></table></div>
      <div role="tabpanel" class="tab-pane" id="school"><table>
        <tr><th colspan="3">Předpis školného pro studenta</th></tr><tr><th>Datum</th><th>Text</th><th>Částka</th></tr>
        <tr><td>15.8.2025</td><td>Školné 1.pol 25/26</td><td>55267 Kč</td></tr>
        <tr><th colspan="2">Celkem:</th><td>55267 Kč</td></tr>
        <tr><th colspan="3">Na školném máte nedoplatek 55267 Kč.</th></tr></table></div>
    </div>`;

  it("reads both accounts with their rows, totals and balance", () => {
    const f = parseFinance(html);
    expect(f.accounts.map((a) => [a.id, a.title, a.balance?.kind, a.balance?.amount])).toEqual([
      ["fund", "Fond", "overpaid", 6704.17],
      ["school", "Školné", "underpaid", 55267],
    ]);
    expect(f.accounts[0].sections).toEqual([
      { title: "Čerpání fondu studenta", rows: [{ date: "2025-09-30", text: "Jídelna Obědy", amount: 295.83 }], total: 295.83 },
      { title: "Platby do fondu studenta", rows: [{ date: "2026-04-29", text: "Platba", amount: 7000 }], total: 7000 },
    ]);
  });

  it("reads the payment details and documents", () => {
    const f = parseFinance(html);
    expect(f.symbols).toEqual([
      { label: "VS pro školné", value: "11112222" },
      { label: "VS pro fond", value: "33334444" },
    ]);
    expect(f.bankAccount).toBe("123456789/0100");
    expect(f.documents).toEqual([
      { label: "Předpis 2025/2026", url: "https://money.kyberna.cz/Report/a" },
      { label: "Předpis 2026/2027", url: "https://money.kyberna.cz/Report/b" },
    ]);
    expect(f.notice).toBe("Finance doplníme v lednu.");
    expect(f.paymentsAsOf).toBe("2026-07-19");
  });
});
