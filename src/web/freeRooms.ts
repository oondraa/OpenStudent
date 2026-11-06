import type { Cell } from "../shared/schoolOcr";

/** The sports hall and the weight room (that one has its own screen): nobody goes there to sit and study. */
const NOT_CLASSROOMS = new Set(["T0", "P0"]);

/** Elective blocks (B06): the school image names the block, not the rooms its groups are spread over. */
export const isBlock = (c: Cell) => !c.room && /^B\d+$/.test(c.subject);

/** Every classroom the school timetable uses on any of these days. */
export function allRooms(days: Cell[][]): string[] {
  const rooms = new Set(days.flat().map((c) => c.room).filter((r) => r && !NOT_CLASSROOMS.has(r)));
  return [...rooms].sort((a, b) => a.localeCompare(b, "cs", { numeric: true }));
}

export interface FreeRoom {
  room: string;
  /** Period in which a lesson takes it, null = free for the rest of the day. */
  until: number | null;
}

/** All rooms minus the ones taken in `period`, each with how long it stays free. */
export function freeRooms(rooms: string[], day: Cell[], period: number): FreeRoom[] {
  const taken = (r: string, p: number) => day.some((c) => c.period === p && c.room === r);
  const later = [...new Set(day.map((c) => c.period))].filter((p) => p > period).sort((a, b) => a - b);
  return rooms.filter((r) => !taken(r, period)).map((room) => ({ room, until: later.find((p) => taken(room, p)) ?? null }));
}

/** Blocks running in `period` ("B06"), whose rooms may be taken without the image saying so. */
export const blocksAt = (day: Cell[], period: number) => [...new Set(day.filter((c) => c.period === period && isBlock(c)).map((c) => c.subject))];
