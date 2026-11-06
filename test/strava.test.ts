import { describe, expect, it } from "vitest";
import { parseMenu, parseOrders } from "../src/worker/strava";

const open = { den: "T", obj: "", zm: "", bur: "C" };
const item = (datum: string, druh: string, druh_popis: string, nazev: string, pocet: number, extra: object = {}) => ({
  datum,
  druh,
  druh_popis,
  nazev,
  pocet,
  veta: `${datum}-${druh}`,
  cena: druh === "PO" ? "0" : "49.00",
  ...extra,
});

describe("parseOrders", () => {
  it("finds the ordered meal of each day, ignoring the soup", () => {
    const days = parseOrders({
      table1: [
        item("13.10.2026", "PO", "Polévka", "Polévka z cizrny", 0),
        item("13.10.2026", "O1", "Oběd 1", "Masové tortellini", 0),
        item("13.10.2026", "O2", "Oběd 2", "Alpský  knedlík, koktejl", 1),
      ],
      table0: [item("12.10.2026", "PO", "Polévka", "Polévka", 0), item("12.10.2026", "O1", "Oběd 1", "Rizoto", 0)],
    });
    expect(days).toEqual([
      { date: "2026-10-12", ordered: null },
      { date: "2026-10-13", ordered: { label: "Oběd 2", number: 2, name: "Alpský knedlík, koktejl" } },
    ]);
  });
});

describe("parseMenu", () => {
  const orders = {
    table0: [
      item("15.10.2026", "PO", "Polévka", "Polévka česneková", 0, { omezeniObj: { den: "T", obj: "I", zm: "I", bur: "I" } }),
      item("15.10.2026", "O1", "Oběd 1", "Těstoviny", 0, { omezeniObj: open, casKonec: "2026-10-14T12:00:00", alergeny: [["01", "Lepek"]] }),
      item("15.10.2026", "O2", "Oběd 2", "Sekaná", 1, { omezeniObj: open, casKonec: "2026-10-14T12:00:00" }),
    ],
    table1: [
      item("14.10.2026", "O1", "Oběd 1", "Vrabec", 1, { omezeniObj: { den: "CO", obj: "C", zm: "C", bur: "" }, casKonec: "2026-10-13T12:00:00" }),
    ],
    table2: [
      item("28.10.2026", "O1", "Oběd 1", "nevaří se - Den vzniku státu", 0, { omezeniObj: { den: "VP", obj: "V", zm: "", bur: "V" } }),
    ],
  };

  it("lists the meals with price, order and allergens, and what can still change", () => {
    const [locked, open, holiday] = parseMenu(orders, "2026-10-14T10:00:00");
    expect(open).toEqual({
      date: "2026-10-15",
      soup: "Polévka česneková",
      closed: null,
      deadline: "2026-10-14T12:00:00",
      meals: [
        { veta: "15.10.2026-O1", number: 1, label: "Oběd 1", name: "Těstoviny", price: 49, ordered: false, editable: true, allergens: ["Lepek"] },
        { veta: "15.10.2026-O2", number: 2, label: "Oběd 2", name: "Sekaná", price: 49, ordered: true, editable: true, allergens: [] },
      ],
    });
    expect(locked.meals[0]).toMatchObject({ ordered: true, editable: false });
    expect(holiday).toMatchObject({ date: "2026-10-28", closed: "Den vzniku státu", meals: [] });
  });

  it("locks a day once its deadline has passed", () => {
    const [, open] = parseMenu(orders, "2026-10-14T12:00:01");
    expect(open.meals.every((m) => !m.editable)).toBe(true);
  });
});
