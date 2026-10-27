import type { CourseStatus, EmployeeStatus, ExpiryStatus } from "../types";
import { getCourseStatusLabel, getEmployeeStatusLabel, getExpiryStatusLabel } from "../utils/labels";

interface StatusBadgeProps {
  kind: "employee" | "expiry" | "course";
  value: EmployeeStatus | ExpiryStatus | CourseStatus;
}

export function StatusBadge({ kind, value }: StatusBadgeProps) {
  const label =
    kind === "employee"
      ? getEmployeeStatusLabel(value as EmployeeStatus)
      : kind === "expiry"
        ? getExpiryStatusLabel(value as ExpiryStatus)
        : getCourseStatusLabel(value as CourseStatus);
  return <span className={`status-badge status-${String(value)}`}>{label}</span>;
}
