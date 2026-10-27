import type { QuarterlyTaskAvailability } from "./types";

export interface TaskWriteState {
  canWrite: boolean;
  reason: string | null;
  opensAt?: string | null;
  millisecondsUntilOpen?: number | null;
  dueAt: string | null;
  millisecondsUntilDue: number | null;
}

export interface AvailabilityClock {
  read(): TaskWriteState;
}

export const TASK_AVAILABILITY_MESSAGES = {
  refresh: "当前任务状态尚未更新，请刷新页面后再试。",
  invalidTime: "季度截止时间配置无效，暂不能填写，请联系管理员。",
  invalidOpensAt: "季度开放时间配置无效，暂不能填写，请联系管理员。",
  expired: "季度填写截止时间已到，不能再填写。",
} as const;

export const TASK_AVAILABILITY_MAX_AGE_MS = 60_000;

/** Parse a real calendar date with an explicit timezone, never the device timezone. */
export function parseQuarterlyTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value.trim());
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, zone, sign, zoneHour, zoneMinute] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return null;
  const offsetHour = Number(zoneHour ?? 0);
  const offsetMinute = Number(zoneMinute ?? 0);
  if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, Number((fraction ?? "").padEnd(3, "0")));
  const offset = zone === "Z" ? 0 : (sign === "+" ? 1 : -1) * (offsetHour * 60 + offsetMinute) * 60_000;
  return date.getTime() - offset;
}

export function createAvailabilityClock(
  availability: QuarterlyTaskAvailability | undefined,
  monotonicNow: () => number = () => (typeof performance === "undefined" ? Number.NaN : performance.now()),
): AvailabilityClock {
  if (!availability) {
    return { read: () => ({ canWrite: false, reason: TASK_AVAILABILITY_MESSAGES.refresh, dueAt: null, millisecondsUntilDue: null }) };
  }

  availability = { ...availability };
  const serverTimestamp = parseQuarterlyTimestamp(availability.serverNow);
  const opensTimestamp = availability.opensAt == null ? null : parseQuarterlyTimestamp(availability.opensAt);
  const dueTimestamp = availability.dueAt === null ? null : parseQuarterlyTimestamp(availability.dueAt);
  if (serverTimestamp === null
    || (availability.opensAt != null && opensTimestamp === null)
    || (availability.dueAt !== null && dueTimestamp === null)) {
    const reason = availability.opensAt != null && opensTimestamp === null
      ? TASK_AVAILABILITY_MESSAGES.invalidOpensAt
      : TASK_AVAILABILITY_MESSAGES.invalidTime;
    return { read: () => ({ canWrite: false, reason, opensAt: null, dueAt: availability.dueAt, millisecondsUntilDue: null }) };
  }

  const monotonicStartedAt = monotonicNow();
  let elapsed = 0;
  let invalidClock = !Number.isFinite(monotonicStartedAt);
  return {
    read: () => {
      const current = monotonicNow();
      invalidClock ||= !Number.isFinite(current) || current < monotonicStartedAt + elapsed;
      if (invalidClock) return { canWrite: false, reason: TASK_AVAILABILITY_MESSAGES.refresh, dueAt: availability.dueAt, millisecondsUntilDue: null };
      elapsed = Math.max(elapsed, current - monotonicStartedAt);
      const serverAlignedNow = serverTimestamp + elapsed;
      const millisecondsUntilOpen = opensTimestamp === null ? null : opensTimestamp - serverAlignedNow;
      if (!availability.canWrite) {
        const dueIsPast = dueTimestamp !== null && serverAlignedNow >= dueTimestamp;
        if (millisecondsUntilOpen === null || millisecondsUntilOpen > 0) {
          return {
            canWrite: false,
            reason: availability.reason?.trim() || TASK_AVAILABILITY_MESSAGES.refresh,
            opensAt: availability.opensAt ?? null,
            dueAt: availability.dueAt,
            millisecondsUntilOpen,
            millisecondsUntilDue: dueTimestamp === null ? null : Math.max(0, dueTimestamp - serverAlignedNow),
          };
        }
        if (dueIsPast) {
          return { canWrite: false, reason: TASK_AVAILABILITY_MESSAGES.expired, opensAt: null, dueAt: availability.dueAt, millisecondsUntilOpen: 0, millisecondsUntilDue: 0 };
        }
        if (elapsed >= TASK_AVAILABILITY_MAX_AGE_MS) {
          return { canWrite: false, reason: TASK_AVAILABILITY_MESSAGES.refresh, opensAt: null, dueAt: availability.dueAt, millisecondsUntilOpen: 0, millisecondsUntilDue: dueTimestamp === null ? null : dueTimestamp - serverAlignedNow };
        }
        return { canWrite: true, reason: null, opensAt: null, dueAt: availability.dueAt, millisecondsUntilOpen: 0, millisecondsUntilDue: dueTimestamp === null ? null : dueTimestamp - serverAlignedNow };
      }
      const remaining = dueTimestamp === null ? null : dueTimestamp - serverAlignedNow;
      if (remaining !== null && remaining <= 0) {
        return { canWrite: false, reason: TASK_AVAILABILITY_MESSAGES.expired, dueAt: availability.dueAt, millisecondsUntilDue: 0 };
      }
      if (elapsed >= TASK_AVAILABILITY_MAX_AGE_MS) {
        return { canWrite: false, reason: TASK_AVAILABILITY_MESSAGES.refresh, dueAt: availability.dueAt, millisecondsUntilDue: remaining };
      }
      return { canWrite: true, reason: null, dueAt: availability.dueAt, millisecondsUntilDue: remaining };
    },
  };
}
