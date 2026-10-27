import { afterEach, describe, expect, it, vi } from "vitest";
import { createAvailabilityClock, parseQuarterlyTimestamp, TASK_AVAILABILITY_MAX_AGE_MS, TASK_AVAILABILITY_MESSAGES } from "./taskAvailability";
import type { QuarterlyTaskAvailability } from "./types";

const snapshot: QuarterlyTaskAvailability = {
  canWrite: true, reason: null, serverNow: "2026-12-31T23:59:59+08:00", dueAt: "2027-01-01T00:00:00+08:00",
};

describe("strict quarterly timestamps", () => {
  it.each(["2026-02-30T00:00:00Z", "2025-02-29T00:00:00Z", "1900-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:60:00Z", "2026-01-01T00:00:60Z", "2026-01-01T00:00:00", "2026-01-01", "2026-01-01T00:00:00+14:01", "2026-01-01T00:00:00+15:00", "2026-01-01T00:00:00+08:60", "2026-01-01T00:00:00.1234Z", "", 42, null])("rejects invalid or timezone-free value %s", (value) => {
    expect(parseQuarterlyTimestamp(value)).toBeNull();
  });
  it.each(["2000-02-29T23:59:59Z", "2024-02-29T23:59:59.1+08:00", "2026-12-31T23:59:59.12-05:30", "2026-12-31T23:59:59.123+14:00", "0099-01-01T00:00:00Z"])("accepts real explicit-zone date %s", (value) => {
    expect(parseQuarterlyTimestamp(value)).toBe(Date.parse(value));
  });
});

describe("server-aligned availability clock", () => {
  afterEach(() => vi.restoreAllMocks());
  it("expires exactly at the boundary across years without using the device date", () => {
    let tick = 100;
    const clock = createAvailabilityClock(snapshot, () => tick);
    vi.spyOn(Date, "now").mockReturnValue(0);
    tick = 1099;
    expect(clock.read()).toMatchObject({ canWrite: true, millisecondsUntilDue: 1 });
    tick = 1100;
    expect(clock.read()).toMatchObject({ canWrite: false, reason: TASK_AVAILABILITY_MESSAGES.expired, millisecondsUntilDue: 0 });
    vi.spyOn(Date, "now").mockReturnValue(9e12);
    expect(clock.read().canWrite).toBe(false);
  });
  it("denies missing legacy availability and malformed timestamps", () => {
    expect(createAvailabilityClock(undefined).read().reason).toBe(TASK_AVAILABILITY_MESSAGES.refresh);
    expect(createAvailabilityClock({ ...snapshot, dueAt: "2026-02-30T00:00:00Z" }).read().canWrite).toBe(false);
    expect(createAvailabilityClock({ ...snapshot, serverNow: "2026-01-01T00:00:00" }).read().canWrite).toBe(false);
  });
  it("keeps server denial even without a deadline and allows an open unlimited task", () => {
    expect(createAvailabilityClock({ ...snapshot, canWrite: false, reason: "该季度评价任务已撤销。", dueAt: null }).read()).toMatchObject({ canWrite: false, reason: "该季度评价任务已撤销。" });
    expect(createAvailabilityClock({ ...snapshot, dueAt: null }).read()).toMatchObject({ canWrite: true, dueAt: null, millisecondsUntilDue: null });
  });
  it("keeps a scheduled task locked before opensAt and unlocks at the exact server-aligned boundary", () => {
    let tick = 5_000;
    const scheduledAvailability: QuarterlyTaskAvailability = {
      ...snapshot,
      canWrite: false,
      reason: "季度周期当前未开放填写。",
      serverNow: "2026-12-31T23:59:59+08:00",
      opensAt: "2027-01-01T00:00:00+08:00",
      dueAt: "2027-01-01T01:00:00+08:00",
    };
    const clock = createAvailabilityClock(scheduledAvailability, () => tick);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2027-01-02T00:00:00+08:00"));

    expect(clock.read()).toMatchObject({ canWrite: false, reason: scheduledAvailability.reason, millisecondsUntilOpen: 1_000 });
    tick += 999;
    expect(clock.read()).toMatchObject({ canWrite: false, reason: scheduledAvailability.reason, millisecondsUntilOpen: 1 });
    tick += 1;
    expect(clock.read()).toMatchObject({ canWrite: true, reason: null, millisecondsUntilOpen: 0 });
  });
  it("fails closed when an otherwise writable server snapshot becomes stale, including unlimited tasks", () => {
    let tick = 100;
    const clock = createAvailabilityClock({ ...snapshot, dueAt: null }, () => tick);
    tick += TASK_AVAILABILITY_MAX_AGE_MS - 1;
    expect(clock.read().canWrite).toBe(true);
    tick += 1;
    expect(clock.read()).toMatchObject({ canWrite: false, reason: TASK_AVAILABILITY_MESSAGES.refresh, dueAt: null });
  });
  it("captures an immutable snapshot", () => {
    const mutable = { ...snapshot };
    const clock = createAvailabilityClock(mutable, () => 0);
    mutable.canWrite = false;
    expect(clock.read().canWrite).toBe(true);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])("fails closed on a broken monotonic clock (%s)", (broken) => {
    let tick = 0;
    const clock = createAvailabilityClock(snapshot, () => tick);
    tick = broken;
    expect(clock.read().canWrite).toBe(false);
    tick = 10;
    expect(clock.read().canWrite).toBe(false);
  });
});
