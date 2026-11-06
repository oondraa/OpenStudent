import { describe, expect, it } from "vitest";
import type { Cell } from "../src/shared/schoolOcr";
import { allRooms, blocksAt, freeRooms } from "../src/web/freeRooms";

const cell = (period: number, room: string, subject = "MAT"): Cell => ({ cls: "T2", period, slot: 0, subject, teacher: "XY", room, changed: false });

describe("free rooms", () => {
  const mon = [cell(1, "202"), cell(1, "P0", "TEV"), cell(2, "306"), cell(4, "202"), cell(3, "", "B06")];
  const tue = [cell(1, "B13"), cell(2, "1011")];

  it("lists every classroom of the week, gyms left out, in natural order", () => {
    expect(allRooms([mon, tue])).toEqual(["202", "306", "1011", "B13"]);
  });

  it("subtracts the rooms taken in the period and says until when the rest stay free", () => {
    const rooms = allRooms([mon, tue]);
    expect(freeRooms(rooms, mon, 1)).toEqual([
      { room: "306", until: 2 },
      { room: "1011", until: null },
      { room: "B13", until: null },
    ]);
    expect(freeRooms(rooms, mon, 2).find((r) => r.room === "202")).toEqual({ room: "202", until: 4 });
  });

  it("flags elective blocks, whose rooms the image doesn't show", () => {
    expect(blocksAt(mon, 3)).toEqual(["B06"]);
    expect(blocksAt(mon, 1)).toEqual([]);
  });
});
