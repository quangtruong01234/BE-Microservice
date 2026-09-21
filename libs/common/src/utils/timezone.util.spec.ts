import {
  VN_UTC_OFFSET_MINUTES,
  endOfVnDay,
  formatVnTimestamp,
  startOfVnDay,
  startOfVnDayBefore,
  toVnCalendarDay,
  vnWallClockShiftMinutes,
} from "./timezone.util";

/**
 * EXPORT-TZ-01 — the point of these helpers is that they do NOT depend on the
 * TZ of the process running them, so every assertion here is written to hold
 * on a UTC+7 dev machine and a UTC prod box alike: inputs are absolute
 * instants (explicit `Z`/`+07:00`) and outputs are VN wall-clock.
 *
 * Writing them any other way is what hid the original bug — the export had
 * tests, and they all passed on a machine in Vietnam.
 */
describe("timezone.util (EXPORT-TZ-01)", () => {
  describe("formatVnTimestamp", () => {
    it("renders an instant in VN wall-clock, not the server's", () => {
      // 10:00 UTC is 17:00 in Vietnam. A UTC server used to write "10:00:00".
      expect(formatVnTimestamp(new Date("2026-09-01T10:00:00Z"))).toBe(
        "2026-09-01 17:00:00",
      );
    });

    it("rolls the DATE forward for an instant late in the UTC day", () => {
      // The case that turns a wrong hour into a wrong day: 18:30 UTC on the
      // 19th is already 01:30 on the 20th in Vietnam.
      expect(formatVnTimestamp(new Date("2026-09-19T18:30:00Z"))).toBe(
        "2026-09-20 01:30:00",
      );
    });

    it("accepts the ISO string form TypeORM hands back over TCP", () => {
      expect(formatVnTimestamp("2026-09-01T10:00:00.000Z")).toBe(
        "2026-09-01 17:00:00",
      );
    });

    it("pads every part to a fixed width so the column sorts as text", () => {
      expect(formatVnTimestamp(new Date("2026-01-02T00:04:05Z"))).toBe(
        "2026-01-02 07:04:05",
      );
    });

    it("renders null/invalid as an empty cell", () => {
      expect(formatVnTimestamp(null)).toBe("");
      expect(formatVnTimestamp("not-a-date")).toBe("");
    });
  });

  describe("startOfVnDay / endOfVnDay", () => {
    it("snaps a calendar day to the VN midnight boundary, not UTC midnight", () => {
      // This single pair is the dropped-rows bug: the old code produced
      // 2026-09-01T00:00:00Z, which is 07:00 in Vietnam, so every order placed
      // in the first seven hours of the seller's day fell outside the window.
      expect(startOfVnDay("2026-09-01")?.toISOString()).toBe(
        "2026-08-31T17:00:00.000Z",
      );
      expect(endOfVnDay("2026-09-19")?.toISOString()).toBe(
        "2026-09-19T16:59:59.999Z",
      );
    });

    it("keeps the end bound inclusive to the millisecond", () => {
      const end = endOfVnDay("2026-09-19") as Date;
      const nextStart = startOfVnDay("2026-09-20") as Date;
      expect(nextStart.getTime() - end.getTime()).toBe(1);
    });

    it("resolves a full ISO instant to the VN day it actually lands on", () => {
      // 17:30Z on the 1st is 00:30 on the 2nd in Vietnam — the bound must
      // follow the seller's calendar, not the UTC one.
      expect(startOfVnDay("2026-09-01T17:30:00Z")?.toISOString()).toBe(
        "2026-09-01T17:00:00.000Z",
      );
    });

    it("returns null on an unparseable value so the caller owns the 400", () => {
      expect(startOfVnDay("2026-13-45")).toBeNull();
      expect(endOfVnDay("rubbish")).toBeNull();
    });
  });

  describe("toVnCalendarDay", () => {
    it("reports the VN day, which can be tomorrow in UTC terms", () => {
      expect(toVnCalendarDay(new Date("2026-09-19T17:00:00Z"))).toBe(
        "2026-09-20",
      );
      expect(toVnCalendarDay(new Date("2026-09-19T16:59:59Z"))).toBe(
        "2026-09-19",
      );
    });
  });

  describe("startOfVnDayBefore", () => {
    it("counts back whole days and lands on a VN midnight", () => {
      const from = startOfVnDayBefore(new Date("2026-09-19T10:00:00Z"), 30);
      expect(from.toISOString()).toBe("2026-08-19T17:00:00.000Z");
    });
  });

  describe("vnWallClockShiftMinutes", () => {
    it("is the gap between the stored wall-clock and VN wall-clock", () => {
      // The invariant the SQL bucket relies on, asserted without pinning the
      // process TZ: take the wall-clock MySQL would have STORED for an instant
      // (the driver writes process-local time), add the shift, and the result
      // must be the VN wall-clock for that same instant.
      const instant = new Date("2026-09-19T18:30:00Z");
      const storedWallClockMs = Date.UTC(
        instant.getFullYear(),
        instant.getMonth(),
        instant.getDate(),
        instant.getHours(),
        instant.getMinutes(),
        instant.getSeconds(),
      );
      const shifted = new Date(
        storedWallClockMs + vnWallClockShiftMinutes(instant) * 60_000,
      );
      const vnWallClock = new Date(
        instant.getTime() + VN_UTC_OFFSET_MINUTES * 60_000,
      );
      expect(shifted.toISOString()).toBe(vnWallClock.toISOString());
    });

    it("is zero when the process already runs in VN time", () => {
      // Guards the `vnShiftMinutes === 0` branch that keeps the SQL untouched
      // on a dev box — an accidental non-zero there would double-shift.
      const offsetMinutes = -new Date().getTimezoneOffset();
      const expected = offsetMinutes === VN_UTC_OFFSET_MINUTES ? 0 : undefined;
      if (expected !== undefined) {
        expect(vnWallClockShiftMinutes(new Date())).toBe(0);
      } else {
        expect(vnWallClockShiftMinutes(new Date())).toBe(
          VN_UTC_OFFSET_MINUTES - offsetMinutes,
        );
      }
    });
  });
});
