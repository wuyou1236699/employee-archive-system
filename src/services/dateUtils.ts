import type { ExpiryStatus } from "../types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateOnly(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && formatDateOnly(parsed) === value;
}

export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

export function getDaysToExpire(endDate: string, today = new Date()): number | null {
  if (!isValidDateOnly(endDate)) {
    return null;
  }

  const end = new Date(`${endDate}T00:00:00`);
  const start = new Date(`${formatDateOnly(today)}T00:00:00`);
  return Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
}

export function getExpiryStatus(endDate: string, today = new Date()): ExpiryStatus {
  const days = getDaysToExpire(endDate, today);
  if (days === null) {
    return "missing";
  }
  if (days < 0) {
    return "expired";
  }
  if (days <= 30) {
    return "soon";
  }
  return "normal";
}

export function getExpiryLabel(status: ExpiryStatus, endDate: string, today = new Date()): string {
  const days = getDaysToExpire(endDate, today);
  if (status === "missing") {
    return "日期缺失";
  }
  if (status === "expired") {
    return `已到期 ${Math.abs(days ?? 0)} 天`;
  }
  if (status === "soon") {
    return `${days ?? 0} 天内到期`;
  }
  return "有效期正常";
}

export function getYearsOfService(hireDate: string, today = new Date()): string {
  if (!isValidDateOnly(hireDate)) {
    return "未填写";
  }

  const start = new Date(`${hireDate}T00:00:00`);
  let years = today.getFullYear() - start.getFullYear();
  const anniversary = new Date(today.getFullYear(), start.getMonth(), start.getDate());
  if (anniversary > today) {
    years -= 1;
  }
  const months = (today.getFullYear() - start.getFullYear()) * 12 + today.getMonth() - start.getMonth();
  const completedMonths = Math.max(0, months - (today.getDate() < start.getDate() ? 1 : 0)) % 12;
  return `${Math.max(0, years)} 年 ${completedMonths} 个月`;
}

export function formatDisplayDate(value: string): string {
  if (!value) {
    return "未填写";
  }
  return value.replace(/-/g, ".");
}
