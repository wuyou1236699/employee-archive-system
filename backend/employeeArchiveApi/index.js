/* global require, process, console, exports */
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const crypto = require('node:crypto');

const COLLECTIONS = Object.freeze({
  employees: 'employee_employees',
  employmentContracts: 'employee_employment_contracts',
  vehicleUsages: 'employee_vehicle_usages',
  courses: 'employee_courses',
  courseRecords: 'employee_course_records',
  events: 'employee_events',
  attachments: 'employee_attachments',
  adminAccounts: 'employee_admin_accounts',
  passwordResetRateLimits: 'employee_password_reset_rate_limits',
  adminGovernance: 'employee_admin_governance',
  adminGovernanceOperations: 'employee_admin_governance_operations',
  identityClaims: 'employee_identity_claims',
  auditLogs: 'employee_audit_logs',
  monthlyAssessmentRoster: 'employee_monthly_assessment_roster',
  monthlyAssessmentTargets: 'employee_monthly_assessment_targets',
  monthlyAssessments: 'employee_monthly_assessments',
  quarterlyPeriods: 'employee_quarterly_periods',
  quarterlyTasks: 'employee_quarterly_tasks',
  quarterlyRecords: 'employee_quarterly_records',
  quarterlyPendingRelations: 'employee_quarterly_pending_relations',
});

const NOT_IMPLEMENTED_ROUTES = new Set([
  'accounts/create',
  'employees/import-excel',
  'import/excel',
]);

const ACCOUNT_ROLES = new Set(['super_admin', 'admin', 'user']);
const RECORD_TYPES = Object.freeze({ employee: 'employee', student: 'student' });
const SUPER_ADMIN_GOVERNANCE = Object.freeze({
  rosterId: 'active-super-admin-roster',
  schemaVersion: 1,
  limit: 5,
  operationPrefix: 'employee-admin-governance:v1:',
  initializationTransactionOperationLimit: 94,
});
const PREVIOUS_SUPER_ADMIN_GOVERNANCE_LIMIT = 3;
const SUPER_ADMIN_GOVERNANCE_STATES = new Set(['ready', 'over_limit', 'no_active_super_admin', 'drift']);
const GOVERNANCE_OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANAGED_PERMISSIONS = Object.freeze([
  'employee.write',
  'history.write',
  'attachment.read',
  'attachment.write',
  'audit.read',
  'monthly_assessment_edit',
  'quarterly.manage',
]);
const MANAGED_PERMISSION_SET = new Set(MANAGED_PERMISSIONS);
const PERMISSION_LABELS = Object.freeze({
  'employee.write': '员工档案维护',
  'history.write': '培训与事件记录维护',
  'attachment.read': '附件查看',
  'attachment.write': '附件上传',
  'audit.read': '操作日志查看',
  monthly_assessment_edit: '月度考核编辑',
  'quarterly.manage': '季度评价管理',
});

const MONTHLY_ASSESSMENT_METRICS = Object.freeze([
  'meeting',
  'renewalRate',
  'influence',
  'visits',
  'nineGrid',
]);
const MONTHLY_ASSESSMENT_RESULT_VALUES = Object.freeze(['achieved', 'not_achieved', 'unassessed']);
const MONTHLY_ASSESSMENT_RESULT_SET = new Set(MONTHLY_ASSESSMENT_RESULT_VALUES);
const MONTHLY_ASSESSMENT_METRIC_LABELS = Object.freeze({
  meeting: '月度参会',
  renewalRate: '月度续费率',
  influence: '月度感召',
  visits: '月度走访',
  nineGrid: '月度九宫格考核',
});
const DEFAULT_MONTHLY_ROSTER_KEY = 'default';

const QUARTERLY_DIMENSIONS = Object.freeze(['任务完成', '规范执行', '问题处理', '沟通协作', '学习成长', '服务支持']);
const QUARTERLY_REVIEW_TYPES = Object.freeze(['self', 'first', 'second']);
const QUARTERLY_TYPE_LABELS = Object.freeze({
  self: '自评',
  first: '一次评价',
  second: '二次评价',
});
const QUARTERLY_PERIOD_STATUSES = Object.freeze(['draft', 'open', 'closed', 'archived']);
const QUARTERLY_RECORD_STATUSES = Object.freeze(['draft', 'submitted', 'returned', 'void']);
const QUARTERLY_RESULT_VISIBILITIES = Object.freeze(['hidden', 'published']);
const QUARTERLY_SCORING_STANDARD_VERSION = 'showcase-standard-v1';

const EMPLOYEE_FIELDS = Object.freeze([
  'name',
  'status',
  'department',
  'onlyChildStatus',
  'personalPhone',
  'workPhone',
  'phonePlan',
  'phoneOwnership',
  'computerOwnership',
  'hireDate',
  'regularizationDate',
  'notes',
  'contract',
  'vehicle',
]);
const LEGACY_CONTRACT_DRAFT_FIELDS = Object.freeze({
  contractType: 'type',
  contractStartDate: 'startDate',
  contractEndDate: 'endDate',
  contractNotes: 'notes',
});
const LEGACY_VEHICLE_DRAFT_FIELDS = Object.freeze({
  vehicleModel: 'model',
  vehiclePlateNumber: 'plateNumber',
  vehicleStartDate: 'startDate',
  vehicleEndDate: 'endDate',
  vehicleNotes: 'notes',
});

const PHONE_FIELDS = new Set(['personalPhone', 'workPhone']);
const EMPLOYMENT_DATE_LABELS = Object.freeze({
  hireDate: '入职日期',
  regularizationDate: '转正日期',
});

const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

// CloudBase legacy storage fileIDs use `cloud://<envId>.<bucket>/<path>`.
// Keep the observed authority exact and fail closed for environments that have
// not been explicitly configured instead of accepting any environment prefix.
const STORAGE_AUTHORITY_BY_ENV = Object.freeze({
  'archive-demo-environment': 'archive-demo-environment.7465-archive-demo-environment-1234567890',
});

const COURSE_STATUSES = new Set([
  'completed',
  'incomplete',
  'partial',
  'unknown',
  'not_applicable',
]);

const UNTRUSTED_KEYS = new Set([
  '_id',
  '_openid',
  'id',
  'actor',
  'actorAccountId',
  'actorAuthUid',
  'authUid',
  'role',
  'permissions',
  'password',
  'token',
  'storageKey',
  'fileID',
  'filePath',
  'cloudPath',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'createdByAuthUid',
  'updatedByAuthUid',
  'uploadedByAuthUid',
  'archivedAt',
  'archivedByAuthUid',
]);

const OUTPUT_HIDDEN_KEYS = new Set([
  '_id',
  '_openid',
  'actor',
  'actorAccountId',
  'actorAuthUid',
  'authUid',
  'password',
  'permissions',
  'token',
  'storageKey',
  'fileID',
  'filePath',
  'cloudPath',
  'createdBy',
  'updatedBy',
  'createdByAuthUid',
  'updatedByAuthUid',
  'uploadedByAuthUid',
  'archivedByAuthUid',
]);

const ERROR_STATUS = Object.freeze({
  CONFIG_MISSING: 500,
  CONFIG_CONFLICT: 500,
  AUTH_REQUIRED: 401,
  ACCOUNT_INACTIVE: 403,
  ROUTE_NOT_FOUND: 404,
  NOT_IMPLEMENTED: 501,
  VALIDATION_ERROR: 400,
  EMPLOYEE_NOT_FOUND: 404,
  STUDENT_NOT_FOUND: 404,
  DATABASE_READ_FAILED: 502,
  DATABASE_WRITE_FAILED: 502,
  AUDIT_WRITE_FAILED: 502,
  ATTACHMENT_NOT_FOUND: 404,
  ATTACHMENT_ALREADY_REGISTERED: 409,
  EMPLOYEE_CONFLICT: 409,
  STUDENT_CONFLICT: 409,
  EMPLOYEE_PHONE_DUPLICATE: 409,
  STUDENT_PHONE_DUPLICATE: 409,
  DISPLAY_NAME_IMMUTABLE: 409,
  PERMISSION_DENIED: 403,
  ACCOUNT_NOT_FOUND: 404,
  ACCOUNT_USERNAME_TAKEN: 409,
  ACCOUNT_DISPLAY_NAME_TAKEN: 409,
  PASSWORD_RESET_RATE_LIMITED: 429,
  PASSWORD_RESET_RATE_LIMIT_UNAVAILABLE: 503,
  SUPER_ADMIN_GOVERNANCE_NOT_READY: 503,
  SUPER_ADMIN_OVER_LIMIT: 409,
  SUPER_ADMIN_QUOTA_FULL: 409,
  SUPER_ADMIN_TARGET_INVALID: 409,
  SUPER_ADMIN_REVISION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  REGISTRATION_EMPLOYEE_INVALID: 409,
  REGISTRATION_IDENTITY_CLAIMED: 409,
  REGISTRATION_RECOVERY_REQUIRED: 503,
  LAST_SUPER_ADMIN: 409,
  REGISTRATION_UNAVAILABLE: 503,
  REGISTRATION_PROVIDER_ERROR: 502,
  MONTHLY_INVALID_MONTH: 400,
  MONTHLY_FUTURE_MONTH: 400,
  MONTHLY_TARGET_NOT_FOUND: 404,
  MONTHLY_SNAPSHOT_MISSING: 409,
  MONTHLY_DUPLICATE_RECORD: 409,
  MONTHLY_ASSESSMENT_VERSION_CONFLICT: 409,
  MONTHLY_ROSTER_INVALID: 409,
  MONTHLY_ROSTER_EMPLOYEE_NOT_FOUND: 404,
  MONTHLY_TARGET_SNAPSHOT_CONFLICT: 409,
  QUARTERLY_PERIOD_NOT_FOUND: 404,
  QUARTERLY_TASK_NOT_FOUND: 404,
  QUARTERLY_RECORD_NOT_FOUND: 404,
  QUARTERLY_PERIOD_CLOSED: 409,
  QUARTERLY_PERIOD_VERSION_CONFLICT: 409,
  QUARTERLY_TASK_REVOKED: 409,
  QUARTERLY_TASK_VERSION_CONFLICT: 409,
  QUARTERLY_RECORD_VERSION_CONFLICT: 409,
  QUARTERLY_RECORD_STATE: 409,
  QUARTERLY_DUPLICATE_RECORD: 409,
  QUARTERLY_BINDING_CONFLICT: 409,
  QUARTERLY_DEADLINE_PASSED: 409,
  QUARTERLY_INVALID_DUE_AT: 409,
  QUARTERLY_INVALID_OPENS_AT: 409,
  QUARTERLY_SELF_BINDING_REQUIRED: 409,
  QUARTERLY_SELF_BINDING_MISMATCH: 409,
  QUARTERLY_ACCOUNT_IDENTITY_CHANGED: 409,
  QUARTERLY_TASK_IDENTITY_CONFLICT: 409,
  QUARTERLY_PERIOD_IDENTITY_CONFLICT: 409,
  QUARTERLY_MATERIALIZATION_PREVIEW_STALE: 409,
  QUARTERLY_MATERIALIZATION_CONFLICT: 409,
  STORAGE_READ_FAILED: 502,
  INTERNAL_ERROR: 500,
});

const EMPLOYEE_CONFLICT_MESSAGE = '该员工档案已被其他账号更新，请刷新后再保存。';
const STUDENT_CONFLICT_MESSAGE = '该学员档案已被其他账号更新，请刷新后再保存。';
const QUARTERLY_MESSAGES = Object.freeze({
  deadlinePassed: '季度填写截止时间已到，不能再填写。',
  invalidDueAt: '季度截止时间配置无效，暂不能填写，请联系管理员。',
  invalidOpensAt: '季度开放时间配置无效，暂不能填写，请联系管理员。',
  periodNotOpen: '季度周期当前未开放填写。',
  taskRevoked: '该季度评价任务已撤销。',
  selfBindingRequired: '自评必须先绑定本人员工身份。',
  selfBindingMismatch: '自评只能评价当前账号绑定的本人员工。',
  accountIdentityChanged: '当前账号身份已变化，请刷新后重试。',
  taskIdentityConflict: '季度评价任务已发生变化，请刷新后重试。',
  periodIdentityConflict: '季度周期已发生变化，请刷新后重试。',
});

class AppError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status || ERROR_STATUS[code] || 500;
    this.details = details;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasControlCharacters(value) {
  return [...String(value ?? '')].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function archiveRecordType(record) {
  const value = asTrimmedString(record && record.recordType);
  if (!value || value === RECORD_TYPES.employee) return RECORD_TYPES.employee;
  return value;
}

function isEmployeeRecord(record) {
  return isPlainObject(record) && archiveRecordType(record) === RECORD_TYPES.employee;
}

function isStudentRecord(record) {
  return isPlainObject(record) && archiveRecordType(record) === RECORD_TYPES.student;
}

function isStudentAccount(account) {
  return isPlainObject(account)
    && (asTrimmedString(account.identityType) === 'student' || Boolean(asTrimmedString(account.studentId)));
}

function normalizeAccountRole(value) {
  const role = asTrimmedString(value);
  return ACCOUNT_ROLES.has(role) ? role : 'user';
}

function normalizePermissions(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(asTrimmedString).filter((permission) => MANAGED_PERMISSION_SET.has(permission)))];
}

function resolveAccountAuthorization(account) {
  if (isStudentAccount(account)) return { role: 'user', permissions: [] };
  const role = normalizeAccountRole(account && account.role);
  if (role === 'super_admin') {
    return { role, permissions: [...MANAGED_PERMISSIONS] };
  }
  if (role === 'admin') {
    return { role, permissions: normalizePermissions(account && account.permissions) };
  }
  // Legacy records that predate role fields are deliberately read-only. An
  // explicit super_admin record must be seeded by an approved migration; no
  // existing account is silently promoted.
  return { role: 'user', permissions: [] };
}

function hasPermission(actor, permission) {
  return actor && actor.role === 'super_admin'
    ? true
    : Boolean(actor && Array.isArray(actor.permissions) && actor.permissions.includes(permission));
}

function normalizeRegistrationInput(input) {
  const source = isPlainObject(input) ? input : {};
  const username = asTrimmedString(source.username);
  const password = typeof source.password === 'string' ? source.password : '';
  if (hasOwn(source, 'role') || hasOwn(source, 'permissions')) {
    throw new AppError('VALIDATION_ERROR', '注册请求不能指定账号角色或权限。', 400, { field: 'role' });
  }
  if (hasOwn(source, 'displayName') || hasOwn(source, 'employeeId') || hasOwn(source, 'studentId')
    || hasOwn(source, 'identityType') || hasOwn(source, 'invitationCode')) {
    throw new AppError('VALIDATION_ERROR', '注册时只能填写手机号，由系统匹配现有人员档案。', 400);
  }
  const phoneNumber = normalizeRegistrationPhone(source.phoneNumber);

  if (!username || username.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(username)) {
    throw new AppError(
      'VALIDATION_ERROR',
      '用户名需为 1-64 位，并以字母或数字开头，只能包含字母、数字、点、下划线或短横线。',
      400,
      { field: 'username' },
    );
  }

  if (password.length < 8 || password.length > 32) {
    throw new AppError('VALIDATION_ERROR', '密码需为 8-32 位。', 400, { field: 'password' });
  }
  const cloudBasePasswordSpecialCharacters = new Set('()!@#$%^&*|?><_-');
  if (/^[^A-Za-z0-9]/.test(password)
    || [...password].some((character) => !/[A-Za-z0-9]/.test(character)
      && !cloudBasePasswordSpecialCharacters.has(character))) {
    throw new AppError(
      'VALIDATION_ERROR',
      '密码不能以特殊字符开头；特殊字符只能使用 ()!@#$%^&*|?><_-。',
      400,
      { field: 'password' },
    );
  }
  const passwordClasses = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  if (passwordClasses < 3) {
    throw new AppError('VALIDATION_ERROR', '密码需至少包含大写字母、小写字母、数字、特殊字符中的三类。', 400, { field: 'password' });
  }

  if (!phoneNumber) {
    throw new AppError('VALIDATION_ERROR', '请输入有效的本人手机号。', 400, { field: 'phoneNumber' });
  }

  return { username, password, phoneNumber };
}

function normalizeRegistrationPhone(value) {
  if (typeof value !== 'string') return '';
  let phoneNumber = value.normalize('NFKC').trim().replace(/[\s\-‐‑‒–—―]/g, '');
  if (phoneNumber.startsWith('+86')) phoneNumber = phoneNumber.slice(3);
  if (!/^1[3-9]\d{9}$/.test(phoneNumber)) return '';
  return phoneNumber;
}

function normalizeStudentPhone(value) {
  if (typeof value !== 'string') return '';
  let phoneNumber = value.normalize('NFKC').trim().replace(/[\s\-‐‑‒–—―]/g, '');
  if (phoneNumber.startsWith('+86')) phoneNumber = phoneNumber.slice(3);
  return /^1[3-9]\d{9}$/.test(phoneNumber) ? phoneNumber : '';
}

function shanghaiMonthKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('MONTHLY_INVALID_MONTH', '无法计算当前月份，请稍后重试。', 400);
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) {
    throw new AppError('MONTHLY_INVALID_MONTH', '无法计算当前月份，请稍后重试。', 400);
  }
  return `${year}-${month}`;
}

function normalizeMonthlyMonthKey(value, nowValue = new Date()) {
  const monthKey = asTrimmedString(value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    throw new AppError('MONTHLY_INVALID_MONTH', '月份必须使用 YYYY-MM 格式。', 400, { field: 'monthKey' });
  }
  const currentMonthKey = shanghaiMonthKey(nowValue);
  if (monthKey > currentMonthKey) {
    throw new AppError('MONTHLY_FUTURE_MONTH', '不能查看或保存未来月份的月度考核。', 400, { field: 'monthKey' });
  }
  return monthKey;
}

function normalizeMonthlyResults(value) {
  if (!isPlainObject(value)) {
    throw new AppError('VALIDATION_ERROR', '月度考核结果必须是五项指标对象。', 400, { field: 'results' });
  }
  const unknownMetric = Object.keys(value).find((metric) => !MONTHLY_ASSESSMENT_METRICS.includes(metric));
  if (unknownMetric) {
    throw new AppError('VALIDATION_ERROR', `不支持的月度考核指标：${unknownMetric}。`, 400, { field: 'results' });
  }
  const results = {};
  for (const metric of MONTHLY_ASSESSMENT_METRICS) {
    const status = asTrimmedString(value[metric]);
    if (!MONTHLY_ASSESSMENT_RESULT_SET.has(status)) {
      throw new AppError('VALIDATION_ERROR', `月度考核指标“${MONTHLY_ASSESSMENT_METRIC_LABELS[metric]}”状态不合法。`, 400, { field: `results.${metric}` });
    }
    results[metric] = status;
  }
  return results;
}

function normalizeMonthlyNote(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', '整体评价说明必须是文本。', 400, { field: 'note' });
  }
  const note = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if ([...note].length > 2000) {
    throw new AppError('VALIDATION_ERROR', '整体评价说明不能超过 2000 个字符。', 400, { field: 'note' });
  }
  return note;
}

function normalizeQuarterlyPeriodKey(value) {
  const periodKey = asTrimmedString(value);
  if (!/^\d{4}-Q[1-4]$/.test(periodKey)) {
    throw new AppError('VALIDATION_ERROR', '季度必须使用 YYYY-Q1 至 YYYY-Q4 格式。', 400, { field: 'periodKey' });
  }
  return periodKey;
}

function normalizeQuarterlyType(value) {
  const type = asTrimmedString(value);
  if (!QUARTERLY_REVIEW_TYPES.includes(type)) {
    throw new AppError('VALIDATION_ERROR', '评价类型必须是 self、first 或 second。', 400, { field: 'type' });
  }
  return type;
}

function normalizeQuarterlyPeriodStatus(value) {
  const status = asTrimmedString(value);
  if (!QUARTERLY_PERIOD_STATUSES.includes(status)) {
    throw new AppError('VALIDATION_ERROR', '季度周期状态不合法。', 400, { field: 'status' });
  }
  return status;
}

function normalizeQuarterlyRecordStatus(value) {
  const status = asTrimmedString(value);
  if (!QUARTERLY_RECORD_STATUSES.includes(status)) {
    throw new AppError('VALIDATION_ERROR', '季度评价记录状态不合法。', 400, { field: 'status' });
  }
  return status;
}

function normalizeQuarterlyResultVisibility(value) {
  const visibility = asTrimmedString(value || 'hidden') || 'hidden';
  if (!QUARTERLY_RESULT_VISIBILITIES.includes(visibility)) {
    throw new AppError('VALIDATION_ERROR', '季度评价结果公布状态不合法。', 400, { field: 'resultVisibility' });
  }
  return visibility;
}

const QUARTERLY_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function parseQuarterlyDateTime(value) {
  const text = asTrimmedString(value);
  if (!text) return null;
  const match = QUARTERLY_DATE_TIME_PATTERN.exec(text);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionalText, zone, sign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = fractionalText ? Number(fractionalText.padEnd(3, '0')) : 0;
  const offsetHour = zone === 'Z' ? 0 : Number(offsetHourText);
  const offsetMinute = zone === 'Z' ? 0 : Number(offsetMinuteText);

  if (
    month < 1 || month > 12
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 14
    || offsetMinute > 59
    || (offsetHour === 14 && offsetMinute !== 0)
  ) return null;

  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, millisecond);
  if (
    calendar.getUTCFullYear() !== year
    || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day
    || calendar.getUTCHours() !== hour
    || calendar.getUTCMinutes() !== minute
    || calendar.getUTCSeconds() !== second
    || calendar.getUTCMilliseconds() !== millisecond
  ) return null;

  const offsetMinutes = zone === 'Z'
    ? 0
    : (sign === '+' ? 1 : -1) * (offsetHour * 60 + offsetMinute);
  const timestamp = calendar.getTime() - offsetMinutes * 60 * 1000;
  return Number.isFinite(timestamp) ? { value: text, timestamp } : null;
}

function invalidQuarterlyDueAtError(field = 'dueAt') {
  return new AppError('QUARTERLY_INVALID_DUE_AT', QUARTERLY_MESSAGES.invalidDueAt, 409, { field });
}

function normalizeQuarterlyDueAt(value) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value !== 'string' || value.trim().length > 80 || hasControlCharacters(value) || !parseQuarterlyDateTime(value)) {
    throw invalidQuarterlyDueAtError();
  }
  return value.trim();
}

function normalizeQuarterlyOpensAt(value) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value !== 'string' || value.trim().length > 80 || hasControlCharacters(value) || !parseQuarterlyDateTime(value)) {
    throw new AppError('VALIDATION_ERROR', '季度开放时间必须是带时区的有效日期时间。', 400, { field: 'opensAt' });
  }
  return value.trim();
}

function quarterlyPeriodId(periodKey) {
  return `quarterly-period:${normalizeQuarterlyPeriodKey(periodKey)}`;
}

function quarterlyNaturalWindow(periodKeyValue) {
  const periodKey = normalizeQuarterlyPeriodKey(periodKeyValue);
  const match = /^(\d{4})-Q([1-4])$/.exec(periodKey);
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const month = (quarter - 1) * 3 + 1;
  let nextYear = year;
  let nextMonth = month + 3;
  if (nextMonth > 12) {
    nextYear += 1;
    nextMonth -= 12;
  }
  if (nextYear > 9999) {
    throw new AppError('VALIDATION_ERROR', '季度开放时间超出可支持的年份范围。', 400, { field: 'periodKey' });
  }
  return {
    opensAt: `${year}-${String(month).padStart(2, '0')}-01T00:00:00+08:00`,
    closesAt: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+08:00`,
  };
}

function previousQuarterlyPeriodKey(periodKeyValue) {
  const periodKey = normalizeQuarterlyPeriodKey(periodKeyValue);
  const match = /^(\d{4})-Q([1-4])$/.exec(periodKey);
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  if (quarter === 1) {
    if (year <= 1) {
      throw new AppError('VALIDATION_ERROR', '目标季度没有可支持的上一季度。', 400, { field: 'periodKey' });
    }
    return `${String(year - 1).padStart(4, '0')}-Q4`;
  }
  return `${String(year).padStart(4, '0')}-Q${quarter - 1}`;
}

function quarterlyTaskId(periodKey, type, evaluatorAccountId, evaluateeEmployeeId) {
  const safePeriodKey = normalizeQuarterlyPeriodKey(periodKey);
  const safeType = normalizeQuarterlyType(type);
  const evaluatorId = validateTextField(evaluatorAccountId, '评价人账号编号', { required: true, maxLength: 160 });
  const evaluateeId = validateTextField(evaluateeEmployeeId, '被评价员工编号', { required: true, maxLength: 160 });
  return `quarterly-task:${safePeriodKey}:${safeType}:${evaluatorId}:${evaluateeId}`;
}

function quarterlyEmployeeTaskId(periodKey, type, evaluatorEmployeeId, evaluateeEmployeeId) {
  const safePeriodKey = normalizeQuarterlyPeriodKey(periodKey);
  const safeType = normalizeQuarterlyType(type);
  const evaluatorId = validateTextField(evaluatorEmployeeId, '评价人档案编号', { required: true, maxLength: 160 });
  const evaluateeId = validateTextField(evaluateeEmployeeId, '被评价员工编号', { required: true, maxLength: 160 });
  return `quarterly-task:employee:${safePeriodKey}:${safeType}:${evaluatorId}:${evaluateeId}`;
}

function quarterlyPendingRelationId(periodKey, type, sourceRelationId) {
  const safePeriodKey = normalizeQuarterlyPeriodKey(periodKey);
  const safeType = normalizeQuarterlyType(type);
  const sourceId = validateTextField(sourceRelationId, '来源关系编号', { required: true, maxLength: 160 });
  return `quarterly-pending:${safePeriodKey}:${safeType}:${sourceId}`;
}

function quarterlyRecordId(taskId) {
  return validateTextField(taskId, '任务编号', { required: true, maxLength: 400 });
}

function quarterlyGradeForScore(value) {
  if (!Number.isInteger(value) || value < 0 || value > 25) return null;
  if (value >= 21) return 'A';
  if (value >= 16) return 'B';
  if (value >= 10) return 'C';
  return 'D';
}

function normalizeQuarterlyScores(value, { complete = false } = {}) {
  if (value === undefined || value === null) value = {};
  if (!isPlainObject(value)) {
    throw new AppError('VALIDATION_ERROR', '季度评价分数必须是六个维度对象。', 400, { field: 'scores' });
  }
  const unknownDimension = Object.keys(value).find((dimension) => !QUARTERLY_DIMENSIONS.includes(dimension));
  if (unknownDimension) {
    throw new AppError('VALIDATION_ERROR', `不支持的季度评价维度：${unknownDimension}。`, 400, { field: 'scores' });
  }

  const scores = {};
  for (const dimension of QUARTERLY_DIMENSIONS) {
    const raw = value[dimension];
    if (raw === undefined || raw === null || raw === '') {
      if (complete) {
        throw new AppError('VALIDATION_ERROR', `季度评价维度“${dimension}”必须填写 0-25 的整数。`, 400, { field: `scores.${dimension}` });
      }
      scores[dimension] = null;
      continue;
    }
    if (!Number.isInteger(raw) || raw < 0 || raw > 25) {
      throw new AppError('VALIDATION_ERROR', `季度评价维度“${dimension}”必须是 0-25 的整数。`, 400, { field: `scores.${dimension}` });
    }
    scores[dimension] = raw;
  }
  return scores;
}

function normalizeQuarterlyReason(value, dimension) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', `季度评价维度“${dimension}”的理由必须是文本。`, 400, { field: `reasons.${dimension}` });
  }
  const reason = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if ([...reason].length > 2000) {
    throw new AppError('VALIDATION_ERROR', `季度评价维度“${dimension}”的理由不能超过 2000 个字符。`, 400, { field: `reasons.${dimension}` });
  }
  return reason;
}

function normalizeQuarterlyReasons(value, scores, { complete = false } = {}) {
  if (value === undefined || value === null) value = {};
  if (!isPlainObject(value)) {
    throw new AppError('VALIDATION_ERROR', '季度评价理由必须是六个维度对象。', 400, { field: 'reasons' });
  }
  const unknownDimension = Object.keys(value).find((dimension) => !QUARTERLY_DIMENSIONS.includes(dimension));
  if (unknownDimension) {
    throw new AppError('VALIDATION_ERROR', `不支持的季度评价理由维度：${unknownDimension}。`, 400, { field: 'reasons' });
  }

  const reasons = {};
  for (const dimension of QUARTERLY_DIMENSIONS) {
    const reason = normalizeQuarterlyReason(value[dimension], dimension);
    const grade = quarterlyGradeForScore(scores[dimension]);
    if (grade === 'A' || grade === 'D') {
      if (!reason) {
        throw new AppError('VALIDATION_ERROR', `季度评价维度“${dimension}”为${grade}档时必须填写理由。`, 400, { field: `reasons.${dimension}` });
      }
    } else if (complete && !reason && scores[dimension] === null) {
      throw new AppError('VALIDATION_ERROR', `季度评价维度“${dimension}”必须填写分数。`, 400, { field: `scores.${dimension}` });
    }
    reasons[dimension] = reason;
  }
  return reasons;
}

function quarterlyTotal(scores, { complete = false } = {}) {
  const values = QUARTERLY_DIMENSIONS.map((dimension) => scores[dimension]);
  if (complete && values.some((value) => !Number.isInteger(value))) return null;
  if (values.every((value) => value === null)) return null;
  return values.reduce((total, value) => total + (Number.isInteger(value) ? value : 0), 0);
}

function normalizeQuarterlyEvaluation(input, { complete = false } = {}) {
  const source = isPlainObject(input) ? input : {};
  const scores = normalizeQuarterlyScores(source.scores, { complete });
  const reasons = normalizeQuarterlyReasons(source.reasons, scores, { complete });
  const total = quarterlyTotal(scores, { complete });
  if (complete && total === null) {
    throw new AppError('VALIDATION_ERROR', '正式提交必须完整填写六个评分维度。', 400, { field: 'scores' });
  }
  return { scores, reasons, total };
}

function normalizeQuarterlyExpectedVersion(input) {
  if (!hasOwn(input || {}, 'expectedVersion') || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new AppError('VALIDATION_ERROR', '缺少有效的季度评价 expectedVersion。', 400, { field: 'expectedVersion' });
  }
  return input.expectedVersion;
}

function normalizeQuarterlyPeriodInput(input, { current = null } = {}) {
  const source = isPlainObject(input && input.period) ? input.period : (isPlainObject(input) ? input : {});
  const periodKey = normalizeQuarterlyPeriodKey(source.periodKey || current?.periodKey);
  const periodName = validateTextField(
    source.periodName === undefined ? current?.periodName : source.periodName,
    '季度名称',
    { required: true, maxLength: 120 },
  );
  const status = normalizeQuarterlyPeriodStatus(source.status === undefined ? (current?.status || 'draft') : source.status);
  if (!current && status !== 'draft') {
    throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '新建季度必须先保存为草稿。', 409, { field: 'status' });
  }
  const resultVisibility = normalizeQuarterlyResultVisibility(
    source.resultVisibility === undefined ? (current?.resultVisibility || 'hidden') : source.resultVisibility,
  );
  const scoringStandardVersion = validateTextField(
    source.scoringStandardVersion === undefined
      ? (current?.scoringStandardVersion || QUARTERLY_SCORING_STANDARD_VERSION)
      : source.scoringStandardVersion,
    '评分标准版本',
    { required: true, maxLength: 120 },
  );
  const rosterVersion = source.rosterVersion === undefined
    ? (Number.isInteger(current?.rosterVersion) && current.rosterVersion > 0 ? current.rosterVersion : 1)
    : source.rosterVersion;
  if (!Number.isInteger(rosterVersion) || rosterVersion < 1) {
    throw new AppError('VALIDATION_ERROR', '名单版本必须是正整数。', 400, { field: 'rosterVersion' });
  }
  const currentOpensAt = current ? normalizeQuarterlyOpensAt(current.opensAt) : null;
  const requestedOpensAt = source.opensAt === undefined ? currentOpensAt : normalizeQuarterlyOpensAt(source.opensAt);
  if (!current && requestedOpensAt) {
    throw new AppError('VALIDATION_ERROR', '季度开放时间由系统按自然季度安排，请保存草稿后使用“按季度开放”。', 400, { field: 'opensAt' });
  }
  if (current && source.opensAt !== undefined) {
    const currentTimestamp = currentOpensAt ? parseQuarterlyDateTime(currentOpensAt)?.timestamp : null;
    const requestedTimestamp = requestedOpensAt ? parseQuarterlyDateTime(requestedOpensAt)?.timestamp : null;
    if (currentTimestamp !== requestedTimestamp) {
      throw new AppError('VALIDATION_ERROR', '开放时间由系统管理，不能手动修改。', 400, { field: 'opensAt' });
    }
  }
  if (current?.naturalQuarterSchedule === true) {
    const naturalWindow = quarterlyNaturalWindow(periodKey);
    if (currentOpensAt !== naturalWindow.opensAt) {
      throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '季度自然开放配置不一致，暂不能修改。', 409);
    }
  }
  const opensAt = currentOpensAt;
  const dueAt = normalizeQuarterlyDueAt(source.dueAt === undefined ? current?.dueAt : source.dueAt);
  if (opensAt && dueAt && parseQuarterlyDateTime(opensAt).timestamp >= parseQuarterlyDateTime(dueAt).timestamp) {
    throw new AppError('VALIDATION_ERROR', '开放时间必须早于截止时间。', 400, { field: 'opensAt' });
  }
  if ((!current || current.naturalQuarterSchedule === true) && dueAt) {
    const naturalWindow = quarterlyNaturalWindow(periodKey);
    const dueAtTimestamp = parseQuarterlyDateTime(dueAt).timestamp;
    const closesAtTimestamp = parseQuarterlyDateTime(naturalWindow.closesAt).timestamp;
    if (dueAtTimestamp >= closesAtTimestamp) {
      throw new AppError('VALIDATION_ERROR', '截止时间必须早于下季度开始时间。', 400, { field: 'dueAt' });
    }
  }
  return {
    periodKey,
    periodName,
    status,
    resultVisibility,
    scoringStandardVersion,
    rosterVersion,
    opensAt,
    dueAt,
  };
}

function monthlyAssessmentRecordId(monthKey, employeeId) {
  return `assessment:${monthKey}:${employeeId}`;
}

function monthlyAssessmentTargetId(monthKey, employeeId) {
  return `target:${monthKey}:${employeeId}`;
}

function normalizeMonthlyRosterSourceRows(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => Number.parseInt(row, 10))
    .filter((row) => Number.isInteger(row) && row > 0);
}

function normalizeMonthlyRosterVersion(value) {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function monthlyDefaultResults() {
  return MONTHLY_ASSESSMENT_METRICS.reduce((result, metric) => {
    result[metric] = 'unassessed';
    return result;
  }, {});
}

function normalizeStoredMonthlyResults(value) {
  const source = isPlainObject(value) ? value : {};
  return MONTHLY_ASSESSMENT_METRICS.reduce((result, metric) => {
    const status = asTrimmedString(source[metric]);
    result[metric] = MONTHLY_ASSESSMENT_RESULT_SET.has(status) ? status : 'unassessed';
    return result;
  }, {});
}

function monthlyFilledCount(results) {
  return MONTHLY_ASSESSMENT_METRICS.filter((metric) => results[metric] !== 'unassessed').length;
}

function monthlyAssessmentChangedFields(before, after) {
  const changed = MONTHLY_ASSESSMENT_METRICS
    .filter((metric) => before?.results?.[metric] !== after?.results?.[metric])
    .map((metric) => MONTHLY_ASSESSMENT_METRIC_LABELS[metric]);
  if ((before?.note || '') !== (after?.note || '')) changed.push('整体评价说明');
  return changed.length ? changed : ['未检测到字段变化'];
}

function createRequestId() {
  return crypto.randomUUID();
}

function getEnvironmentId(env = process.env) {
  const primary = asTrimmedString(env.TCB_ENV_ID);
  const legacy = asTrimmedString(env.CLOUDBASE_ENV_ID);

  if (primary && legacy && primary !== legacy) {
    throw new AppError(
      'CONFIG_CONFLICT',
      '服务端同时配置了不一致的 TCB_ENV_ID 和 CLOUDBASE_ENV_ID，请只保留一个环境 ID。',
    );
  }

  const envId = primary || legacy;
  if (!envId) {
    throw new AppError(
      'CONFIG_MISSING',
      '服务端未配置 TCB_ENV_ID 或 CLOUDBASE_ENV_ID，无法初始化 CloudBase。',
    );
  }
  return envId;
}

function getStorageAuthority(envId) {
  const authority = STORAGE_AUTHORITY_BY_ENV[asTrimmedString(envId)];
  if (!authority) {
    throw new AppError(
      'CONFIG_MISSING',
      '当前环境未配置受信的 CloudBase 存储位置，无法安全访问员工附件。',
    );
  }
  return authority;
}

function loadCloudBaseSdk() {
  // Keep SDK loading lazy so pure unit tests do not need a live CloudBase runtime.
  // The deployed function installs this dependency from package.json.
  return require('@cloudbase/node-sdk');
}

function loadCloudBaseManager() {
  // Registration is intentionally server-only. The manager SDK never ships to
  // the browser and receives credentials only from the Cloud Function runtime.
  return require('@cloudbase/manager-node');
}

function createCloudBaseManager(envId, env = process.env) {
  const CloudBase = loadCloudBaseManager();
  const options = { envId };
  const secretId = asTrimmedString(env.TCB_SECRET_ID || env.CLOUDBASE_SECRET_ID);
  const secretKey = asTrimmedString(env.TCB_SECRET_KEY || env.CLOUDBASE_SECRET_KEY);
  const token = asTrimmedString(env.TCB_TOKEN || env.CLOUDBASE_TOKEN);
  if (secretId && secretKey) {
    options.secretId = secretId;
    options.secretKey = secretKey;
  } else if (token) {
    options.token = token;
  }
  return CloudBase.init(options);
}

function normalizeRequest(event) {
  const source = isPlainObject(event) ? event : {};
  const explicitRoute = asTrimmedString(source.route);
  const route = explicitRoute || asTrimmedString(source.action);
  let input;

  if (isPlainObject(source.input)) {
    input = { ...source.input };
  } else if (isPlainObject(source.payload)) {
    input = { ...source.payload };
  } else {
    input = { ...source };
    delete input.route;
    // `action` is the legacy route field only when no explicit route exists.
    // With an explicit route, audit/list uses it as the operation-type filter.
    if (!explicitRoute) delete input.action;
    delete input.requestId;
  }

  // A client requestId is deliberately ignored. Audit correlation IDs are server-generated.
  delete input.requestId;
  // CloudBase injects this top-level context into function events. Strip it
  // only when it is the same value copied from the event envelope; a
  // caller-supplied field nested inside input/payload remains subject to each
  // route's normal strict field validation.
  if (hasOwn(source, 'tcbContext') && input.tcbContext === source.tcbContext) {
    delete input.tcbContext;
  }
  return { route, input };
}

function readCallerIdentity(auth) {
  if (!auth || typeof auth.getUserInfo !== 'function') {
    throw new AppError('AUTH_REQUIRED', '服务端无法读取当前登录身份。');
  }

  return Promise.resolve(auth.getUserInfo()).then((rawIdentity) => {
    const identity = isPlainObject(rawIdentity) ? rawIdentity : {};
    const anonymousMarker = (value) => {
      if (value === true) return true;
      const normalized = asTrimmedString(value).toLowerCase();
      return normalized === 'true' || normalized === 'anonymous' || normalized === 'is_anonymous';
    };
    const anonymous =
      anonymousMarker(identity.isAnonymous) ||
      anonymousMarker(identity.is_anonymous) ||
      anonymousMarker(identity.anonymous) ||
      asTrimmedString(identity.loginType).toLowerCase() === 'anonymous' ||
      asTrimmedString(identity.login_type).toLowerCase() === 'anonymous' ||
      asTrimmedString(identity.provider).toLowerCase() === 'anonymous';
    const authUid = asTrimmedString(identity.uid);

    if (anonymous || !authUid) {
      throw new AppError('AUTH_REQUIRED', '需要使用已登录的非匿名账号访问员工档案。');
    }

    const username = asTrimmedString(identity.username || identity.userName || identity.name);
    return { authUid, username };
  });
}

function getRows(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.data)) return result.data;
  if (result && Array.isArray(result.documents)) return result.documents;
  return [];
}

function getDocument(result) {
  if (!isPlainObject(result)) return null;
  if (hasOwn(result, 'data')) {
    if (Array.isArray(result.data)) return result.data[0] || null;
    if (isPlainObject(result.data)) return Object.keys(result.data).length ? result.data : null;
    return null;
  }
  if (Array.isArray(result.documents)) return result.documents[0] || null;
  if (isPlainObject(result.document)) return Object.keys(result.document).length ? result.document : null;
  if (hasOwn(result, 'requestId') || hasOwn(result, 'request_id')) return null;
  if (Object.keys(result).length === 0) return null;
  return result;
}

function getDocumentId(result, fallback) {
  const candidate = result && (result.id || result._id);
  return asTrimmedString(candidate) || asTrimmedString(fallback);
}

function getRecordId(record) {
  if (!isPlainObject(record)) return '';
  return asTrimmedString(record._id || record.id);
}

const MONTHLY_TARGET_BUSINESS_FIELDS = Object.freeze([
  'monthKey',
  'employeeId',
  'eligible',
  'matchStatus',
  'rosterKey',
  'rosterVersion',
  'sourceName',
  'sourceNameNormalized',
  'sourceFileName',
  'sourceSheet',
  'sourceRows',
  'employeeNameSnapshot',
  'departmentSnapshot',
  'employmentStatusSnapshot',
]);

function hasMonthlyTargetBusinessFields(document) {
  if (!isPlainObject(document) || Object.keys(document).length === 0) return false;
  return MONTHLY_TARGET_BUSINESS_FIELDS.some((field) => hasOwn(document, field));
}

function expectedVersionOf(input) {
  if (!hasOwn(input || {}, 'expectedVersion') || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new AppError('VALIDATION_ERROR', '缺少有效的 expectedVersion。', 400, { field: 'expectedVersion' });
  }
  return input.expectedVersion;
}

function employeeVersion(employee) {
  return Number.isInteger(employee && employee.version) && employee.version > 0 ? employee.version : 1;
}

function studentVersion(student) {
  return Number.isInteger(student && student.version) && student.version > 0 ? student.version : 1;
}

function conflictError() {
  return new AppError('EMPLOYEE_CONFLICT', EMPLOYEE_CONFLICT_MESSAGE, 409);
}

function studentConflictError() {
  return new AppError('STUDENT_CONFLICT', STUDENT_CONFLICT_MESSAGE, 409);
}

async function runTransaction(db, work) {
  if (typeof db.startTransaction !== 'function' && typeof db.runTransaction !== 'function') {
    throw new AppError('DATABASE_WRITE_FAILED', '当前 CloudBase SDK 不支持员工档案事务。');
  }
  try {
    if (typeof db.startTransaction !== 'function') return await db.runTransaction(work);
    const transaction = await db.startTransaction();
    try {
      const result = await work(transaction);
      const committed = await transaction.commit();
      assertTransactionWriteDidNotFail(committed, '数据库事务未能提交，请刷新后重试。');
      if (committed && committed.ok === 0) {
        throw new AppError('DATABASE_WRITE_FAILED', '数据库事务未能提交，请刷新后重试。', 502);
      }
      return result;
    } catch (error) {
      try { await transaction.rollback(); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = String(error && (error.code || error.errCode || error.errorCode) || '').toLowerCase();
    const text = String(error && error.message || '').toLowerCase();
    if (/(transaction[_ -]?conflict|aborted|conflict|retry)/.test(`${code} ${text}`)) {
      throw conflictError();
    }
    throw error;
  }
}

function databaseWriteFailure(result) {
  if (!isPlainObject(result)) return null;
  const candidates = [result, result.result, result.data].filter(isPlainObject);
  for (const candidate of candidates) {
    if (candidate.success === false || candidate.ok === false) return candidate;
    const code = candidate.code ?? candidate.errCode ?? candidate.errorCode;
    if (typeof code === 'number' && code !== 0) return candidate;
    if (typeof code === 'string' && code.trim() && !['0', 'OK', 'SUCCESS'].includes(code.trim().toUpperCase())) {
      return candidate;
    }
    const message = asTrimmedString(candidate.errMsg || candidate.message);
    if (/(?:^|:)\s*fail\b|\berror\b|\bfailed\b/i.test(message) && !/:ok\s*$/i.test(message)) return candidate;
  }
  return null;
}

function assertTransactionWriteDidNotFail(result, errorMessage) {
  const failure = databaseWriteFailure(result);
  if (failure) {
    throw new AppError('DATABASE_WRITE_FAILED', errorMessage, 502, { cause: safeErrorCode(failure) });
  }
}

async function writeQuarterlyDocument(collection, id, data, errorMessage) {
  if (typeof collection.add !== 'function') {
    throw new AppError('DATABASE_WRITE_FAILED', errorMessage);
  }
  // A new quarterly document must be inserted under its deterministic ID.
  // add rejects a duplicate ID instead of silently replacing an existing row.
  const result = await collection.add({ ...data, _id: id });
  assertTransactionWriteDidNotFail(result, errorMessage);
  const insertedId = asTrimmedString(result && (result.id || result._id));
  if (insertedId && insertedId !== id) {
    throw new AppError('DATABASE_WRITE_FAILED', errorMessage, 502);
  }
}

function isOutputHiddenKey(key) {
  return (
    OUTPUT_HIDDEN_KEYS.has(key) ||
    /password|token|secret|privatekey|storage.?key|file.?id|file.?path|cloud.?path/i.test(asTrimmedString(key))
  );
}

function sanitizePublicValue(value) {
  if (Array.isArray(value)) return value.map(sanitizePublicValue);
  if (!isPlainObject(value)) return value;

  const result = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isOutputHiddenKey(key)) continue;
    result[key] = sanitizePublicValue(nestedValue);
  }
  return result;
}

function safePublicRecord(record) {
  if (!isPlainObject(record)) return null;

  const result = sanitizePublicValue(record);

  const id = getRecordId(record);
  delete result._id;
  if (id) result.id = id;
  return result;
}

function legacyEmployeeContract(record) {
  if (!isPlainObject(record) || hasOwn(record, 'contract')) return null;
  const legacyContract = {
    type: asTrimmedString(record.contractType),
    startDate: asTrimmedString(record.contractStartDate),
    endDate: asTrimmedString(record.contractEndDate),
    notes: asTrimmedString(record.contractNotes),
  };
  if (!Object.values(legacyContract).some(Boolean)) return null;
  return {
    id: asTrimmedString(record.contractId) || `${getRecordId(record)}-contract`,
    ...legacyContract,
    type: legacyContract.type || '当前合同',
  };
}

function employeePublicRecord(record) {
  if (!isEmployeeRecord(record)) return null;
  const result = safePublicRecord(record);
  if (result) {
    result.recordType = RECORD_TYPES.employee;
    const legacyContract = legacyEmployeeContract(record);
    if (legacyContract) result.contract = legacyContract;
  }
  return result;
}

function studentSummaryRecord(record) {
  if (!isPlainObject(record)) return null;
  const id = getRecordId(record);
  if (!id) return null;
  return {
    id,
    recordType: RECORD_TYPES.student,
    name: asTrimmedString(record.name),
    status: asTrimmedString(record.status) === 'inactive' ? 'inactive' : 'active',
    version: studentVersion(record),
    createdAt: asTrimmedString(record.createdAt) || null,
    updatedAt: asTrimmedString(record.updatedAt) || null,
  };
}

function studentDetailRecord(record) {
  const summary = studentSummaryRecord(record);
  if (!summary) return null;
  return { ...summary, phoneNumber: asTrimmedString(record.phoneNumber) };
}

function safeAccount(account) {
  const authorization = resolveAccountAuthorization(account);
  const result = {
    username: asTrimmedString(account.username),
    displayName:
      asTrimmedString(account.displayName) ||
      asTrimmedString(account.name) ||
      asTrimmedString(account.username) ||
      '未命名账号',
    scope: authorization.role === 'user' ? 'self' : 'all',
    role: authorization.role,
    permissions: authorization.permissions,
    status: ['disabled', 'pending_activation'].includes(asTrimmedString(account.status))
      ? asTrimmedString(account.status)
      : 'active',
  };
  const employeeId = asTrimmedString(account.employeeId);
  const employeeNameSnapshot = asTrimmedString(account.employeeNameSnapshot);
  const studentId = asTrimmedString(account.studentId);
  const studentNameSnapshot = asTrimmedString(account.studentNameSnapshot);
  const identityVersion = Number.isInteger(account.identityVersion) && account.identityVersion > 0
    ? account.identityVersion
    : null;
  if (studentId || asTrimmedString(account.identityType) === 'student') {
    result.identityType = 'student';
    if (studentId) result.studentId = studentId;
    if (studentNameSnapshot) result.studentNameSnapshot = studentNameSnapshot;
  } else {
    if (employeeId) result.employeeId = employeeId;
    if (employeeNameSnapshot) result.employeeNameSnapshot = employeeNameSnapshot;
  }
  if (identityVersion) result.identityVersion = identityVersion;
  return result;
}

function buildActor(account, identity) {
  const publicAccount = safeAccount(account);
  const actor = {
    authUid: identity.authUid,
    accountId: getRecordId(account) || asTrimmedString(account.accountId),
    username: publicAccount.username,
    displayName: publicAccount.displayName,
    role: publicAccount.role,
    permissions: publicAccount.permissions,
    status: publicAccount.status,
  };
  if (publicAccount.employeeId) actor.employeeId = publicAccount.employeeId;
  if (publicAccount.employeeNameSnapshot) actor.employeeNameSnapshot = publicAccount.employeeNameSnapshot;
  if (publicAccount.identityType === 'student') {
    actor.identityType = 'student';
    if (publicAccount.studentId) actor.studentId = publicAccount.studentId;
    if (publicAccount.studentNameSnapshot) actor.studentNameSnapshot = publicAccount.studentNameSnapshot;
  }
  if (publicAccount.identityVersion) actor.identityVersion = publicAccount.identityVersion;
  return actor;
}

async function findActiveAccount(db, authUid) {
  try {
    const result = await db
      .collection(COLLECTIONS.adminAccounts)
      .where({ authUid, status: 'active' })
      .limit(1)
      .get();
    const account = getRows(result)[0];
    if (!account) {
      throw new AppError('ACCOUNT_INACTIVE', '当前账号未授权或已停用，无法访问员工档案。');
    }
    return account;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('DATABASE_READ_FAILED', '读取账号授权状态失败。');
  }
}

function permissionLabels(permissions) {
  return normalizePermissions(permissions).map((permission) => PERMISSION_LABELS[permission] || permission);
}

function accountAuditSnapshot(account) {
  if (!isPlainObject(account)) return null;
  const publicAccount = safeAccount(account);
  const snapshot = {
    username: publicAccount.username,
    displayName: publicAccount.displayName,
    role: publicAccount.role,
    permissions: permissionLabels(publicAccount.permissions).join('、'),
    status: publicAccount.status,
    employeeId: publicAccount.employeeId || null,
    employeeNameSnapshot: publicAccount.employeeNameSnapshot || null,
    studentId: publicAccount.studentId || null,
    studentNameSnapshot: publicAccount.studentNameSnapshot || null,
    identityVersion: Number.isInteger(account.identityVersion) && account.identityVersion > 0
      ? account.identityVersion
      : 0,
  };
  return snapshot;
}

function accountSummary(account) {
  const publicAccount = safeAccount(account);
  const id = getRecordId(account);
  const identityVersion = Number.isInteger(account.identityVersion) && account.identityVersion > 0
    ? account.identityVersion
    : 0;
  return {
    id,
    username: publicAccount.username,
    displayName: publicAccount.displayName,
    role: publicAccount.role,
    permissions: publicAccount.permissions,
    status: publicAccount.status,
    createdAt: asTrimmedString(account.createdAt) || null,
    updatedAt: asTrimmedString(account.updatedAt) || null,
    permissionVersion: Number.isInteger(account.permissionVersion) && account.permissionVersion > 0
      ? account.permissionVersion
      : 1,
    employeeId: publicAccount.employeeId || null,
    employeeNameSnapshot: publicAccount.employeeNameSnapshot || null,
    studentId: publicAccount.studentId || null,
    studentNameSnapshot: publicAccount.studentNameSnapshot || null,
    identityVersion,
  };
}

function requirePermission(actor, permission) {
  if (!hasPermission(actor, permission)) {
    throw new AppError('PERMISSION_DENIED', '当前账号没有执行此操作的权限。', 403, { permission });
  }
}

async function listAccountRows(db) {
  try {
    const pageSize = 100;
    const allRows = [];
    for (let page = 0; ; page += 1) {
      let query = db.collection(COLLECTIONS.adminAccounts);
      if (typeof query.orderBy !== 'function' || typeof query.skip !== 'function' || typeof query.limit !== 'function') {
        throw new Error('CloudBase account query pagination is unavailable');
      }
      query = query.orderBy('_id', 'asc').skip(page * pageSize).limit(pageSize);
      const batch = getRows(await query.get());
      allRows.push(...batch);
      if (batch.length < pageSize) return allRows;
    }
  } catch {
    throw new AppError('DATABASE_READ_FAILED', '读取账号授权状态失败。');
  }
}

async function listRegistrationRecoveryClaimRows(db) {
  try {
    const pageSize = 100;
    const fields = {
      _id: true,
      identityType: true,
      employeeId: true,
      studentId: true,
      status: true,
      accountId: true,
      authUid: true,
      usernameNormalized: true,
      registrationAttemptId: true,
      registrationVerificationMethod: true,
      previousClaimStatus: true,
      invitationId: true,
      invitationDocumentId: true,
      recoveryCode: true,
      recoveryDetectedAt: true,
    };
    const allRows = [];
    for (let page = 0; ; page += 1) {
      const query = db.collection(COLLECTIONS.identityClaims)
        .field(fields)
        .orderBy('_id', 'asc')
        .skip(page * pageSize)
        .limit(pageSize);
      const batch = getRows(await query.get());
      allRows.push(...batch);
      if (batch.length < pageSize) return allRows.filter((row) => asTrimmedString(row.status) === 'recovery_required');
    }
  } catch {
    throw new AppError('DATABASE_READ_FAILED', '读取待恢复注册记录失败。');
  }
}

async function findAccountById(db, accountId) {
  const targetId = asTrimmedString(accountId);
  if (!targetId) {
    throw new AppError('VALIDATION_ERROR', '缺少 accountId。', 400, { field: 'accountId' });
  }
  try {
    const account = getDocument(await db.collection(COLLECTIONS.adminAccounts).doc(targetId).get());
    if (!account) throw new AppError('ACCOUNT_NOT_FOUND', '未找到对应账号。');
    return account;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('DATABASE_READ_FAILED', '读取账号资料失败。');
  }
}

async function findAccountByUsername(db, username) {
  const normalizedUsername = asTrimmedString(username).toLowerCase();
  if (!normalizedUsername) return null;
  const rows = await listAccountRows(db);
  return rows.find((account) => asTrimmedString(account.username).toLowerCase() === normalizedUsername) || null;
}

async function listAccountsByEmployeeId(db, employeeId, limit = 2) {
  const normalizedEmployeeId = asTrimmedString(employeeId);
  if (!normalizedEmployeeId) return [];
  try {
    const result = await db.collection(COLLECTIONS.adminAccounts)
      .where({ employeeId: normalizedEmployeeId })
      .limit(limit)
      .get();
    return getRows(result).filter((account) => asTrimmedString(account.employeeId) === normalizedEmployeeId);
  } catch {
    throw new AppError('DATABASE_READ_FAILED', '读取员工账号绑定状态失败。');
  }
}

async function listAccountsByStudentId(db, studentId, limit = 2) {
  const normalizedStudentId = asTrimmedString(studentId);
  if (!normalizedStudentId) return [];
  try {
    const result = await db.collection(COLLECTIONS.adminAccounts)
      .where({ studentId: normalizedStudentId })
      .limit(limit)
      .get();
    return getRows(result).filter((account) => asTrimmedString(account.studentId) === normalizedStudentId);
  } catch {
    throw new AppError('DATABASE_READ_FAILED', '读取学员账号绑定状态失败。');
  }
}

function activeSuperAdminIds(accounts) {
  return accounts
    .filter((account) => asTrimmedString(account.status) === 'active' && normalizeAccountRole(account.role) === 'super_admin')
    .map(getRecordId)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function governanceStateForCount(count, limit = SUPER_ADMIN_GOVERNANCE.limit) {
  if (count === 0) return 'no_active_super_admin';
  if (count > limit) return 'over_limit';
  return 'ready';
}

function governanceNotReady(message = '总管理员名额状态暂不可用，账号管理写入已关闭。') {
  return new AppError('SUPER_ADMIN_GOVERNANCE_NOT_READY', message, 503);
}

function validateGovernanceRoster(roster, { allowPreviousLimit = false } = {}) {
  const isCurrentLimit = isPlainObject(roster) && roster.limit === SUPER_ADMIN_GOVERNANCE.limit;
  const isPreviousLimit = allowPreviousLimit
    && isPlainObject(roster)
    && roster.limit === PREVIOUS_SUPER_ADMIN_GOVERNANCE_LIMIT;
  if (!isPlainObject(roster)
    || roster.schemaVersion !== SUPER_ADMIN_GOVERNANCE.schemaVersion
    || (!isCurrentLimit && !isPreviousLimit)
    || !Number.isInteger(roster.revision)
    || roster.revision < 1
    || !Array.isArray(roster.activeSuperAdminAccountIds)
    || !SUPER_ADMIN_GOVERNANCE_STATES.has(asTrimmedString(roster.state))) {
    throw governanceNotReady();
  }
  const ids = roster.activeSuperAdminAccountIds.map(asTrimmedString);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw governanceNotReady();
  const sortedIds = [...ids].sort((left, right) => left.localeCompare(right));
  if (ids.some((id, index) => id !== sortedIds[index])) throw governanceNotReady();
  if (asTrimmedString(roster.state) !== governanceStateForCount(ids.length, roster.limit)) throw governanceNotReady();
  return { ...roster, activeSuperAdminAccountIds: ids };
}

function assertGovernanceAccountMatchesRoster(roster, account) {
  const accountId = getRecordId(account);
  if (!accountId) throw governanceNotReady();
  const rosterHasAccount = roster.activeSuperAdminAccountIds.includes(accountId);
  const accountIsActiveSuperAdmin = asTrimmedString(account.status) === 'active'
    && normalizeAccountRole(account.role) === 'super_admin';
  if (rosterHasAccount !== accountIsActiveSuperAdmin) throw governanceNotReady();
}

function normalizeGovernanceOperationId(value) {
  const operationId = asTrimmedString(value);
  if (!GOVERNANCE_OPERATION_ID_PATTERN.test(operationId)) {
    throw new AppError('VALIDATION_ERROR', '缺少有效的 operationId。', 400, { field: 'operationId' });
  }
  const canonicalId = operationId.toLowerCase();
  const operationKeyHash = crypto.createHash('sha256')
    .update(`${SUPER_ADMIN_GOVERNANCE.operationPrefix}${canonicalId}`, 'utf8')
    .digest('hex');
  return {
    canonicalId,
    operationKeyHash,
    documentId: `op-${operationKeyHash}`,
  };
}

function expectedGovernanceRevision(input) {
  if (!Number.isInteger(input && input.expectedGovernanceRevision) || input.expectedGovernanceRevision < 1) {
    throw new AppError('VALIDATION_ERROR', '缺少有效的 expectedGovernanceRevision。', 400, { field: 'expectedGovernanceRevision' });
  }
  return input.expectedGovernanceRevision;
}

function canonicalizeFingerprintValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new AppError('VALIDATION_ERROR', '治理请求参数无效。', 400);
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeFingerprintValue);
  if (isPlainObject(value)) {
    return Object.keys(value).sort((left, right) => left.localeCompare(right)).reduce((result, key) => {
      if (value[key] !== undefined) result[key] = canonicalizeFingerprintValue(value[key]);
      return result;
    }, {});
  }
  throw new AppError('VALIDATION_ERROR', '治理请求参数无效。', 400);
}

function governanceRequestFingerprint(route, actorAccountId, targetAccountIds, input) {
  const normalizedInput = { ...input };
  delete normalizedInput.operationId;
  delete normalizedInput.requestId;
  const fingerprintSource = canonicalizeFingerprintValue({
    route,
    actorAccountId,
    targetAccountIds: [...targetAccountIds].sort((left, right) => left.localeCompare(right)),
    input: normalizedInput,
  });
  return crypto.createHash('sha256').update(JSON.stringify(fingerprintSource), 'utf8').digest('hex');
}

function isGovernanceTransactionConflict(error) {
  if (error instanceof AppError) return error.code === 'EMPLOYEE_CONFLICT';
  const code = String(error && (error.code || error.errCode || error.errorCode) || '').toLowerCase();
  return new Set(['employee_conflict', 'transaction_conflict']).has(code);
}

async function runGovernanceTransaction(db, work) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await runTransaction(db, work);
    } catch (error) {
      if (!isGovernanceTransactionConflict(error)) throw error;
      if (attempt === 3) {
        throw new AppError('SUPER_ADMIN_REVISION_CONFLICT', '账号状态已被其他操作更新，请刷新后重新确认。', 409);
      }
    }
  }
  throw new AppError('SUPER_ADMIN_REVISION_CONFLICT', '账号状态已被其他操作更新，请刷新后重新确认。', 409);
}

function governanceControlSummary(roster) {
  return {
    state: asTrimmedString(roster.state),
    activeCount: roster.activeSuperAdminAccountIds.length,
    limit: roster.limit,
    revision: roster.revision,
  };
}

function parsePage(input) {
  const page = Number.parseInt(input.page, 10);
  const pageSize = Number.parseInt(input.pageSize, 10);
  return {
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 100000) : 1,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 200) : 50,
  };
}

function normalizeEmployeeContract(value) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) {
    throw new AppError('VALIDATION_ERROR', '合同信息格式不正确。', 400, { field: 'contract' });
  }

  function contractText(field, label) {
    const fieldValue = value[field];
    if (fieldValue === null || fieldValue === undefined) return '';
    if (typeof fieldValue !== 'string') {
      throw new AppError('VALIDATION_ERROR', `${label}格式不正确。`, 400, { field });
    }
    return fieldValue.trim();
  }

  const contract = {
    type: contractText('type', '合同类型'),
    startDate: contractText('startDate', '合同开始日期'),
    endDate: contractText('endDate', '合同结束日期'),
    notes: contractText('notes', '合同备注'),
  };
  if (!Object.values(contract).some(Boolean)) return null;
  if (contract.startDate && !isValidDateOnly(contract.startDate)) {
    throw new AppError('VALIDATION_ERROR', '合同开始日期格式不正确，请使用 YYYY-MM-DD。', 400, { field: 'contractStartDate' });
  }
  if (contract.endDate && !isValidDateOnly(contract.endDate)) {
    throw new AppError('VALIDATION_ERROR', '合同结束日期格式不正确，请使用 YYYY-MM-DD。', 400, { field: 'contractEndDate' });
  }
  if (contract.startDate && contract.endDate && contract.endDate < contract.startDate) {
    throw new AppError('VALIDATION_ERROR', '合同结束日期不能早于开始日期。', 400, { field: 'contractEndDate' });
  }
  if (!contract.type) contract.type = '当前合同';
  return contract;
}

function employeeContractForWrite(contract, currentEmployee = null) {
  if (!isPlainObject(contract)) return contract;
  const currentContract = isPlainObject(currentEmployee && currentEmployee.contract)
    ? currentEmployee.contract
    : null;
  const legacyContract = legacyEmployeeContract(currentEmployee);
  return {
    ...contract,
    id: asTrimmedString(currentContract && currentContract.id)
      || asTrimmedString(legacyContract && legacyContract.id)
      || crypto.randomUUID(),
  };
}

function normalizeEmployeeVehicle(value) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) {
    throw new AppError('VALIDATION_ERROR', '车辆信息格式不正确。', 400, { field: 'vehicle' });
  }

  function vehicleText(field, label) {
    const fieldValue = value[field];
    if (fieldValue === null || fieldValue === undefined) return '';
    if (typeof fieldValue !== 'string') {
      throw new AppError('VALIDATION_ERROR', `${label}格式不正确。`, 400, { field: `vehicle.${field}` });
    }
    return fieldValue.trim();
  }

  const vehicle = {
    model: vehicleText('model', '车辆型号'),
    plateNumber: vehicleText('plateNumber', '车牌号码'),
    startDate: vehicleText('startDate', '车辆开始日期'),
    endDate: vehicleText('endDate', '车辆结束日期'),
    notes: vehicleText('notes', '车辆备注'),
  };
  if (!Object.values(vehicle).some(Boolean)) return null;
  if (vehicle.startDate && !isValidDateOnly(vehicle.startDate)) {
    throw new AppError('VALIDATION_ERROR', '车辆开始日期格式不正确，请使用 YYYY-MM-DD。', 400, { field: 'vehicle.startDate' });
  }
  if (vehicle.endDate && !isValidDateOnly(vehicle.endDate)) {
    throw new AppError('VALIDATION_ERROR', '车辆结束日期格式不正确，请使用 YYYY-MM-DD。', 400, { field: 'vehicle.endDate' });
  }
  if (vehicle.startDate && vehicle.endDate && vehicle.endDate < vehicle.startDate) {
    throw new AppError('VALIDATION_ERROR', '车辆使用结束日期不能早于开始日期。', 400, { field: 'vehicle.endDate' });
  }
  return vehicle;
}

function employeeVehicleForWrite(vehicle, currentEmployee, employeeId) {
  if (!isPlainObject(vehicle)) return vehicle;
  const currentVehicle = isPlainObject(currentEmployee && currentEmployee.vehicle)
    ? currentEmployee.vehicle
    : null;
  return {
    ...(currentVehicle || {}),
    ...vehicle,
    id: asTrimmedString(currentVehicle && currentVehicle.id) || `${employeeId}-vehicle`,
  };
}

function employeeVehicleForCreate(vehicle) {
  if (!isPlainObject(vehicle)) return vehicle;
  return { ...vehicle, id: crypto.randomUUID() };
}

function normalizeEmployeeInput(input, { partial = false } = {}) {
  const source = isPlainObject(input.employee) ? input.employee : input;
  const payload = {};

  for (const field of EMPLOYEE_FIELDS) {
    if (!hasOwn(source, field)) continue;
    const value = source[field];
    if (field === 'contract') {
      payload.contract = normalizeEmployeeContract(value);
      continue;
    }
    if (field === 'vehicle') {
      payload.vehicle = normalizeEmployeeVehicle(value);
      continue;
    }
    if (PHONE_FIELDS.has(field) && typeof value === 'string' && value.includes('****')) continue;
    if (Object.prototype.hasOwnProperty.call(EMPLOYMENT_DATE_LABELS, field) && value !== null && value !== undefined && typeof value !== 'string') {
      throw new AppError('VALIDATION_ERROR', `${EMPLOYMENT_DATE_LABELS[field]}格式不正确，请使用 YYYY-MM-DD。`, 400, { field });
    }
    if (value === null || value === undefined) {
      payload[field] = '';
    } else if (typeof value === 'string') {
      payload[field] = value.trim();
    } else {
      payload[field] = value;
    }
  }

  if (!hasOwn(source, 'contract') && Object.keys(LEGACY_CONTRACT_DRAFT_FIELDS).some((field) => hasOwn(source, field))) {
    const contractDraft = Object.entries(LEGACY_CONTRACT_DRAFT_FIELDS).reduce((result, [draftField, contractField]) => {
      if (hasOwn(source, draftField)) result[contractField] = source[draftField];
      return result;
    }, {});
    payload.contract = normalizeEmployeeContract(contractDraft);
  }

  if (!hasOwn(source, 'vehicle') && Object.keys(LEGACY_VEHICLE_DRAFT_FIELDS).some((field) => hasOwn(source, field))) {
    const vehicleDraft = Object.entries(LEGACY_VEHICLE_DRAFT_FIELDS).reduce((result, [draftField, vehicleField]) => {
      if (hasOwn(source, draftField)) result[vehicleField] = source[draftField];
      return result;
    }, {});
    payload.vehicle = normalizeEmployeeVehicle(vehicleDraft);
  }

  validateEmployeeEmploymentDates(payload);

  if (!partial && !asTrimmedString(payload.name)) {
    throw new AppError('VALIDATION_ERROR', '员工姓名不能为空。', 400, { field: 'name' });
  }
  if (!partial && !asTrimmedString(payload.department)) {
    throw new AppError('VALIDATION_ERROR', '部门或分组不能为空。', 400, { field: 'department' });
  }
  if (hasOwn(payload, 'name') && !asTrimmedString(payload.name)) {
    throw new AppError('VALIDATION_ERROR', '员工姓名不能为空。', 400, { field: 'name' });
  }
  if (hasOwn(payload, 'department') && !asTrimmedString(payload.department)) {
    throw new AppError('VALIDATION_ERROR', '部门或分组不能为空。', 400, { field: 'department' });
  }
  if (hasOwn(payload, 'status') && !['active', 'former', 'archived'].includes(payload.status)) {
    throw new AppError('VALIDATION_ERROR', '员工状态不合法。', 400, { field: 'status' });
  }

  return payload;
}

function normalizeStudentInput(input, { partial = false } = {}) {
  const source = isPlainObject(input) ? input : {};
  const allowedFields = new Set(['studentId', 'id', 'expectedVersion', 'name', 'phoneNumber']);
  const unsupportedField = Object.keys(source).find((field) => !allowedFields.has(field));
  if (unsupportedField) {
    throw new AppError('VALIDATION_ERROR', '学员档案只支持姓名和手机号字段。', 400, { field: unsupportedField });
  }

  const payload = {};
  if (hasOwn(source, 'name')) {
    const name = typeof source.name === 'string' ? source.name.normalize('NFKC').trim() : '';
    if (name.length < 2 || name.length > 64 || hasControlCharacters(name)) {
      throw new AppError('VALIDATION_ERROR', '请填写有效的学员姓名。', 400, { field: 'name' });
    }
    payload.name = name;
  } else if (!partial) {
    throw new AppError('VALIDATION_ERROR', '请填写学员姓名。', 400, { field: 'name' });
  }

  if (hasOwn(source, 'phoneNumber')) {
    const phoneNumber = normalizeStudentPhone(source.phoneNumber);
    if (!phoneNumber) {
      throw new AppError('VALIDATION_ERROR', '请填写有效的学员手机号。', 400, { field: 'phoneNumber' });
    }
    payload.phoneNumber = phoneNumber;
  } else if (!partial) {
    throw new AppError('VALIDATION_ERROR', '请填写学员手机号。', 400, { field: 'phoneNumber' });
  }

  return payload;
}

function getEmployeeId(input) {
  const employeeId = asTrimmedString(input.employeeId || input.id);
  if (!employeeId) {
    throw new AppError('VALIDATION_ERROR', '缺少 employeeId。', 400, { field: 'employeeId' });
  }
  return employeeId;
}

function getStudentId(input) {
  const studentId = asTrimmedString(input.studentId || input.id);
  if (!studentId) {
    throw new AppError('VALIDATION_ERROR', '缺少 studentId。', 400, { field: 'studentId' });
  }
  return studentId;
}

function validateTextField(value, field, { required = false, maxLength = 200 } = {}) {
  const text = asTrimmedString(value);
  if (required && !text) {
    throw new AppError('VALIDATION_ERROR', `${field}不能为空。`, 400, { field });
  }
  if (text.length > maxLength) {
    throw new AppError('VALIDATION_ERROR', `${field}不能超过${maxLength}个字符。`, 400, { field });
  }
  return text;
}

function isValidDateOnly(value) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validateEmployeeEmploymentDates(payload, current = null) {
  for (const [field, label] of Object.entries(EMPLOYMENT_DATE_LABELS)) {
    if (hasOwn(payload, field)) {
      const value = asTrimmedString(payload[field]);
      if (value && !isValidDateOnly(value)) {
        throw new AppError('VALIDATION_ERROR', `${label}格式不正确，请使用 YYYY-MM-DD。`, 400, { field });
      }
    }
  }

  const hireDate = hasOwn(payload, 'hireDate') ? asTrimmedString(payload.hireDate) : asTrimmedString(current && current.hireDate);
  const regularizationDate = hasOwn(payload, 'regularizationDate')
    ? asTrimmedString(payload.regularizationDate)
    : asTrimmedString(current && current.regularizationDate);
  if (hireDate && regularizationDate && isValidDateOnly(hireDate) && isValidDateOnly(regularizationDate) && regularizationDate < hireDate) {
    throw new AppError('VALIDATION_ERROR', '转正日期不能早于入职日期。', 400, { field: 'regularizationDate' });
  }
}

function normalizeEventFields(input) {
  const source = isPlainObject(input) ? input : {};
  const eventDate = asTrimmedString(source.eventDate);
  if (eventDate && !isValidDateOnly(eventDate)) {
    throw new AppError('VALIDATION_ERROR', '事件日期格式不正确，请使用 YYYY-MM-DD。', 400, {
      field: 'eventDate',
    });
  }

  return {
    eventDate,
    eventType: validateTextField(source.eventType || '特殊事件', '事件类型', { maxLength: 80 }),
    summary: validateTextField(source.summary, '事件名称', { required: true, maxLength: 200 }),
    detail: validateTextField(source.detail, '事件说明', { maxLength: 2000 }),
  };
}

function normalizeCourseFields(input) {
  const source = isPlainObject(input) ? input : {};
  const attendedDate = asTrimmedString(source.attendedDate);
  if (attendedDate && !isValidDateOnly(attendedDate)) {
    throw new AppError('VALIDATION_ERROR', '课程参加日期格式不正确，请使用 YYYY-MM-DD。', 400, {
      field: 'attendedDate',
    });
  }

  const status = asTrimmedString(source.status);
  if (!COURSE_STATUSES.has(status)) {
    throw new AppError(
      'VALIDATION_ERROR',
      '课程完成状态不合法，请选择已完成、未完成、部分记录、未知或不适用。',
      400,
      { field: 'status' },
    );
  }

  return {
    courseName: validateTextField(source.courseName, '课程名称', { required: true, maxLength: 200 }),
    status,
    attendedDate,
    note: validateTextField(source.note, '课程备注', { maxLength: 2000 }),
  };
}

function isValidEmployeeStorageKey(storageKey, employeeId, folder, expectedStorageAuthority) {
  const safeEmployeeId = asTrimmedString(employeeId);
  if (!/^[A-Za-z0-9_-]+$/.test(safeEmployeeId)) return false;

  const safeFolder = asTrimmedString(folder);
  if (!['events', 'attachments'].includes(safeFolder)) return false;

  const key = asTrimmedString(storageKey);
  if (!key.startsWith('cloud://')) return false;
  const schemeRemainder = key.slice('cloud://'.length);
  const authorityEnd = schemeRemainder.indexOf('/');
  const authority = authorityEnd > 0 ? schemeRemainder.slice(0, authorityEnd) : '';
  const objectPath = authorityEnd > 0 ? schemeRemainder.slice(authorityEnd + 1) : '';
  const expectedPrefix = `employee-archive/${safeFolder}/${safeEmployeeId}/`;
  const objectName = objectPath.startsWith(expectedPrefix)
    ? objectPath.slice(expectedPrefix.length)
    : '';

  return Boolean(
    authority &&
      expectedStorageAuthority &&
      authority === expectedStorageAuthority &&
      objectName &&
      !objectName.includes('/') &&
      !objectName.includes('\\') &&
      objectName !== '.' &&
      objectName !== '..' &&
      !hasControlCharacters(objectName) &&
      !/[?#]/.test(objectName),
  );
}

function isValidEventStorageKey(storageKey, employeeId, expectedStorageAuthority) {
  return isValidEmployeeStorageKey(storageKey, employeeId, 'events', expectedStorageAuthority);
}

function isValidGeneralAttachmentStorageKey(storageKey, employeeId, expectedStorageAuthority) {
  return isValidEmployeeStorageKey(storageKey, employeeId, 'attachments', expectedStorageAuthority);
}

function normalizeStoredImageAttachment(value, employeeId, expectedStorageAuthority, { folder, kind }) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    throw new AppError('VALIDATION_ERROR', '事件附件格式不正确。', 400, { field: 'attachment' });
  }

  const safeEmployeeId = asTrimmedString(employeeId);
  const storageKey = asTrimmedString(value.storageKey);
  const validStorageKey = isValidEmployeeStorageKey(
    storageKey,
    safeEmployeeId,
    folder,
    expectedStorageAuthority,
  );
  if (!validStorageKey) {
    throw new AppError('VALIDATION_ERROR', `${kind}存储位置不合法。`, 400, { field: 'attachment.storageKey' });
  }

  const fileName = validateTextField(value.fileName, '附件文件名', { required: true, maxLength: 255 });
  if (/[\\/]/.test(fileName) || hasControlCharacters(fileName)) {
    throw new AppError('VALIDATION_ERROR', '附件文件名不能包含路径或控制字符。', 400, {
      field: 'attachment.fileName',
    });
  }

  const mimeType = asTrimmedString(value.mimeType).toLowerCase();
  if (!ATTACHMENT_MIME_TYPES.has(mimeType)) {
    throw new AppError('VALIDATION_ERROR', `${kind}只支持 JPG、PNG、WEBP 或 GIF 图片。`, 400, {
      field: 'attachment.mimeType',
    });
  }

  const size = value.size;
  if (!Number.isSafeInteger(size) || size <= 0 || size > ATTACHMENT_MAX_BYTES) {
    throw new AppError('VALIDATION_ERROR', `${kind}大小必须大于 0 且不超过 10 MB。`, 400, {
      field: 'attachment.size',
    });
  }

  return { storageKey, fileName, mimeType, size };
}

function normalizeEventAttachment(value, employeeId, expectedStorageAuthority) {
  return normalizeStoredImageAttachment(value, employeeId, expectedStorageAuthority, {
    folder: 'events',
    kind: '特殊事件图片',
  });
}

function normalizeGeneralAttachment(value, employeeId, expectedStorageAuthority) {
  return normalizeStoredImageAttachment(value, employeeId, expectedStorageAuthority, {
    folder: 'attachments',
    kind: '员工附件图片',
  });
}

function getNestedRecordId(record) {
  return asTrimmedString(record && (record.id || record._id));
}

function findEventAttachment(employee, eventId, attachmentId) {
  const events = Array.isArray(employee && employee.events) ? employee.events : [];
  const targetEventId = asTrimmedString(eventId);
  const targetAttachmentId = asTrimmedString(attachmentId);
  const event = events.find((item) => getNestedRecordId(item) === targetEventId);
  if (!event) return null;
  const attachments = Array.isArray(event.attachments) ? event.attachments : [];
  const attachment = attachments.find((item) => getNestedRecordId(item) === targetAttachmentId);
  return attachment ? { event, attachment } : null;
}

function findGeneralAttachment(employee, attachmentId) {
  const attachments = Array.isArray(employee && employee.attachments) ? employee.attachments : [];
  const targetAttachmentId = asTrimmedString(attachmentId);
  const attachment = attachments.find((item) => getNestedRecordId(item) === targetAttachmentId);
  return attachment ? { attachment } : null;
}

function getTempFileUrl(result, storageKey) {
  const candidates = [];
  const addCandidates = (value) => {
    if (Array.isArray(value)) candidates.push(...value);
    else if (isPlainObject(value)) candidates.push(value);
  };
  addCandidates(result && result.fileList);
  addCandidates(result && result.data);
  if (result && result.data) addCandidates(result.data.fileList);
  addCandidates(result);

  const withUrl = candidates.filter((candidate) =>
    asTrimmedString(candidate.tempFileURL || candidate.tempUrl || candidate.url),
  );
  const item =
    withUrl.find((candidate) => asTrimmedString(candidate.fileID) === asTrimmedString(storageKey)) ||
    withUrl[0];
  if (!item) return '';
  return asTrimmedString(item.tempFileURL || item.tempUrl || item.url);
}

async function resolveStorageTempUrl(storage, storageKey, errorMessage) {
  if (!storage || typeof storage.getTempFileURL !== 'function') {
    throw new AppError('STORAGE_READ_FAILED', errorMessage);
  }

  let tempResult;
  try {
    tempResult = await storage.getTempFileURL({
      fileList: [{ fileID: storageKey, maxAge: 3600 }],
    });
  } catch {
    throw new AppError('STORAGE_READ_FAILED', errorMessage);
  }

  const url = getTempFileUrl(tempResult, storageKey);
  if (!url) throw new AppError('STORAGE_READ_FAILED', errorMessage);
  return url;
}

// These two registration routes never delete uploaded objects. Even a rejected
// invocation may be a retry of a committed invocation whose response was lost.
async function runImageRegistrationTransaction(db, work) {
  let writeAttempted = false;
  let commitAttempted = false;
  let rolledBack = false;
  const markWrite = () => { writeAttempted = true; };
  try {
    if (typeof db.startTransaction !== 'function') {
      // SDK-managed transactions do not expose rollback acknowledgement here.
      return await db.runTransaction(tx => work(tx, markWrite));
    }
    const tx = await db.startTransaction();
    try {
      const result = await work(tx, markWrite);
      commitAttempted = true;
      const committed = await tx.commit();
      assertTransactionWriteDidNotFail(committed, '图片登记事务未能确认提交。');
      if (committed && committed.ok === 0) throw new AppError('DATABASE_WRITE_FAILED', '图片登记事务未能确认提交。');
      return result;
    } catch (error) {
      try {
        const aborted = await tx.rollback();
        assertTransactionWriteDidNotFail(aborted, '图片登记事务未能确认回滚。');
        rolledBack = !aborted || aborted.ok !== 0;
      } catch { rolledBack = false; }
      throw error;
    }
  } catch (error) {
    const appError = toAppError(error);
    appError.details = {
      ...(appError.details || {}),
      submissionOutcome: !writeAttempted || (!commitAttempted && rolledBack) ? 'not_committed' : 'uncertain',
    };
    throw appError;
  }
}

function sameImageMetadata(stored, submitted, authUid) {
  return stored && stored.storageKey === submitted.storageKey
    && stored.fileName === submitted.fileName && stored.mimeType === submitted.mimeType
    && stored.size === submitted.size && stored.uploadedByAuthUid === authUid;
}

function changedFields(before, after) {
  const fields = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...fields].filter((field) => {
    if (UNTRUSTED_KEYS.has(field) || field === '_id' || field === 'id') return false;
    return JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field]);
  });
}

function maskPhone(value) {
  const text = asTrimmedString(value);
  if (text.length < 7) return text ? '已填写' : '';
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function auditSummary(record) {
  if (!isPlainObject(record)) return null;
  const summary = {};
  for (const key of [
    ...EMPLOYEE_FIELDS,
    'displayName',
    'username',
    'role',
    'permissions',
    'status',
    'employeeId',
    'employeeNameSnapshot',
    'identityVersion',
  ]) {
    if (!hasOwn(record, key)) continue;
    if (PHONE_FIELDS.has(key)) summary[key] = maskPhone(record[key]);
    else summary[key] = record[key];
  }
  if (hasOwn(record, 'monthKey')) summary.monthKey = asTrimmedString(record.monthKey);
  if (hasOwn(record, 'results')) summary.results = normalizeStoredMonthlyResults(record.results);
  if (hasOwn(record, 'note')) summary.note = typeof record.note === 'string' ? record.note : '';
  for (const field of [
    'activeCount',
    'limit',
    'revision',
    'state',
    'periodKey',
    'periodName',
    'taskId',
    'type',
    'status',
    'total',
    'version',
    'returnedReason',
    'voidReason',
    'evaluatorNameSnapshot',
    'evaluatorEmployeeIdSnapshot',
    'evaluatorStudentIdSnapshot',
    'evaluatorStudentNameSnapshot',
    'sourcePendingRelationId',
    'sourceRelationId',
    'assignedTaskId',
    'evaluateeEmployeeId',
    'evaluateeNameSnapshot',
    'evaluateeDepartmentSnapshot',
    'managementEdited',
    'actualOperatorName',
  ]) {
    if (hasOwn(record, field)) summary[field] = record[field];
  }
  if (hasOwn(record, 'scores')) summary.scores = normalizeStoredQuarterlyScores(record.scores);
  if (hasOwn(record, 'reasons')) summary.reasons = normalizeStoredQuarterlyReasons(record.reasons);
  return summary;
}

function normalizeStoredQuarterlyScores(value) {
  const source = isPlainObject(value) ? value : {};
  return QUARTERLY_DIMENSIONS.reduce((result, dimension) => {
    const score = source[dimension];
    result[dimension] = Number.isInteger(score) && score >= 0 && score <= 25 ? score : null;
    return result;
  }, {});
}

function normalizeStoredQuarterlyReasons(value) {
  const source = isPlainObject(value) ? value : {};
  return QUARTERLY_DIMENSIONS.reduce((result, dimension) => {
    result[dimension] = typeof source[dimension] === 'string'
      ? source[dimension].normalize('NFC').replace(/\r\n?/g, '\n').trim()
      : '';
    return result;
  }, {});
}

function auditPublicRecord(record) {
  if (!isPlainObject(record)) return null;
  const projection = {
    actorNameSnapshot: asTrimmedString(record.actorDisplayName) || '未命名账号',
    actorUsername: asTrimmedString(record.actorUsername),
    action: asTrimmedString(record.action),
    targetNameSnapshot: asTrimmedString(record.targetNameSnapshot) || null,
    changedFields: Array.isArray(record.changedFields)
      ? record.changedFields.filter((field) => !isOutputHiddenKey(field))
      : [],
    before: auditSummary(record.before),
    after: auditSummary(record.after),
    result: ['success', 'failure', 'unknown'].includes(record.result) ? record.result : 'success',
    requestId: asTrimmedString(record.requestId),
    createdAt: record.createdAt || null,
  };
  const detail = asTrimmedString(record.detail);
  if (detail) projection.detail = detail;
  const id = getRecordId(record);
  // Governance document IDs contain the internal operation key hash. Derive a
  // stable public identifier for historical rows without exposing that key.
  if (id) projection.id = id.startsWith('governance-audit:')
    ? `audit-public:${crypto.createHash('sha256').update('employee-archive/audit-public/v1\0').update(id).digest('hex')}`
    : id;
  if (record.targetType === 'account') projection.targetType = 'account';
  const originalEvaluatorName = asTrimmedString(record.originalEvaluatorNameSnapshot);
  const actualOperatorName = asTrimmedString(record.actualOperatorNameSnapshot);
  const reason = asTrimmedString(record.reason);
  const verificationMethod = asTrimmedString(record.verificationMethod);
  const invitationId = asTrimmedString(record.invitationId);
  const invitationIssuerName = asTrimmedString(record.invitationIssuerNameSnapshot);
  if (originalEvaluatorName) projection.originalEvaluatorNameSnapshot = originalEvaluatorName;
  if (actualOperatorName) projection.actualOperatorNameSnapshot = actualOperatorName;
  if (reason) projection.reason = reason;
  if (verificationMethod) projection.verificationMethod = verificationMethod;
  if (invitationId) projection.invitationId = invitationId;
  if (invitationIssuerName) projection.invitationIssuerNameSnapshot = invitationIssuerName;
  return projection;
}

function toAppError(error) {
  if (error instanceof AppError) return error;
  return new AppError('INTERNAL_ERROR', '服务暂时不可用，请联系系统管理员。');
}

function successResponse(requestId, data) {
  return { ok: true, requestId, data };
}

function errorResponse(requestId, error) {
  const appError = toAppError(error);
  const response = {
    ok: false,
    requestId,
    error: {
      code: appError.code,
      message: appError.message,
      status: appError.status,
    },
  };
  if (appError.details && isPlainObject(appError.details)) response.error.details = appError.details;
  return response;
}

function safeErrorCode(error) {
  return toAppError(error).code;
}

function safeProviderErrorCode(error) {
  const providerError = error && (error.code || error.errCode || error.errorCode || error.Code)
    ? error
    : error && (error.Error || (error.Response && error.Response.Error));
  const value = asTrimmedString(providerError
    && (providerError.code || providerError.errCode || providerError.errorCode || providerError.Code)).toUpperCase();
  return /^[A-Z0-9_.-]{1,64}$/.test(value) ? value : '';
}

function isInvalidRegistrationProviderParameter(error) {
  const code = safeProviderErrorCode(error);
  // These codes are explicit rejections, so the create call did not create an
  // account. A transport failure or a message mentioning validation is unknown.
  return code === 'INVALID_PARAM' || code === 'TCBAUTH.INVALID_PARAM'
    || /^INVALIDPARAMETER(?:VALUE)?(?:\.[A-Z0-9_-]+)*$/.test(code);
}

const REGISTRATION_DIAGNOSTIC_REASON_CODES = new Set([
  'INPUT_VALIDATION_FAILED',
  'MANAGER_INITIALIZATION_FAILED',
  'MANAGER_CAPABILITY_MISSING',
  'AUTH_PROVIDER_UID_MISSING',
  'USERNAME_ALREADY_TAKEN',
  'REGISTRATION_REQUEST_FAILED',
  'IDENTITY_LOOKUP_FAILED',
  'IDENTITY_PHONE_POST_RESERVATION_AMBIGUOUS',
  'IDENTITY_PHONE_POST_RESERVATION_CHANGED',
  'IDENTITY_PHONE_PREFLIGHT_AMBIGUOUS',
  'IDENTITY_PHONE_PREFLIGHT_UNMATCHED',
  'IDENTITY_PHONE_RECHECK_AMBIGUOUS',
  'IDENTITY_PHONE_RECHECK_CHANGED',
  'IDENTITY_PROFILE_INVALID',
  'EMPLOYEE_PHONE_PREFLIGHT_UNMATCHED',
  'EMPLOYEE_PHONE_RECHECK_CHANGED',
  'EMPLOYEE_PROFILE_INVALID',
  'EMPLOYEE_LOOKUP_FAILED',
  'ACCOUNT_STATUS_LOOKUP_FAILED',
  'ACCOUNT_ALREADY_BOUND',
  'IDENTITY_CLAIM_CONFLICT',
  'ACCOUNT_DOCUMENT_CONFLICT',
  'RESERVATION_TRANSACTION_FAILED',
  'USERNAME_PREFLIGHT_FAILED',
  'AUTH_PROVIDER_CREATE_FAILED',
  'POST_AUTH_STAGING_FAILED',
  'RECOVERY_STATE_WRITE_FAILED',
  'REGISTRATION_ACTIVATION_FAILED',
  'REGISTRATION_AUDIT_WRITE_FAILED',
]);

const REGISTRATION_DIAGNOSTIC_ERROR_CODES = new Set([
  ...Object.keys(ERROR_STATUS),
  'REGISTRATION_EMPLOYEE_MATCH_FAILED',
]);

function logPhoneRegistrationDiagnostic({ requestId, reasonCode, error }) {
  const safeReasonCode = REGISTRATION_DIAGNOSTIC_REASON_CODES.has(reasonCode)
    ? reasonCode
    : 'RESERVATION_TRANSACTION_FAILED';
  const candidateErrorCode = safeErrorCode(error);
  const safeCode = REGISTRATION_DIAGNOSTIC_ERROR_CODES.has(candidateErrorCode)
    ? candidateErrorCode
    : 'INTERNAL_ERROR';
  const safeRequestId = String(requestId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
  const diagnostic = {
    requestId: safeRequestId,
    reasonCode: safeReasonCode,
    errorCode: safeCode,
  };
  const field = isPlainObject(error && error.details) ? asTrimmedString(error.details.field) : '';
  if (['username', 'password', 'phoneNumber', 'role', 'registration'].includes(field)) {
    diagnostic.field = field;
  }
  const providerErrorCode = safeReasonCode === 'AUTH_PROVIDER_CREATE_FAILED'
    ? safeProviderErrorCode(error)
    : '';
  if (providerErrorCode) diagnostic.providerErrorCode = providerErrorCode;
  console.warn('[employeeArchiveApi] phone registration diagnostic', diagnostic);
}

function appendAuditFactory({ db, actor, requestId, now }) {
  return async function appendAudit({
    database = db,
    action,
    targetId = null,
    targetName = null,
    changed = [],
    before = null,
    after = null,
    targetType,
    result,
    detail,
    originalEvaluatorAccountId = null,
    originalEvaluatorNameSnapshot = null,
    actualOperatorNameSnapshot = null,
    reason = null,
  }) {
    const record = {
      actorAccountId: actor.accountId,
      actorAuthUid: actor.authUid,
      actorUsername: actor.username,
      actorDisplayName: actor.displayName,
      action,
      targetType: targetType || (targetId ? 'employee' : 'session'),
      targetId,
      targetNameSnapshot: targetName,
      changedFields: changed,
      before: auditSummary(before),
      after: auditSummary(after),
      result,
      detail,
      requestId,
      createdAt: now(),
    };
    if (originalEvaluatorAccountId) record.originalEvaluatorAccountId = originalEvaluatorAccountId;
    if (originalEvaluatorNameSnapshot) record.originalEvaluatorNameSnapshot = originalEvaluatorNameSnapshot;
    if (actualOperatorNameSnapshot) record.actualOperatorNameSnapshot = actualOperatorNameSnapshot;
    if (reason) record.reason = reason;

    try {
      const addResult = await database.collection(COLLECTIONS.auditLogs).add(record);
      return { ...record, _id: getDocumentId(addResult) };
    } catch (error) {
      throw new AppError('AUDIT_WRITE_FAILED', '操作已被阻止：审计日志写入失败，请稍后重试。', 502, {
        cause: safeErrorCode(error),
      });
    }
  };
}

async function appendAuditDocument({ database, actor, requestId, action, targetId = null, targetName = null, changed = [], before = null, after = null, targetType, result, detail, verificationMethod, invitationId, invitationIssuerAccountId, invitationIssuerAuthUid, invitationIssuerNameSnapshot, now }) {
  const record = {
    actorAccountId: actor.accountId,
    actorUsername: actor.username,
    actorDisplayName: actor.displayName,
    action,
    targetType: targetType || (targetId ? 'employee' : 'session'),
    targetId,
    targetNameSnapshot: targetName,
    changedFields: changed,
    before: auditSummary(before),
    after: auditSummary(after),
    result,
    detail,
    requestId,
    createdAt: now(),
  };
  if (verificationMethod) record.verificationMethod = verificationMethod;
  if (invitationId) record.invitationId = invitationId;
  if (invitationIssuerAccountId) record.invitationIssuerAccountId = invitationIssuerAccountId;
  if (invitationIssuerAuthUid) record.invitationIssuerAuthUid = invitationIssuerAuthUid;
  if (invitationIssuerNameSnapshot) record.invitationIssuerNameSnapshot = invitationIssuerNameSnapshot;
  const documentId = `audit:${crypto.createHash('sha256').update(`${requestId}:${action}`, 'utf8').digest('hex').slice(0, 48)}`;
  try {
    await database.collection(COLLECTIONS.auditLogs).doc(documentId).set(record);
    return { ...record, _id: documentId };
  } catch (error) {
    throw new AppError('AUDIT_WRITE_FAILED', '操作已被阻止：审计日志写入失败，请稍后重试。', 502, {
      cause: safeErrorCode(error),
    });
  }
}

async function appendGovernanceAuditDocument({ database, actor, requestId, operationKeyHash, suffix, action, targetType = 'account', targetId = null, targetName = null, changed = [], before = null, after = null, detail, createdAt }) {
  const record = {
    actorAccountId: actor.accountId,
    actorUsername: actor.username,
    actorDisplayName: actor.displayName,
    action,
    targetType,
    targetId,
    targetNameSnapshot: targetName || null,
    changedFields: changed,
    before: auditSummary(before),
    after: auditSummary(after),
    result: 'success',
    detail,
    requestId,
    createdAt,
  };
  const documentId = `governance-audit:${operationKeyHash}:${suffix}`;
  try {
    const writeResult = await database.collection(COLLECTIONS.auditLogs).doc(documentId).set(record);
    assertTransactionWriteDidNotFail(writeResult, '治理审计日志未能与账号变更一同提交。');
  } catch (error) {
    if (error instanceof AppError && error.code === 'AUDIT_WRITE_FAILED') throw error;
    throw new AppError('AUDIT_WRITE_FAILED', '治理审计日志未能与账号变更一同提交。', 502, {
      cause: safeErrorCode(error),
    });
  }
  return { ...record, _id: documentId };
}

function managerUserId(result) {
  const data = isPlainObject(result && result.Data) ? result.Data : isPlainObject(result && result.data) ? result.data : result;
  return asTrimmedString(data && (data.Uid || data.uid || data.UserId || data.userId));
}

function managerUserRecords(result) {
  const data = isPlainObject(result && result.Data) ? result.Data : isPlainObject(result && result.data) ? result.data : result;
  if ((result && (result.Error || result.error || (result.Response && result.Response.Error)))
    || !data || !Array.isArray(data.UserList) || data.UserList.some((user) => !isPlainObject(user))) {
    throw new AppError('REGISTRATION_RECOVERY_UNAVAILABLE', '暂时无法核对注册账号状态，请稍后刷新。', 503);
  }
  return data.UserList;
}

function managerUserName(user) {
  return asTrimmedString(user && (user.Name || user.name));
}

function managerUserStatus(user) {
  return asTrimmedString(user && (user.UserStatus || user.userStatus)).toUpperCase();
}

async function managerUsersByUid(manager, uid) {
  const result = await manager.user.describeUserList({ uidList: [uid], pageNo: 1, pageSize: 10 });
  return managerUserRecords(result).filter((user) => asTrimmedString(user.Uid || user.uid) === uid);
}

async function managerUsersByName(manager, name) {
  const normalizedName = name.toLowerCase();
  const pageSize = 100;
  const maxPages = 10;
  // Scan the bounded user list because a provider's name filter may be case
  // sensitive while registration claims store the normalized username.
  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const result = await manager.user.describeUserList({ pageNo, pageSize });
    const users = managerUserRecords(result);
    const matches = users.filter((user) => managerUserName(user).toLowerCase() === normalizedName);
    if (matches.length) return matches;
    const data = isPlainObject(result && result.Data) ? result.Data : isPlainObject(result && result.data) ? result.data : result;
    const readCount = (pageNo - 1) * pageSize + users.length;
    if (users.some((user) => !managerUserName(user))
      || (hasOwn(data, 'Total') && (!Number.isInteger(data.Total) || data.Total < readCount
        || (users.length < pageSize && data.Total > readCount)))) {
      throw new AppError('REGISTRATION_RECOVERY_UNAVAILABLE', '注册账号状态核对未完成，请联系管理员进一步核对。', 503);
    }
    if (users.length < pageSize) return [];
  }
  throw new AppError('REGISTRATION_RECOVERY_UNAVAILABLE', '注册账号状态核对未完成，请联系管理员进一步核对。', 503);
}

function isDuplicateUsernameError(error) {
  const code = safeProviderErrorCode(error);
  const leafCode = code.replace(/^TCBAUTH\./, '');
  return code === 'FAILEDOPERATION.DUPLICATEDDATA'
    || /^(?:DUPLICATE_USERNAME|USERNAME_TAKEN|(?:USER|USERNAME|ACCOUNT)_(?:ALREADY_)?EXISTS)$/.test(leafCode);
}

async function setAndVerifyManagerUserStatus(manager, authUid, requestedStatus) {
  if (!manager || !manager.user || typeof manager.user.modifyUser !== 'function'
    || typeof manager.user.describeUserList !== 'function') {
    throw new AppError('REGISTRATION_RECOVERY_REQUIRED', '注册服务缺少安全启用或状态核验能力，请联系管理员。', 503);
  }
  let modifyError = null;
  try {
    const result = await manager.user.modifyUser({ uid: authUid, userStatus: requestedStatus });
    const data = isPlainObject(result && result.Data) ? result.Data : isPlainObject(result && result.data) ? result.data : result;
    if (data && data.Success === false) modifyError = new Error('CloudBase user status change was rejected');
  } catch (error) {
    modifyError = error;
  }
  try {
    const result = await manager.user.describeUserList({ uidList: [authUid] });
    const data = isPlainObject(result && result.Data) ? result.Data : isPlainObject(result && result.data) ? result.data : result;
    const users = Array.isArray(data && data.UserList) ? data.UserList : [];
    const current = users.find((user) => asTrimmedString(user && (user.Uid || user.uid)) === authUid);
    if (asTrimmedString(current && (current.UserStatus || current.userStatus)).toUpperCase() === requestedStatus) {
      return { verified: true, status: requestedStatus };
    }
  } catch {
    // The result stays unknown; do not infer a status from the modify call alone.
  }
  const code = modifyError ? safeErrorCode(modifyError) : 'REGISTRATION_STATUS_UNVERIFIED';
  throw new AppError('REGISTRATION_RECOVERY_REQUIRED', `CloudBase 账号状态未能确认为${requestedStatus}，请管理员核对后再继续。`, 503, { cause: code });
}

function identityClaimDocumentId(subjectId, subjectType = 'employee') {
  const normalizedSubjectId = asTrimmedString(subjectId);
  const prefix = subjectType === 'student' ? 'student-identity' : 'employee-identity';
  return `${prefix}:${crypto.createHash('sha256').update(normalizedSubjectId, 'utf8').digest('hex')}`;
}

function registrationAccountDocumentId(subjectId, subjectType = 'employee') {
  const normalizedSubjectId = asTrimmedString(subjectId);
  const prefix = subjectType === 'student' ? 'student-account' : 'employee-account';
  return `${prefix}:${crypto.createHash('sha256').update(normalizedSubjectId, 'utf8').digest('hex').slice(0, 40)}`;
}

async function registrationEmployeeSnapshot(database, employeeId) {
  const employee = getDocument(await database.collection(COLLECTIONS.employees).doc(employeeId).get());
  if (!isEmployeeRecord(employee)) throw new AppError('EMPLOYEE_NOT_FOUND', '未找到对应的员工档案。');
  if (asTrimmedString(employee.status) !== 'active') {
    throw new AppError('EMPLOYEE_INACTIVE', '只能绑定在职员工档案。', 409);
  }
  const name = asTrimmedString(employee.name);
  if (name.length < 2 || name.length > 64 || hasControlCharacters(name)) {
    throw new AppError('EMPLOYEE_NOT_FOUND', '员工档案姓名信息不完整，暂不能绑定。');
  }
  return {
    employeeId: getRecordId(employee) || employeeId,
    employeeName: name,
    department: asTrimmedString(employee.department),
  };
}

const PHONE_REGISTRATION_METHOD = 'personal_phone_match';
const DIRECTORY_PHONE_GUARD_ID = 'system:directory-phone-guard';
const DIRECTORY_PHONE_PAGE_SIZE = 100;

async function directoryPhoneGuardRevision(database) {
  let guard;
  try {
    guard = getDocument(await database.collection(COLLECTIONS.employees).doc(DIRECTORY_PHONE_GUARD_ID).get());
  } catch {
    throw new AppError('DATABASE_READ_FAILED', '人员手机号校验状态暂时无法读取，请稍后重试。');
  }
  if (!guard || getRecordId(guard) !== DIRECTORY_PHONE_GUARD_ID) return 0;
  if (guard.recordType !== 'phone_guard' || !Number.isSafeInteger(guard.revision) || guard.revision < 1) {
    throw new AppError('DATABASE_READ_FAILED', '人员手机号校验状态无效，请联系管理员。');
  }
  return guard.revision;
}

async function advanceDirectoryPhoneGuard(transaction, expectedRevision) {
  if (await directoryPhoneGuardRevision(transaction) !== expectedRevision) {
    throw new AppError('PHONE_DIRECTORY_CONFLICT', '人员档案已更新，请刷新后重新核对手机号。', 409);
  }
  const result = await transaction.collection(COLLECTIONS.employees).doc(DIRECTORY_PHONE_GUARD_ID).set({
    recordType: 'phone_guard', revision: expectedRevision + 1,
  });
  assertTransactionWriteDidNotFail(result, '人员手机号校验状态未能写入。');
}

async function listActiveRegistrationRows(database, fields, expectedType) {
  const allRows = [];
  try {
    for (let page = 0; ; page += 1) {
      let query = database.collection(COLLECTIONS.employees).where({ status: 'active' });
      if (typeof query.field !== 'function'
        || typeof query.orderBy !== 'function'
        || typeof query.skip !== 'function'
        || typeof query.limit !== 'function') {
        throw new Error('Directory query pagination is unavailable');
      }
      query = query.field(fields).orderBy('_id', 'asc').skip(page * DIRECTORY_PHONE_PAGE_SIZE).limit(DIRECTORY_PHONE_PAGE_SIZE);
      const batch = getRows(await query.get());
      allRows.push(...batch);
      if (batch.length < DIRECTORY_PHONE_PAGE_SIZE) return allRows.filter(expectedType);
    }
  } catch {
    throw new AppError('DATABASE_READ_FAILED', '当前无法完整核对人员档案手机号，请稍后重试。');
  }
}

function phoneRegistrationMatchFailed() {
  return new AppError('REGISTRATION_EMPLOYEE_MATCH_FAILED', '未能完成档案身份匹配，请核对档案中登记的手机号后重试，或联系管理员。', 400);
}

function registrationEmployeeProfileInvalid() {
  return new AppError('REGISTRATION_EMPLOYEE_INVALID', '员工档案资料不完整，暂不能注册，请联系管理员。', 409);
}

function registrationIdentityClaimed() {
  return new AppError('REGISTRATION_IDENTITY_CLAIMED', '当前员工身份状态无法继续注册，请联系管理员。', 409);
}

async function listActiveRegistrationEmployees(database) {
  return listActiveRegistrationRows(database,
    { _id: true, recordType: true, name: true, department: true, status: true, personalPhone: true },
    (record) => isEmployeeRecord(record));
}

async function listActiveRegistrationStudents(database) {
  return listActiveRegistrationRows(database,
    { _id: true, recordType: true, name: true, status: true, phoneNumber: true },
    (record) => isStudentRecord(record));
}

function registrationSubjectSnapshot(subjectType, subject) {
  const subjectId = getRecordId(subject);
  const name = asTrimmedString(subject && subject.name);
  const status = asTrimmedString(subject && subject.status);
  if (!subjectId || status !== 'active' || name.length < 2 || name.length > 64 || hasControlCharacters(name)) {
    throw new AppError('REGISTRATION_IDENTITY_INVALID', '档案资料不完整，暂不能注册，请联系管理员。', 409);
  }
  return {
    subjectType,
    subjectId,
    name,
    employeeId: subjectType === 'employee' ? subjectId : null,
    studentId: subjectType === 'student' ? subjectId : null,
    department: subjectType === 'employee' ? asTrimmedString(subject.department) : '',
  };
}

function registrationIdentityMatchAmbiguous() {
  return new AppError('REGISTRATION_IDENTITY_MATCH_AMBIGUOUS', '该手机号关联多个身份，暂不能注册，请联系管理员核对。', 409);
}

async function registrationSubjectByPhoneSnapshot(database, phoneNumber, expectedSubjectType = '', expectedSubjectId = '') {
  // Keep the revision from before the complete scan with its result. Transaction
  // retries must reject this scan if a directory writer advances the guard.
  const phoneScanRevision = await directoryPhoneGuardRevision(database);
  const [employees, students] = await Promise.all([
    listActiveRegistrationEmployees(database),
    listActiveRegistrationStudents(database),
  ]);
  const matches = [
    ...employees
      .filter((employee) => asTrimmedString(employee.status) === 'active'
        && normalizeRegistrationPhone(employee.personalPhone) === phoneNumber)
      .map((employee) => ({ subjectType: 'employee', subject: employee })),
    ...students
      .filter((student) => asTrimmedString(student.status) === 'active'
        && normalizeRegistrationPhone(student.phoneNumber) === phoneNumber)
      .map((student) => ({ subjectType: 'student', subject: student })),
  ];
  if (matches.length > 1) throw registrationIdentityMatchAmbiguous();
  if (matches.length !== 1) throw phoneRegistrationMatchFailed();
  const match = matches[0];
  if (expectedSubjectType && (match.subjectType !== expectedSubjectType || getRecordId(match.subject) !== expectedSubjectId)) {
    throw phoneRegistrationMatchFailed();
  }
  return { ...registrationSubjectSnapshot(match.subjectType, match.subject), phoneScanRevision };
}

async function registrationSubjectByIdSnapshot(database, phoneNumber, subjectType, subjectId) {
  let subject;
  try {
    subject = getDocument(await database.collection(COLLECTIONS.employees).doc(subjectId).get());
  } catch {
    throw new AppError('DATABASE_READ_FAILED', '当前无法核对人员档案，请稍后重试。');
  }
  const storedPhone = subjectType === 'student' ? subject && subject.phoneNumber : subject && subject.personalPhone;
  const correctRecordType = subjectType === 'student' ? isStudentRecord(subject) : isEmployeeRecord(subject);
  if (!correctRecordType || asTrimmedString(subject.status) !== 'active' || normalizeRegistrationPhone(storedPhone) !== phoneNumber) {
    throw phoneRegistrationMatchFailed();
  }
  return registrationSubjectSnapshot(subjectType, subject);
}

async function runPhoneRegistrationTransaction({ db, phoneNumber, subjectType, subjectId, work, maxAttempts = 5 }) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const subject = await registrationSubjectByPhoneSnapshot(db, phoneNumber, subjectType, subjectId);
    try {
      return await runTransaction(db, async (transaction) => {
        await advanceDirectoryPhoneGuard(transaction, subject.phoneScanRevision);
        await registrationSubjectByIdSnapshot(transaction, phoneNumber, subjectType, subjectId);
        return work(transaction, subject);
      });
    } catch (error) {
      lastError = error;
      const code = toAppError(error).code;
      const retryable = code === 'EMPLOYEE_CONFLICT' || code === 'PHONE_DIRECTORY_CONFLICT';
      if (!retryable || attempt + 1 >= maxAttempts) throw error;
      // Registration and directory edits share a guard document. Refresh the
      // full phone match before retrying so a conflict cannot bind stale data.
      await new Promise((resolve) => setTimeout(resolve, Math.min(30 * (2 ** attempt), 240)));
    }
  }
  throw lastError;
}

function registrationIdentityFields(subject) {
  return subject.subjectType === 'student'
    ? { studentId: subject.subjectId, studentNameSnapshot: subject.name }
    : { employeeId: subject.subjectId, employeeNameSnapshot: subject.name };
}

function registrationIdentityMatches(record, subject) {
  if (!isPlainObject(record) || !subject) return false;
  const expectedField = subject.subjectType === 'student' ? 'studentId' : 'employeeId';
  const otherField = subject.subjectType === 'student' ? 'employeeId' : 'studentId';
  return asTrimmedString(record[expectedField]) === subject.subjectId
    && !asTrimmedString(record[otherField]);
}

function registrationIdentityLabel(subjectType) {
  return subjectType === 'student' ? '学员' : '员工';
}

async function findRegistrationEmployeeByPhone(database, phoneNumber) {
  const matches = (await listActiveRegistrationEmployees(database)).filter((employee) => (
    asTrimmedString(employee.status) === 'active'
    && normalizeRegistrationPhone(employee.personalPhone) === phoneNumber
  ));
  return matches.length === 1 ? matches[0] : null;
}

async function registrationEmployeeByPhoneSnapshot(database, phoneNumber, expectedEmployeeId = '') {
  let employee;
  let employeeId = asTrimmedString(expectedEmployeeId);
  if (employeeId) {
    try {
      employee = getDocument(await database.collection(COLLECTIONS.employees).doc(employeeId).get());
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '当前无法核对员工档案，请稍后重试。');
    }
    if (!employee
      || asTrimmedString(employee.status) !== 'active'
      || normalizeRegistrationPhone(employee.personalPhone) !== phoneNumber) {
      throw phoneRegistrationMatchFailed();
    }
  } else {
    employee = await findRegistrationEmployeeByPhone(database, phoneNumber);
    if (!employee) throw phoneRegistrationMatchFailed();
    employeeId = getRecordId(employee);
  }
  const name = asTrimmedString(employee.name);
  if (!employeeId || name.length < 2 || name.length > 64 || hasControlCharacters(name)) {
    throw registrationEmployeeProfileInvalid();
  }
  return {
    employeeId,
    employeeName: name,
    department: asTrimmedString(employee.department),
  };
}

async function releasePhoneRegistrationReservation({ db, claimId, registrationAttemptId, previousClaimStatus, now }) {
  await runTransaction(db, async (transaction) => {
    const claimReference = transaction.collection(COLLECTIONS.identityClaims).doc(claimId);
    const claim = getDocument(await claimReference.get());
    if (!claim
      || asTrimmedString(claim.registrationAttemptId) !== registrationAttemptId
      || asTrimmedString(claim.status) !== 'creating') {
      throw new AppError('REGISTRATION_RECOVERY_REQUIRED', '注册状态需要管理员核对后才能继续，请勿重复注册。', 503);
    }
    await claimReference.update({
      status: previousClaimStatus,
      accountId: '',
      authUid: '',
      usernameNormalized: '',
      registrationAttemptId: '',
      registrationVerificationMethod: '',
      previousClaimStatus: '',
      reservedAt: '',
      recoveryCode: '',
      recoveryDetectedAt: '',
      updatedAt: now(),
    });
  });
}

async function recoverPhoneRegistrationReservation({ db, claimId, registrationAttemptId, authUid, errorCode, now, requestId }) {
  try {
    await runTransaction(db, async (transaction) => {
      const claimReference = transaction.collection(COLLECTIONS.identityClaims).doc(claimId);
      const claim = getDocument(await claimReference.get());
      if (!claim || asTrimmedString(claim.registrationAttemptId) !== registrationAttemptId) return;
      const nowValue = now();
      const claimUpdate = {
        status: 'recovery_required',
        recoveryCode: asTrimmedString(errorCode) || 'REGISTRATION_PROVIDER_ERROR',
        recoveryDetectedAt: nowValue,
        updatedAt: nowValue,
      };
      if (authUid) claimUpdate.authUid = authUid;
      await claimReference.update(claimUpdate);
      // Recovery owns only this registration reservation. Account activation
      // is completed by the final registration transaction, while role/status
      // changes for existing accounts go through the governance roster lock.
    });
  } catch (error) {
    logPhoneRegistrationDiagnostic({
      requestId,
      reasonCode: 'RECOVERY_STATE_WRITE_FAILED',
      error,
    });
  }
}

async function completePhoneRegistrationActivation({
  db,
  claimId,
  accountId,
  identitySnapshot,
  authUid,
  registrationAttemptId,
  requestId,
  now,
  auditActor = null,
  auditAction = 'register_account_activation_confirmed',
  auditDetailPrefix = '',
}) {
  const activatedAt = now();
  const phoneNumber = normalizeRegistrationPhone(identitySnapshot && identitySnapshot.phoneNumber);
  const complete = async (transaction) => {
    const claimReference = transaction.collection(COLLECTIONS.identityClaims).doc(claimId);
    const claim = getDocument(await claimReference.get());
    if (!claim
      || asTrimmedString(claim.status) !== 'linked'
      || asTrimmedString(claim.registrationAttemptId) !== registrationAttemptId
      || asTrimmedString(claim.accountId) !== accountId
      || asTrimmedString(claim.authUid) !== authUid
      || !registrationIdentityMatches(claim, identitySnapshot)
      || asTrimmedString(claim.registrationVerificationMethod) !== PHONE_REGISTRATION_METHOD) {
      throw new AppError('REGISTRATION_RECOVERY_REQUIRED', '注册激活状态已变化，需要管理员核对后才能完成。', 503);
    }

    const accountReference = transaction.collection(COLLECTIONS.adminAccounts).doc(accountId);
    const account = getDocument(await accountReference.get());
    if (!account
      || asTrimmedString(account.authUid) !== authUid
      || !registrationIdentityMatches(account, identitySnapshot)
      || asTrimmedString(account.status) !== 'pending_activation'
      || asTrimmedString(account.role) !== 'user'
      || !Array.isArray(account.permissions)
      || account.permissions.length !== 0) {
      throw new AppError('REGISTRATION_RECOVERY_REQUIRED', '注册账号状态已变化，需要管理员核对后才能完成。', 503);
    }

    const activatedAccount = {
      ...account,
      _id: getRecordId(account) || accountId,
      status: 'active',
      updatedAt: activatedAt,
    };
    await accountReference.update({ status: 'active', updatedAt: activatedAt });
    await appendAuditDocument({
      database: transaction,
      actor: auditActor || buildActor(activatedAccount, { authUid }),
      requestId,
      action: auditAction,
      targetId: accountId,
      targetName: asTrimmedString(account.displayName),
      targetType: 'account',
      changed: ['CloudBase 登录状态', '账号状态'],
      before: accountAuditSnapshot(account),
      after: accountAuditSnapshot(activatedAccount),
      result: 'success',
      detail: `${auditDetailPrefix}已核实 CloudBase 账号“${asTrimmedString(account.username)}”处于激活状态，并关联${registrationIdentityLabel(identitySnapshot.subjectType)}“${identitySnapshot.name}”；身份匹配方式为档案登记手机号。`,
      verificationMethod: PHONE_REGISTRATION_METHOD,
      now: () => activatedAt,
    });
    return activatedAccount;
  };

  try {
    return await runPhoneRegistrationTransaction({
      db,
      phoneNumber,
      subjectType: identitySnapshot.subjectType,
      subjectId: identitySnapshot.subjectId,
      work: complete,
    });
  } catch (error) {
    // A commit acknowledgement can be lost after the database has committed.
    // Treat only the exact completed account-and-claim pair as success.
    try {
      const [claim, account] = await Promise.all([
        db.collection(COLLECTIONS.identityClaims).doc(claimId).get().then(getDocument),
        db.collection(COLLECTIONS.adminAccounts).doc(accountId).get().then(getDocument),
      ]);
      if (claim
        && asTrimmedString(claim.status) === 'linked'
        && asTrimmedString(claim.registrationAttemptId) === registrationAttemptId
        && asTrimmedString(claim.accountId) === accountId
        && asTrimmedString(claim.authUid) === authUid
        && registrationIdentityMatches(claim, identitySnapshot)
        && account
        && asTrimmedString(account.authUid) === authUid
        && registrationIdentityMatches(account, identitySnapshot)
        && asTrimmedString(account.status) === 'active'
        && asTrimmedString(account.role) === 'user'
        && Array.isArray(account.permissions)
        && account.permissions.length === 0) {
        return { ...account, _id: getRecordId(account) || accountId };
      }
    } catch {
      // Preserve the transaction error; the caller will re-block Auth and
      // mark the still-pending reservation for administrator review.
    }
    throw error;
  }
}

async function registerAccountByPhone({ db, manager, managerFactory, envId, env, input, requestId, now }) {
  let normalized;
  try {
    normalized = normalizeRegistrationInput(input);
  } catch (error) {
    logPhoneRegistrationDiagnostic({ requestId, reasonCode: 'INPUT_VALIDATION_FAILED', error });
    throw error;
  }
  let preflightSubject;
  try {
    preflightSubject = await registrationSubjectByPhoneSnapshot(db, normalized.phoneNumber);
  } catch (error) {
    logPhoneRegistrationDiagnostic({
      requestId,
      reasonCode: error && error.code === 'REGISTRATION_EMPLOYEE_MATCH_FAILED'
        ? 'IDENTITY_PHONE_PREFLIGHT_UNMATCHED'
        : error && error.code === 'REGISTRATION_IDENTITY_MATCH_AMBIGUOUS'
          ? 'IDENTITY_PHONE_PREFLIGHT_AMBIGUOUS'
          : error && error.code === 'REGISTRATION_IDENTITY_INVALID'
            ? 'IDENTITY_PROFILE_INVALID'
            : 'IDENTITY_LOOKUP_FAILED',
      error,
    });
    throw error;
  }
  const subjectType = preflightSubject.subjectType;
  const subjectId = preflightSubject.subjectId;
  const claimId = identityClaimDocumentId(subjectId, subjectType);
  const accountId = registrationAccountDocumentId(subjectId, subjectType);
  let linkedAccounts;
  try {
    linkedAccounts = subjectType === 'student'
      ? await listAccountsByStudentId(db, subjectId, 1)
      : await listAccountsByEmployeeId(db, subjectId, 1);
  } catch (error) {
    logPhoneRegistrationDiagnostic({ requestId, reasonCode: 'ACCOUNT_STATUS_LOOKUP_FAILED', error });
    throw error;
  }
  if (linkedAccounts.length) {
    const error = registrationIdentityClaimed();
    logPhoneRegistrationDiagnostic({ requestId, reasonCode: 'ACCOUNT_ALREADY_BOUND', error });
    throw error;
  }

  if (!manager && typeof managerFactory === 'function') {
    try {
      manager = managerFactory(envId, env);
    } catch (error) {
      logPhoneRegistrationDiagnostic({ requestId, reasonCode: 'MANAGER_INITIALIZATION_FAILED', error });
      if (error instanceof AppError) throw error;
      throw new AppError('REGISTRATION_UNAVAILABLE', '当前注册服务未完成服务端配置，请联系总管理员。', 503, { cause: safeErrorCode(error) });
    }
  }
  if (!manager || !manager.user || typeof manager.user.createUser !== 'function') {
    logPhoneRegistrationDiagnostic({ requestId, reasonCode: 'MANAGER_CAPABILITY_MISSING', error: new AppError('REGISTRATION_UNAVAILABLE', '', 503) });
    throw new AppError(
      'REGISTRATION_UNAVAILABLE',
      '当前 CloudBase 管理 SDK 不支持服务端创建用户名账号，请配置 @cloudbase/manager-node v5+ 后再开放注册。',
      503,
    );
  }
  if (typeof manager.user.modifyUser !== 'function' || typeof manager.user.describeUserList !== 'function') {
    logPhoneRegistrationDiagnostic({ requestId, reasonCode: 'MANAGER_CAPABILITY_MISSING', error: new AppError('REGISTRATION_UNAVAILABLE', '', 503) });
    throw new AppError('REGISTRATION_UNAVAILABLE', '当前 CloudBase 管理 SDK 缺少安全启用或状态核验能力，已暂停注册。', 503);
  }

  const registrationAttemptId = crypto.randomUUID();
  let reservation;
  try {
    reservation = await runTransaction(db, async (transaction) => {
      await advanceDirectoryPhoneGuard(transaction, preflightSubject.phoneScanRevision);
      const subject = await registrationSubjectByIdSnapshot(transaction, normalized.phoneNumber, subjectType, subjectId);
      const claimReference = transaction.collection(COLLECTIONS.identityClaims).doc(claimId);
      const claim = getDocument(await claimReference.get());
      const claimStatus = asTrimmedString(claim && claim.status) || 'unclaimed';
      const claimHasIdentity = asTrimmedString(claim && claim.employeeId) || asTrimmedString(claim && claim.studentId);
      if ((claimHasIdentity && !registrationIdentityMatches(claim, subject))
        || (asTrimmedString(claim && claim.identityType) && asTrimmedString(claim.identityType) !== subjectType)) {
        throw registrationIdentityClaimed();
      }
      if (claimStatus === 'recovery_required') {
        throw new AppError('REGISTRATION_RECOVERY_REQUIRED', '注册结果需要管理员核对，请勿重复注册。', 503);
      }
      if (!['unclaimed', 'invited'].includes(claimStatus)
        || asTrimmedString(claim && claim.accountId)
        || asTrimmedString(claim && claim.authUid)) {
        throw registrationIdentityClaimed();
      }

      const accountReference = transaction.collection(COLLECTIONS.adminAccounts).doc(accountId);
      if (getDocument(await accountReference.get())) throw registrationIdentityClaimed();

      const updatedAt = now();
      const claimData = {
        ...registrationIdentityFields(subject),
        identityType: subjectType,
        status: 'creating',
        accountId,
        authUid: '',
        usernameNormalized: normalized.username.toLowerCase(),
        registrationAttemptId,
        registrationVerificationMethod: PHONE_REGISTRATION_METHOD,
        previousClaimStatus: claimStatus,
        reservedAt: updatedAt,
        recoveryCode: '',
        recoveryDetectedAt: '',
        updatedAt,
      };
      if (claim) await claimReference.update(claimData);
      else await claimReference.set(claimData);
      return {
        subject,
        previousClaimStatus: claimStatus,
      };
    });
  } catch (error) {
    logPhoneRegistrationDiagnostic({
      requestId,
      reasonCode: error && error.code === 'REGISTRATION_EMPLOYEE_MATCH_FAILED'
        ? 'IDENTITY_PHONE_RECHECK_CHANGED'
        : error && error.code === 'REGISTRATION_IDENTITY_MATCH_AMBIGUOUS'
          ? 'IDENTITY_PHONE_RECHECK_AMBIGUOUS'
        : error && error.code === 'REGISTRATION_IDENTITY_CLAIMED'
          ? 'IDENTITY_CLAIM_CONFLICT'
          : 'RESERVATION_TRANSACTION_FAILED',
      error,
    });
    if (error instanceof AppError) throw error;
    throw new AppError('DATABASE_WRITE_FAILED', '人员身份预留失败，请稍后重试。');
  }

  const releasePreflightReservation = async (errorCode) => {
    try {
      await releasePhoneRegistrationReservation({
        db,
        claimId,
        registrationAttemptId,
        previousClaimStatus: reservation.previousClaimStatus,
        now,
      });
      return true;
    } catch {
      await recoverPhoneRegistrationReservation({ db, claimId, registrationAttemptId, errorCode, now, requestId });
      return false;
    }
  };
  try {
    await registrationSubjectByPhoneSnapshot(db, normalized.phoneNumber, subjectType, subjectId);
  } catch (error) {
    logPhoneRegistrationDiagnostic({
      requestId,
      reasonCode: error && error.code === 'REGISTRATION_IDENTITY_MATCH_AMBIGUOUS'
        ? 'IDENTITY_PHONE_POST_RESERVATION_AMBIGUOUS'
        : 'IDENTITY_PHONE_POST_RESERVATION_CHANGED',
      error,
    });
    if (!await releasePreflightReservation('REGISTRATION_POST_RESERVATION_RELEASE_FAILED')) {
      throw new AppError('REGISTRATION_RECOVERY_REQUIRED', '注册状态需管理员核对，请勿重复注册。', 503);
    }
    throw error;
  }
  let existingUsernameAccount;
  try {
    existingUsernameAccount = await findAccountByUsername(db, normalized.username);
  } catch (error) {
    logPhoneRegistrationDiagnostic({ requestId, reasonCode: 'USERNAME_PREFLIGHT_FAILED', error });
    if (!await releasePreflightReservation('REGISTRATION_USERNAME_PREFLIGHT_RELEASE_FAILED')) {
      throw new AppError('REGISTRATION_RECOVERY_REQUIRED', '注册状态需管理员核对，请勿重复注册。', 503);
    }
    throw error;
  }
  if (existingUsernameAccount) {
    logPhoneRegistrationDiagnostic({ requestId, reasonCode: 'USERNAME_ALREADY_TAKEN', error: new AppError('ACCOUNT_USERNAME_TAKEN', '', 409) });
    if (!await releasePreflightReservation('REGISTRATION_USERNAME_CONFLICT_RELEASE_FAILED')) {
      throw new AppError('REGISTRATION_RECOVERY_REQUIRED', '注册状态需管理员核对，请勿重复注册。', 503);
    }
    throw new AppError('ACCOUNT_USERNAME_TAKEN', '该用户名已被注册，请换一个用户名。', 409);
  }

  let managerResult;
  try {
    managerResult = await manager.user.createUser({
      name: normalized.username,
      password: normalized.password,
      type: 'externalUser',
      userStatus: 'BLOCKED',
      nickName: reservation.subject.name,
    });
  } catch (error) {
    logPhoneRegistrationDiagnostic({ requestId, reasonCode: 'AUTH_PROVIDER_CREATE_FAILED', error });
    if (isDuplicateUsernameError(error)) {
      try {
        await releasePhoneRegistrationReservation({ db, claimId, registrationAttemptId, previousClaimStatus: reservation.previousClaimStatus, now });
      } catch {
        await recoverPhoneRegistrationReservation({ db, claimId, registrationAttemptId, errorCode: 'REGISTRATION_RESERVATION_RELEASE_FAILED', now, requestId });
        throw new AppError('REGISTRATION_RECOVERY_REQUIRED', '注册状态需管理员核对，请勿重复注册。', 503);
      }
      throw new AppError('ACCOUNT_USERNAME_TAKEN', '该用户名已被注册，请换一个用户名。', 409);
    }
    if (isInvalidRegistrationProviderParameter(error)) {
      if (!await releasePreflightReservation('REGISTRATION_INVALID_PROVIDER_PARAMETER_RELEASE_FAILED')) {
        throw new AppError('REGISTRATION_RECOVERY_REQUIRED', '注册状态需管理员核对，请勿重复注册。', 503);
      }
      throw new AppError(
        'VALIDATION_ERROR',
        '注册参数未通过校验。请检查账号名和密码规则；确认填写无误后仍失败，请联系管理员。',
        400,
        { field: 'registration' },
      );
    }
    await recoverPhoneRegistrationReservation({ db, claimId, registrationAttemptId, errorCode: safeErrorCode(error), now, requestId });
    throw new AppError('REGISTRATION_RECOVERY_REQUIRED', '注册结果需要管理员核对，请勿重复注册。', 503);
  }

  const authUid = managerUserId(managerResult);
  if (!authUid) {
    logPhoneRegistrationDiagnostic({ requestId, reasonCode: 'AUTH_PROVIDER_UID_MISSING', error: new AppError('REGISTRATION_RECOVERY_REQUIRED', '', 503) });
    await recoverPhoneRegistrationReservation({ db, claimId, registrationAttemptId, errorCode: 'REGISTRATION_PROVIDER_UID_MISSING', now, requestId });
    throw new AppError('REGISTRATION_RECOVERY_REQUIRED', '账号可能已创建，但服务未返回可核对的身份编号；请联系管理员处理。', 503);
  }

  const completedAt = now();
  const identityName = reservation.subject.name;
  const accountData = {
    authUid,
    username: normalized.username,
    usernameNormalized: normalized.username.toLowerCase(),
    displayName: identityName,
    displayNameNormalized: identityName.toLowerCase(),
    ...registrationIdentityFields(reservation.subject),
    registrationVerificationMethod: PHONE_REGISTRATION_METHOD,
    identityVersion: 1,
    status: 'pending_activation',
    role: 'user',
    permissions: [],
    permissionVersion: 1,
    createdAt: completedAt,
    updatedAt: completedAt,
  };
  const account = { ...accountData, _id: accountId };
  const actor = buildActor(account, { authUid });
  let staged = false;
  try {
    const stagingSubject = await registrationSubjectByPhoneSnapshot(db, normalized.phoneNumber, subjectType, subjectId);
    await runTransaction(db, async (transaction) => {
      await advanceDirectoryPhoneGuard(transaction, stagingSubject.phoneScanRevision);
      await registrationSubjectByIdSnapshot(transaction, normalized.phoneNumber, subjectType, subjectId);
      const claimReference = transaction.collection(COLLECTIONS.identityClaims).doc(claimId);
      const claim = getDocument(await claimReference.get());
      if (!claim
        || asTrimmedString(claim.status) !== 'creating'
        || asTrimmedString(claim.registrationAttemptId) !== registrationAttemptId
        || asTrimmedString(claim.accountId) !== accountId
        || !registrationIdentityMatches(claim, reservation.subject)
        || asTrimmedString(claim.registrationVerificationMethod) !== PHONE_REGISTRATION_METHOD) {
        throw new AppError('REGISTRATION_RECOVERY_REQUIRED', '注册状态已变化，需要管理员核对后才能完成账号绑定。', 503);
      }
      const accountReference = transaction.collection(COLLECTIONS.adminAccounts).doc(accountId);
      const existingAccount = getDocument(await accountReference.get());
      if (existingAccount) throw registrationIdentityClaimed();

      await accountReference.set(accountData);
      const stagedAt = now();
      const claimUpdate = {
        status: 'linked',
        authUid,
        invitationId: '',
        invitationDocumentId: '',
        linkedAt: stagedAt,
        updatedAt: stagedAt,
      };
      await claimReference.update(claimUpdate);
      await appendAuditDocument({
        database: transaction,
        actor,
        requestId,
        action: 'register_account_pending_activation',
        targetId: accountId,
        targetName: identityName,
        targetType: 'account',
        changed: ['账号状态', '角色', '权限', `${registrationIdentityLabel(subjectType)}身份`, '身份绑定方式'],
        after: accountAuditSnapshot(account),
        result: 'success',
        detail: `账号“${normalized.username}”与${registrationIdentityLabel(subjectType)}“${identityName}”的关联已落库；身份匹配方式为档案登记手机号，CloudBase 账号当前仍阻止登录，等待安全激活。`,
        verificationMethod: PHONE_REGISTRATION_METHOD,
        now,
      });
      staged = true;
    });
  } catch (error) {
    logPhoneRegistrationDiagnostic({ requestId, reasonCode: 'POST_AUTH_STAGING_FAILED', error });
    let persisted = false;
    try {
      const [claim, savedAccount] = await Promise.all([
        db.collection(COLLECTIONS.identityClaims).doc(claimId).get().then(getDocument),
        db.collection(COLLECTIONS.adminAccounts).doc(accountId).get().then(getDocument),
      ]);
      persisted = asTrimmedString(claim && claim.status) === 'linked'
        && asTrimmedString(claim && claim.authUid) === authUid
        && registrationIdentityMatches(claim, reservation.subject)
        && asTrimmedString(claim && claim.registrationVerificationMethod) === PHONE_REGISTRATION_METHOD
        && asTrimmedString(savedAccount && savedAccount.authUid) === authUid
        && registrationIdentityMatches(savedAccount, reservation.subject)
        && asTrimmedString(savedAccount && savedAccount.status) === 'pending_activation';
    } catch {
      persisted = false;
    }
    if (!persisted) {
      await recoverPhoneRegistrationReservation({ db, claimId, registrationAttemptId, authUid, errorCode: safeErrorCode(error), now, requestId });
      throw new AppError('REGISTRATION_RECOVERY_REQUIRED', `账号已安全阻止登录，但${registrationIdentityLabel(subjectType)}身份绑定和审计尚未确认；管理员核对前请勿重复注册。`, 503);
    }
    staged = true;
  }

  if (!staged) {
    await recoverPhoneRegistrationReservation({ db, claimId, registrationAttemptId, authUid, errorCode: 'REGISTRATION_STAGE_UNVERIFIED', now, requestId });
    throw new AppError('REGISTRATION_RECOVERY_REQUIRED', '账号身份绑定状态需要管理员核对，请勿重复注册。', 503);
  }

  let activatedAccount;
  try {
    await setAndVerifyManagerUserStatus(manager, authUid, 'ACTIVE');
    activatedAccount = await completePhoneRegistrationActivation({
      db,
      claimId,
      accountId,
      identitySnapshot: { ...reservation.subject, phoneNumber: normalized.phoneNumber },
      authUid,
      registrationAttemptId,
      requestId,
      now,
    });
  } catch (error) {
    logPhoneRegistrationDiagnostic({ requestId, reasonCode: 'REGISTRATION_ACTIVATION_FAILED', error });
    let providerBlocked = false;
    try {
      await setAndVerifyManagerUserStatus(manager, authUid, 'BLOCKED');
      providerBlocked = true;
    } catch {
      providerBlocked = false;
    }
    await recoverPhoneRegistrationReservation({
      db,
      claimId,
      registrationAttemptId,
      authUid,
      errorCode: providerBlocked ? safeErrorCode(error) : 'REGISTRATION_PROVIDER_BLOCK_UNVERIFIED',
      now,
      requestId,
    });
    throw new AppError('REGISTRATION_RECOVERY_REQUIRED', providerBlocked
      ? `${registrationIdentityLabel(subjectType)}身份绑定已保存，账号仍保持阻止登录；管理员核对后才能完成注册。`
      : `${registrationIdentityLabel(subjectType)}身份绑定已保存，但账号状态未能核实；管理员核对前请勿重复注册。`, 503);
  }
  return { registered: true, account: safeAccount(activatedAccount) };
}

async function assertSelfPasswordResetRateLimitCollectionAvailable(db) {
  try {
    await db.collection(COLLECTIONS.passwordResetRateLimits).limit(1).get();
  } catch {
    throw new AppError('PASSWORD_RESET_RATE_LIMIT_UNAVAILABLE', '暂时无法处理重置请求，请稍后重试。', 503);
  }
}

async function consumeSelfPasswordResetAttempt({ db, clientIp, now }) {
  const normalizedIp = asTrimmedString(clientIp);
  if (!normalizedIp || normalizedIp.length > 160 || hasControlCharacters(normalizedIp)) {
    throw new AppError('PASSWORD_RESET_RATE_LIMIT_UNAVAILABLE', '暂时无法处理重置请求，请稍后重试。', 503);
  }
  const timestamp = now();
  const currentTime = Date.parse(timestamp);
  if (!Number.isFinite(currentTime)) {
    throw new AppError('PASSWORD_RESET_RATE_LIMIT_UNAVAILABLE', '暂时无法处理重置请求，请稍后重试。', 503);
  }
  const windowMs = 15 * 60 * 1000;
  const maximumAttempts = 20;
  const documentId = `ip-${crypto.createHash('sha256').update(normalizedIp, 'utf8').digest('hex')}`;
  try {
    await assertSelfPasswordResetRateLimitCollectionAvailable(db);
    await runTransaction(db, async (transaction) => {
      const reference = transaction.collection(COLLECTIONS.passwordResetRateLimits).doc(documentId);
      const current = getDocument(await reference.get());
      const windowStartedAt = Date.parse(asTrimmedString(current && current.windowStartedAt));
      const currentCount = Number.isInteger(current && current.count) ? current.count : 0;
      const inCurrentWindow = Number.isFinite(windowStartedAt)
        && currentTime >= windowStartedAt
        && currentTime - windowStartedAt < windowMs;
      if (inCurrentWindow && currentCount >= maximumAttempts) {
        throw new AppError('PASSWORD_RESET_RATE_LIMITED', '尝试次数过多，请过一会儿再试。', 429);
      }
      await reference.set({
        windowStartedAt: inCurrentWindow ? asTrimmedString(current.windowStartedAt) : timestamp,
        count: inCurrentWindow ? currentCount + 1 : 1,
        updatedAt: timestamp,
      });
    });
  } catch (error) {
    if (error instanceof AppError && error.code === 'PASSWORD_RESET_RATE_LIMITED') throw error;
    throw new AppError('PASSWORD_RESET_RATE_LIMIT_UNAVAILABLE', '暂时无法处理重置请求，请稍后重试。', 503);
  }
}

async function acquireSelfPasswordResetLock({ db, accountId, requestId, now }) {
  const timestamp = now();
  const currentTime = Date.parse(timestamp);
  if (!Number.isFinite(currentTime)) {
    throw new AppError('PASSWORD_RESET_RATE_LIMIT_UNAVAILABLE', '暂时无法处理重置请求，请稍后重试。', 503);
  }
  const lockDocumentId = `account-${crypto.createHash('sha256').update(accountId, 'utf8').digest('hex')}`;
  const lockExpiresAt = new Date(currentTime + 2 * 60 * 1000).toISOString();
  try {
    return await runTransaction(db, async (transaction) => {
      const reference = transaction.collection(COLLECTIONS.passwordResetRateLimits).doc(lockDocumentId);
      const current = getDocument(await reference.get());
      const currentLockExpiry = Date.parse(asTrimmedString(current && current.lockExpiresAt));
      if (asTrimmedString(current && current.lockOwner)
        && Number.isFinite(currentLockExpiry)
        && currentLockExpiry > currentTime) return false;
      await reference.set({ lockOwner: requestId, lockExpiresAt, updatedAt: timestamp });
      return true;
    });
  } catch {
    throw new AppError('PASSWORD_RESET_RATE_LIMIT_UNAVAILABLE', '暂时无法处理重置请求，请稍后重试。', 503);
  }
}

async function releaseSelfPasswordResetLock({ db, accountId, requestId, now }) {
  const lockDocumentId = `account-${crypto.createHash('sha256').update(accountId, 'utf8').digest('hex')}`;
  try {
    await runTransaction(db, async (transaction) => {
      const reference = transaction.collection(COLLECTIONS.passwordResetRateLimits).doc(lockDocumentId);
      const current = getDocument(await reference.get());
      if (asTrimmedString(current && current.lockOwner) !== requestId) return;
      await reference.update({ lockOwner: '', lockExpiresAt: now(), updatedAt: now() });
    });
  } catch {
    console.warn('[employeeArchiveApi] self password reset lock release deferred', { requestId });
  }
}

function normalizeSelfPasswordResetInput(input) {
  const source = isPlainObject(input) ? input : {};
  const allowedFields = new Set(['username', 'phoneNumber', 'newPassword']);
  if (Object.keys(source).some((field) => !allowedFields.has(field))) {
    throw new AppError('VALIDATION_ERROR', '密码重置请求参数无效。', 400);
  }
  const normalized = normalizeRegistrationInput({
    username: source.username,
    phoneNumber: source.phoneNumber,
    password: source.newPassword,
  });
  return {
    username: normalized.username,
    usernameNormalized: normalized.username.toLowerCase(),
    phoneNumber: normalized.phoneNumber,
    newPassword: normalized.password,
  };
}

async function resetAccountPasswordByIdentity({ db, auth, managerFactory, envId, env, input, requestId, now }) {
  let clientIp = '';
  try {
    clientIp = auth && typeof auth.getClientIP === 'function' ? auth.getClientIP() : '';
  } catch {
    clientIp = '';
  }
  await consumeSelfPasswordResetAttempt({ db, clientIp, now });
  const normalized = normalizeSelfPasswordResetInput(input);

  // Only validation and IP throttling may produce public errors. All subsequent
  // results depend on a target account and must share the same public response.
  try {
    const accounts = await listAccountRows(db);
    const matches = accounts.filter((account) => asTrimmedString(account.username).toLowerCase() === normalized.usernameNormalized);
    if (matches.length !== 1) return { accepted: true };
    const target = matches[0];
    const accountId = getRecordId(target);
    const authUid = asTrimmedString(target.authUid);
    if (!accountId || !authUid || asTrimmedString(target.status) !== 'active'
      || target.role !== 'user' || isStudentAccount(target)) return { accepted: true };

    const employeeId = asTrimmedString(target.employeeId);
    const studentId = asTrimmedString(target.studentId);
    if (!employeeId || studentId) return { accepted: true };
    const identityType = studentId ? 'student' : 'employee';
    const identityId = studentId || employeeId;
    let profile;
    try {
      profile = getDocument(await db.collection(COLLECTIONS.employees).doc(identityId).get());
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '暂时无法处理重置请求，请稍后重试。', 503);
    }
    const profileMatches = identityType === 'student' ? isStudentRecord(profile) : isEmployeeRecord(profile);
    const registeredPhone = identityType === 'student' ? profile && profile.phoneNumber : profile && profile.personalPhone;
    if (!profileMatches || normalizeRegistrationPhone(registeredPhone) !== normalized.phoneNumber) return { accepted: true };
    const lockAcquired = await acquireSelfPasswordResetLock({ db, accountId, requestId, now });
    if (!lockAcquired) return { accepted: true };

    const actor = {
      accountId: null,
      authUid: null,
      username: 'anonymous_password_reset',
      displayName: '未登录密码重置请求者',
    };
    const appendAudit = appendAuditFactory({ db, actor, requestId, now });
    try {
      let pendingAudit;
      try {
        pendingAudit = await appendAudit({
          action: 'reset_account_password',
          targetId: accountId,
          targetName: asTrimmedString(target.username),
          changed: ['密码'],
          targetType: 'account',
          result: 'unknown',
          detail: '未登录请求者通过账号与绑定档案手机号发起自助密码重置；手机号匹配不代表已验证本人身份，结果待确认。',
        });
      } catch (error) {
        console.warn('[employeeArchiveApi] self password reset audit could not start', {
          requestId,
          code: safeErrorCode(error),
        });
        return { accepted: true };
      }

      let outcome = 'unknown';
      try {
        // Recheck after acquiring the lock and writing the audit: a stale account
        // snapshot must not authorize reset after a role or binding change.
        const currentTarget = getDocument(await db.collection(COLLECTIONS.adminAccounts).doc(accountId).get());
        const currentProfile = getDocument(await db.collection(COLLECTIONS.employees).doc(identityId).get());
        const currentProfileMatches = identityType === 'student' ? isStudentRecord(currentProfile) : isEmployeeRecord(currentProfile);
        const currentPhone = identityType === 'student' ? currentProfile && currentProfile.phoneNumber : currentProfile && currentProfile.personalPhone;
        if (!currentTarget || currentTarget.role !== 'user' || isStudentAccount(currentTarget)
          || asTrimmedString(currentTarget.status) !== 'active'
          || asTrimmedString(currentTarget.authUid) !== authUid
          || asTrimmedString(currentTarget.username).toLowerCase() !== normalized.usernameNormalized
          || asTrimmedString(currentTarget.employeeId) !== employeeId
          || asTrimmedString(currentTarget.studentId) !== studentId
          || !currentProfileMatches || normalizeRegistrationPhone(currentPhone) !== normalized.phoneNumber) {
          outcome = 'failure';
        } else {
          const manager = typeof managerFactory === 'function' ? managerFactory(envId, env) : null;
          if (manager && manager.user && typeof manager.user.modifyUser === 'function') {
            const result = await manager.user.modifyUser({ uid: authUid, password: normalized.newPassword });
            const responseData = isPlainObject(result && result.Data)
              ? result.Data
              : isPlainObject(result && result.data) ? result.data : null;
            if (responseData && responseData.Success === true) outcome = 'success';
            else if (responseData && responseData.Success === false) outcome = 'failure';
          }
        }
      } catch {
        outcome = 'unknown';
      }

      const auditDetail = outcome === 'success'
        ? '未登录请求者通过账号与绑定档案手机号完成自助密码重置；未验证请求者本人身份。'
        : outcome === 'failure'
          ? '用户自助密码重置未成功。'
          : '用户自助密码重置结果暂不可确认。';
      try {
        const writeResult = await db.collection(COLLECTIONS.auditLogs).doc(pendingAudit._id)
          .update({ result: outcome, detail: auditDetail });
        assertTransactionWriteDidNotFail(writeResult, '密码重置审计结果暂不可确认。');
      } catch (error) {
        console.warn('[employeeArchiveApi] self password reset audit could not finish', {
          requestId,
          outcome,
          code: safeErrorCode(error),
        });
      }
    } finally {
      await releaseSelfPasswordResetLock({ db, accountId, requestId, now });
    }
    return { accepted: true };
  } catch (error) {
    console.warn('[employeeArchiveApi] self password reset request could not complete', {
      requestId,
      code: safeErrorCode(error),
    });
    return { accepted: true };
  }
}

function createRouter({
  db,
  storage = null,
  actor,
  requestId,
  storageAuthority,
  managerFactory = createCloudBaseManager,
  envId = '',
  env = process.env,
  now = () => new Date().toISOString(),
}) {
  const appendAudit = appendAuditFactory({ db, actor, requestId, now });
  const governanceWritesEnabled = asTrimmedString(env.ACCOUNT_GOVERNANCE_WRITES_ENABLED).toLowerCase() === 'true';

  async function getEmployee(employeeId) {
    try {
      const result = await db.collection(COLLECTIONS.employees).doc(employeeId).get();
      const employee = getDocument(result);
      if (!isEmployeeRecord(employee)) throw new AppError('EMPLOYEE_NOT_FOUND', '未找到对应的员工档案。');
      return employee;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATABASE_READ_FAILED', '读取员工档案失败。');
    }
  }

  function scopedEmployeePublic(employee) {
    if (!employee) return null;
    return {
      id: getRecordId(employee),
      recordType: RECORD_TYPES.employee,
      name: asTrimmedString(employee.name),
      department: asTrimmedString(employee.department),
      status: asTrimmedString(employee.status),
      hireDate: asTrimmedString(employee.hireDate),
      regularizationDate: asTrimmedString(employee.regularizationDate),
    };
  }

  async function getStudent(studentId, database = db) {
    try {
      const result = await database.collection(COLLECTIONS.employees).doc(studentId).get();
      const student = getDocument(result);
      if (!isStudentRecord(student)) throw new AppError('STUDENT_NOT_FOUND', '未找到对应的学员档案。');
      return student;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATABASE_READ_FAILED', '读取学员档案失败。');
    }
  }

  async function assertStudentPhoneAvailable(phoneNumber, excludedStudentId = '') {
    let studentRows;
    try {
      studentRows = await listQuarterlyRowsWithPagination(COLLECTIONS.employees, { _id: true, recordType: true, phoneNumber: true }, db, { recordType: RECORD_TYPES.student });
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '暂时无法核对学员手机号，请稍后重试。');
    }
    if (studentRows.some((student) => isStudentRecord(student) && getRecordId(student) !== excludedStudentId
      && normalizeStudentPhone(student.phoneNumber) === phoneNumber)) {
      throw new AppError('STUDENT_PHONE_DUPLICATE', '该手机号已登记，无法重复建档。', 409, { field: 'phoneNumber' });
    }

    let employeeRows;
    try {
      employeeRows = await listQuarterlyRowsWithPagination(COLLECTIONS.employees, { _id: true, recordType: true, status: true, personalPhone: true }, db, null);
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '暂时无法核对在职员工手机号，请稍后重试。');
    }
    if (employeeRows.some((employee) => isEmployeeRecord(employee)
      && normalizeStudentPhone(employee.personalPhone) === phoneNumber)) {
      throw new AppError('STUDENT_PHONE_DUPLICATE', '该手机号已登记为员工手机号，无法重复建档。', 409, { field: 'phoneNumber' });
    }
  }

  // Serialize directory writes against the complete phone scan. A callback retry
  // must compare against the original scan version, never accept a newer guard.
  async function phoneGuardRevision(database = db) {
    return directoryPhoneGuardRevision(database);
  }

  async function advancePhoneGuard(transaction, expectedRevision) {
    return advanceDirectoryPhoneGuard(transaction, expectedRevision);
  }

  async function assertEmployeePhoneAvailable(phoneNumber, excludedEmployeeId = '') {
    const normalizedPhone = normalizeStudentPhone(phoneNumber);
    if (!normalizedPhone) return;
    let studentRows;
    try {
      studentRows = await listQuarterlyRowsWithPagination(COLLECTIONS.employees, { _id: true, recordType: true, phoneNumber: true }, db, { recordType: RECORD_TYPES.student });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATABASE_READ_FAILED', '暂时无法核对学员手机号，请稍后重试。');
    }
    if (studentRows.some((student) => isStudentRecord(student)
      && normalizeStudentPhone(student.phoneNumber) === normalizedPhone)) {
      throw new AppError('EMPLOYEE_PHONE_DUPLICATE', '该个人手机号已登记为学员手机号，无法保存员工档案。', 409, { field: 'personalPhone' });
    }

    let employeeRows;
    try {
      employeeRows = await listQuarterlyRowsWithPagination(COLLECTIONS.employees, { _id: true, recordType: true, status: true, personalPhone: true }, db, null);
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '暂时无法核对在职员工手机号，请稍后重试。');
    }
    if (employeeRows.some((employee) => isEmployeeRecord(employee)
      && getRecordId(employee) !== excludedEmployeeId
      && normalizeStudentPhone(employee.personalPhone) === normalizedPhone)) {
      throw new AppError('EMPLOYEE_PHONE_DUPLICATE', '该个人手机号已登记，无法重复保存员工档案。', 409, { field: 'personalPhone' });
    }
  }

  async function listStudents(input) {
    const { page, pageSize } = parsePage(input);
    const keyword = asTrimmedString(input.keyword || input.search).normalize('NFKC').toLowerCase();
    if (keyword.length > 64) throw new AppError('VALIDATION_ERROR', '姓名搜索内容不能超过64个字符。', 400, { field: 'keyword' });
    const status = asTrimmedString(input.status || 'all');
    if (!['all', 'active', 'inactive'].includes(status)) {
      throw new AppError('VALIDATION_ERROR', '学员档案状态筛选无效。', 400, { field: 'status' });
    }

    let rows;
    try {
      rows = (await listQuarterlyRowsWithPagination(COLLECTIONS.employees,
        { _id: true, recordType: true, name: true, status: true, version: true, createdAt: true, updatedAt: true },
        db, status === 'all' ? { recordType: RECORD_TYPES.student } : { recordType: RECORD_TYPES.student, status },
        '读取学员档案列表失败。')).filter((student) => isStudentRecord(student) && (!keyword
        || asTrimmedString(student.name).normalize('NFKC').toLowerCase().includes(keyword)));
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '读取学员档案列表失败。');
    }
    rows.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
    const offset = (page - 1) * pageSize;
    return {
      items: rows.slice(offset, offset + pageSize).map(studentSummaryRecord).filter(Boolean),
      total: rows.length,
      page,
      pageSize,
    };
  }

  async function getStudentDetails(input) {
    const studentId = getStudentId(input);
    const current = await getStudent(studentId);
    return studentDetailRecord(current);
  }

  async function createStudent(input) {
    let payload = {};
    let targetName = asTrimmedString(input.name);
    try {
      const scanRevision = await phoneGuardRevision();
      payload = normalizeStudentInput(input);
      targetName = payload.name;
      await assertStudentPhoneAvailable(payload.phoneNumber);
      const operationTime = now();
      const data = {
        ...payload,
        recordType: RECORD_TYPES.student,
        status: 'active',
        version: 1,
        createdAt: operationTime,
        updatedAt: operationTime,
        createdByAuthUid: actor.authUid,
        updatedByAuthUid: actor.authUid,
      };
      let student;
      await runTransaction(db, async (transaction) => {
        await advancePhoneGuard(transaction, scanRevision);
        const addResult = await transaction.collection(COLLECTIONS.employees).add(data);
        const studentId = getDocumentId(addResult);
        if (!studentId) throw new AppError('DATABASE_WRITE_FAILED', '学员新增未返回档案编号。');
        student = { ...data, _id: studentId };
        await appendAudit({
        database: transaction,
        action: 'create_student',
        targetId: studentId,
        targetName,
        targetType: 'student',
        changed: ['name', 'phoneNumber'],
        after: studentSummaryRecord(student),
        result: 'success',
        detail: '新增学员档案。',
      });
      });
      return studentSummaryRecord(student);
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: 'create_student',
        targetName,
        targetType: 'student',
        changed: Object.keys(payload),
        detail: `新增学员档案失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function updateStudent(input) {
    const studentId = getStudentId(input);
    const expectedVersion = expectedVersionOf(input);
    let current = null;
    let payload = {};
    try {
      const scanRevision = await phoneGuardRevision();
      payload = normalizeStudentInput(input, { partial: true });
      if (Object.keys(payload).length === 0) throw new AppError('VALIDATION_ERROR', '没有可保存的学员字段。');
      if (payload.phoneNumber) await assertStudentPhoneAvailable(payload.phoneNumber, studentId);
      let updated;
      await runTransaction(db, async (transaction) => {
        await advancePhoneGuard(transaction, scanRevision);
        current = await getStudent(studentId, transaction);
        if (studentVersion(current) !== expectedVersion) throw studentConflictError();
        const data = {
          ...payload,
          version: expectedVersion + 1,
          updatedAt: now(),
          updatedByAuthUid: actor.authUid,
        };
        await transaction.collection(COLLECTIONS.employees).doc(studentId).update(data);
        updated = { ...current, ...data, _id: studentId };
        await appendAudit({
        database: transaction,
        action: 'update_student',
        targetId: studentId,
        targetName: asTrimmedString(updated.name),
        targetType: 'student',
        changed: Object.keys(payload),
        before: studentSummaryRecord(current),
        after: studentSummaryRecord(updated),
        result: 'success',
        detail: '编辑学员档案。',
      });
      });
      return studentSummaryRecord(updated);
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: 'update_student',
        targetId: studentId,
        targetName: asTrimmedString(current && current.name),
        targetType: 'student',
        changed: Object.keys(payload),
        before: studentSummaryRecord(current),
        detail: `编辑学员档案失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function setStudentStatus(input, status) {
    const studentId = getStudentId(input);
    const expectedVersion = expectedVersionOf(input);
    let current = null;
    let updated = null;
    const action = status === 'inactive' ? 'archive_student' : 'restore_student';
    try {
      const scanRevision = await phoneGuardRevision();
      current = await getStudent(studentId);
      if (studentVersion(current) !== expectedVersion) throw studentConflictError();
      if (status === 'active') {
        const restoredPhone = normalizeStudentPhone(current.phoneNumber);
        if (!restoredPhone) throw new AppError('VALIDATION_ERROR', '学员档案手机号无效，暂不能恢复。', 409, { field: 'phoneNumber' });
        await assertStudentPhoneAvailable(restoredPhone, studentId);
      }
      await runTransaction(db, async (transaction) => {
        await advancePhoneGuard(transaction, scanRevision);
        current = await getStudent(studentId, transaction);
        if (studentVersion(current) !== expectedVersion) throw studentConflictError();
        const operationTime = now();
        const data = {
          status,
          version: expectedVersion + 1,
          updatedAt: operationTime,
          updatedByAuthUid: actor.authUid,
          archivedAt: status === 'inactive' ? operationTime : null,
          archivedByAuthUid: status === 'inactive' ? actor.authUid : null,
        };
        await transaction.collection(COLLECTIONS.employees).doc(studentId).update(data);
        updated = { ...current, ...data, _id: studentId };
        await appendAudit({
        database: transaction,
        action,
        targetId: studentId,
        targetName: asTrimmedString(updated.name),
        targetType: 'student',
        changed: ['status'],
        before: studentSummaryRecord(current),
        after: studentSummaryRecord(updated),
        result: 'success',
        detail: status === 'inactive' ? '归档学员档案。' : '恢复学员档案。',
      });
      });
      return studentSummaryRecord(updated);
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action,
        targetId: studentId,
        targetName: asTrimmedString(current && current.name),
        targetType: 'student',
        changed: ['status'],
        before: studentSummaryRecord(current),
        detail: `${status === 'inactive' ? '归档' : '恢复'}学员档案失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function requireEmployeeReadAccess(employeeId, action = 'view_employee') {
    if (actor.role !== 'user') return;
    if (!actor.employeeId || actor.employeeId !== employeeId) {
      await appendFailureAudit({
        action,
        targetId: employeeId,
        targetType: 'employee',
        detail: '拒绝普通用户读取未绑定员工范围之外的员工档案。',
      });
      throw new AppError('PERMISSION_DENIED', '普通用户只能读取已绑定的本人员工范围。', 403);
    }
  }

  async function listEmployees(input) {
    const { page, pageSize } = parsePage(input);
    const keyword = asTrimmedString(input.keyword || input.search).toLowerCase();
    const status = asTrimmedString(input.status);

    if (actor.role === 'user') {
      if (!actor.employeeId) return { items: [], total: 0, page, pageSize };
      const employee = await getEmployee(actor.employeeId);
      const searchable = [employee.name, employee.department, employee.status].map(asTrimmedString).join(' ').toLowerCase();
      if (status && status !== asTrimmedString(employee.status)) return { items: [], total: 0, page, pageSize };
      if (keyword && !searchable.includes(keyword)) return { items: [], total: 0, page, pageSize };
      return { items: [scopedEmployeePublic(employee)].slice((page - 1) * pageSize, page * pageSize), total: 1, page, pageSize };
    }

    let result;
    try {
      result = { data: await listQuarterlyRowsWithPagination(COLLECTIONS.employees, null, db,
        status && ['active', 'former', 'archived'].includes(status) ? { status } : null,
        '读取员工档案列表失败。') };
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '读取员工档案列表失败。');
    }

    const rows = getRows(result).filter((employee) => isEmployeeRecord(employee)).filter((employee) => {
      if (!keyword) return true;
      const text = [
        employee.name,
        employee.department,
        employee.personalPhone,
        employee.workPhone,
        employee.onlyChildStatus,
      ]
        .map(asTrimmedString)
        .join(' ')
        .toLowerCase();
      return text.includes(keyword);
    });
    const offset = (page - 1) * pageSize;
    return {
      items: rows.slice(offset, offset + pageSize).map(employeePublicRecord),
      total: rows.length,
      page,
      pageSize,
    };
  }

  async function listMonthlyRosterRows() {
    try {
      const result = await db
        .collection(COLLECTIONS.monthlyAssessmentRoster)
        .where({ rosterKey: DEFAULT_MONTHLY_ROSTER_KEY, enabled: true })
        .get();
      const rows = getRows(result);
      const seenEmployeeIds = new Set();
      const normalized = [];
      for (const row of rows) {
        const employeeId = asTrimmedString(row && row.employeeId);
        if (!employeeId || seenEmployeeIds.has(employeeId)) {
          throw new AppError('MONTHLY_ROSTER_INVALID', '固定月度考核名单存在缺失或重复的 employeeId，请先修正名单。', 409);
        }
        seenEmployeeIds.add(employeeId);
        normalized.push({
          employeeId,
          rosterKey: DEFAULT_MONTHLY_ROSTER_KEY,
          rosterVersion: normalizeMonthlyRosterVersion(row.rosterVersion),
          sourceName: asTrimmedString(row.sourceName || row.excelName || row.name),
          sourceNameNormalized: asTrimmedString(row.sourceNameNormalized || row.excelNameNormalized),
          sourceFileName: asTrimmedString(row.sourceFileName),
          sourceSheet: asTrimmedString(row.sourceSheet),
          sourceRows: normalizeMonthlyRosterSourceRows(row.sourceRows || row.sourceRow),
        });
      }
      return normalized;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATABASE_READ_FAILED', '读取固定月度考核名单失败。');
    }
  }

  async function listMonthlyTargetDocuments(monthKey, database = db) {
    try {
      const result = await database
        .collection(COLLECTIONS.monthlyAssessmentTargets)
        .where({ monthKey })
        .get();
      return getRows(result);
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '读取月度考核对象名单失败。');
    }
  }

  async function listMonthlyTargetRows(monthKey) {
    const rows = await listMonthlyTargetDocuments(monthKey);
    return rows.filter((target) => {
      if (!isPlainObject(target) || target.eligible !== true) return false;
      const matchStatus = asTrimmedString(target.matchStatus);
      return !matchStatus || matchStatus === 'matched';
    });
  }

  async function findMonthlyTargetRows(monthKey, employeeId, database = db) {
    try {
      const result = await database
        .collection(COLLECTIONS.monthlyAssessmentTargets)
        .where({ monthKey, employeeId })
        .get();
      return getRows(result);
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '读取月度考核对象名单失败。');
    }
  }

  async function getMonthlyEmployee(employeeId, database = db) {
    try {
      const result = await database.collection(COLLECTIONS.employees).doc(employeeId).get();
      const employee = getDocument(result);
      if (employee && !isEmployeeRecord(employee)) {
        throw new AppError('MONTHLY_ROSTER_EMPLOYEE_NOT_FOUND', '月度考核名单引用的不是员工档案。', 409, { field: 'employeeId' });
      }
      return employee;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATABASE_READ_FAILED', '读取月度考核员工资料失败。');
    }
  }

  function monthlyTargetEmployeeSnapshot(employee) {
    if (!isEmployeeRecord(employee)) {
      throw new AppError(
        'MONTHLY_ROSTER_EMPLOYEE_NOT_FOUND',
        '固定月度考核名单中的员工档案不存在，不能生成该月份考核对象快照。',
        404,
        { field: 'employeeId' },
      );
    }
    const employmentStatus = asTrimmedString(employee.status);
    if (!['active', 'former', 'archived'].includes(employmentStatus)) {
      throw new AppError(
        'MONTHLY_ROSTER_INVALID',
        '固定月度考核名单中的员工状态不完整，不能生成该月份考核对象快照。',
        409,
        { field: 'status' },
      );
    }
    return {
      employeeNameSnapshot: asTrimmedString(employee.name) || '未命名员工',
      departmentSnapshot: asTrimmedString(employee.department),
      employmentStatusSnapshot: employmentStatus,
    };
  }

  async function ensureMonthlyTargets(monthKey) {
    const currentMonthKey = shanghaiMonthKey(now());
    if (monthKey > currentMonthKey) return 0;

    let rosterRows;
    try {
      if (monthKey !== currentMonthKey) {
        // A historical month is frozen after its first target is persisted.
        // Do not let a later change to the current default roster expand or
        // rewrite that month's employee scope.
        const existingTargetDocuments = await listMonthlyTargetDocuments(monthKey);
        if (existingTargetDocuments.length) return 0;
      }

      rosterRows = await listMonthlyRosterRows();
      if (!rosterRows.length) return 0;

      const currentMonthEmployeeSnapshots = new Map();
      if (monthKey === currentMonthKey) {
        for (const rosterRow of rosterRows) {
          const employee = await getMonthlyEmployee(rosterRow.employeeId);
          currentMonthEmployeeSnapshots.set(rosterRow.employeeId, monthlyTargetEmployeeSnapshot(employee));
        }
      }

      return await runTransaction(db, async (transaction) => {
        const pendingRosterRows = [];
        for (const rosterRow of rosterRows) {
          const expectedId = monthlyAssessmentTargetId(monthKey, rosterRow.employeeId);
          const existingRows = await findMonthlyTargetRows(monthKey, rosterRow.employeeId, transaction);
          if (existingRows.length > 1) {
            throw new AppError('MONTHLY_DUPLICATE_RECORD', '同一员工同一月份存在重复月度考核对象，请先清理后再生成快照。', 409);
          }
          const existing = existingRows[0] || null;
          if (existing) {
            const existingId = getRecordId(existing);
            if (!existingId) {
              const reference = transaction.collection(COLLECTIONS.monthlyAssessmentTargets).doc(expectedId);
              const existingById = getDocument(await reference.get());
              if (hasMonthlyTargetBusinessFields(existingById)) continue;
              throw new AppError('MONTHLY_TARGET_SNAPSHOT_CONFLICT', '该月份已存在非确定性主键的月度考核对象，不能覆盖或重复生成。', 409);
            }
            if (existingId !== expectedId) {
              throw new AppError('MONTHLY_TARGET_SNAPSHOT_CONFLICT', '该月份已存在非确定性主键的月度考核对象，不能覆盖或重复生成。', 409);
            }
            continue;
          }

          const reference = transaction.collection(COLLECTIONS.monthlyAssessmentTargets).doc(expectedId);
          const existingById = getDocument(await reference.get());
          if (hasMonthlyTargetBusinessFields(existingById)) {
            continue;
          }
          pendingRosterRows.push(rosterRow);
        }

        const snapshots = [];
        for (const rosterRow of pendingRosterRows) {
          const employeeSnapshot = currentMonthEmployeeSnapshots.get(rosterRow.employeeId)
            || monthlyTargetEmployeeSnapshot(await getMonthlyEmployee(rosterRow.employeeId, transaction));
          snapshots.push({
            ...rosterRow,
            ...employeeSnapshot,
          });
        }

        const created = [];
        for (const snapshot of snapshots) {
          const expectedId = monthlyAssessmentTargetId(monthKey, snapshot.employeeId);
          const nowValue = now();
          const target = {
            monthKey,
            employeeId: snapshot.employeeId,
            eligible: true,
            matchStatus: 'matched',
            rosterKey: snapshot.rosterKey,
            rosterVersion: snapshot.rosterVersion,
            sourceName: snapshot.sourceName,
            sourceNameNormalized: snapshot.sourceNameNormalized,
            sourceFileName: snapshot.sourceFileName,
            sourceSheet: snapshot.sourceSheet,
            sourceRows: snapshot.sourceRows,
            employeeNameSnapshot: snapshot.employeeNameSnapshot,
            departmentSnapshot: snapshot.departmentSnapshot,
            employmentStatusSnapshot: snapshot.employmentStatusSnapshot,
            snapshotAt: nowValue,
            createdAt: nowValue,
            updatedAt: nowValue,
            createdByAuthUid: actor.authUid,
            updatedByAuthUid: actor.authUid,
          };
          const reference = transaction.collection(COLLECTIONS.monthlyAssessmentTargets).doc(expectedId);
          if (typeof reference.set !== 'function') {
            throw new AppError('DATABASE_WRITE_FAILED', '当前 CloudBase SDK 不支持创建月度考核对象快照。');
          }
          await reference.set(target);
          created.push(snapshot.employeeId);
        }

        if (created.length) {
          await appendAudit({
            database: transaction,
            action: 'materialize_monthly_assessment_targets',
            targetName: '月度固定考核名单',
            targetType: 'session',
            changed: ['月度考核对象快照'],
            result: 'success',
            detail: `按固定名单 ${DEFAULT_MONTHLY_ROSTER_KEY} 生成${monthKey}月度考核对象快照，共 ${created.length} 条。`,
          });
        }
        return created.length;
      });
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: 'materialize_monthly_assessment_targets',
        targetName: '月度固定考核名单',
        targetType: 'session',
        detail: `生成${monthKey}月度考核对象快照失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function loadMonthlyScope(monthKey) {
    const currentMonthKey = shanghaiMonthKey(now());
    await ensureMonthlyTargets(monthKey);
    let currentRosterEmployeeIds = null;
    if (monthKey === currentMonthKey) {
      currentRosterEmployeeIds = new Set((await listMonthlyRosterRows()).map((row) => row.employeeId));
    }
    const targets = await listMonthlyTargetRows(monthKey);
    const scope = [];
    const seenEmployeeIds = new Set();

    for (const target of targets) {
      const employeeId = asTrimmedString(target.employeeId);
      if (!employeeId) continue;
      if (currentRosterEmployeeIds && !currentRosterEmployeeIds.has(employeeId)) continue;
      if (seenEmployeeIds.has(employeeId)) {
        throw new AppError('MONTHLY_DUPLICATE_RECORD', '同一员工同一月份存在重复月度考核对象，请先清理后再查看。', 409);
      }
      const targetId = getRecordId(target);
      if (targetId && targetId !== monthlyAssessmentTargetId(monthKey, employeeId)) {
        throw new AppError('MONTHLY_TARGET_SNAPSHOT_CONFLICT', '该月份已存在非确定性主键的月度考核对象，不能安全读取。', 409);
      }
      seenEmployeeIds.add(employeeId);

      if (monthKey === currentMonthKey) {
        const employee = await getMonthlyEmployee(employeeId);
        if (!employee || asTrimmedString(employee.status) !== 'active') continue;
        scope.push({
          employeeId,
          name: asTrimmedString(employee.name) || '未命名员工',
          department: asTrimmedString(employee.department),
          employmentStatus: 'active',
        });
        continue;
      }

      const snapshotFields = ['employeeNameSnapshot', 'departmentSnapshot', 'employmentStatusSnapshot'];
      if (snapshotFields.some((field) => !hasOwn(target, field))) {
        throw new AppError('MONTHLY_SNAPSHOT_MISSING', '该历史月份缺少必要的员工快照，不能用当前员工资料替代。', 409, { field: 'monthKey' });
      }
      const employmentStatus = asTrimmedString(target.employmentStatusSnapshot);
      if (!['active', 'former', 'archived'].includes(employmentStatus)) {
        throw new AppError('MONTHLY_SNAPSHOT_MISSING', '该历史月份的员工状态快照不完整。', 409, { field: 'monthKey' });
      }
      if (employmentStatus !== 'active') continue;
      scope.push({
        employeeId,
        name: asTrimmedString(target.employeeNameSnapshot) || '未命名员工',
        department: asTrimmedString(target.departmentSnapshot),
        employmentStatus,
      });
    }

    return scope;
  }

  async function findMonthlyAssessmentRow(monthKey, employeeId) {
    try {
      const result = await db
        .collection(COLLECTIONS.monthlyAssessments)
        .where({ monthKey, employeeId })
        .get();
      const rows = getRows(result);
      if (rows.length > 1) {
        throw new AppError('MONTHLY_DUPLICATE_RECORD', '同一员工同一月份存在重复月度考核记录，请先清理后再保存。', 409);
      }
      return rows[0] || null;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATABASE_READ_FAILED', '读取月度考核记录失败。');
    }
  }

  function monthlyPublicRecord(scopeItem, row, monthKey, fallbackEmployeeId = '') {
    const hasRecord = Boolean(row);
    const results = hasRecord ? normalizeStoredMonthlyResults(row.results) : monthlyDefaultResults();
    const note = hasRecord && typeof row.note === 'string' ? row.note.normalize('NFC').replace(/\r\n?/g, '\n').trim() : '';
    const version = hasRecord && Number.isInteger(row.version) && row.version > 0 ? row.version : 0;
    return {
      inScope: Boolean(scopeItem),
      employeeId: scopeItem?.employeeId || fallbackEmployeeId,
      monthKey,
      employeeName: scopeItem?.name || '',
      department: scopeItem?.department || '',
      employmentStatus: scopeItem?.employmentStatus || null,
      hasRecord,
      results,
      note,
      version,
      filledCount: monthlyFilledCount(results),
    };
  }

  function validateMonthlyFilters(input) {
    const metric = asTrimmedString(input.metric) || 'all';
    const metricStatus = asTrimmedString(input.metricStatus) || 'all';
    if (metric !== 'all' && !MONTHLY_ASSESSMENT_METRICS.includes(metric)) {
      throw new AppError('VALIDATION_ERROR', '月度考核指标筛选条件不合法。', 400, { field: 'metric' });
    }
    if (metricStatus !== 'all' && !MONTHLY_ASSESSMENT_RESULT_SET.has(metricStatus)) {
      throw new AppError('VALIDATION_ERROR', '月度考核状态筛选条件不合法。', 400, { field: 'metricStatus' });
    }
    return { metric, metricStatus };
  }

  function buildMonthlyStats(items) {
    const stats = {
      eligibleActiveCount: items.length,
      fullyEvaluatedCount: 0,
      partiallyEvaluatedCount: 0,
      unassessedCount: 0,
      metrics: {},
    };

    for (const metric of MONTHLY_ASSESSMENT_METRICS) {
      stats.metrics[metric] = {
        achieved: 0,
        not_achieved: 0,
        unassessed: 0,
        achievementRate: null,
      };
    }

    for (const item of items) {
      const filledCount = monthlyFilledCount(item.results);
      if (filledCount === 0) stats.unassessedCount += 1;
      else if (filledCount === MONTHLY_ASSESSMENT_METRICS.length) stats.fullyEvaluatedCount += 1;
      else stats.partiallyEvaluatedCount += 1;

      for (const metric of MONTHLY_ASSESSMENT_METRICS) {
        stats.metrics[metric][item.results[metric]] += 1;
      }
    }

    for (const metric of MONTHLY_ASSESSMENT_METRICS) {
      const metricStats = stats.metrics[metric];
      const denominator = metricStats.achieved + metricStats.not_achieved;
      metricStats.achievementRate = denominator ? metricStats.achieved / denominator : null;
    }
    return stats;
  }

  async function getMonthlyOverview(input) {
    const monthKey = normalizeMonthlyMonthKey(input.monthKey, now());
    const { metric, metricStatus } = validateMonthlyFilters(input);
    const { page, pageSize } = parsePage(input);
    const keyword = asTrimmedString(input.keyword).toLowerCase();
    const department = asTrimmedString(input.department);
    let scope = await loadMonthlyScope(monthKey);
    if (actor.role === 'user') {
      scope = actor.employeeId ? scope.filter((item) => item.employeeId === actor.employeeId) : [];
    }
    let assessmentRows;
    try {
      assessmentRows = getRows(await db.collection(COLLECTIONS.monthlyAssessments).where({ monthKey }).get());
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '读取月度考核记录失败。');
    }
    const assessmentByEmployeeId = new Map();
    for (const row of assessmentRows) {
      const employeeId = asTrimmedString(row.employeeId);
      if (!employeeId) continue;
      if (assessmentByEmployeeId.has(employeeId)) {
        throw new AppError('MONTHLY_DUPLICATE_RECORD', '同一员工同一月份存在重复月度考核记录，请先清理后再查看。', 409);
      }
      assessmentByEmployeeId.set(employeeId, row);
    }

    const allItems = scope.map((scopeItem) => monthlyPublicRecord(scopeItem, assessmentByEmployeeId.get(scopeItem.employeeId), monthKey));
    const filtered = allItems.filter((item) => {
      const searchable = `${item.employeeName} ${item.department}`.toLowerCase();
      if (keyword && !searchable.includes(keyword)) return false;
      if (department && department !== 'all' && item.department !== department) return false;
      if (metric !== 'all' && metricStatus !== 'all' && item.results[metric] !== metricStatus) return false;
      if (metric === 'all' && metricStatus !== 'all' && !MONTHLY_ASSESSMENT_METRICS.some((key) => item.results[key] === metricStatus)) return false;
      return true;
    });
    const offset = (page - 1) * pageSize;
    return {
      items: filtered.slice(offset, offset + pageSize),
      page,
      pageSize,
      total: filtered.length,
      stats: buildMonthlyStats(filtered),
    };
  }

  async function getMonthlyAssessment(input) {
    const employeeId = getEmployeeId(input);
    await requireEmployeeReadAccess(employeeId, 'view_monthly_assessment');
    const monthKey = normalizeMonthlyMonthKey(input.monthKey, now());
    const scope = await loadMonthlyScope(monthKey);
    const scopeItem = scope.find((item) => item.employeeId === employeeId);
    if (!scopeItem) return monthlyPublicRecord(null, null, monthKey, employeeId);
    const row = await findMonthlyAssessmentRow(monthKey, employeeId);
    return monthlyPublicRecord(scopeItem, row, monthKey);
  }

  function monthlyExpectedVersion(input) {
    if (!hasOwn(input || {}, 'expectedVersion') || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
      throw new AppError('VALIDATION_ERROR', '缺少有效的 expectedVersion。', 400, { field: 'expectedVersion' });
    }
    return input.expectedVersion;
  }

  async function saveMonthlyAssessment(input) {
    const employeeId = getEmployeeId(input);
    const monthKey = normalizeMonthlyMonthKey(input.monthKey, now());
    const expectedVersion = monthlyExpectedVersion(input);
    const results = normalizeMonthlyResults(input.results);
    const note = normalizeMonthlyNote(input.note);
    const scope = await loadMonthlyScope(monthKey);
    const scopeItem = scope.find((item) => item.employeeId === employeeId);
    let currentRow = null;
    let afterRow = null;

    try {
      if (!scopeItem) {
        throw new AppError('MONTHLY_TARGET_NOT_FOUND', '该员工不在此月份的月度考核范围内。', 404, { field: 'employeeId' });
      }
      currentRow = await findMonthlyAssessmentRow(monthKey, employeeId);
      const recordId = monthlyAssessmentRecordId(monthKey, employeeId);
      if (currentRow && getRecordId(currentRow) && getRecordId(currentRow) !== recordId) {
        throw new AppError('MONTHLY_DUPLICATE_RECORD', '月度考核记录不是确定性主键，无法安全覆盖，请先清理后再保存。', 409);
      }

      await runTransaction(db, async (transaction) => {
        const reference = transaction.collection(COLLECTIONS.monthlyAssessments).doc(recordId);
        const existing = getDocument(await reference.get());
        const currentVersion = existing && Number.isInteger(existing.version) && existing.version > 0 ? existing.version : 0;
        if (currentVersion !== expectedVersion) {
          throw new AppError('MONTHLY_ASSESSMENT_VERSION_CONFLICT', '月度考核数据已被其他人修改，请刷新后重试。', 409);
        }
        const nowValue = now();
        const nextRow = {
          employeeId,
          monthKey,
          results,
          note,
          version: expectedVersion + 1,
          createdAt: existing?.createdAt || nowValue,
          updatedAt: nowValue,
          createdBy: existing?.createdBy || actor.authUid,
          updatedBy: actor.authUid,
        };
        if (existing) {
          await reference.update(nextRow);
        } else if (typeof reference.set === 'function') {
          await reference.set(nextRow);
        } else {
          throw new AppError('DATABASE_WRITE_FAILED', '当前 CloudBase SDK 不支持创建月度考核记录。');
        }
        const before = existing ? { ...existing, results: normalizeStoredMonthlyResults(existing.results), note: typeof existing.note === 'string' ? existing.note : '' } : null;
        afterRow = nextRow;
        await appendAudit({
          database: transaction,
          action: 'save_monthly_assessment',
          targetId: employeeId,
          targetName: scopeItem.name,
          changed: monthlyAssessmentChangedFields(before, nextRow),
          before,
          after: nextRow,
          targetType: 'employee',
          result: 'success',
          detail: `保存${monthKey}月度考核评价。`,
        });
      });

      return monthlyPublicRecord(scopeItem, afterRow, monthKey);
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: 'save_monthly_assessment',
        targetId: employeeId,
        targetName: scopeItem?.name || null,
        targetType: 'employee',
        changed: currentRow ? monthlyAssessmentChangedFields(monthlyPublicRecord(scopeItem, currentRow, monthKey), { results, note }) : [],
        detail: `保存${monthKey}月度考核评价失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  function quarterlyManagementAllowed() {
    return hasPermission(actor, 'quarterly.manage');
  }

  function quarterlyTypeLabel(type) {
    return QUARTERLY_TYPE_LABELS[type] || type;
  }

  function quarterlyDueAtInfo(period, task) {
    const candidates = [];
    for (const source of [period, task]) {
      const rawValue = source && source.dueAt;
      const empty = rawValue === undefined
        || rawValue === null
        || (typeof rawValue === 'string' && rawValue.trim() === '');
      if (empty) continue;
      if (typeof rawValue !== 'string') return { invalid: true, dueAt: null, timestamp: null };
      const parsed = parseQuarterlyDateTime(rawValue);
      if (!parsed) return { invalid: true, dueAt: null, timestamp: null };
      candidates.push(parsed);
    }
    candidates.sort((left, right) => left.timestamp - right.timestamp);
    const earliest = candidates[0] || null;
    return {
      invalid: false,
      dueAt: earliest ? earliest.value : null,
      timestamp: earliest ? earliest.timestamp : null,
    };
  }

  function assertQuarterlyTaskDueAtInNaturalWindow(period, taskDueAt) {
    const opensAt = quarterlyOpensAtInfo(period);
    const usesNaturalWindow = period?.naturalQuarterSchedule === true
      || (asTrimmedString(period?.status) === 'draft' && !opensAt.invalid && opensAt.timestamp === null);
    if (!usesNaturalWindow) return;

    const window = quarterlyNaturalWindow(period.periodKey);
    const start = parseQuarterlyDateTime(window.opensAt);
    const end = parseQuarterlyDateTime(window.closesAt);
    for (const value of [period.dueAt, taskDueAt]) {
      if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) continue;
      const parsed = typeof value === 'string' ? parseQuarterlyDateTime(value) : null;
      if (!parsed) throw invalidQuarterlyDueAtError();
      if (parsed.timestamp <= start.timestamp) {
        throw new AppError('VALIDATION_ERROR', '截止时间必须晚于本季度自然开放时间。', 400, { field: 'dueAt' });
      }
      if (parsed.timestamp >= end.timestamp) {
        throw new AppError('VALIDATION_ERROR', '截止时间必须早于下季度开始时间。', 400, { field: 'dueAt' });
      }
    }
  }

  function quarterlyOpensAtInfo(period) {
    const rawValue = period && period.opensAt;
    const empty = rawValue === undefined
      || rawValue === null
      || (typeof rawValue === 'string' && rawValue.trim() === '');
    if (empty) return { invalid: false, opensAt: null, timestamp: null };
    if (typeof rawValue !== 'string') return { invalid: true, opensAt: null, timestamp: null };
    const parsed = parseQuarterlyDateTime(rawValue);
    if (!parsed) return { invalid: true, opensAt: null, timestamp: null };
    return { invalid: false, opensAt: parsed.value, timestamp: parsed.timestamp };
  }

  function quarterlyPeriodEffectiveStatus(period, serverNowValue) {
    const status = asTrimmedString(period?.status) || 'draft';
    if (['closed', 'archived'].includes(status)) return status;
    if (period?.naturalQuarterSchedule === true) {
      try {
        const window = quarterlyNaturalWindow(period.periodKey);
        const opensAt = quarterlyOpensAtInfo(period);
        const parsedNow = parseQuarterlyDateTime(serverNowValue);
        const start = parseQuarterlyDateTime(window.opensAt);
        if (
          opensAt.invalid
          || !parsedNow
          || !start
          || opensAt.timestamp !== start.timestamp
        ) return 'closed';
        if (parsedNow.timestamp < start.timestamp) return 'draft';
        // Calendar quarter end does not close the review period. An administrator
        // must persist status="closed"; task-level due dates remain independent.
        return 'open';
      } catch {
        return 'closed';
      }
    }
    const opensAt = quarterlyOpensAtInfo(period);
    const parsedNow = parseQuarterlyDateTime(serverNowValue);
    if (!opensAt.invalid && opensAt.timestamp !== null && parsedNow) {
      if (parsedNow.timestamp < opensAt.timestamp) return 'draft';
      if (status === 'draft') return 'open';
    }
    return status;
  }

  function assertQuarterlyRosterEditable(period, serverNowValue) {
    const opensAt = quarterlyOpensAtInfo(period);
    if (opensAt.invalid) {
      throw new AppError('QUARTERLY_INVALID_OPENS_AT', QUARTERLY_MESSAGES.invalidOpensAt);
    }
    if (period?.naturalQuarterSchedule === true) {
      throw new AppError('QUARTERLY_PERIOD_CLOSED', '名单已按季度排期确认，开放前不能再修改评价关系。', 409);
    }
    if (quarterlyPeriodEffectiveStatus(period, serverNowValue) !== 'draft') {
      throw new AppError('QUARTERLY_PERIOD_CLOSED', '周期开放后不能再新增或修改评价关系。');
    }
  }

  function quarterlyWriteState(task, period, serverNowValue, account = actor, {
    enforceOwner = true,
    enforceSelfBinding = true,
  } = {}) {
    const serverNow = asTrimmedString(serverNowValue) || new Date().toISOString();
    const state = {
      canWrite: false,
      reason: null,
      opensAt: null,
      dueAt: null,
      serverNow,
      failure: null,
    };
    const dueAt = quarterlyDueAtInfo(period, task);
    state.dueAt = dueAt.dueAt;
    if (!task || asTrimmedString(task.status) !== 'active') {
      state.reason = QUARTERLY_MESSAGES.taskRevoked;
      state.failure = 'revoked';
      return state;
    }
    if (!period) {
      state.reason = QUARTERLY_MESSAGES.periodNotOpen;
      state.failure = 'period-not-open';
      return state;
    }
    const opening = quarterlyOpensAtInfo(period);
    if (opening.invalid) {
      state.reason = QUARTERLY_MESSAGES.invalidOpensAt;
      state.failure = 'invalid-opens-at';
      return state;
    }
    const parsedNow = parseQuarterlyDateTime(serverNow);
    if (!parsedNow) {
      state.reason = QUARTERLY_MESSAGES.invalidDueAt;
      state.failure = 'invalid-server-time';
      return state;
    }
    const storedPeriodStatus = asTrimmedString(period.status) || 'draft';
    const effectiveStatus = quarterlyPeriodEffectiveStatus(period, serverNow);
    if (['draft', 'open'].includes(storedPeriodStatus)
      && effectiveStatus === 'draft'
      && !dueAt.invalid
      && (dueAt.timestamp === null || parsedNow.timestamp < dueAt.timestamp)
      && opening.timestamp !== null
      && parsedNow.timestamp < opening.timestamp) {
      state.opensAt = opening.opensAt;
    }
    if (['closed', 'archived'].includes(storedPeriodStatus)
      || (opening.timestamp !== null && parsedNow.timestamp < opening.timestamp)
      || quarterlyPeriodEffectiveStatus(period, serverNow) !== 'open') {
      state.reason = QUARTERLY_MESSAGES.periodNotOpen;
      state.failure = 'period-not-open';
      return state;
    }
    if (dueAt.invalid) {
      state.reason = QUARTERLY_MESSAGES.invalidDueAt;
      state.failure = 'invalid-due-at';
      return state;
    }
    if (dueAt.timestamp !== null && parsedNow.timestamp >= dueAt.timestamp) {
      state.reason = QUARTERLY_MESSAGES.deadlinePassed;
      state.failure = 'deadline-passed';
      return state;
    }
    if (enforceOwner && !quarterlyTaskMatchesCurrentEmployee(task, account)) {
      state.reason = '当前账号不是该季度评价任务的评价人。';
      state.failure = 'not-owner';
      return state;
    }
    if (enforceSelfBinding && asTrimmedString(task.type) === 'self') {
      const boundEmployeeId = asTrimmedString(account?.employeeId);
      const evaluateeEmployeeId = asTrimmedString(task.evaluateeEmployeeId);
      if (!boundEmployeeId) {
        state.reason = QUARTERLY_MESSAGES.selfBindingRequired;
        state.failure = 'self-binding-required';
        return state;
      }
      if (boundEmployeeId !== evaluateeEmployeeId) {
        state.reason = QUARTERLY_MESSAGES.selfBindingMismatch;
        state.failure = 'self-binding-mismatch';
        return state;
      }
    }
    state.canWrite = true;
    return state;
  }

  function quarterlyTaskAvailability(task, period, serverNowValue) {
    const ownerContext = quarterlyTaskMatchesCurrentEmployee(task, actor);
    const state = quarterlyWriteState(task, period, serverNowValue, actor, {
      enforceOwner: false,
      enforceSelfBinding: ownerContext,
    });
    return {
      canWrite: state.canWrite,
      reason: state.reason,
      opensAt: state.opensAt,
      dueAt: state.dueAt,
      serverNow: state.serverNow,
    };
  }

  function assertQuarterlyWriteAllowed(task, period, serverNowValue, account = actor) {
    const state = quarterlyWriteState(task, period, serverNowValue, account);
    if (state.canWrite) return state;
    if (state.failure === 'not-owner') {
      throw new AppError('PERMISSION_DENIED', '当前账号不能提交未分配的季度评价任务。', 403);
    }
    if (state.failure === 'revoked') {
      throw new AppError('QUARTERLY_TASK_REVOKED', QUARTERLY_MESSAGES.taskRevoked);
    }
    if (state.failure === 'period-not-open') {
      throw new AppError('QUARTERLY_PERIOD_CLOSED', QUARTERLY_MESSAGES.periodNotOpen);
    }
    if (state.failure === 'deadline-passed') {
      throw new AppError('QUARTERLY_DEADLINE_PASSED', QUARTERLY_MESSAGES.deadlinePassed);
    }
    if (state.failure === 'invalid-opens-at') {
      throw new AppError('QUARTERLY_INVALID_OPENS_AT', QUARTERLY_MESSAGES.invalidOpensAt);
    }
    if (state.failure === 'self-binding-required') {
      throw new AppError('QUARTERLY_SELF_BINDING_REQUIRED', QUARTERLY_MESSAGES.selfBindingRequired);
    }
    if (state.failure === 'self-binding-mismatch') {
      throw new AppError('QUARTERLY_SELF_BINDING_MISMATCH', QUARTERLY_MESSAGES.selfBindingMismatch);
    }
    throw invalidQuarterlyDueAtError('dueAt');
  }

  function currentQuarterlyTaskIdentity(task, taskId) {
    try {
      const periodKey = normalizeQuarterlyPeriodKey(task?.periodKey);
      const type = normalizeQuarterlyType(task?.type);
      const evaluateeEmployeeId = validateTextField(task?.evaluateeEmployeeId, '被评价员工编号', { required: true, maxLength: 160 });
      const evaluatorEmployeeIdSnapshot = asTrimmedString(task?.evaluatorEmployeeIdSnapshot);
      const evaluatorStudentIdSnapshot = asTrimmedString(task?.evaluatorStudentIdSnapshot);
      if (evaluatorEmployeeIdSnapshot && evaluatorStudentIdSnapshot) throw new Error('multiple evaluator identity snapshots');
      if (asTrimmedString(taskId).startsWith('quarterly-task:employee:')) {
        const evaluatorEmployeeId = validateTextField(
          evaluatorEmployeeIdSnapshot,
          '评价人档案编号',
          { required: true, maxLength: 160 },
        );
        if (quarterlyEmployeeTaskId(periodKey, type, evaluatorEmployeeId, evaluateeEmployeeId) !== taskId) {
          throw new Error('quarterly employee task identity mismatch');
        }
        return {
          periodKey,
          type,
          evaluatorAccountId: asTrimmedString(task?.evaluatorAccountId) || null,
          evaluatorEmployeeId,
          evaluatorStudentId: null,
          evaluateeEmployeeId,
          identityMode: 'employee',
        };
      }
      const evaluatorAccountId = validateTextField(task?.evaluatorAccountId, '评价人账号编号', { required: true, maxLength: 160 });
      if (quarterlyTaskId(periodKey, type, evaluatorAccountId, evaluateeEmployeeId) !== taskId) {
        throw new Error('quarterly task identity mismatch');
      }
      return {
        periodKey,
        type,
        evaluatorAccountId,
        evaluatorEmployeeId: evaluatorEmployeeIdSnapshot || null,
        evaluatorStudentId: evaluatorStudentIdSnapshot || null,
        evaluateeEmployeeId,
        identityMode: 'account',
      };
    } catch {
      throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', QUARTERLY_MESSAGES.taskIdentityConflict);
    }
  }

  function currentQuarterlyPeriodIdentity(period, periodKey) {
    if (!period || asTrimmedString(period.periodKey) !== periodKey) {
      throw new AppError('QUARTERLY_PERIOD_IDENTITY_CONFLICT', QUARTERLY_MESSAGES.periodIdentityConflict);
    }
    return period;
  }

  function assertQuarterlySelfBinding(type, account, evaluateeEmployeeId) {
    if (type !== 'self') return;
    const boundEmployeeId = asTrimmedString(account?.employeeId);
    if (!boundEmployeeId) {
      throw new AppError('QUARTERLY_SELF_BINDING_REQUIRED', QUARTERLY_MESSAGES.selfBindingRequired);
    }
    if (boundEmployeeId !== asTrimmedString(evaluateeEmployeeId)) {
      throw new AppError('QUARTERLY_SELF_BINDING_MISMATCH', QUARTERLY_MESSAGES.selfBindingMismatch);
    }
  }

  function assertQuarterlyAccountIdentity(currentAccount) {
    if (!currentAccount || asTrimmedString(currentAccount.status) !== 'active' || asTrimmedString(currentAccount.authUid) !== actor.authUid) {
      throw new AppError('QUARTERLY_ACCOUNT_IDENTITY_CHANGED', QUARTERLY_MESSAGES.accountIdentityChanged);
    }
    const currentIdentityVersion = Number.isInteger(currentAccount.identityVersion) && currentAccount.identityVersion > 0
      ? currentAccount.identityVersion
      : 0;
    if (actor.identityVersion && currentIdentityVersion !== actor.identityVersion) {
      throw new AppError('QUARTERLY_ACCOUNT_IDENTITY_CHANGED', QUARTERLY_MESSAGES.accountIdentityChanged);
    }
    return currentAccount;
  }

  function assertQuarterlySourceTaskBinding(task, account = actor) {
    if (!asTrimmedString(task?.sourcePendingRelationId)) return;
    const assignedEmployeeId = asTrimmedString(task.evaluatorEmployeeIdSnapshot);
    const assignedStudentId = asTrimmedString(task.evaluatorStudentIdSnapshot);
    const currentEmployeeId = asTrimmedString(account?.employeeId);
    const currentStudentId = asTrimmedString(account?.studentId);
    const studentIdentityMatches = Boolean(assignedStudentId
      && !assignedEmployeeId
      && isStudentAccount(account)
      && assignedStudentId === currentStudentId
      && asTrimmedString(task.evaluatorAccountId) === asTrimmedString(account.accountId));
    const employeeIdentityMatches = Boolean(assignedEmployeeId
      && !assignedStudentId
      && !isStudentAccount(account)
      && currentEmployeeId
      && assignedEmployeeId === currentEmployeeId);
    if (!studentIdentityMatches && !employeeIdentityMatches) {
      throw new AppError('PERMISSION_DENIED', '当前账号的员工绑定与该季度评价任务不一致。', 403);
    }
  }

  function quarterlyTaskMatchesCurrentEmployee(task, account = actor) {
    const assignedEmployeeId = asTrimmedString(task.evaluatorEmployeeIdSnapshot);
    const assignedStudentId = asTrimmedString(task.evaluatorStudentIdSnapshot);
    const currentEmployeeId = asTrimmedString(account?.employeeId);
    const currentStudentId = asTrimmedString(account?.studentId);
    const isStudent = isStudentAccount(account);
    const evaluatorAccountId = asTrimmedString(task?.evaluatorAccountId);
    if (asTrimmedString(getRecordId(task) || task?.taskId).startsWith('quarterly-task:employee:')) {
      return Boolean(assignedEmployeeId && !assignedStudentId && !isStudent && currentEmployeeId && assignedEmployeeId === currentEmployeeId);
    }
    if (evaluatorAccountId !== asTrimmedString(account?.accountId)) return false;
    if (assignedStudentId) {
      return Boolean(!assignedEmployeeId && isStudent && currentStudentId && assignedStudentId === currentStudentId);
    }
    if (assignedEmployeeId) return Boolean(!isStudent && currentEmployeeId && assignedEmployeeId === currentEmployeeId);
    return !asTrimmedString(task?.sourcePendingRelationId) && !isStudent;
  }

  async function quarterlyTasksForAccount(account, database = db) {
    const accountId = asTrimmedString(account?.accountId);
    const employeeId = asTrimmedString(account?.employeeId);
    const queries = [];
    if (accountId) {
      queries.push(listQuarterlyRows(COLLECTIONS.quarterlyTasks, { evaluatorAccountId: accountId }, database));
    }
    if (employeeId) {
      queries.push(listQuarterlyRows(COLLECTIONS.quarterlyTasks, { evaluatorEmployeeIdSnapshot: employeeId }, database));
    }
    const rows = (await Promise.all(queries)).flat();
    const unique = new Map();
    for (const row of rows) {
      const id = getRecordId(row) || asTrimmedString(row.taskId);
      if (id) unique.set(id, row);
    }
    return [...unique.values()].filter((task) => quarterlyTaskMatchesCurrentEmployee(task, account));
  }

  async function quarterlyTasksForEmployeeIdentity({ periodKey, type, evaluatorEmployeeId, evaluateeEmployeeId, database = db }) {
    if (typeof database.runTransaction !== 'function') {
      throw new AppError('DATABASE_READ_FAILED', '季度任务身份预检必须在事务外完成。');
    }
    const rows = await listQuarterlyRowsWithPagination(
      COLLECTIONS.quarterlyTasks,
      {
        _id: true,
        taskId: true,
        periodKey: true,
        type: true,
        evaluatorAccountId: true,
        evaluatorAuthUidSnapshot: true,
        evaluatorEmployeeIdSnapshot: true,
        evaluateeEmployeeId: true,
        status: true,
        sourcePendingRelationId: true,
        version: true,
      },
      database,
      { periodKey },
      '读取已存在的季度评价任务失败。',
    );
    const matches = [];
    for (const task of rows) {
      if (
        asTrimmedString(task.type) !== type
        || asTrimmedString(task.evaluateeEmployeeId) !== evaluateeEmployeeId
      ) continue;
      let storedEvaluatorEmployeeId = asTrimmedString(task.evaluatorEmployeeIdSnapshot);
      if (asTrimmedString(task.evaluatorAccountId)) {
        try {
          const account = await findAccountById(database, task.evaluatorAccountId);
          const boundEmployeeId = asTrimmedString(account.employeeId);
          if (storedEvaluatorEmployeeId && storedEvaluatorEmployeeId !== boundEmployeeId) continue;
          storedEvaluatorEmployeeId = boundEmployeeId;
        } catch (error) {
          if (toAppError(error).code !== 'ACCOUNT_NOT_FOUND') throw error;
          if (!storedEvaluatorEmployeeId) {
            throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', QUARTERLY_MESSAGES.taskIdentityConflict);
          }
        }
      }
      if (storedEvaluatorEmployeeId === evaluatorEmployeeId) matches.push(task);
    }
    return matches;
  }

  async function currentQuarterlyActorAccount(database = db) {
    let account;
    try {
      account = getDocument(await database.collection(COLLECTIONS.adminAccounts).doc(actor.accountId).get());
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '读取当前季度评价账号失败。');
    }
    const current = assertQuarterlyAccountIdentity(account);
    const currentStudentId = asTrimmedString(current.studentId);
    const actorStudentId = asTrimmedString(actor.studentId);
    if (asTrimmedString(current.employeeId) !== asTrimmedString(actor.employeeId)
      || currentStudentId !== actorStudentId
      || isStudentAccount(current) !== Boolean(actorStudentId)
      || (isStudentAccount(current) && asTrimmedString(current.employeeId))) {
      throw new AppError('QUARTERLY_ACCOUNT_IDENTITY_CHANGED', QUARTERLY_MESSAGES.accountIdentityChanged);
    }
    return { ...current, accountId: actor.accountId };
  }

  function quarterlyPeriodPublic(period, counts = {}, serverNowValue = now()) {
    if (!period) return null;
    const periodKey = asTrimmedString(period.periodKey);
    const effectiveStatus = quarterlyPeriodEffectiveStatus(period, serverNowValue);
    return {
      id: getRecordId(period) || quarterlyPeriodId(periodKey),
      periodKey,
      periodName: asTrimmedString(period.periodName),
      status: effectiveStatus,
      rosterLocked: period.naturalQuarterSchedule === true || effectiveStatus !== 'draft',
      resultVisibility: normalizeQuarterlyResultVisibility(period.resultVisibility),
      scoringStandardVersion: asTrimmedString(period.scoringStandardVersion) || QUARTERLY_SCORING_STANDARD_VERSION,
      rosterVersion: Number.isInteger(period.rosterVersion) && period.rosterVersion > 0 ? period.rosterVersion : 1,
      version: Number.isInteger(period.version) && period.version > 0 ? period.version : 1,
      opensAt: asTrimmedString(period.opensAt) || null,
      dueAt: asTrimmedString(period.dueAt) || null,
      taskCount: Number.isInteger(counts.taskCount) ? counts.taskCount : Number.isInteger(period.taskCount) ? period.taskCount : 0,
      submittedTaskCount: Number.isInteger(counts.submittedTaskCount)
        ? counts.submittedTaskCount
        : Number.isInteger(period.submittedTaskCount) ? period.submittedTaskCount : 0,
      updatedAt: period.updatedAt || null,
    };
  }

  function quarterlyPeriodNameFromKey(periodKey) {
    const match = /^(\d{4})-Q([1-4])$/.exec(periodKey);
    if (!match) return periodKey;
    const quarterNames = ['一', '二', '三', '四'];
    return `${match[1]} 年第${quarterNames[Number(match[2]) - 1]}季度`;
  }

  function quarterlyPendingRelationPublic(relation) {
    const periodKey = normalizeQuarterlyPeriodKey(relation.periodKey);
    const type = normalizeQuarterlyType(relation.type);
    const sourceRelationId = validateTextField(relation.sourceRelationId, '来源关系编号', {
      required: true,
      maxLength: 160,
    });
    const id = validateTextField(getRecordId(relation), '待绑定关系编号', { required: true, maxLength: 240 });
    if (id !== quarterlyPendingRelationId(periodKey, type, sourceRelationId)) {
      throw new AppError('QUARTERLY_PENDING_RELATION_IDENTITY_CONFLICT', '待绑定评价关系编号与来源信息不一致。');
    }
    if (asTrimmedString(relation.status) !== 'pending_binding') {
      throw new AppError('VALIDATION_ERROR', '待绑定评价关系状态无效。', 400, { field: 'status' });
    }
    const evaluatorEmployeeIdValue = relation.evaluatorEmployeeIdSnapshot;
    const evaluatorEmployeeIdSnapshot = evaluatorEmployeeIdValue === null
      || evaluatorEmployeeIdValue === undefined
      || (typeof evaluatorEmployeeIdValue === 'string' && !evaluatorEmployeeIdValue.trim())
      ? null
      : validateTextField(evaluatorEmployeeIdValue, '评价人档案编号', { required: true, maxLength: 160 });
    const evaluatorStudentIdValue = relation.evaluatorStudentIdSnapshot;
    const evaluatorStudentIdSnapshot = evaluatorStudentIdValue === null
      || evaluatorStudentIdValue === undefined
      || (typeof evaluatorStudentIdValue === 'string' && !evaluatorStudentIdValue.trim())
      ? null
      : validateTextField(evaluatorStudentIdValue, '评价人学员编号', { required: true, maxLength: 160 });
    if (evaluatorEmployeeIdSnapshot && evaluatorStudentIdSnapshot) {
      throw new AppError('QUARTERLY_PENDING_RELATION_IDENTITY_CONFLICT', '待绑定评价关系不能同时绑定员工和学员身份。');
    }
    const evaluatorStudentNameSnapshot = validateTextField(relation.evaluatorStudentNameSnapshot, '评价人学员姓名', {
      maxLength: 120,
    }) || null;
    const evaluatorNameSnapshot = validateTextField(relation.evaluatorNameSnapshot, '评价人来源姓名', {
      required: true,
      maxLength: 120,
    });
    const evaluateeEmployeeId = validateTextField(relation.evaluateeEmployeeId, '被评价员工编号', {
      required: true,
      maxLength: 160,
    });
    const evaluateeNameSnapshot = validateTextField(relation.evaluateeNameSnapshot, '被评价员工姓名', {
      required: true,
      maxLength: 120,
    });
    const periodName = validateTextField(relation.periodName, '周期名称', { maxLength: 120 })
      || quarterlyPeriodNameFromKey(periodKey);
    return {
      id,
      sourceRelationId,
      periodKey,
      periodName,
      type,
      typeLabel: quarterlyTypeLabel(type),
      status: 'pending_binding',
      evaluatorNameSnapshot,
      evaluatorEmployeeIdSnapshot,
      evaluatorStudentIdSnapshot,
      evaluatorStudentNameSnapshot,
      evaluateeEmployeeId,
      evaluateeNameSnapshot,
      evaluateeDepartmentSnapshot: validateTextField(relation.evaluateeDepartmentSnapshot, '被评价员工部门', { maxLength: 120 }),
    };
  }

  function quarterlyRecordSummary(record) {
    if (!record) return null;
    return {
      id: getRecordId(record) || asTrimmedString(record.taskId),
      status: normalizeQuarterlyRecordStatus(record.status || 'draft'),
      total: Number.isInteger(record.total) ? record.total : null,
      version: Number.isInteger(record.version) && record.version > 0 ? record.version : 1,
      updatedAt: record.updatedAt || null,
      submittedAt: record.submittedAt || null,
      returnedReason: asTrimmedString(record.returnedReason) || null,
    };
  }

  function quarterlyTaskPublic(task, record = null, period = null, serverNowValue = now()) {
    if (!task) return null;
    return {
      id: getRecordId(task) || asTrimmedString(task.taskId),
      periodKey: asTrimmedString(task.periodKey),
      periodName: asTrimmedString(task.periodName),
      type: asTrimmedString(task.type),
      typeLabel: quarterlyTypeLabel(asTrimmedString(task.type)),
      evaluatorAccountId: asTrimmedString(task.evaluatorAccountId) || null,
      evaluatorNameSnapshot: asTrimmedString(task.evaluatorNameSnapshot),
      evaluatorEmployeeIdSnapshot: asTrimmedString(task.evaluatorEmployeeIdSnapshot) || null,
      evaluatorStudentIdSnapshot: asTrimmedString(task.evaluatorStudentIdSnapshot) || null,
      evaluateeEmployeeId: asTrimmedString(task.evaluateeEmployeeId),
      evaluateeNameSnapshot: asTrimmedString(task.evaluateeNameSnapshot),
      evaluateeDepartmentSnapshot: asTrimmedString(task.evaluateeDepartmentSnapshot),
      status: asTrimmedString(task.status) === 'revoked' ? 'revoked' : 'active',
      sourceLocked: Boolean(asTrimmedString(task.sourcePendingRelationId)),
      version: Number.isInteger(task.version) && task.version > 0 ? task.version : 1,
      dueAt: asTrimmedString(task.dueAt) || null,
      availability: quarterlyTaskAvailability(task, period, serverNowValue),
      record: quarterlyRecordSummary(record),
    };
  }

  function quarterlyRecordPublic(record, { received = false, published = true, management = false } = {}) {
    if (!record) return null;
    const status = normalizeQuarterlyRecordStatus(record.status || 'draft');
    const result = {
      id: getRecordId(record) || asTrimmedString(record.taskId),
      taskId: asTrimmedString(record.taskId) || getRecordId(record),
      periodKey: asTrimmedString(record.periodKey),
      periodName: asTrimmedString(record.periodName),
      type: asTrimmedString(record.type),
      typeLabel: quarterlyTypeLabel(asTrimmedString(record.type)),
      evaluatorAccountId: asTrimmedString(record.evaluatorAccountId),
      evaluatorNameSnapshot: asTrimmedString(record.evaluatorNameSnapshot),
      evaluateeEmployeeId: asTrimmedString(record.evaluateeEmployeeId),
      evaluateeNameSnapshot: asTrimmedString(record.evaluateeNameSnapshot),
      evaluateeDepartmentSnapshot: asTrimmedString(record.evaluateeDepartmentSnapshot),
      status,
      total: Number.isInteger(record.total) ? record.total : null,
      version: Number.isInteger(record.version) && record.version > 0 ? record.version : 1,
      updatedAt: record.updatedAt || null,
      submittedAt: record.submittedAt || null,
      returnedReason: asTrimmedString(record.returnedReason) || null,
      isReceived: Boolean(received),
      resultVisible: Boolean(published),
      managementEdited: record.managementEdited === true,
      actualOperatorName: asTrimmedString(record.actualOperatorName) || null,
    };
    if (!received || published || management) {
      result.scores = normalizeStoredQuarterlyScores(record.scores);
      result.reasons = normalizeStoredQuarterlyReasons(record.reasons);
    } else {
      result.scores = null;
      result.reasons = null;
      result.total = null;
      result.evaluatorNameSnapshot = '';
      result.evaluatorAccountId = '';
    }
    if (!management) delete result.evaluatorAccountId;
    return result;
  }

  function quarterlyResultItem(record, period, direction, { published = true } = {}) {
    const received = direction === 'received';
    const visible = !received || published;
    return {
      id: getRecordId(record) || asTrimmedString(record.taskId),
      periodKey: asTrimmedString(record.periodKey),
      periodName: asTrimmedString(period?.periodName || record.periodName),
      type: asTrimmedString(record.type),
      typeLabel: quarterlyTypeLabel(asTrimmedString(record.type)),
      direction,
      status: visible ? normalizeQuarterlyRecordStatus(record.status || 'draft') : 'unpublished',
      evaluatorName: received ? (visible ? asTrimmedString(record.evaluatorNameSnapshot) || null : null) : asTrimmedString(record.evaluatorNameSnapshot) || null,
      evaluateeName: asTrimmedString(record.evaluateeNameSnapshot) || null,
      total: visible && Number.isInteger(record.total) ? record.total : null,
      scores: visible ? normalizeStoredQuarterlyScores(record.scores) : null,
      reasons: visible ? normalizeStoredQuarterlyReasons(record.reasons) : null,
      published: visible,
    };
  }

  async function listQuarterlyRows(collectionName, filter = null, database = db) {
    try {
      return await listQuarterlyRowsWithPagination(collectionName, null, database, filter);
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '读取季度评价数据失败。');
    }
  }

  async function listQuarterlyRowsWithPagination(
    collectionName,
    fields,
    database = db,
    filter = null,
    errorMessage = '读取季度人员选择数据失败。',
  ) {
    const pageSize = 100;
    const allRows = [];
    try {
      for (let page = 0; ; page += 1) {
        let query = database.collection(collectionName);
        if (
          typeof query.field !== 'function'
          || typeof query.orderBy !== 'function'
          || typeof query.skip !== 'function'
          || typeof query.limit !== 'function'
        ) {
          throw new Error('CloudBase query pagination is unavailable');
        }
        if (isPlainObject(filter) && Object.keys(filter).length) query = query.where(filter);
        if (fields) query = query.field(fields);
        query = query.orderBy('_id', 'asc').skip(page * pageSize).limit(pageSize);
        const batch = getRows(await query.get());
        allRows.push(...batch);
        if (batch.length < pageSize) return allRows;
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATABASE_READ_FAILED', errorMessage);
    }
  }

  function quarterlyAssignmentEmployeePublic(employee) {
    const employeeId = getRecordId(employee) || asTrimmedString(employee.employeeId);
    if (!employeeId) return null;
    const rawStatus = asTrimmedString(employee.status);
    return {
      employeeId,
      name: asTrimmedString(employee.name) || '未命名员工',
      department: asTrimmedString(employee.department),
      status: ['active', 'former', 'archived'].includes(rawStatus) ? rawStatus : 'archived',
    };
  }

  function quarterlyAssignmentAccountPublic(account, employeesById) {
    const accountId = getRecordId(account) || asTrimmedString(account.accountId);
    if (!accountId) return null;
    if (asTrimmedString(account.identityType) === 'student' || asTrimmedString(account.studentId)) return null;
    const employeeId = asTrimmedString(account.employeeId);
    const employee = employeeId ? employeesById.get(employeeId) : null;
    const employeeName = employeeId
      ? (asTrimmedString(employee?.name) || asTrimmedString(account.employeeNameSnapshot) || null)
      : null;
    return {
      accountId,
      displayName: employeeName || asTrimmedString(account.displayName) || asTrimmedString(account.name) || asTrimmedString(account.username) || '未命名账号',
      username: asTrimmedString(account.username),
      employeeId: employeeId || null,
      employeeName,
      department: asTrimmedString(employee?.department) || asTrimmedString(account.department),
      status: asTrimmedString(account.status) === 'active' ? 'active' : 'disabled',
    };
  }

  function quarterlyAssignmentStudentPublic(student, accounts) {
    const studentId = getRecordId(student) || asTrimmedString(student.studentId);
    if (!studentId || !isStudentRecord(student) || asTrimmedString(student.status) !== 'active') return null;
    const linkedAccounts = accounts.filter((account) => isStudentAccount(account)
      && asTrimmedString(account.studentId) === studentId);
    if (linkedAccounts.length !== 1 || asTrimmedString(linkedAccounts[0].status) !== 'active') return null;
    return {
      studentId,
      name: asTrimmedString(student.name) || '未命名学员',
    };
  }

  async function getQuarterlyAssignmentOptions() {
    requirePermission(actor, 'quarterly.manage');
    const [accountRows, employeeRows] = await Promise.all([
      listQuarterlyRowsWithPagination(COLLECTIONS.adminAccounts, {
        _id: true,
        accountId: true,
        displayName: true,
        name: true,
        username: true,
        employeeId: true,
        employeeNameSnapshot: true,
        studentId: true,
        identityType: true,
        department: true,
        status: true,
      }),
      listQuarterlyRowsWithPagination(COLLECTIONS.employees, {
        _id: true,
        recordType: true,
        employeeId: true,
        name: true,
        department: true,
        status: true,
      }),
    ]);
    const employees = employeeRows.filter(isEmployeeRecord).map(quarterlyAssignmentEmployeePublic).filter(Boolean);
    const students = employeeRows
      .filter(isStudentRecord)
      .map((student) => quarterlyAssignmentStudentPublic(student, accountRows))
      .filter(Boolean);
    const employeesById = new Map(employees.map((employee) => [employee.employeeId, employee]));
    const accounts = accountRows.map((account) => quarterlyAssignmentAccountPublic(account, employeesById)).filter(Boolean);
    return { accounts, employees, students };
  }

  async function getQuarterlyPeriod(periodKey, database = db) {
    const normalizedPeriodKey = normalizeQuarterlyPeriodKey(periodKey);
    const id = quarterlyPeriodId(normalizedPeriodKey);
    try {
      const period = getDocument(await database.collection(COLLECTIONS.quarterlyPeriods).doc(id).get());
      if (!period) throw new AppError('QUARTERLY_PERIOD_NOT_FOUND', '未找到对应的季度周期。');
      return getRecordId(period) ? period : { ...period, _id: id };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATABASE_READ_FAILED', '读取季度周期失败。');
    }
  }

  async function findQuarterlyPeriod(periodKey, database = db) {
    const normalizedPeriodKey = normalizeQuarterlyPeriodKey(periodKey);
    const id = quarterlyPeriodId(normalizedPeriodKey);
    try {
      const period = getDocument(await database.collection(COLLECTIONS.quarterlyPeriods).doc(id).get());
      if (!period) return null;
      currentQuarterlyPeriodIdentity(period, normalizedPeriodKey);
      return getRecordId(period) ? period : { ...period, _id: id };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATABASE_READ_FAILED', '读取季度评价周期失败。');
    }
  }

  async function getQuarterlyTask(taskId, database = db) {
    const id = quarterlyRecordId(taskId);
    try {
      const task = getDocument(await database.collection(COLLECTIONS.quarterlyTasks).doc(id).get());
      if (!task) throw new AppError('QUARTERLY_TASK_NOT_FOUND', '未找到对应的季度评价任务。');
      return getRecordId(task) ? task : { ...task, _id: id };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATABASE_READ_FAILED', '读取季度评价任务失败。');
    }
  }

  async function getQuarterlyRecord(taskId, database = db) {
    const id = quarterlyRecordId(taskId);
    try {
      const direct = getDocument(await database.collection(COLLECTIONS.quarterlyRecords).doc(id).get());
      if (direct) return getRecordId(direct) ? direct : { ...direct, _id: id };
      const rows = await listQuarterlyRows(COLLECTIONS.quarterlyRecords, { taskId }, database);
      if (rows.length > 1) {
        throw new AppError('QUARTERLY_DUPLICATE_RECORD', '同一季度评价任务存在重复记录，不能安全读取。');
      }
      if (!rows[0]) return null;
      const row = rows[0];
      if (getRecordId(row) !== id) {
        throw new AppError('QUARTERLY_DUPLICATE_RECORD', '季度评价记录不是确定性主键，不能安全覆盖。');
      }
      return row;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATABASE_READ_FAILED', '读取季度评价记录失败。');
    }
  }

  async function getQuarterlyEmployeeSnapshot(employeeId, database = db) {
    const id = validateTextField(employeeId, '被评价员工编号', { required: true, maxLength: 160 });
    try {
      const employee = getDocument(await database.collection(COLLECTIONS.employees).doc(id).get());
      if (!isEmployeeRecord(employee)) throw new AppError('EMPLOYEE_NOT_FOUND', '未找到被评价员工档案。');
      return {
        employeeId: id,
        employeeNameSnapshot: asTrimmedString(employee.name) || '未命名员工',
        departmentSnapshot: asTrimmedString(employee.department),
        employmentStatusSnapshot: asTrimmedString(employee.status) || null,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATABASE_READ_FAILED', '读取季度评价员工快照失败。');
    }
  }

  async function quarterlyEvaluatorForEmployee(employeeIdValue, accountIdValue = '', database = db, type = '') {
    const employeeId = validateTextField(employeeIdValue, '评价人档案编号', { required: true, maxLength: 160 });
    const currentEmployee = await getQuarterlyEmployeeSnapshot(employeeId, database);
    if (asTrimmedString(currentEmployee.employmentStatusSnapshot) !== 'active') {
      throw new AppError('ACCOUNT_INACTIVE', '评价人对应员工档案当前不是在职状态，不能建立季度评价任务。');
    }
    let account = null;
    const requestedAccountId = asTrimmedString(accountIdValue);
    if (requestedAccountId) {
      account = await findAccountById(database, requestedAccountId);
      if (asTrimmedString(account.status) !== 'active') {
        throw new AppError('ACCOUNT_INACTIVE', '评价人账号已停用，不能建立季度评价任务。');
      }
      assertQuarterlySelfBinding(type, account, employeeId);
      if (asTrimmedString(account.employeeId) !== employeeId) {
        throw new AppError('QUARTERLY_BINDING_CONFLICT', '所选账号与评价人档案身份不一致。', 409);
      }
    }
    return {
      evaluatorAccountId: account ? (getRecordId(account) || asTrimmedString(account.accountId)) : null,
      evaluatorAuthUidSnapshot: account ? (asTrimmedString(account.authUid) || null) : null,
      evaluatorNameSnapshot: currentEmployee.employeeNameSnapshot,
      evaluatorEmployeeIdSnapshot: employeeId,
    };
  }

  function normalizeQuarterlyTaskInput(input, current = null) {
    const source = isPlainObject(input && input.task) ? input.task : (isPlainObject(input) ? input : {});
    const periodKey = normalizeQuarterlyPeriodKey(source.periodKey || current?.periodKey);
    const type = normalizeQuarterlyType(source.type || current?.type);
    const evaluatorAccountIdValue = asTrimmedString(source.evaluatorAccountId || current?.evaluatorAccountId);
    const evaluatorEmployeeIdValue = asTrimmedString(
      source.evaluatorEmployeeId || current?.evaluatorEmployeeIdSnapshot,
    );
    const evaluatorAccountId = evaluatorAccountIdValue
      ? validateTextField(evaluatorAccountIdValue, '评价人账号编号', { required: true, maxLength: 160 })
      : null;
    const evaluatorEmployeeId = evaluatorEmployeeIdValue
      ? validateTextField(evaluatorEmployeeIdValue, '评价人档案编号', { required: true, maxLength: 160 })
      : null;
    if (!evaluatorAccountId && !evaluatorEmployeeId) {
      throw new AppError('VALIDATION_ERROR', '请选择评价人档案。', 400, { field: 'evaluatorEmployeeId' });
    }
    const evaluateeEmployeeId = validateTextField(
      source.evaluateeEmployeeId || current?.evaluateeEmployeeId,
      '被评价员工编号',
      { required: true, maxLength: 160 },
    );
    const status = asTrimmedString(source.status || current?.status || 'active') || 'active';
    if (!['active', 'revoked'].includes(status)) {
      throw new AppError('VALIDATION_ERROR', '季度评价任务状态只能是 active 或 revoked。', 400, { field: 'status' });
    }
    return {
      periodKey,
      type,
      evaluatorAccountId,
      evaluatorEmployeeId,
      evaluateeEmployeeId,
      status,
      dueAt: normalizeQuarterlyDueAt(source.dueAt === undefined ? current?.dueAt : source.dueAt),
    };
  }

  async function requireQuarterlyTaskAccess(taskId, { management = false, action = 'view_quarterly_task' } = {}) {
    let task;
    try {
      task = await getQuarterlyTask(taskId);
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({ action, targetId: asTrimmedString(taskId) || null, targetType: 'quarterly_task', detail: `读取季度评价任务失败：${appError.code}。` });
      throw appError;
    }
    const currentAccount = management ? null : await currentQuarterlyActorAccount();
    if (!management && !quarterlyTaskMatchesCurrentEmployee(task, currentAccount)) {
      await appendFailureAudit({
        action,
        targetId: getRecordId(task) || asTrimmedString(taskId),
        targetName: asTrimmedString(task.evaluateeNameSnapshot),
        targetType: 'quarterly_task',
        detail: '拒绝读取未分配给当前账号的季度评价任务。',
      });
      throw new AppError('PERMISSION_DENIED', '当前账号不能访问未分配的季度评价任务。', 403);
    }
    if (!management && asTrimmedString(task.sourcePendingRelationId)) {
      try {
        assertQuarterlySourceTaskBinding(task, currentAccount);
      } catch (error) {
        await appendFailureAudit({
          action,
          targetId: getRecordId(task) || asTrimmedString(taskId),
          targetName: asTrimmedString(task.evaluateeNameSnapshot),
          targetType: 'quarterly_task',
          detail: '拒绝读取员工身份绑定已变更的来源关系季度评价任务。',
        });
        throw error;
      }
    }
    return task;
  }

  async function saveQuarterlyPeriod(input) {
    requirePermission(actor, 'quarterly.manage');
    let current = null;
    let normalized = null;
    try {
      const requestedPeriodKey = normalizeQuarterlyPeriodKey(input.periodKey);
      try {
        current = await getQuarterlyPeriod(requestedPeriodKey);
      } catch (error) {
        if (toAppError(error).code !== 'QUARTERLY_PERIOD_NOT_FOUND') throw error;
      }
      normalized = normalizeQuarterlyPeriodInput(input, { current });
      const periodId = quarterlyPeriodId(normalized.periodKey);
      const hasExpectedVersion = hasOwn(input, 'expectedVersion');
      const expectedVersion = hasExpectedVersion ? normalizeQuarterlyExpectedVersion(input) : null;
      let saved;
      let previousPersisted = null;

      await runTransaction(db, async (transaction) => {
        const reference = transaction.collection(COLLECTIONS.quarterlyPeriods).doc(periodId);
        const existing = getDocument(await reference.get());
        previousPersisted = existing;
        const existingVersion = existing && Number.isInteger(existing.version) && existing.version > 0 ? existing.version : 0;
        if (hasExpectedVersion && existingVersion !== expectedVersion) {
          throw new AppError('QUARTERLY_PERIOD_VERSION_CONFLICT', '季度周期已被其他人修改，请刷新后重试。');
        }
        const nowValue = now();
        const existingStatus = existing ? quarterlyPeriodEffectiveStatus(existing, nowValue) : null;
        const existingOpensAt = existing ? quarterlyOpensAtInfo(existing) : null;
        const nextOpensAt = quarterlyOpensAtInfo({ opensAt: normalized.opensAt });
        const existingDueAt = existing ? quarterlyDueAtInfo(existing) : null;
        const nextDueAt = quarterlyDueAtInfo({ dueAt: normalized.dueAt });
        if (normalized.status === 'open' && existingStatus !== 'open') {
          throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '季度开放时间由系统按自然季度安排，请使用“按季度开放”。', 409);
        }
        if (existingStatus === 'open' && normalized.status === 'draft') {
          throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '周期开始填写后不能恢复为草稿。', 409);
        }
        if (existingStatus === 'closed' && !['closed', 'archived'].includes(normalized.status)) {
          throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '已关闭的周期不能重新开放。', 409);
        }
        if (existingStatus === 'archived' && normalized.status !== 'archived') {
          throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '已归档的周期不能恢复。', 409);
        }
        if (existing
          && existingStatus === 'open'
          && !existingOpensAt.invalid
          && (nextOpensAt.invalid || existingOpensAt.timestamp !== nextOpensAt.timestamp)) {
          throw new AppError('VALIDATION_ERROR', '周期开放后不能调整开放时间。', 400, { field: 'opensAt' });
        }
        if (existing
          && existingStatus === 'open'
          && !existingDueAt.invalid
          && existingDueAt.timestamp !== nextDueAt.timestamp) {
          throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '周期开放后不能调整截止时间。', 409, { field: 'dueAt' });
        }
        if (existing?.naturalQuarterSchedule === true) {
          const storedStatus = asTrimmedString(existing.status) || 'draft';
          const canCloseOrArchive = ['closed', 'archived'].includes(normalized.status);
          const sameScheduleStatus = normalized.status === storedStatus;
          if (!sameScheduleStatus && !canCloseOrArchive) {
            throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '已按自然季度排期的周期不能手动更改开放状态。', 409);
          }
          if (
            existingDueAt.invalid
            || nextDueAt.invalid
            || existingDueAt.timestamp !== nextDueAt.timestamp
          ) {
            throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '已排期周期不能修改截止时间。', 409, { field: 'dueAt' });
          }
          const existingRosterVersion = Number.isInteger(existing.rosterVersion) && existing.rosterVersion > 0
            ? existing.rosterVersion
            : 1;
          if (normalized.rosterVersion !== existingRosterVersion) {
            throw new AppError('QUARTERLY_PERIOD_VERSION_CONFLICT', '名单版本由任务变更维护，请刷新周期后重试。', 409, { field: 'rosterVersion' });
          }
        }
        const next = {
          periodKey: normalized.periodKey,
          periodName: normalized.periodName,
          status: normalized.status,
          resultVisibility: normalized.resultVisibility,
          scoringStandardVersion: normalized.scoringStandardVersion,
          rosterVersion: normalized.rosterVersion,
          opensAt: normalized.opensAt,
          naturalQuarterSchedule: existing?.naturalQuarterSchedule === true,
          dueAt: normalized.dueAt,
          taskCount: Number.isInteger(existing?.taskCount) ? existing.taskCount : 0,
          submittedTaskCount: Number.isInteger(existing?.submittedTaskCount) ? existing.submittedTaskCount : 0,
          version: existingVersion + 1,
          createdAt: existing?.createdAt || nowValue,
          updatedAt: nowValue,
          createdByAccountId: existing?.createdByAccountId || actor.accountId,
          createdByAuthUid: existing?.createdByAuthUid || actor.authUid,
          updatedByAccountId: actor.accountId,
          updatedByAuthUid: actor.authUid,
        };
        if (existing) {
          assertTransactionWriteDidNotFail(
            await reference.update(next),
            '季度周期未能写入数据库，请刷新后重试。',
          );
        }
        else await writeQuarterlyDocument(
          transaction.collection(COLLECTIONS.quarterlyPeriods),
          periodId,
          next,
          '季度周期未能写入数据库，请刷新后重试。',
        );
        saved = { ...next, _id: periodId };
      });
      let persisted;
      try {
        persisted = await getQuarterlyPeriod(normalized.periodKey);
      } catch (error) {
        if (toAppError(error).code === 'QUARTERLY_PERIOD_NOT_FOUND') {
          if (!previousPersisted && saved) {
            try {
              const document = { ...saved };
              delete document._id;
              await writeQuarterlyDocument(
                db.collection(COLLECTIONS.quarterlyPeriods),
                periodId,
                document,
                '季度周期未能写入数据库，请刷新后重试。',
              );
            } catch {
              // A concurrent request may have created the same deterministic ID.
              // The authoritative readback below decides whether it is valid.
            }
            try {
              persisted = await getQuarterlyPeriod(normalized.periodKey);
            } catch (readError) {
              if (toAppError(readError).code !== 'QUARTERLY_PERIOD_NOT_FOUND') throw readError;
            }
          }
          if (!persisted) {
            throw new AppError('DATABASE_WRITE_VERIFICATION_FAILED', '季度周期保存后未能在数据库中确认，请刷新后重试。', 502);
          }
        } else {
          throw error;
        }
      }
      const verifiedFields = [
        'periodKey', 'periodName', 'status', 'resultVisibility', 'scoringStandardVersion',
        'rosterVersion', 'opensAt', 'naturalQuarterSchedule', 'dueAt', 'taskCount',
        'submittedTaskCount', 'version',
      ];
      if (verifiedFields.some((field) => persisted[field] !== saved[field])) {
        throw new AppError('DATABASE_WRITE_VERIFICATION_FAILED', '季度周期保存结果与数据库记录不一致，请刷新后重试。', 502);
      }
      saved = persisted;
      await appendAudit({
        action: 'save_quarterly_period',
        targetId: periodId,
        targetName: normalized.periodName,
        targetType: 'quarterly_period',
        changed: previousPersisted ? changedFields(previousPersisted, saved) : ['periodKey', 'periodName', 'status', 'resultVisibility', '开放时间', '截止时间', '评分标准版本', '名单版本'],
        before: previousPersisted,
        after: saved,
        result: 'success',
        detail: `保存季度周期“${normalized.periodName}”。`,
      });
      return quarterlyPeriodPublic(saved, {}, now());
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: 'save_quarterly_period',
        targetName: normalized?.periodName || asTrimmedString(input.periodName),
        targetType: 'quarterly_period',
        before: current,
        detail: `保存季度周期失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function validateQuarterlyPeriodScheduleRoster(periodKey, period = null) {
    const [taskRows, recordRows] = await Promise.all([
      listQuarterlyRowsWithPagination(
        COLLECTIONS.quarterlyTasks,
        {
          _id: true,
          taskId: true,
          periodKey: true,
          type: true,
          evaluatorAccountId: true,
          evaluatorEmployeeIdSnapshot: true,
          evaluateeEmployeeId: true,
          status: true,
          sourcePendingRelationId: true,
          version: true,
        },
        db,
        { periodKey },
        '读取待开放季度任务失败。',
      ),
      listQuarterlyRowsWithPagination(
        COLLECTIONS.quarterlyRecords,
        { _id: true, taskId: true, periodKey: true, status: true },
        db,
        { periodKey },
        '读取待开放季度记录失败。',
      ),
    ]);
    const tasksById = new Map();
    const activeTasks = [];
    for (const task of taskRows) {
      const taskId = getRecordId(task) || asTrimmedString(task.taskId);
      if (!taskId || tasksById.has(taskId) || asTrimmedString(task.periodKey) !== periodKey) {
        throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', '季度名单中存在重复或无效的任务编号。', 409);
      }
      tasksById.set(taskId, task);
      const status = asTrimmedString(task.status);
      if (status === 'active') activeTasks.push(task);
      else if (status !== 'revoked') {
        throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', '季度名单中存在无效的任务状态。', 409);
      }
    }
    if (!activeTasks.length) {
      throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '至少需要一条有效评价任务后才能按季度开放。', 409);
    }
    const schedulePeriod = period || await getQuarterlyPeriod(periodKey);
    for (const task of activeTasks) {
      assertQuarterlyTaskDueAtInNaturalWindow(schedulePeriod, task.dueAt);
    }

    const employeeCache = new Map();
    const employeeIds = new Set();
    const accountBindings = new Map();
    const employeeSnapshot = async (employeeId) => {
      employeeIds.add(employeeId);
      if (!employeeCache.has(employeeId)) {
        employeeCache.set(employeeId, getQuarterlyEmployeeSnapshot(employeeId, db));
      }
      try {
        return await employeeCache.get(employeeId);
      } catch (error) {
        const appError = toAppError(error);
        if (appError.code === 'EMPLOYEE_NOT_FOUND') {
          throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', '季度任务关联的员工档案不存在。', 409);
        }
        throw appError;
      }
    };
    const seenIdentities = new Set();
    for (const task of activeTasks) {
      const taskId = getRecordId(task) || asTrimmedString(task.taskId);
      const identity = currentQuarterlyTaskIdentity(task, taskId);
      let evaluatorEmployeeId = identity.evaluatorEmployeeId;
      if (identity.identityMode === 'account') {
        const account = await findAccountById(db, identity.evaluatorAccountId);
        evaluatorEmployeeId = asTrimmedString(account.employeeId);
        if (
          asTrimmedString(account.status) !== 'active'
          || !evaluatorEmployeeId
          || (asTrimmedString(task.evaluatorEmployeeIdSnapshot)
            && asTrimmedString(task.evaluatorEmployeeIdSnapshot) !== evaluatorEmployeeId)
        ) {
          throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', '季度任务的评价账号与员工身份不一致或已停用。', 409);
        }
        accountBindings.set(identity.evaluatorAccountId, evaluatorEmployeeId);
      }
      const evaluator = await employeeSnapshot(evaluatorEmployeeId);
      const evaluatee = await employeeSnapshot(identity.evaluateeEmployeeId);
      if (
        asTrimmedString(evaluator.employmentStatusSnapshot) !== 'active'
        || asTrimmedString(evaluatee.employmentStatusSnapshot) !== 'active'
      ) {
        throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', '季度任务关联的员工档案不是在职状态。', 409);
      }
      if (identity.type === 'self' && evaluatorEmployeeId !== identity.evaluateeEmployeeId) {
        throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', '自评任务的评价人与被评价人不一致。', 409);
      }
      const tuple = JSON.stringify([identity.type, evaluatorEmployeeId, evaluatee.employeeId]);
      if (seenIdentities.has(tuple)) {
        throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', '季度名单中存在重复评价关系。', 409);
      }
      seenIdentities.add(tuple);
    }

    const recordsByTask = new Map();
    for (const record of recordRows) {
      const taskId = asTrimmedString(record.taskId) || getRecordId(record);
      if (!taskId || !tasksById.has(taskId)) {
        throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', '季度评价记录未关联到本周期的有效任务。', 409);
      }
      const count = (recordsByTask.get(taskId) || 0) + 1;
      if (count > 1) {
        throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', '同一季度任务存在重复评价记录。', 409);
      }
      recordsByTask.set(taskId, count);
    }
    return {
      taskCount: activeTasks.length,
      employeeIds: [...employeeIds],
      accountBindings: [...accountBindings.entries()].map(([accountId, employeeId]) => ({ accountId, employeeId })),
    };
  }

  async function scheduleQuarterlyPeriod(input) {
    requirePermission(actor, 'quarterly.manage');
    const periodKey = normalizeQuarterlyPeriodKey(input.periodKey);
    const expectedVersion = normalizeQuarterlyExpectedVersion(input);
    let current = null;
    try {
      current = await getQuarterlyPeriod(periodKey);
      const window = quarterlyNaturalWindow(periodKey);
      const windowStart = parseQuarterlyDateTime(window.opensAt);
      const existingOpensAt = quarterlyOpensAtInfo(current);
      if (['closed', 'archived'].includes(asTrimmedString(current.status))) {
        throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '已关闭或归档的季度不能再次排期开放。', 409);
      }
      if (current.naturalQuarterSchedule === true) {
        if (existingOpensAt.invalid || existingOpensAt.timestamp !== windowStart.timestamp) {
          throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '已排期季度的自然开放时间不一致，不能覆盖。', 409);
        }
        return quarterlyPeriodPublic(current, {}, now());
      }
      if (existingOpensAt.invalid) {
        throw new AppError('QUARTERLY_INVALID_OPENS_AT', QUARTERLY_MESSAGES.invalidOpensAt, 409);
      }
      if (existingOpensAt.timestamp !== null && existingOpensAt.timestamp !== windowStart.timestamp) {
        throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '旧周期已有自定义开放时间，系统不会自动覆盖；请沿用原周期规则。', 409);
      }
      if (
        asTrimmedString(current.status) !== 'draft'
        || quarterlyPeriodEffectiveStatus(current, now()) !== 'draft'
      ) {
        throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '只有尚未开放的草稿周期可以按自然季度排期。', 409);
      }
      assertQuarterlyRosterEditable(current, now());
      const currentVersion = Number.isInteger(current.version) && current.version > 0 ? current.version : 1;
      if (expectedVersion !== currentVersion) {
        throw new AppError('QUARTERLY_PERIOD_VERSION_CONFLICT', '季度周期已被其他人修改，请刷新后重试。', 409);
      }
      const dueAt = quarterlyDueAtInfo(current);
      if (dueAt.invalid) throw invalidQuarterlyDueAtError();
      if (dueAt.timestamp !== null && dueAt.timestamp <= windowStart.timestamp) {
        throw new AppError('VALIDATION_ERROR', '截止时间必须晚于自然开放时间。', 400, { field: 'dueAt' });
      }
      const windowEnd = parseQuarterlyDateTime(window.closesAt);
      if (dueAt.timestamp !== null && dueAt.timestamp >= windowEnd.timestamp) {
        throw new AppError('VALIDATION_ERROR', '截止时间必须早于下季度开始时间。', 400, { field: 'dueAt' });
      }

      const pendingPlan = await quarterlyMaterializationPlan(periodKey);
      if (pendingPlan.eligibleCount > 0 || pendingPlan.conflictCount > 0) {
        throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '仍有已确认评价关系未生成任务，或存在身份冲突，暂不能排期开放。', 409);
      }
      const roster = await validateQuarterlyPeriodScheduleRoster(periodKey, current);
      let saved = null;
      await runTransaction(db, async (transaction) => {
        const reference = transaction.collection(COLLECTIONS.quarterlyPeriods).doc(quarterlyPeriodId(periodKey));
        const latest = getDocument(await reference.get());
        currentQuarterlyPeriodIdentity(latest, periodKey);
        const latestVersion = Number.isInteger(latest.version) && latest.version > 0 ? latest.version : 1;
        if (latestVersion !== expectedVersion) {
          throw new AppError('QUARTERLY_PERIOD_VERSION_CONFLICT', '季度周期已被其他人修改，请刷新后重试。', 409);
        }
        if (['closed', 'archived'].includes(asTrimmedString(latest.status))) {
          throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '已关闭或归档的季度不能再次排期开放。', 409);
        }
        if (
          asTrimmedString(latest.status) !== 'draft'
          || quarterlyPeriodEffectiveStatus(latest, now()) !== 'draft'
        ) {
          throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '周期状态已变化，请刷新后重试。', 409);
        }
        assertQuarterlyRosterEditable(latest, now());
        const currentOpensAt = quarterlyOpensAtInfo(latest);
        if (currentOpensAt.invalid || (currentOpensAt.timestamp !== null && currentOpensAt.timestamp !== windowStart.timestamp)) {
          throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '周期开放时间已变化，请重新检查。', 409);
        }
        const latestDueAt = quarterlyDueAtInfo(latest);
        if (latestDueAt.invalid || (latestDueAt.timestamp !== null && latestDueAt.timestamp <= windowStart.timestamp)) {
          throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '周期截止时间已变化，不能排期开放。', 409);
        }
        if (latestDueAt.timestamp !== null && latestDueAt.timestamp >= windowEnd.timestamp) {
          throw new AppError('QUARTERLY_PERIOD_STATE_INVALID', '周期截止时间已变化，必须早于下季度开始时间。', 409);
        }
        for (const employeeId of roster.employeeIds) {
          const employee = await getQuarterlyEmployeeSnapshot(employeeId, transaction);
          if (asTrimmedString(employee.employmentStatusSnapshot) !== 'active') {
            throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', '季度任务关联的员工档案已不在职，不能排期开放。', 409);
          }
        }
        for (const binding of roster.accountBindings) {
          const account = await findAccountById(transaction, binding.accountId);
          if (
            asTrimmedString(account.status) !== 'active'
            || asTrimmedString(account.employeeId) !== binding.employeeId
          ) {
            throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', '季度任务的评价账号身份已变化，不能排期开放。', 409);
          }
        }
        const nowValue = now();
        const next = {
          opensAt: window.opensAt,
          naturalQuarterSchedule: true,
          status: 'draft',
          version: latestVersion + 1,
          rosterVersion: (Number.isInteger(latest.rosterVersion) && latest.rosterVersion > 0 ? latest.rosterVersion : 1) + 1,
          updatedAt: nowValue,
          updatedByAccountId: actor.accountId,
          updatedByAuthUid: actor.authUid,
        };
        assertTransactionWriteDidNotFail(
          await reference.update(next),
          '自然季度开放设置未能写入数据库，请刷新后重试。',
        );
        saved = { ...latest, ...next, _id: quarterlyPeriodId(periodKey) };
      });
      const persisted = await getQuarterlyPeriod(periodKey);
      const verifiedSchedule = ['periodKey', 'periodName', 'status', 'opensAt', 'naturalQuarterSchedule', 'dueAt', 'version', 'rosterVersion'];
      if (verifiedSchedule.some((field) => persisted[field] !== saved[field])) {
        throw new AppError('DATABASE_WRITE_VERIFICATION_FAILED', '自然季度开放设置保存后未能在数据库中确认，请刷新后重试。', 502);
      }
      saved = persisted;
      await appendAudit({
        action: 'schedule_quarterly_period',
        targetId: quarterlyPeriodId(periodKey),
        targetName: asTrimmedString(saved.periodName),
        targetType: 'quarterly_period',
        changed: ['opensAt', 'naturalQuarterSchedule', 'rosterVersion'],
        before: current,
        after: saved,
        result: 'success',
        detail: `确认${periodKey}名单并按自然季度开放。`,
      });
      return quarterlyPeriodPublic(saved, { taskCount: roster.taskCount }, now());
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: 'schedule_quarterly_period',
        targetId: current ? getRecordId(current) : quarterlyPeriodId(periodKey),
        targetName: asTrimmedString(current?.periodName),
        targetType: 'quarterly_period',
        before: current,
        detail: `季度自然开放排期失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  function quarterlyPeriodVersion(period) {
    return Number.isInteger(period?.version) && period.version > 0 ? period.version : 1;
  }

  function quarterlyTaskCopyTuple(type, evaluatorEmployeeId, evaluateeEmployeeId) {
    return JSON.stringify([type, evaluatorEmployeeId, evaluateeEmployeeId]);
  }

  async function resolveQuarterlyTaskCopyIdentity(task, database, accountCache = new Map()) {
    const taskId = getRecordId(task) || asTrimmedString(task?.taskId);
    if (!taskId || (asTrimmedString(task?.taskId) && asTrimmedString(task.taskId) !== taskId)) return null;
    let identity;
    try {
      identity = currentQuarterlyTaskIdentity(task, taskId);
    } catch (error) {
      if (toAppError(error).code === 'QUARTERLY_TASK_IDENTITY_CONFLICT') return null;
      throw error;
    }
    if (identity.periodKey !== asTrimmedString(task.periodKey)) return null;
    let evaluatorEmployeeId = identity.evaluatorEmployeeId;
    let accountValid = true;
    if (identity.identityMode === 'account') {
      const accountId = identity.evaluatorAccountId;
      if (!accountCache.has(accountId)) {
        accountCache.set(accountId, (async () => {
          try {
            return await findAccountById(database, accountId);
          } catch (error) {
            if (toAppError(error).code === 'ACCOUNT_NOT_FOUND') return null;
            throw error;
          }
        })());
      }
      const account = await accountCache.get(accountId);
      const accountEmployeeId = asTrimmedString(account?.employeeId);
      const snapshotEmployeeId = asTrimmedString(task.evaluatorEmployeeIdSnapshot);
      evaluatorEmployeeId = accountEmployeeId || snapshotEmployeeId || null;
      accountValid = Boolean(
        account
        && asTrimmedString(account.status) === 'active'
        && accountEmployeeId
        && (!snapshotEmployeeId || snapshotEmployeeId === accountEmployeeId),
      );
    }
    return {
      taskId,
      identity,
      evaluatorEmployeeId: asTrimmedString(evaluatorEmployeeId) || null,
      accountValid,
    };
  }

  async function getQuarterlyCopyEmployee(employeeId, cache, database = db) {
    if (!employeeId) return null;
    if (!cache.has(employeeId)) {
      cache.set(employeeId, (async () => {
        try {
          return await getQuarterlyEmployeeSnapshot(employeeId, database);
        } catch (error) {
          if (toAppError(error).code === 'EMPLOYEE_NOT_FOUND') return null;
          throw error;
        }
      })());
    }
    return cache.get(employeeId);
  }

  async function getQuarterlyRecordDocOrNull(taskId, database = db) {
    try {
      return getDocument(await database.collection(COLLECTIONS.quarterlyRecords).doc(quarterlyRecordId(taskId)).get());
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '读取季度评价记录失败。');
    }
  }

  async function quarterlyPreviousTaskCopyPlan(periodKeyValue) {
    const periodKey = normalizeQuarterlyPeriodKey(periodKeyValue);
    const sourcePeriodKey = previousQuarterlyPeriodKey(periodKey);
    const targetPeriod = await getQuarterlyPeriod(periodKey);
    currentQuarterlyPeriodIdentity(targetPeriod, periodKey);
    if (
      asTrimmedString(targetPeriod.status) !== 'draft'
      || quarterlyPeriodEffectiveStatus(targetPeriod, now()) !== 'draft'
    ) {
      throw new AppError('QUARTERLY_PERIOD_NOT_DRAFT', '请先选择尚未开放的草稿周期，再沿用上一季度任务。', 409);
    }
    assertQuarterlyRosterEditable(targetPeriod, now());
    assertQuarterlyTaskDueAtInNaturalWindow(targetPeriod, targetPeriod.dueAt);
    const sourcePeriod = await getQuarterlyPeriod(sourcePeriodKey);
    currentQuarterlyPeriodIdentity(sourcePeriod, sourcePeriodKey);
    const targetPendingRelations = await listQuarterlyRowsWithPagination(
      COLLECTIONS.quarterlyPendingRelations,
      { _id: true, periodKey: true, status: true },
      db,
      { periodKey },
      '读取目标季度待确认关系失败。',
    );
    if (targetPendingRelations.length > 0) {
      throw new AppError(
        'QUARTERLY_COPY_MIXED_RELATION_SOURCE',
        '本季度已有待确认的旧评价关系，不能与沿用上一季度混用；请先完成关系核对与任务生成。',
        409,
      );
    }
    const [sourceTaskRows, targetTaskRows, targetRecordRows] = await Promise.all([
      listQuarterlyRowsWithPagination(
        COLLECTIONS.quarterlyTasks,
        {
          _id: true,
          taskId: true,
          periodKey: true,
          periodName: true,
          type: true,
          evaluatorAccountId: true,
          evaluatorEmployeeIdSnapshot: true,
          evaluateeEmployeeId: true,
          status: true,
          version: true,
        },
        db,
        { periodKey: sourcePeriodKey },
        '读取上一季度任务失败。',
      ),
      listQuarterlyRowsWithPagination(
        COLLECTIONS.quarterlyTasks,
        {
          _id: true,
          taskId: true,
          periodKey: true,
          type: true,
          evaluatorAccountId: true,
          evaluatorEmployeeIdSnapshot: true,
          evaluateeEmployeeId: true,
          status: true,
          version: true,
        },
        db,
        { periodKey },
        '读取目标季度已有任务失败。',
      ),
      listQuarterlyRowsWithPagination(
        COLLECTIONS.quarterlyRecords,
        { _id: true, taskId: true, periodKey: true, status: true },
        db,
        { periodKey },
        '读取目标季度已有记录失败。',
      ),
    ]);

    const plan = {
      periodKey,
      sourcePeriodKey,
      targetPeriod,
      sourcePeriod,
      sourceActiveTaskCount: 0,
      ignoredInactiveCount: 0,
      eligible: [],
      eligibleCount: 0,
      alreadyPresentCount: 0,
      identityErrorCount: 0,
      duplicateSourceCount: 0,
      duplicateTargetCount: 0,
      recordConflictCount: 0,
      conflictCount: 0,
    };
    const employeeCache = new Map();
    const accountCache = new Map();
    const sourceCandidates = [];
    const classifications = [];
    const invalidSourcePairs = new Set();
    const unresolvedSourcePairs = new Set();
    const mapCopyRowsWithLimit = async (rows, worker) => {
      const results = new Array(rows.length);
      let nextIndex = 0;
      const runWorker = async () => {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= rows.length) return;
          results[index] = await worker(rows[index]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(12, rows.length) }, runWorker));
      return results;
    };
    const sourceEntries = await mapCopyRowsWithLimit(sourceTaskRows, async (task) => {
      if (asTrimmedString(task.status) !== 'active') return { inactive: true };
      const sourceTaskId = getRecordId(task) || asTrimmedString(task.taskId);
      const resolved = await resolveQuarterlyTaskCopyIdentity(task, db, accountCache);
      if (!resolved || !resolved.evaluatorEmployeeId || !resolved.accountValid) {
        const rawType = asTrimmedString(task.type);
        const rawEvaluateeId = asTrimmedString(task.evaluateeEmployeeId);
        const rawEvaluatorId = asTrimmedString(task.evaluatorEmployeeIdSnapshot);
        return {
          sourceTaskId,
          category: 'identity_error',
          invalidTuple: rawType && rawEvaluatorId && rawEvaluateeId
            ? quarterlyTaskCopyTuple(rawType, rawEvaluatorId, rawEvaluateeId)
            : null,
          unresolvedPair: rawType && rawEvaluateeId
            ? quarterlyTaskCopyTuple(rawType, '', rawEvaluateeId)
            : null,
        };
      }
      const { identity, evaluatorEmployeeId } = resolved;
      if (identity.periodKey !== sourcePeriodKey) {
        return {
          sourceTaskId,
          category: 'identity_error',
          invalidTuple: quarterlyTaskCopyTuple(identity.type, evaluatorEmployeeId, identity.evaluateeEmployeeId),
        };
      }
      const evaluator = await getQuarterlyCopyEmployee(evaluatorEmployeeId, employeeCache);
      const evaluatee = await getQuarterlyCopyEmployee(identity.evaluateeEmployeeId, employeeCache);
      if (
        !evaluator
        || !evaluatee
        || asTrimmedString(evaluator.employmentStatusSnapshot) !== 'active'
        || asTrimmedString(evaluatee.employmentStatusSnapshot) !== 'active'
        || (identity.type === 'self' && evaluatorEmployeeId !== identity.evaluateeEmployeeId)
      ) {
        return {
          sourceTaskId,
          category: 'identity_error',
          invalidTuple: quarterlyTaskCopyTuple(identity.type, evaluatorEmployeeId, identity.evaluateeEmployeeId),
        };
      }
      return { candidate: {
        sourcePeriodKey,
        periodKey,
        sourceTaskId,
        sourceTaskVersion: Number.isInteger(task.version) ? task.version : null,
        sourceIdentityMode: identity.identityMode,
        sourceAccountId: identity.identityMode === 'account' ? identity.evaluatorAccountId : null,
        type: identity.type,
        evaluatorEmployeeId,
        evaluateeEmployeeId: identity.evaluateeEmployeeId,
        evaluator,
        evaluatee,
        targetTaskId: quarterlyEmployeeTaskId(periodKey, identity.type, evaluatorEmployeeId, identity.evaluateeEmployeeId),
      } };
    });
    for (const entry of sourceEntries) {
      if (entry.inactive) {
        plan.ignoredInactiveCount += 1;
        continue;
      }
      plan.sourceActiveTaskCount += 1;
      if (entry.category === 'identity_error') {
        plan.identityErrorCount += 1;
        if (entry.invalidTuple) invalidSourcePairs.add(entry.invalidTuple);
        if (entry.unresolvedPair) unresolvedSourcePairs.add(entry.unresolvedPair);
        classifications.push({ sourceTaskId: entry.sourceTaskId, category: 'identity_error' });
      } else if (entry.candidate) {
        sourceCandidates.push(entry.candidate);
      }
    }

    const sourceTupleGroups = new Map();
    for (const candidate of sourceCandidates) {
      const tuple = quarterlyTaskCopyTuple(candidate.type, candidate.evaluatorEmployeeId, candidate.evaluateeEmployeeId);
      if (!sourceTupleGroups.has(tuple)) sourceTupleGroups.set(tuple, []);
      sourceTupleGroups.get(tuple).push(candidate);
    }
    const uniqueSourceCandidates = [];
    for (const group of sourceTupleGroups.values()) {
      if (group.length > 1) {
        plan.duplicateSourceCount += group.length;
        for (const candidate of group) classifications.push({ sourceTaskId: candidate.sourceTaskId, category: 'duplicate_source' });
      } else {
        const candidate = group[0];
        const tuple = quarterlyTaskCopyTuple(candidate.type, candidate.evaluatorEmployeeId, candidate.evaluateeEmployeeId);
        if (invalidSourcePairs.has(tuple)) {
          plan.duplicateSourceCount += 1;
          classifications.push({ sourceTaskId: candidate.sourceTaskId, category: 'duplicate_source' });
        } else if (unresolvedSourcePairs.has(quarterlyTaskCopyTuple(candidate.type, '', candidate.evaluateeEmployeeId))) {
          plan.conflictCount += 1;
          classifications.push({ sourceTaskId: candidate.sourceTaskId, category: 'conflict' });
        } else {
          uniqueSourceCandidates.push(candidate);
        }
      }
    }

    const targetTasksById = new Map();
    const targetTasksByTuple = new Map();
    const unresolvedTargetPairs = new Set();
    const targetAccountCache = new Map();
    const targetEntries = await mapCopyRowsWithLimit(targetTaskRows, async (task) => ({
      task,
      resolved: await resolveQuarterlyTaskCopyIdentity(task, db, targetAccountCache),
    }));
    for (const { task, resolved } of targetEntries) {
      const targetTaskId = getRecordId(task) || asTrimmedString(task.taskId);
      if (targetTaskId) targetTasksById.set(targetTaskId, task);
      if (!resolved || !resolved.evaluatorEmployeeId) {
        const type = asTrimmedString(task.type);
        const evaluateeEmployeeId = asTrimmedString(task.evaluateeEmployeeId);
        if (type && evaluateeEmployeeId) unresolvedTargetPairs.add(quarterlyTaskCopyTuple(type, '', evaluateeEmployeeId));
        continue;
      }
      const tuple = quarterlyTaskCopyTuple(
        resolved.identity.type,
        resolved.evaluatorEmployeeId,
        resolved.identity.evaluateeEmployeeId,
      );
      if (!targetTasksByTuple.has(tuple)) targetTasksByTuple.set(tuple, []);
      targetTasksByTuple.get(tuple).push({ task, resolved });
    }

    const targetRecordsByTaskId = new Map();
    for (const record of targetRecordRows) {
      const keys = [getRecordId(record), asTrimmedString(record.taskId)].filter(Boolean);
      for (const key of new Set(keys)) {
        if (!targetRecordsByTaskId.has(key)) targetRecordsByTaskId.set(key, []);
        targetRecordsByTaskId.get(key).push(record);
      }
    }

    const directCheckCandidates = [];
    for (const candidate of uniqueSourceCandidates) {
      const tuple = quarterlyTaskCopyTuple(candidate.type, candidate.evaluatorEmployeeId, candidate.evaluateeEmployeeId);
      const matchingTargets = targetTasksByTuple.get(tuple) || [];
      const unresolvedTargetPair = unresolvedTargetPairs.has(quarterlyTaskCopyTuple(candidate.type, '', candidate.evaluateeEmployeeId));
      const recordsForExpectedId = targetRecordsByTaskId.get(candidate.targetTaskId) || [];
      const matchingTargetRecord = matchingTargets.some(({ task }) => {
        const targetId = getRecordId(task) || asTrimmedString(task.taskId);
        return Boolean(targetRecordsByTaskId.get(targetId)?.length);
      });
      if (recordsForExpectedId.length || matchingTargetRecord) {
        plan.recordConflictCount += 1;
        classifications.push({ sourceTaskId: candidate.sourceTaskId, targetTaskId: candidate.targetTaskId, category: 'record_conflict' });
        continue;
      }
      if (matchingTargets.length > 1) {
        plan.duplicateTargetCount += 1;
        classifications.push({ sourceTaskId: candidate.sourceTaskId, targetTaskId: candidate.targetTaskId, category: 'duplicate_target' });
        continue;
      }
      if (unresolvedTargetPair) {
        plan.conflictCount += 1;
        classifications.push({ sourceTaskId: candidate.sourceTaskId, targetTaskId: candidate.targetTaskId, category: 'conflict' });
        continue;
      }
      if (!matchingTargets.length && targetTasksById.has(candidate.targetTaskId)) {
        plan.conflictCount += 1;
        classifications.push({ sourceTaskId: candidate.sourceTaskId, targetTaskId: candidate.targetTaskId, category: 'conflict' });
        continue;
      }
      const existingTarget = matchingTargets[0] || null;
      const recordCheckTaskIds = existingTarget
        ? [getRecordId(existingTarget.task) || asTrimmedString(existingTarget.task.taskId)]
        : [candidate.targetTaskId];
      directCheckCandidates.push({ candidate, existingTarget, recordCheckTaskIds: [...new Set(recordCheckTaskIds.filter(Boolean))] });
    }
    const directCheckResults = new Array(directCheckCandidates.length);
    let directCheckIndex = 0;
    const directCheckWorker = async () => {
      while (true) {
        const index = directCheckIndex;
        directCheckIndex += 1;
        if (index >= directCheckCandidates.length) return;
        const item = directCheckCandidates[index];
        const reads = await Promise.all([
          Promise.all(item.recordCheckTaskIds.map((taskId) => getQuarterlyRecordDocOrNull(taskId))),
          item.existingTarget ? Promise.resolve(null) : (async () => {
            try {
              return await getQuarterlyTask(item.candidate.targetTaskId);
            } catch (error) {
              if (toAppError(error).code === 'QUARTERLY_TASK_NOT_FOUND') return null;
              throw error;
            }
          })(),
        ]);
        directCheckResults[index] = { records: reads[0], task: reads[1] };
      }
    };
    await Promise.all(Array.from({ length: Math.min(12, directCheckCandidates.length) }, directCheckWorker));
    for (let index = 0; index < directCheckCandidates.length; index += 1) {
      const { candidate, existingTarget } = directCheckCandidates[index];
      const result = directCheckResults[index];
      if (result.records.some(Boolean)) {
        plan.recordConflictCount += 1;
        classifications.push({ sourceTaskId: candidate.sourceTaskId, targetTaskId: candidate.targetTaskId, category: 'record_conflict' });
        continue;
      }
      if (result.task) {
        plan.conflictCount += 1;
        classifications.push({ sourceTaskId: candidate.sourceTaskId, targetTaskId: candidate.targetTaskId, category: 'conflict' });
        continue;
      }
      if (existingTarget) {
        if (
          asTrimmedString(existingTarget.task.status) === 'active'
          && asTrimmedString(existingTarget.task.periodKey) === periodKey
          && existingTarget.resolved.accountValid
        ) {
          plan.alreadyPresentCount += 1;
          classifications.push({ sourceTaskId: candidate.sourceTaskId, targetTaskId: getRecordId(existingTarget.task), category: 'already_present' });
        } else {
          plan.conflictCount += 1;
          classifications.push({ sourceTaskId: candidate.sourceTaskId, targetTaskId: getRecordId(existingTarget.task), category: 'conflict' });
        }
        continue;
      }
      plan.eligible.push(candidate);
      classifications.push({ sourceTaskId: candidate.sourceTaskId, targetTaskId: candidate.targetTaskId, category: 'eligible' });
    }
    plan.eligible.sort((left, right) => left.sourceTaskId.localeCompare(right.sourceTaskId));
    plan.eligibleCount = plan.eligible.length;
    const sourceScopeRows = sourceTaskRows.map((task) => ({
      id: getRecordId(task) || asTrimmedString(task.taskId) || null,
      taskId: asTrimmedString(task.taskId) || null,
      periodKey: asTrimmedString(task.periodKey) || null,
      type: asTrimmedString(task.type) || null,
      status: asTrimmedString(task.status) || null,
      evaluatorAccountId: asTrimmedString(task.evaluatorAccountId) || null,
      evaluatorEmployeeIdSnapshot: asTrimmedString(task.evaluatorEmployeeIdSnapshot) || null,
      evaluateeEmployeeId: asTrimmedString(task.evaluateeEmployeeId) || null,
      version: Number.isInteger(task.version) ? task.version : null,
    })).sort((left, right) => asTrimmedString(left.id).localeCompare(asTrimmedString(right.id)));
    const targetScopeRows = targetTaskRows.map((task) => ({
      id: getRecordId(task) || asTrimmedString(task.taskId) || null,
      taskId: asTrimmedString(task.taskId) || null,
      periodKey: asTrimmedString(task.periodKey) || null,
      type: asTrimmedString(task.type) || null,
      status: asTrimmedString(task.status) || null,
      evaluatorAccountId: asTrimmedString(task.evaluatorAccountId) || null,
      evaluatorEmployeeIdSnapshot: asTrimmedString(task.evaluatorEmployeeIdSnapshot) || null,
      evaluateeEmployeeId: asTrimmedString(task.evaluateeEmployeeId) || null,
      version: Number.isInteger(task.version) ? task.version : null,
    })).sort((left, right) => asTrimmedString(left.id).localeCompare(asTrimmedString(right.id)));
    const targetRecordScopeRows = targetRecordRows.map((record) => ({
      id: getRecordId(record) || null,
      taskId: asTrimmedString(record.taskId) || null,
      periodKey: asTrimmedString(record.periodKey) || null,
      status: asTrimmedString(record.status) || null,
    })).sort((left, right) => asTrimmedString(left.id).localeCompare(asTrimmedString(right.id)));
    const fingerprint = {
      sourcePeriodKey,
      targetPeriodKey: periodKey,
      sourcePeriodVersion: quarterlyPeriodVersion(sourcePeriod),
      sourceRosterVersion: Number.isInteger(sourcePeriod.rosterVersion) ? sourcePeriod.rosterVersion : null,
      targetPeriodVersion: quarterlyPeriodVersion(targetPeriod),
      targetRosterVersion: Number.isInteger(targetPeriod.rosterVersion) ? targetPeriod.rosterVersion : null,
      sourceScopeRows,
      targetScopeRows,
      targetRecordScopeRows,
      classifications: classifications.sort((left, right) => `${left.sourceTaskId}:${left.category}`.localeCompare(`${right.sourceTaskId}:${right.category}`)),
    };
    plan.sourceVersion = quarterlyPeriodVersion(sourcePeriod);
    plan.targetVersion = quarterlyPeriodVersion(targetPeriod);
    plan.previewToken = crypto.createHash('sha256').update(JSON.stringify(fingerprint), 'utf8').digest('hex');
    return plan;
  }

  function quarterlyCopyCounts(plan) {
    return {
      sourceActiveTaskCount: plan.sourceActiveTaskCount,
      ignoredInactiveCount: plan.ignoredInactiveCount,
      eligibleCount: plan.eligibleCount,
      alreadyPresentCount: plan.alreadyPresentCount,
      identityErrorCount: plan.identityErrorCount,
      duplicateSourceCount: plan.duplicateSourceCount,
      duplicateTargetCount: plan.duplicateTargetCount,
      recordConflictCount: plan.recordConflictCount,
      conflictCount: plan.conflictCount,
    };
  }

  async function quarterlyPreviousTaskCopyPreview(input) {
    requirePermission(actor, 'quarterly.manage');
    const plan = await quarterlyPreviousTaskCopyPlan(input.periodKey);
    return {
      targetPeriodKey: plan.periodKey,
      sourcePeriodKey: plan.sourcePeriodKey,
      targetPeriodName: asTrimmedString(plan.targetPeriod.periodName),
      sourcePeriodName: asTrimmedString(plan.sourcePeriod.periodName),
      targetVersion: plan.targetVersion,
      previewToken: plan.previewToken,
      ...quarterlyCopyCounts(plan),
    };
  }

  async function copyPreviousQuarterlyTask(candidate, { sourceVersion, targetVersion }) {
    const executeOnce = () => runTransaction(db, async (transaction) => {
      const sourcePeriodReference = transaction.collection(COLLECTIONS.quarterlyPeriods).doc(quarterlyPeriodId(candidate.sourcePeriodKey));
      const targetPeriodReference = transaction.collection(COLLECTIONS.quarterlyPeriods).doc(quarterlyPeriodId(candidate.periodKey));
      const sourcePeriod = getDocument(await sourcePeriodReference.get());
      const targetPeriod = getDocument(await targetPeriodReference.get());
      currentQuarterlyPeriodIdentity(sourcePeriod, candidate.sourcePeriodKey);
      currentQuarterlyPeriodIdentity(targetPeriod, candidate.periodKey);
      if (quarterlyPeriodVersion(sourcePeriod) !== sourceVersion) {
        throw new AppError('QUARTERLY_COPY_PREVIEW_STALE', '上一季度任务已变化，请重新预检。', 409);
      }
      if (quarterlyPeriodVersion(targetPeriod) !== targetVersion) {
        throw new AppError('QUARTERLY_COPY_PREVIEW_STALE', '目标季度名单已变化，请重新预检。', 409);
      }
      if (
        asTrimmedString(targetPeriod.status) !== 'draft'
        || quarterlyPeriodEffectiveStatus(targetPeriod, now()) !== 'draft'
      ) {
        throw new AppError('QUARTERLY_PERIOD_NOT_DRAFT', '目标季度已不再是可编辑草稿，未复制任务。', 409);
      }
      assertQuarterlyRosterEditable(targetPeriod, now());

      const sourceTaskReference = transaction.collection(COLLECTIONS.quarterlyTasks).doc(candidate.sourceTaskId);
      const sourceTask = getDocument(await sourceTaskReference.get());
      if (!sourceTask || asTrimmedString(sourceTask.status) !== 'active') {
        throw new AppError('QUARTERLY_COPY_PREVIEW_STALE', '上一季度来源任务已变化，请重新预检。', 409);
      }
      const actualVersion = Number.isInteger(sourceTask.version) ? sourceTask.version : null;
      if (actualVersion !== candidate.sourceTaskVersion) {
        throw new AppError('QUARTERLY_COPY_PREVIEW_STALE', '上一季度来源任务已修改，请重新预检。', 409);
      }
      const identity = await resolveQuarterlyTaskCopyIdentity(sourceTask, transaction);
      if (
        !identity
        || !identity.accountValid
        || identity.identity.periodKey !== candidate.sourcePeriodKey
        || identity.identity.type !== candidate.type
        || identity.evaluatorEmployeeId !== candidate.evaluatorEmployeeId
        || identity.identity.evaluateeEmployeeId !== candidate.evaluateeEmployeeId
        || identity.identity.identityMode !== candidate.sourceIdentityMode
      ) {
        throw new AppError('QUARTERLY_COPY_IDENTITY_ERROR', '上一季度来源任务身份已变化，未复制该任务。', 409);
      }

      const evaluator = await getQuarterlyEmployeeSnapshot(candidate.evaluatorEmployeeId, transaction);
      const evaluatee = await getQuarterlyEmployeeSnapshot(candidate.evaluateeEmployeeId, transaction);
      if (
        asTrimmedString(evaluator.employmentStatusSnapshot) !== 'active'
        || asTrimmedString(evaluatee.employmentStatusSnapshot) !== 'active'
        || (candidate.type === 'self' && candidate.evaluatorEmployeeId !== candidate.evaluateeEmployeeId)
      ) {
        throw new AppError('QUARTERLY_COPY_IDENTITY_ERROR', '评价任务关联的员工身份已变化，未复制该任务。', 409);
      }

      const taskReference = transaction.collection(COLLECTIONS.quarterlyTasks).doc(candidate.targetTaskId);
      const existingTask = getDocument(await taskReference.get());
      if (existingTask) {
        throw new AppError('QUARTERLY_COPY_CONFLICT', '目标季度已存在对应任务，未覆盖现有任务。', 409);
      }
      const recordReference = transaction.collection(COLLECTIONS.quarterlyRecords).doc(quarterlyRecordId(candidate.targetTaskId));
      const existingRecord = getDocument(await recordReference.get());
      if (existingRecord) {
        throw new AppError('QUARTERLY_COPY_RECORD_CONFLICT', '目标任务已存在评价记录，未复制该任务。', 409);
      }

      const nowValue = now();
      const copiedTask = {
        taskId: candidate.targetTaskId,
        periodKey: candidate.periodKey,
        periodName: asTrimmedString(targetPeriod.periodName),
        type: candidate.type,
        evaluatorAccountId: null,
        evaluatorAuthUidSnapshot: null,
        evaluatorNameSnapshot: evaluator.employeeNameSnapshot,
        evaluatorEmployeeIdSnapshot: evaluator.employeeId,
        evaluateeEmployeeId: evaluatee.employeeId,
        evaluateeNameSnapshot: evaluatee.employeeNameSnapshot,
        evaluateeDepartmentSnapshot: evaluatee.departmentSnapshot,
        evaluateeEmploymentStatusSnapshot: evaluatee.employmentStatusSnapshot,
        status: 'active',
        dueAt: targetPeriod.dueAt || null,
        version: 1,
        createdAt: nowValue,
        updatedAt: nowValue,
        createdByAccountId: actor.accountId,
        createdByAuthUid: actor.authUid,
        updatedByAccountId: actor.accountId,
        updatedByAuthUid: actor.authUid,
      };
      await writeQuarterlyDocument(
        transaction.collection(COLLECTIONS.quarterlyTasks),
        candidate.targetTaskId,
        copiedTask,
        '沿用任务未能写入数据库，请刷新后重试。',
      );
      const nextTargetPeriod = {
        version: targetVersion + 1,
        rosterVersion: (Number.isInteger(targetPeriod.rosterVersion) && targetPeriod.rosterVersion > 0 ? targetPeriod.rosterVersion : 1) + 1,
        updatedAt: nowValue,
        updatedByAccountId: actor.accountId,
        updatedByAuthUid: actor.authUid,
      };
      await targetPeriodReference.update(nextTargetPeriod);
      await appendAudit({
        database: transaction,
        action: 'copy_previous_quarterly_task',
        targetId: candidate.targetTaskId,
        targetName: evaluatee.employeeNameSnapshot,
        targetType: 'quarterly_task',
        changed: ['评价周期', '评价类型', '评价人', '被评价人', '任务状态'],
        before: null,
        after: copiedTask,
        result: 'success',
        detail: `沿用${candidate.sourcePeriodKey}评价关系创建${candidate.periodKey}任务。`,
      });
      return 'created';
    });
    return executeOnce();
  }

  async function quarterlyPreviousTaskCopyExecute(input) {
    requirePermission(actor, 'quarterly.manage');
    if (input.acknowledged !== true) {
      throw new AppError('VALIDATION_ERROR', '请确认已核对上一季度任务预览后再执行。', 400, { field: 'acknowledged' });
    }
    if (!Number.isInteger(input.expectedEligibleCount) || input.expectedEligibleCount < 0) {
      throw new AppError('VALIDATION_ERROR', '预检任务数量无效，请重新预检。', 400, { field: 'expectedEligibleCount' });
    }
    const expectedPreviewToken = asTrimmedString(input.expectedPreviewToken);
    if (!/^[a-f0-9]{64}$/.test(expectedPreviewToken)) {
      throw new AppError('VALIDATION_ERROR', '预检结果标识无效，请重新预检。', 400, { field: 'expectedPreviewToken' });
    }
    const plan = await quarterlyPreviousTaskCopyPlan(input.periodKey);
    if (
      plan.eligibleCount !== input.expectedEligibleCount
      || plan.previewToken !== expectedPreviewToken
    ) {
      throw new AppError('QUARTERLY_COPY_PREVIEW_STALE', '季度任务关系已变化，请重新预检后再执行。', 409);
    }
    const result = {
      targetPeriodKey: plan.periodKey,
      sourcePeriodKey: plan.sourcePeriodKey,
      targetPeriodName: asTrimmedString(plan.targetPeriod.periodName),
      sourcePeriodName: asTrimmedString(plan.sourcePeriod.periodName),
      targetVersion: plan.targetVersion,
      copiedCount: 0,
      processedCount: 0,
      remainingCount: plan.eligibleCount,
      failedCount: 0,
      errorSummary: [],
      complete: false,
      ...quarterlyCopyCounts(plan),
    };
    let expectedTargetVersion = plan.targetVersion;
    let executionIssueOccurred = false;
    let resolvedItemCount = 0;
    let executionIdentityErrorCount = 0;
    let executionRecordConflictCount = 0;
    let executionConflictCount = 0;
    for (const candidate of plan.eligible.slice(0, 5)) {
      try {
        await copyPreviousQuarterlyTask(candidate, {
          sourceVersion: plan.sourceVersion,
          targetVersion: expectedTargetVersion,
        });
        result.copiedCount += 1;
        resolvedItemCount += 1;
        expectedTargetVersion += 1;
      } catch (error) {
        const appError = toAppError(error);
        executionIssueOccurred = true;
        if (appError.code === 'QUARTERLY_COPY_RECORD_CONFLICT') {
          executionRecordConflictCount += 1;
          resolvedItemCount += 1;
        } else if (appError.code === 'QUARTERLY_COPY_IDENTITY_ERROR') {
          executionIdentityErrorCount += 1;
          resolvedItemCount += 1;
        } else if (appError.code === 'QUARTERLY_COPY_CONFLICT') {
          executionConflictCount += 1;
          resolvedItemCount += 1;
        } else result.failedCount += 1;
        result.errorSummary.push(
          appError.code === 'QUARTERLY_COPY_RECORD_CONFLICT'
            ? '目标任务已有评价记录，部分关系未复制。'
            : appError.code === 'QUARTERLY_COPY_IDENTITY_ERROR'
              ? '员工身份状态发生变化，部分关系未复制。'
              : appError.code === 'QUARTERLY_COPY_CONFLICT'
                ? '目标季度任务发生冲突，部分关系未复制。'
                : '部分任务未完成，请重新预检后继续。',
        );
        if (!['QUARTERLY_COPY_RECORD_CONFLICT', 'QUARTERLY_COPY_IDENTITY_ERROR', 'QUARTERLY_COPY_CONFLICT'].includes(appError.code)) break;
      }
    }
    result.processedCount = resolvedItemCount;
    result.remainingCount = Math.max(0, plan.eligibleCount - resolvedItemCount);
    result.alreadyPresentCount = plan.alreadyPresentCount + result.copiedCount;
    result.identityErrorCount = plan.identityErrorCount + executionIdentityErrorCount;
    result.recordConflictCount = plan.recordConflictCount + executionRecordConflictCount;
    result.conflictCount = plan.conflictCount + executionConflictCount;
    try {
      result.targetVersion = quarterlyPeriodVersion(await getQuarterlyPeriod(plan.periodKey));
    } catch {
      result.failedCount += 1;
      result.errorSummary.push('无法读取目标季度版本，请重新预检后继续。');
    }
    if (result.failedCount > 0 || executionIssueOccurred) {
      await appendFailureAudit({
        action: 'copy_previous_quarterly_tasks',
        targetId: quarterlyPeriodId(plan.periodKey),
        targetName: asTrimmedString(plan.targetPeriod.periodName),
        targetType: 'quarterly_period',
        detail: `沿用上一季度任务批次发生异常；未完成${result.failedCount}项，冲突${result.conflictCount + result.recordConflictCount + result.identityErrorCount}项。`,
      });
    }
    result.complete = result.remainingCount === 0 && result.failedCount === 0;
    return result;
  }

  async function listQuarterlyPeriods() {
    const management = quarterlyManagementAllowed();
    const currentAccount = management ? null : await currentQuarterlyActorAccount();
    const periods = (await listQuarterlyRows(COLLECTIONS.quarterlyPeriods))
      .sort((left, right) => asTrimmedString(right.periodKey).localeCompare(asTrimmedString(left.periodKey)));
    const tasks = management
      ? await listQuarterlyRows(COLLECTIONS.quarterlyTasks)
      : await quarterlyTasksForAccount(currentAccount);
    const records = await listQuarterlyRows(COLLECTIONS.quarterlyRecords);
    const recordsByTask = new Map();
    for (const record of records) {
      const recordId = getRecordId(record);
      const taskId = asTrimmedString(record.taskId);
      if (recordId) recordsByTask.set(recordId, record);
      if (taskId) recordsByTask.set(taskId, record);
    }
    const serverNow = now();
    const relatedPeriodKeys = new Set(
      tasks
        .filter((task) => asTrimmedString(task.status) !== 'revoked')
        .map((task) => asTrimmedString(task.periodKey))
        .filter(Boolean),
    );
    const items = periods
      .filter((period) => management || relatedPeriodKeys.has(asTrimmedString(period.periodKey)))
      .map((period) => {
        const periodKey = asTrimmedString(period.periodKey);
        const periodTasks = tasks.filter((task) => asTrimmedString(task.periodKey) === periodKey && asTrimmedString(task.status) !== 'revoked');
        const submittedTaskCount = periodTasks.filter((task) => {
          const taskId = getRecordId(task) || asTrimmedString(task.taskId);
          return asTrimmedString(recordsByTask.get(taskId)?.status) === 'submitted';
        }).length;
        return quarterlyPeriodPublic(period, { taskCount: periodTasks.length, submittedTaskCount }, serverNow);
      })
      .sort((left, right) => right.periodKey.localeCompare(left.periodKey));
    return { items, total: items.length };
  }

  async function saveQuarterlyTask(input) {
    requirePermission(actor, 'quarterly.manage');
    let normalized = null;
    let current = null;
    let taskId = '';
    let preflightTask = null;
    const hasExpectedVersion = hasOwn(input, 'expectedVersion');
    const expectedVersion = hasExpectedVersion ? normalizeQuarterlyExpectedVersion(input) : null;
    try {
      normalized = normalizeQuarterlyTaskInput(input);
      if (!normalized.evaluatorEmployeeId && normalized.evaluatorAccountId) {
        const legacyAccount = await findAccountById(db, normalized.evaluatorAccountId);
        if (asTrimmedString(legacyAccount.status) !== 'active') {
          throw new AppError('ACCOUNT_INACTIVE', '评价人账号已停用，不能建立季度评价任务。');
        }
        assertQuarterlySelfBinding(normalized.type, legacyAccount, normalized.evaluateeEmployeeId);
        normalized.evaluatorEmployeeId = validateTextField(
          legacyAccount.employeeId,
          '评价人档案编号',
          { required: true, maxLength: 160 },
        );
      }
      const period = await getQuarterlyPeriod(normalized.periodKey);
      assertQuarterlyRosterEditable(period, now());
      const evaluator = await quarterlyEvaluatorForEmployee(
        normalized.evaluatorEmployeeId,
        normalized.evaluatorAccountId,
        db,
        normalized.type,
      );
      const evaluatorIdentity = { employeeId: evaluator.evaluatorEmployeeIdSnapshot };
      assertQuarterlySelfBinding(normalized.type, evaluatorIdentity, normalized.evaluateeEmployeeId);
      const existingMatches = await quarterlyTasksForEmployeeIdentity({
        periodKey: normalized.periodKey,
        type: normalized.type,
        evaluatorEmployeeId: normalized.evaluatorEmployeeId,
        evaluateeEmployeeId: normalized.evaluateeEmployeeId,
        database: db,
      });
      if (existingMatches.length > 1) {
        throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', QUARTERLY_MESSAGES.taskIdentityConflict);
      }
      preflightTask = existingMatches[0] || null;
      taskId = quarterlyEmployeeTaskId(
        normalized.periodKey,
        normalized.type,
        normalized.evaluatorEmployeeId,
        normalized.evaluateeEmployeeId,
      );
      const employeeTaskId = taskId;
      let savedPeriod = period;
      let saved;

      await runTransaction(db, async (transaction) => {
        const periodReference = transaction.collection(COLLECTIONS.quarterlyPeriods).doc(quarterlyPeriodId(normalized.periodKey));
        const currentPeriod = getDocument(await periodReference.get());
        currentQuarterlyPeriodIdentity(currentPeriod, normalized.periodKey);
        const periodNow = now();
        assertQuarterlyRosterEditable(currentPeriod, periodNow);
        const currentEvaluator = await quarterlyEvaluatorForEmployee(
          normalized.evaluatorEmployeeId,
          normalized.evaluatorAccountId,
          transaction,
          normalized.type,
        );
        assertQuarterlySelfBinding(
          normalized.type,
          { employeeId: currentEvaluator.evaluatorEmployeeIdSnapshot },
          normalized.evaluateeEmployeeId,
        );
        const currentEmployee = await getQuarterlyEmployeeSnapshot(normalized.evaluateeEmployeeId, transaction);
        const dueAtInfo = quarterlyDueAtInfo(currentPeriod, { dueAt: normalized.dueAt });
        if (dueAtInfo.invalid) throw invalidQuarterlyDueAtError();
        assertQuarterlyTaskDueAtInNaturalWindow(currentPeriod, normalized.dueAt);
        savedPeriod = currentPeriod;
        const existingTaskId = preflightTask
          ? (getRecordId(preflightTask) || asTrimmedString(preflightTask.taskId))
          : employeeTaskId;
        const reference = transaction.collection(COLLECTIONS.quarterlyTasks).doc(existingTaskId);
        current = getDocument(await reference.get());
        taskId = existingTaskId;
        if (preflightTask && !current) {
          throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', '预检确认的已有任务已变化，请刷新后重试。', 409);
        }
        const nextTaskDueAt = quarterlyDueAtInfo({ dueAt: normalized.dueAt });
        const currentTaskDueAt = current ? quarterlyDueAtInfo({ dueAt: current.dueAt }) : { invalid: false, timestamp: null };
        if (nextTaskDueAt.invalid || currentTaskDueAt.invalid) throw invalidQuarterlyDueAtError();
        const taskStateChanged = Boolean(current) && asTrimmedString(current.status) !== normalized.status;
        const taskDueAtChanged = Boolean(current) && currentTaskDueAt.timestamp !== nextTaskDueAt.timestamp;
        const currentIdentity = current ? currentQuarterlyTaskIdentity(current, taskId) : null;
        if (
          current
          && asTrimmedString(current.sourcePendingRelationId)
          && (
            taskStateChanged
            || currentIdentity.evaluatorEmployeeId !== normalized.evaluatorEmployeeId
            || asTrimmedString(current.type) !== normalized.type
            || asTrimmedString(current.evaluateeEmployeeId) !== normalized.evaluateeEmployeeId
          )
        ) {
          throw new AppError(
            'QUARTERLY_TASK_SOURCE_RELATION_LOCKED',
            '由已确认来源关系生成的任务不能直接改派或撤销；请通过来源关系管理流程处理。',
            409,
          );
        }
        if ((taskStateChanged || taskDueAtChanged) && !hasExpectedVersion) {
          throw new AppError('VALIDATION_ERROR', '修改已有季度任务需要提供 expectedVersion。', 400, { field: 'expectedVersion' });
        }
        if (current && (taskStateChanged || taskDueAtChanged)) {
          const existingRecord = getDocument(
            await transaction.collection(COLLECTIONS.quarterlyRecords).doc(quarterlyRecordId(taskId)).get(),
          );
          if (existingRecord) {
            throw new AppError('QUARTERLY_TASK_HAS_RECORD', '该任务已有评价记录，不能撤销、重新启用或修改截止时间。', 409);
          }
        }
        if (current) {
          if (
            currentIdentity.evaluatorEmployeeId !== normalized.evaluatorEmployeeId
            || (asTrimmedString(current.evaluatorEmployeeIdSnapshot)
              && asTrimmedString(current.evaluatorEmployeeIdSnapshot) !== normalized.evaluatorEmployeeId)
          ) {
            throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', QUARTERLY_MESSAGES.taskIdentityConflict);
          }
          if (currentIdentity.identityMode === 'account') {
            const legacyAccount = await findAccountById(transaction, currentIdentity.evaluatorAccountId);
            if (
              asTrimmedString(legacyAccount.status) !== 'active'
              || asTrimmedString(legacyAccount.employeeId) !== normalized.evaluatorEmployeeId
            ) {
              throw new AppError('QUARTERLY_TASK_IDENTITY_CONFLICT', QUARTERLY_MESSAGES.taskIdentityConflict);
            }
          }
        }
        const existingVersion = current && Number.isInteger(current.version) && current.version > 0 ? current.version : 0;
        if (hasExpectedVersion && existingVersion !== expectedVersion) {
          throw new AppError('QUARTERLY_TASK_VERSION_CONFLICT', '季度评价任务已被其他人修改，请刷新后重试。');
        }
        const nowValue = periodNow;
        const next = {
          taskId,
          periodKey: normalized.periodKey,
          periodName: asTrimmedString(currentPeriod.periodName),
          type: normalized.type,
          evaluatorAccountId: current?.evaluatorAccountId || currentEvaluator.evaluatorAccountId,
          evaluatorAuthUidSnapshot: current?.evaluatorAuthUidSnapshot || currentEvaluator.evaluatorAuthUidSnapshot,
          evaluatorNameSnapshot: currentEvaluator.evaluatorNameSnapshot,
          evaluatorEmployeeIdSnapshot: currentEvaluator.evaluatorEmployeeIdSnapshot,
          evaluateeEmployeeId: currentEmployee.employeeId,
          evaluateeNameSnapshot: currentEmployee.employeeNameSnapshot,
          evaluateeDepartmentSnapshot: currentEmployee.departmentSnapshot,
          evaluateeEmploymentStatusSnapshot: currentEmployee.employmentStatusSnapshot,
          status: normalized.status,
          dueAt: normalized.dueAt || currentPeriod.dueAt || null,
          version: existingVersion + 1,
          createdAt: current?.createdAt || nowValue,
          updatedAt: nowValue,
          createdByAccountId: current?.createdByAccountId || actor.accountId,
          createdByAuthUid: current?.createdByAuthUid || actor.authUid,
          updatedByAccountId: actor.accountId,
          updatedByAuthUid: actor.authUid,
        };
        if (asTrimmedString(current?.sourcePendingRelationId)) {
          next.sourcePendingRelationId = asTrimmedString(current.sourcePendingRelationId);
        }
        if (current) await reference.update(next);
        else await writeQuarterlyDocument(
          transaction.collection(COLLECTIONS.quarterlyTasks),
          taskId,
          next,
          '季度评价任务未能写入数据库，请刷新后重试。',
        );
        const currentPeriodVersion = Number.isInteger(currentPeriod.version) && currentPeriod.version > 0
          ? currentPeriod.version
          : 1;
        const currentRosterVersion = Number.isInteger(currentPeriod.rosterVersion) && currentPeriod.rosterVersion > 0
          ? currentPeriod.rosterVersion
          : 1;
        const periodRosterUpdate = {
          version: currentPeriodVersion + 1,
          rosterVersion: currentRosterVersion + 1,
          updatedAt: nowValue,
          updatedByAccountId: actor.accountId,
          updatedByAuthUid: actor.authUid,
        };
        await periodReference.update(periodRosterUpdate);
        savedPeriod = { ...currentPeriod, ...periodRosterUpdate };
        saved = { ...next, _id: taskId };
        await appendAudit({
          database: transaction,
          action: 'save_quarterly_task',
          targetId: taskId,
          targetName: currentEmployee.employeeNameSnapshot,
          targetType: 'quarterly_task',
          changed: current ? changedFields(current, saved) : ['评价周期', '评价类型', '评价人', '被评价人', '任务状态'],
          before: current,
          after: saved,
          result: 'success',
          detail: `保存${normalized.periodKey}${quarterlyTypeLabel(normalized.type)}任务。`,
        });
      });
      return quarterlyTaskPublic(saved, null, savedPeriod);
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: 'save_quarterly_task',
        targetId: current ? getRecordId(current) : null,
        targetName: asTrimmedString(current?.evaluateeNameSnapshot),
        targetType: 'quarterly_task',
        detail: `保存季度评价任务失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function reviseQuarterlyRecord(input) {
    requirePermission(actor, 'quarterly.manage');
    const recordId = quarterlyRecordId(input.recordId || input.taskId || input.id);
    const expectedVersion = normalizeQuarterlyExpectedVersion(input);
    const reason = validateTextField(input.reason, '管理修订原因', { required: true, maxLength: 2000 });
    const evaluation = normalizeQuarterlyEvaluation(input, { complete: true });
    let task = null;
    let current = null;
    let saved = null;
    try {
      task = await requireQuarterlyTaskAccess(recordId, { management: true, action: 'revise_quarterly_review' });
      if (asTrimmedString(task.status) !== 'active') {
        throw new AppError('QUARTERLY_TASK_REVOKED', '已撤销的季度评价任务不能由管理员代录或修订。');
      }
      await getQuarterlyPeriod(task.periodKey);

      await runTransaction(db, async (transaction) => {
        const taskReference = transaction.collection(COLLECTIONS.quarterlyTasks).doc(recordId);
        const currentTask = getDocument(await taskReference.get());
        if (!currentTask) throw new AppError('QUARTERLY_TASK_NOT_FOUND', '未找到对应的季度评价任务。');
        if (asTrimmedString(currentTask.status) !== 'active') {
          throw new AppError('QUARTERLY_TASK_REVOKED', '已撤销的季度评价任务不能由管理员代录或修订。');
        }
        const reference = transaction.collection(COLLECTIONS.quarterlyRecords).doc(recordId);
        current = getDocument(await reference.get());
        const currentVersion = current && Number.isInteger(current.version) && current.version > 0 ? current.version : 0;
        if (currentVersion !== expectedVersion) {
          throw new AppError('QUARTERLY_RECORD_VERSION_CONFLICT', '季度评价数据已被其他人修改，请刷新后重试。');
        }
        if (current && asTrimmedString(current.status) === 'void') {
          throw new AppError('QUARTERLY_RECORD_STATE', '已作废的季度评价记录不能修订。');
        }
        const nowValue = now();
        const next = {
          taskId: recordId,
          periodKey: asTrimmedString(currentTask.periodKey),
          periodName: asTrimmedString(currentTask.periodName),
          type: asTrimmedString(currentTask.type),
          evaluatorAccountId: asTrimmedString(currentTask.evaluatorAccountId) || actor.accountId,
          evaluatorAuthUidSnapshot: asTrimmedString(currentTask.evaluatorAuthUidSnapshot) || actor.authUid,
          evaluatorNameSnapshot: asTrimmedString(currentTask.evaluatorNameSnapshot),
          evaluatorEmployeeIdSnapshot: asTrimmedString(currentTask.evaluatorEmployeeIdSnapshot) || null,
          evaluateeEmployeeId: asTrimmedString(currentTask.evaluateeEmployeeId),
          evaluateeNameSnapshot: asTrimmedString(currentTask.evaluateeNameSnapshot),
          evaluateeDepartmentSnapshot: asTrimmedString(currentTask.evaluateeDepartmentSnapshot),
          scores: evaluation.scores,
          reasons: evaluation.reasons,
          total: evaluation.total,
          status: 'submitted',
          version: currentVersion + 1,
          createdAt: current?.createdAt || nowValue,
          updatedAt: nowValue,
          createdByAccountId: current?.createdByAccountId || asTrimmedString(currentTask.evaluatorAccountId),
          createdByAuthUid: current?.createdByAuthUid || asTrimmedString(currentTask.evaluatorAuthUidSnapshot),
          updatedByAccountId: actor.accountId,
          updatedByAuthUid: actor.authUid,
          submittedAt: current?.submittedAt || nowValue,
          submittedByAccountId: current?.submittedByAccountId || asTrimmedString(currentTask.evaluatorAccountId),
          submittedByAuthUid: current?.submittedByAuthUid || asTrimmedString(currentTask.evaluatorAuthUidSnapshot),
          returnedReason: null,
          returnedAt: null,
          returnedByAccountId: null,
          returnedByAuthUid: null,
          managementEdited: true,
          managementEditReason: reason,
          managementEditedAt: nowValue,
          managementEditedByAccountId: actor.accountId,
          managementEditedByAuthUid: actor.authUid,
          actualOperatorName: actor.displayName,
          lastActorSnapshot: { accountId: actor.accountId, displayName: actor.displayName },
        };
        if (current) await reference.update(next);
        else await writeQuarterlyDocument(
          transaction.collection(COLLECTIONS.quarterlyRecords),
          recordId,
          next,
          '季度评价记录未能写入数据库，请刷新后重试。',
        );
        saved = { ...next, _id: recordId };
        await appendAudit({
          database: transaction,
          action: 'revise_quarterly_review',
          targetId: asTrimmedString(currentTask.evaluateeEmployeeId),
          targetName: asTrimmedString(currentTask.evaluateeNameSnapshot),
          targetType: 'employee',
          changed: current
            ? [...new Set([...changedFields(current, saved), 'managementEdited', 'actualOperatorName'])]
            : ['季度评分', '季度理由', '记录状态', 'managementEdited', 'actualOperatorName'],
          before: current,
          after: saved,
          result: 'success',
          detail: `管理员代录/修订${asTrimmedString(currentTask.periodKey)}${quarterlyTypeLabel(currentTask.type)}，原因：${reason}。`,
          originalEvaluatorAccountId: asTrimmedString(currentTask.evaluatorAccountId),
          originalEvaluatorNameSnapshot: asTrimmedString(currentTask.evaluatorNameSnapshot),
          actualOperatorNameSnapshot: actor.displayName,
          reason,
        });
      });
      return quarterlyRecordPublic(saved, { management: true });
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: 'revise_quarterly_review',
        targetId: asTrimmedString(task?.evaluateeEmployeeId),
        targetName: asTrimmedString(task?.evaluateeNameSnapshot),
        targetType: 'employee',
        before: current,
        detail: `管理员代录/修订季度评价失败：${appError.code}。`,
        originalEvaluatorAccountId: asTrimmedString(task?.evaluatorAccountId),
        originalEvaluatorNameSnapshot: asTrimmedString(task?.evaluatorNameSnapshot),
        actualOperatorNameSnapshot: actor.displayName,
        reason,
      });
      throw appError;
    }
  }

  async function saveQuarterlyTasks(input) {
    requirePermission(actor, 'quarterly.manage');
    const assignments = Array.isArray(input.tasks) ? input.tasks : [input];
    if (!assignments.length) throw new AppError('VALIDATION_ERROR', '至少需要保存一条季度评价关系。', 400, { field: 'tasks' });
    const items = [];
    for (const assignment of assignments) items.push(await saveQuarterlyTask(assignment));
    return { task: items[0] || null, items, total: items.length };
  }

  async function quarterlyMaterializationPlan(periodKeyValue) {
    const periodKey = normalizeQuarterlyPeriodKey(periodKeyValue);
    const period = await getQuarterlyPeriod(periodKey);
    if (asTrimmedString(period.status) !== 'draft' || quarterlyPeriodEffectiveStatus(period, now()) !== 'draft') {
      throw new AppError('QUARTERLY_PERIOD_NOT_DRAFT', '请先选择尚未开放的草稿周期，再预检或生成评价任务。', 409);
    }

    const [relationRows, taskRows, recordRows] = await Promise.all([
      listQuarterlyRowsWithPagination(
        COLLECTIONS.quarterlyPendingRelations,
        {
          _id: true,
          sourceRelationId: true,
          periodKey: true,
          periodName: true,
          type: true,
          status: true,
          evaluatorNameSnapshot: true,
          evaluatorEmployeeIdSnapshot: true,
          evaluatorStudentIdSnapshot: true,
          evaluatorStudentNameSnapshot: true,
          evaluateeEmployeeId: true,
          evaluateeNameSnapshot: true,
          evaluateeDepartmentSnapshot: true,
          assignedTaskId: true,
        },
        db,
        { periodKey },
        '读取季度待确认关系失败。',
      ),
      listQuarterlyRowsWithPagination(
        COLLECTIONS.quarterlyTasks,
        {
          _id: true,
          taskId: true,
          periodKey: true,
          periodName: true,
          type: true,
          evaluatorAccountId: true,
          evaluatorAuthUidSnapshot: true,
          evaluatorNameSnapshot: true,
          evaluatorEmployeeIdSnapshot: true,
          evaluatorStudentIdSnapshot: true,
          evaluateeEmployeeId: true,
          status: true,
          sourcePendingRelationId: true,
          version: true,
        },
        db,
        { periodKey },
        '读取已有季度评价任务失败。',
      ),
      listQuarterlyRowsWithPagination(
        COLLECTIONS.quarterlyRecords,
        { _id: true, taskId: true, periodKey: true },
        db,
        { periodKey },
        '读取已有季度评价记录失败。',
      ),
    ]);

    const tasksById = new Map();
    for (const task of taskRows) {
      const id = getRecordId(task) || asTrimmedString(task.taskId);
      if (id) tasksById.set(id, task);
    }
    const recordsByTaskId = new Map();
    for (const record of recordRows) {
      const recordId = getRecordId(record);
      const taskId = asTrimmedString(record.taskId);
      if (recordId) recordsByTaskId.set(recordId, record);
      if (taskId) recordsByTaskId.set(taskId, record);
    }

    const employeeSnapshots = new Map();
    const employeeSnapshotFor = async (employeeId) => {
      if (!employeeSnapshots.has(employeeId)) {
        employeeSnapshots.set(employeeId, getQuarterlyEmployeeSnapshot(employeeId));
      }
      try {
        return await employeeSnapshots.get(employeeId);
      } catch (error) {
        const appError = toAppError(error);
        if (appError.code === 'EMPLOYEE_NOT_FOUND') return null;
        throw appError;
      }
    };

    const taskEmployeeIdentities = new Map();
    const identityForTask = async (task) => {
      const taskId = getRecordId(task) || asTrimmedString(task.taskId);
      if (!taskId) return null;
      if (taskEmployeeIdentities.has(taskId)) return taskEmployeeIdentities.get(taskId);
      let identity;
      try {
        identity = currentQuarterlyTaskIdentity(task, taskId);
      } catch (error) {
        const appError = toAppError(error);
        if (appError.code === 'QUARTERLY_TASK_IDENTITY_CONFLICT') {
          taskEmployeeIdentities.set(taskId, null);
          return null;
        }
        throw appError;
      }
      if (identity.identityMode === 'employee') {
        const result = {
          employeeId: identity.evaluatorEmployeeId,
          studentId: null,
          accountId: null,
          activeAccount: true,
        };
        taskEmployeeIdentities.set(taskId, result);
        return result;
      }
      let account;
      try {
        account = await findAccountById(db, identity.evaluatorAccountId);
      } catch (error) {
        if (toAppError(error).code === 'ACCOUNT_NOT_FOUND') {
          const snapshotEmployeeId = asTrimmedString(task.evaluatorEmployeeIdSnapshot);
          const snapshotStudentId = asTrimmedString(task.evaluatorStudentIdSnapshot);
          const result = snapshotStudentId
            ? { employeeId: null, studentId: snapshotStudentId, accountId: identity.evaluatorAccountId, activeAccount: false }
            : snapshotEmployeeId
              ? { employeeId: snapshotEmployeeId, studentId: null, accountId: identity.evaluatorAccountId, activeAccount: false }
              : null;
          taskEmployeeIdentities.set(taskId, result);
          return result;
        }
        throw error;
      }
      const accountEmployeeId = asTrimmedString(account.employeeId);
      const accountStudentId = asTrimmedString(account.studentId);
      const snapshotEmployeeId = asTrimmedString(task.evaluatorEmployeeIdSnapshot);
      const snapshotStudentId = asTrimmedString(task.evaluatorStudentIdSnapshot);
      if (snapshotStudentId) {
        if (snapshotEmployeeId || accountEmployeeId || !isStudentAccount(account) || accountStudentId !== snapshotStudentId) {
          taskEmployeeIdentities.set(taskId, null);
          return null;
        }
        const result = {
          employeeId: null,
          studentId: accountStudentId,
          accountId: identity.evaluatorAccountId,
          activeAccount: asTrimmedString(account.status) === 'active',
        };
        taskEmployeeIdentities.set(taskId, result);
        return result;
      }
      if (isStudentAccount(account) || !accountEmployeeId || (snapshotEmployeeId && snapshotEmployeeId !== accountEmployeeId)) {
        taskEmployeeIdentities.set(taskId, null);
        return null;
      }
      const result = {
        employeeId: accountEmployeeId,
        studentId: null,
        accountId: identity.evaluatorAccountId,
        activeAccount: asTrimmedString(account.status) === 'active',
      };
      taskEmployeeIdentities.set(taskId, result);
      return result;
    };

    const normalizedRelations = [];
    const duplicateTupleCounts = new Map();
    for (const row of relationRows) {
      const status = asTrimmedString(row.status);
      if (!['pending_binding', 'assigned'].includes(status)) {
        normalizedRelations.push({ row, status, relation: null, invalid: true });
        continue;
      }
      try {
        const relation = quarterlyPendingRelationPublic({ ...row, status: 'pending_binding' });
        normalizedRelations.push({ row, status, relation, invalid: false });
        if (status === 'pending_binding' && (relation.evaluatorEmployeeIdSnapshot || relation.evaluatorStudentIdSnapshot)) {
          const tuple = JSON.stringify([
            relation.type,
            relation.evaluatorStudentIdSnapshot ? 'student' : 'employee',
            relation.evaluatorStudentIdSnapshot || relation.evaluatorEmployeeIdSnapshot,
            relation.evaluateeEmployeeId,
          ]);
          duplicateTupleCounts.set(tuple, (duplicateTupleCounts.get(tuple) || 0) + 1);
        }
      } catch {
        normalizedRelations.push({ row, status, relation: null, invalid: true });
      }
    }

    const taskIdsByTuple = new Map();
    const unresolvedTaskTargets = new Set();
    for (const task of taskRows) {
      const taskPeriodKey = asTrimmedString(task.periodKey);
      const type = asTrimmedString(task.type);
      const evaluateeEmployeeId = asTrimmedString(task.evaluateeEmployeeId);
      if (taskPeriodKey !== periodKey || !type || !evaluateeEmployeeId) continue;
      const identity = await identityForTask(task);
      if (!identity) {
        unresolvedTaskTargets.add(JSON.stringify([type, evaluateeEmployeeId]));
        continue;
      }
      const identityType = identity.studentId ? 'student' : 'employee';
      const identityId = identity.studentId || identity.employeeId;
      if (!identityId) {
        unresolvedTaskTargets.add(JSON.stringify([type, evaluateeEmployeeId]));
        continue;
      }
      const tuple = JSON.stringify([type, identityType, identityId, evaluateeEmployeeId]);
      if (!taskIdsByTuple.has(tuple)) taskIdsByTuple.set(tuple, []);
      taskIdsByTuple.get(tuple).push(task);
    }

    const plan = {
      periodKey,
      period,
      eligible: [],
      eligibleCount: 0,
      alreadyMaterializedCount: 0,
      unmatchedCount: 0,
      conflictCount: 0,
    };
    for (const entry of normalizedRelations) {
      if (entry.invalid || !entry.relation) {
        plan.conflictCount += 1;
        continue;
      }
      const { row, status, relation } = entry;
      const sourceRelationId = relation.id;
      const evaluatee = await employeeSnapshotFor(relation.evaluateeEmployeeId);
      if (!evaluatee) {
        plan.conflictCount += 1;
        continue;
      }

      if (status === 'assigned') {
        const assignedTaskId = asTrimmedString(row.assignedTaskId);
        const task = assignedTaskId ? tasksById.get(assignedTaskId) : null;
        if (!task || asTrimmedString(task.sourcePendingRelationId) !== sourceRelationId) {
          plan.conflictCount += 1;
          continue;
        }
        const identity = await identityForTask(task);
        if (
          asTrimmedString(task.status) !== 'active'
          || asTrimmedString(task.periodKey) !== periodKey
          || asTrimmedString(task.type) !== relation.type
          || asTrimmedString(task.evaluateeEmployeeId) !== relation.evaluateeEmployeeId
          || (relation.evaluatorStudentIdSnapshot
            ? identity?.studentId !== relation.evaluatorStudentIdSnapshot || identity?.employeeId !== null
            : identity?.employeeId !== relation.evaluatorEmployeeIdSnapshot || identity?.studentId !== null)
        ) {
          plan.conflictCount += 1;
          continue;
        }
        plan.alreadyMaterializedCount += 1;
        continue;
      }

      const evaluatorEmployeeId = relation.evaluatorEmployeeIdSnapshot;
      if (relation.evaluatorStudentIdSnapshot) {
        plan.conflictCount += 1;
        continue;
      }
      if (!evaluatorEmployeeId) {
        plan.unmatchedCount += 1;
        continue;
      }
      const evaluator = await employeeSnapshotFor(evaluatorEmployeeId);
      if (!evaluator || asTrimmedString(evaluator.employmentStatusSnapshot) !== 'active') {
        plan.conflictCount += 1;
        continue;
      }
      if (relation.type === 'self' && evaluatorEmployeeId !== relation.evaluateeEmployeeId) {
        plan.conflictCount += 1;
        continue;
      }
      if (unresolvedTaskTargets.has(JSON.stringify([relation.type, relation.evaluateeEmployeeId]))) {
        plan.conflictCount += 1;
        continue;
      }
      const tuple = JSON.stringify([relation.type, 'employee', evaluatorEmployeeId, relation.evaluateeEmployeeId]);
      if ((duplicateTupleCounts.get(tuple) || 0) > 1) {
        plan.conflictCount += 1;
        continue;
      }
      const matchingTasks = taskIdsByTuple.get(tuple) || [];
      if (matchingTasks.length > 1) {
        plan.conflictCount += 1;
        continue;
      }
      let existingTask = matchingTasks[0] || null;
      if (existingTask) {
        const identity = await identityForTask(existingTask);
        if (
          asTrimmedString(existingTask.status) !== 'active'
          || !identity?.activeAccount
          || (asTrimmedString(existingTask.sourcePendingRelationId)
            && asTrimmedString(existingTask.sourcePendingRelationId) !== sourceRelationId)
        ) {
          plan.conflictCount += 1;
          continue;
        }
      } else {
        const employeeTaskId = quarterlyEmployeeTaskId(
          periodKey,
          relation.type,
          evaluatorEmployeeId,
          relation.evaluateeEmployeeId,
        );
        if (tasksById.has(employeeTaskId) || recordsByTaskId.has(employeeTaskId)) {
          plan.conflictCount += 1;
          continue;
        }
      }
      plan.eligible.push({ relation, sourceRelationId, evaluator, evaluatee, existingTask });
      plan.eligibleCount += 1;
    }
    const scopeRows = normalizedRelations.map(({ row, status, relation }) => ({
      relationId: getRecordId(row) || null,
      sourceRelationId: asTrimmedString(row.sourceRelationId) || null,
      status,
      periodKey: asTrimmedString(row.periodKey) || null,
      type: relation?.type || asTrimmedString(row.type) || null,
      evaluatorEmployeeId: relation?.evaluatorEmployeeIdSnapshot
        || asTrimmedString(row.evaluatorEmployeeIdSnapshot)
        || null,
      evaluatorStudentId: relation?.evaluatorStudentIdSnapshot
        || asTrimmedString(row.evaluatorStudentIdSnapshot)
        || null,
      evaluateeEmployeeId: relation?.evaluateeEmployeeId
        || asTrimmedString(row.evaluateeEmployeeId)
        || null,
      assignedTaskId: asTrimmedString(row.assignedTaskId) || null,
    })).sort((left, right) => asTrimmedString(left.relationId).localeCompare(asTrimmedString(right.relationId)));
    const eligibleRows = plan.eligible.map(({ relation, existingTask }) => ({
      relationId: relation.id,
      sourceRelationId: relation.sourceRelationId,
      periodKey: relation.periodKey,
      type: relation.type,
      evaluatorEmployeeId: relation.evaluatorEmployeeIdSnapshot,
      evaluatorStudentId: relation.evaluatorStudentIdSnapshot,
      evaluateeEmployeeId: relation.evaluateeEmployeeId,
      status: 'pending_binding',
      existingTaskId: existingTask ? (getRecordId(existingTask) || asTrimmedString(existingTask.taskId)) : null,
      existingTaskStatus: existingTask ? asTrimmedString(existingTask.status) : null,
      existingTaskVersion: existingTask?.version ?? null,
      existingSourceRelationId: existingTask ? asTrimmedString(existingTask.sourcePendingRelationId) || null : null,
    })).sort((left, right) => asTrimmedString(left.sourceRelationId).localeCompare(asTrimmedString(right.sourceRelationId)));
    const previewFingerprint = {
      periodKey,
      periodStatus: asTrimmedString(period.status),
      periodVersion: Number.isInteger(period.version) ? period.version : null,
      periodOpensAt: asTrimmedString(period.opensAt) || null,
      periodDueAt: asTrimmedString(period.dueAt) || null,
      eligibleCount: plan.eligibleCount,
      alreadyMaterializedCount: plan.alreadyMaterializedCount,
      unmatchedCount: plan.unmatchedCount,
      conflictCount: plan.conflictCount,
      scopeRows,
      eligibleRows,
    };
    plan.previewToken = crypto.createHash('sha256').update(JSON.stringify(previewFingerprint), 'utf8').digest('hex');
    return plan;
  }

  async function quarterlyMaterializationPreview(input) {
    requirePermission(actor, 'quarterly.manage');
    const plan = await quarterlyMaterializationPlan(input.periodKey);
    return {
      periodKey: plan.periodKey,
      periodName: asTrimmedString(plan.period.periodName),
      previewToken: plan.previewToken,
      eligibleCount: plan.eligibleCount,
      alreadyMaterializedCount: plan.alreadyMaterializedCount,
      unmatchedCount: plan.unmatchedCount,
      conflictCount: plan.conflictCount,
    };
  }

  async function materializeQuarterlyRelation(candidate) {
    const { relation, sourceRelationId } = candidate;
    const expectedTaskId = quarterlyEmployeeTaskId(
      relation.periodKey,
      relation.type,
      relation.evaluatorEmployeeIdSnapshot,
      relation.evaluateeEmployeeId,
    );
    const executeOnce = () => runTransaction(db, async (transaction) => {
      const periodReference = transaction.collection(COLLECTIONS.quarterlyPeriods).doc(quarterlyPeriodId(relation.periodKey));
      const period = getDocument(await periodReference.get());
      currentQuarterlyPeriodIdentity(period, relation.periodKey);
      if (asTrimmedString(period.status) !== 'draft') {
        throw new AppError('QUARTERLY_PERIOD_NOT_DRAFT', '季度周期已不再是草稿，不能生成评价任务。', 409);
      }
      assertQuarterlyRosterEditable(period, now());

      const relationReference = transaction.collection(COLLECTIONS.quarterlyPendingRelations).doc(relation.id);
      const currentRelation = getDocument(await relationReference.get());
      if (!currentRelation) throw new AppError('QUARTERLY_MATERIALIZATION_CONFLICT', '来源评价关系已不存在。', 409);
      const relationStatus = asTrimmedString(currentRelation.status);
      if (relationStatus === 'assigned') {
        const assignedTaskId = asTrimmedString(currentRelation.assignedTaskId);
        const assignedTask = assignedTaskId
          ? getDocument(await transaction.collection(COLLECTIONS.quarterlyTasks).doc(assignedTaskId).get())
          : null;
        if (
          assignedTask
          && asTrimmedString(assignedTask.status) === 'active'
          && asTrimmedString(assignedTask.sourcePendingRelationId) === sourceRelationId
          && asTrimmedString(assignedTask.evaluatorEmployeeIdSnapshot) === relation.evaluatorEmployeeIdSnapshot
          && asTrimmedString(assignedTask.evaluateeEmployeeId) === relation.evaluateeEmployeeId
          && asTrimmedString(assignedTask.type) === relation.type
        ) return 'skipped';
        throw new AppError('QUARTERLY_MATERIALIZATION_CONFLICT', '已分配来源关系与季度任务不一致。', 409);
      }
      if (relationStatus !== 'pending_binding') {
        throw new AppError('QUARTERLY_MATERIALIZATION_CONFLICT', '来源评价关系状态已变化。', 409);
      }
      const current = quarterlyPendingRelationPublic({ ...currentRelation, status: 'pending_binding' });
      if (
        current.id !== relation.id
        || current.evaluatorEmployeeIdSnapshot !== relation.evaluatorEmployeeIdSnapshot
        || current.evaluateeEmployeeId !== relation.evaluateeEmployeeId
        || current.type !== relation.type
      ) {
        throw new AppError('QUARTERLY_MATERIALIZATION_CONFLICT', '来源评价关系在预检后发生变化。', 409);
      }
      const evaluator = await quarterlyEvaluatorForEmployee(relation.evaluatorEmployeeIdSnapshot, null, transaction);
      const evaluatee = await getQuarterlyEmployeeSnapshot(relation.evaluateeEmployeeId, transaction);
      if (relation.type === 'self' && relation.evaluatorEmployeeIdSnapshot !== relation.evaluateeEmployeeId) {
        throw new AppError('QUARTERLY_MATERIALIZATION_CONFLICT', '自评关系的评价人与被评价人不一致。', 409);
      }

      const taskId = candidate.existingTask
        ? (getRecordId(candidate.existingTask) || asTrimmedString(candidate.existingTask.taskId))
        : expectedTaskId;
      const taskReadback = getDocument(await transaction.collection(COLLECTIONS.quarterlyTasks).doc(taskId).get());
      // A missing CloudBase document can return an empty response envelope.
      // Only a row carrying the requested task identity may reserve this ID.
      let task = taskReadback && (
        getRecordId(taskReadback) === taskId || asTrimmedString(taskReadback.taskId) === taskId
      ) ? taskReadback : null;
      if (candidate.existingTask && !task) {
        throw new AppError('QUARTERLY_MATERIALIZATION_CONFLICT', '预检确认的已有任务已变化，未执行本条关系。', 409);
      }
      if (!candidate.existingTask && task) {
        throw new AppError('QUARTERLY_MATERIALIZATION_CONFLICT', '目标任务编号已被其他操作占用。', 409);
      }
      let created = false;
      let taskReference = transaction.collection(COLLECTIONS.quarterlyTasks).doc(taskId);
      if (task) {
        const taskIdentity = currentQuarterlyTaskIdentity(task, taskId);
        if (
          asTrimmedString(task.status) !== 'active'
          || (taskIdentity.identityMode === 'account'
            && asTrimmedString(task.evaluatorEmployeeIdSnapshot)
            && asTrimmedString(task.evaluatorEmployeeIdSnapshot) !== relation.evaluatorEmployeeIdSnapshot)
          || (asTrimmedString(task.sourcePendingRelationId)
            && asTrimmedString(task.sourcePendingRelationId) !== sourceRelationId)
        ) {
          throw new AppError('QUARTERLY_MATERIALIZATION_CONFLICT', '已有任务不符合安全复用条件。', 409);
        }
        if (taskIdentity.identityMode === 'account') {
          const legacyAccount = await findAccountById(transaction, taskIdentity.evaluatorAccountId);
          if (
            asTrimmedString(legacyAccount.status) !== 'active'
            || asTrimmedString(legacyAccount.employeeId) !== relation.evaluatorEmployeeIdSnapshot
          ) {
            throw new AppError('QUARTERLY_MATERIALIZATION_CONFLICT', '历史账号任务的员工绑定已变化，未复用该任务。', 409);
          }
        }
        const patch = {};
        if (!asTrimmedString(task.sourcePendingRelationId)) patch.sourcePendingRelationId = sourceRelationId;
        if (!asTrimmedString(task.evaluatorEmployeeIdSnapshot)) {
          patch.evaluatorEmployeeIdSnapshot = relation.evaluatorEmployeeIdSnapshot;
          patch.evaluatorNameSnapshot = evaluator.evaluatorNameSnapshot;
        }
        if (Object.keys(patch).length) {
          patch.updatedAt = now();
          patch.updatedByAccountId = actor.accountId;
          patch.updatedByAuthUid = actor.authUid;
          await taskReference.update(patch);
          task = { ...task, ...patch };
        }
      } else {
        const recordReadback = getDocument(await transaction.collection(COLLECTIONS.quarterlyRecords).doc(taskId).get());
        const orphanRecord = recordReadback && (
          getRecordId(recordReadback) === taskId || asTrimmedString(recordReadback.taskId) === taskId
        ) ? recordReadback : null;
        if (orphanRecord) {
          throw new AppError('QUARTERLY_MATERIALIZATION_CONFLICT', '目标任务已有评价记录，未执行本条关系。', 409);
        }
        const nowValue = now();
        const nextTask = {
          taskId,
          periodKey: relation.periodKey,
          periodName: asTrimmedString(period.periodName) || relation.periodName,
          type: relation.type,
          evaluatorAccountId: null,
          evaluatorAuthUidSnapshot: null,
          evaluatorNameSnapshot: evaluator.evaluatorNameSnapshot,
          evaluatorEmployeeIdSnapshot: evaluator.evaluatorEmployeeIdSnapshot,
          evaluateeEmployeeId: evaluatee.employeeId,
          evaluateeNameSnapshot: evaluatee.employeeNameSnapshot,
          evaluateeDepartmentSnapshot: evaluatee.departmentSnapshot,
          evaluateeEmploymentStatusSnapshot: evaluatee.employmentStatusSnapshot,
          status: 'active',
          dueAt: period.dueAt || null,
          sourcePendingRelationId: sourceRelationId,
          version: 1,
          createdAt: nowValue,
          updatedAt: nowValue,
          createdByAccountId: actor.accountId,
          createdByAuthUid: actor.authUid,
          updatedByAccountId: actor.accountId,
          updatedByAuthUid: actor.authUid,
        };
        await writeQuarterlyDocument(
          transaction.collection(COLLECTIONS.quarterlyTasks),
          taskId,
          nextTask,
          '评价任务未能写入数据库，本条关系保持未分配。',
        );
        task = { ...nextTask, _id: taskId };
        created = true;
      }

      const assignedAt = now();
      await relationReference.update({
        status: 'assigned',
        assignedTaskId: taskId,
        assignedAt,
        assignedByAccountId: actor.accountId,
        assignedByAuthUid: actor.authUid,
      });
      const currentPeriodVersion = Number.isInteger(period.version) && period.version > 0 ? period.version : 1;
      const currentRosterVersion = Number.isInteger(period.rosterVersion) && period.rosterVersion > 0
        ? period.rosterVersion
        : 1;
      await periodReference.update({
        version: currentPeriodVersion + 1,
        rosterVersion: currentRosterVersion + 1,
        updatedAt: assignedAt,
        updatedByAccountId: actor.accountId,
        updatedByAuthUid: actor.authUid,
      });
      await appendAudit({
        database: transaction,
        action: 'materialize_quarterly_relation',
        targetId: taskId,
        targetName: evaluatee.employeeNameSnapshot,
        targetType: 'quarterly_task',
        changed: created ? ['quarterly_task', 'source_relation_status'] : ['sourcePendingRelationId', 'source_relation_status'],
        before: null,
        after: task,
        result: 'success',
        detail: `将${relation.periodKey}${quarterlyTypeLabel(relation.type)}评价关系生成个人任务。`,
      });
      return created ? 'created' : 'reused';
    });

    try {
      return await executeOnce();
    } catch (error) {
      if (toAppError(error).code !== 'EMPLOYEE_CONFLICT') throw error;
      return executeOnce();
    }
  }

  async function quarterlyMaterializationExecute(input) {
    requirePermission(actor, 'quarterly.manage');
    if (input.acknowledged !== true) {
      throw new AppError('VALIDATION_ERROR', '请确认已核对预检结果后再生成任务。', 400, { field: 'acknowledged' });
    }
    if (!Number.isInteger(input.expectedEligibleCount) || input.expectedEligibleCount < 0) {
      throw new AppError('VALIDATION_ERROR', '预检任务数量无效，请重新预检。', 400, { field: 'expectedEligibleCount' });
    }
    const expectedPreviewToken = asTrimmedString(input.expectedPreviewToken);
    if (!/^[a-f0-9]{64}$/.test(expectedPreviewToken)) {
      throw new AppError('VALIDATION_ERROR', '预检结果标识无效，请重新预检。', 400, { field: 'expectedPreviewToken' });
    }
    const plan = await quarterlyMaterializationPlan(input.periodKey);
    if (
      plan.eligibleCount !== input.expectedEligibleCount
      || plan.previewToken !== expectedPreviewToken
    ) {
      throw new AppError('QUARTERLY_MATERIALIZATION_PREVIEW_STALE', '关系数量已变化，请重新预检后再执行。', 409);
    }
    const result = {
      periodKey: plan.periodKey,
      periodName: asTrimmedString(plan.period.periodName),
      createdCount: 0,
      reusedCount: 0,
      skippedCount: 0,
      processedCount: 0,
      remainingCount: plan.eligibleCount,
      unmatchedCount: plan.unmatchedCount,
      conflictCount: plan.conflictCount,
      failedCount: 0,
      errorSummary: [],
      complete: false,
    };
    if (plan.conflictCount > 0) {
      result.errorSummary.push('预检发现身份或关系冲突，未写入任务。');
      return result;
    }
    const batchLimit = 5;
    for (const candidate of plan.eligible.slice(0, batchLimit)) {
      try {
        const status = await materializeQuarterlyRelation(candidate);
        if (status === 'created') result.createdCount += 1;
        else if (status === 'reused') result.reusedCount += 1;
        else result.skippedCount += 1;
      } catch (error) {
        const appError = toAppError(error);
        if (appError.code === 'QUARTERLY_MATERIALIZATION_CONFLICT') {
          result.conflictCount += 1;
        } else {
          result.failedCount += 1;
        }
      }
    }
    result.processedCount = result.createdCount + result.reusedCount + result.skippedCount;
    try {
      const refreshedPlan = await quarterlyMaterializationPlan(plan.periodKey);
      result.remainingCount = refreshedPlan.eligibleCount;
      result.conflictCount = Math.max(result.conflictCount, refreshedPlan.conflictCount);
      result.unmatchedCount = refreshedPlan.unmatchedCount;
    } catch {
      result.failedCount += 1;
    }
    if (result.conflictCount > 0) result.errorSummary.push('有关系在处理时发生变化或存在身份冲突，请重新预检核对。');
    if (result.failedCount > 0) result.errorSummary.push('部分事务未完成，请重新预检后继续处理。');
    result.complete = result.remainingCount === 0 && result.conflictCount === 0 && result.failedCount === 0;
    return result;
  }

  async function bindQuarterlyPendingRelationToStudent(input) {
    requirePermission(actor, 'quarterly.manage');
    if (input.acknowledged !== true) {
      throw new AppError('VALIDATION_ERROR', '请先确认已核对来源关系和学员档案。', 400, { field: 'acknowledged' });
    }
    const relationId = validateTextField(input.relationId, '待处理关系编号', { required: true, maxLength: 240 });
    const studentId = getStudentId(input);
    if (!Number.isInteger(input.expectedRosterVersion) || input.expectedRosterVersion < 1) {
      throw new AppError('VALIDATION_ERROR', '缺少有效的任务名单版本。', 400, { field: 'expectedRosterVersion' });
    }

    // Resolve the linked account before entering the transaction, then re-read
    // that exact account inside it. A student with no unique active account
    // cannot receive a task that nobody can open.
    const linkedAccounts = await listAccountsByStudentId(db, studentId, 2);
    if (linkedAccounts.length !== 1
      || !isStudentAccount(linkedAccounts[0])
      || asTrimmedString(linkedAccounts[0].status) !== 'active') {
      throw new AppError('QUARTERLY_STUDENT_ACCOUNT_REQUIRED', '所选学员档案没有唯一有效的登录账号，暂不能创建评价任务。', 409);
    }
    const linkedAccountId = getRecordId(linkedAccounts[0]) || asTrimmedString(linkedAccounts[0].accountId);
    if (!linkedAccountId) {
      throw new AppError('QUARTERLY_STUDENT_ACCOUNT_REQUIRED', '所选学员账号身份编号无效，暂不能创建评价任务。', 409);
    }

    return runTransaction(db, async (transaction) => {
      const relationReference = transaction.collection(COLLECTIONS.quarterlyPendingRelations).doc(relationId);
      const currentRelation = getDocument(await relationReference.get());
      if (!currentRelation) throw new AppError('QUARTERLY_PENDING_RELATION_NOT_FOUND', '待处理来源关系已不存在。', 404);
      const relation = quarterlyPendingRelationPublic({ ...currentRelation, status: 'pending_binding' });
      if (relation.id !== relationId) {
        throw new AppError('QUARTERLY_PENDING_RELATION_IDENTITY_CONFLICT', '待处理来源关系编号与来源信息不一致。', 409);
      }

      const periodReference = transaction.collection(COLLECTIONS.quarterlyPeriods).doc(quarterlyPeriodId(relation.periodKey));
      const period = getDocument(await periodReference.get());
      currentQuarterlyPeriodIdentity(period, relation.periodKey);

      const status = asTrimmedString(currentRelation.status);
      if (status === 'assigned') {
        const assignedTaskId = asTrimmedString(currentRelation.assignedTaskId);
        const existingTask = assignedTaskId
          ? getDocument(await transaction.collection(COLLECTIONS.quarterlyTasks).doc(assignedTaskId).get())
          : null;
        if (relation.evaluatorStudentIdSnapshot !== studentId
          || !existingTask
          || asTrimmedString(existingTask.sourcePendingRelationId) !== relationId
          || asTrimmedString(existingTask.evaluatorStudentIdSnapshot) !== studentId
          || asTrimmedString(existingTask.evaluatorAccountId) !== linkedAccountId
          || asTrimmedString(existingTask.evaluateeEmployeeId) !== relation.evaluateeEmployeeId
          || asTrimmedString(existingTask.periodKey) !== relation.periodKey
          || asTrimmedString(existingTask.type) !== relation.type
          || asTrimmedString(existingTask.status) !== 'active') {
          throw new AppError('QUARTERLY_PENDING_RELATION_CONFLICT', '来源关系已处理，但任务身份与所选学员档案不一致。', 409);
        }
        return {
          task: quarterlyTaskPublic(existingTask, null, period, now()),
          alreadyBound: true,
        };
      }
      if (status !== 'pending_binding') {
        throw new AppError('QUARTERLY_PENDING_RELATION_CONFLICT', '来源关系状态已变化，请刷新后重试。', 409);
      }
      if (relation.type === 'self') {
        throw new AppError('QUARTERLY_STUDENT_SELF_REVIEW_UNSUPPORTED', '学员身份不能绑定到员工自评关系。', 409);
      }
      if (relation.evaluatorEmployeeIdSnapshot
        || (relation.evaluatorStudentIdSnapshot && relation.evaluatorStudentIdSnapshot !== studentId)) {
        throw new AppError('QUARTERLY_PENDING_RELATION_CONFLICT', '来源关系已有不同的评价人身份，不能覆盖。', 409);
      }

      const periodStatus = quarterlyPeriodEffectiveStatus(period, now());
      if (!['draft', 'open'].includes(periodStatus)) {
        throw new AppError('QUARTERLY_PERIOD_CLOSED', '已关闭或归档的季度不能绑定来源关系。', 409);
      }
      const rosterVersion = Number.isInteger(period.rosterVersion) && period.rosterVersion > 0 ? period.rosterVersion : 1;
      if (rosterVersion !== input.expectedRosterVersion) {
        throw new AppError('QUARTERLY_PENDING_RELATION_STALE', '季度任务名单已变化，请刷新后重新核对。', 409);
      }

      const studentReference = transaction.collection(COLLECTIONS.employees).doc(studentId);
      const currentStudent = getDocument(await studentReference.get());
      if (!isStudentRecord(currentStudent) || asTrimmedString(currentStudent.status) !== 'active') {
        throw new AppError('QUARTERLY_STUDENT_NOT_ACTIVE', '所选学员档案不存在或已停用，请刷新名单后重试。', 409);
      }
      const studentName = asTrimmedString(currentStudent.name);
      if (!studentName) throw new AppError('QUARTERLY_STUDENT_NOT_ACTIVE', '所选学员档案缺少有效姓名，暂不能创建任务。', 409);

      const accountReference = transaction.collection(COLLECTIONS.adminAccounts).doc(linkedAccountId);
      const currentAccount = getDocument(await accountReference.get());
      if (!currentAccount
        || !isStudentAccount(currentAccount)
        || asTrimmedString(currentAccount.studentId) !== studentId
        || asTrimmedString(currentAccount.status) !== 'active'
        || !asTrimmedString(currentAccount.authUid)) {
        throw new AppError('QUARTERLY_STUDENT_ACCOUNT_REQUIRED', '学员账号身份已变化或已停用，请刷新后重试。', 409);
      }

      const evaluatee = await getQuarterlyEmployeeSnapshot(relation.evaluateeEmployeeId, transaction);
      const dueInfo = quarterlyDueAtInfo(period, { dueAt: null });
      const serverNow = parseQuarterlyDateTime(now());
      if (!serverNow) throw new AppError('QUARTERLY_INVALID_SERVER_TIME', '服务器时间暂不可用，不能创建评价任务。', 503);
      if (dueInfo.invalid) throw invalidQuarterlyDueAtError('dueAt');
      if (dueInfo.timestamp !== null && serverNow.timestamp >= dueInfo.timestamp) {
        throw new AppError('QUARTERLY_DEADLINE_PASSED', QUARTERLY_MESSAGES.deadlinePassed, 409);
      }

      const taskId = quarterlyTaskId(relation.periodKey, relation.type, linkedAccountId, relation.evaluateeEmployeeId);
      const taskReference = transaction.collection(COLLECTIONS.quarterlyTasks).doc(taskId);
      const existingTask = getDocument(await taskReference.get());
      const existingRecord = getDocument(await transaction.collection(COLLECTIONS.quarterlyRecords).doc(taskId).get());
      if (existingTask || existingRecord) {
        throw new AppError('QUARTERLY_PENDING_RELATION_CONFLICT', '该评价关系已有任务或评价记录，不能重复创建。', 409);
      }

      const nowValue = now();
      const task = {
        _id: taskId,
        taskId,
        periodKey: relation.periodKey,
        periodName: relation.periodName,
        type: relation.type,
        evaluatorAccountId: linkedAccountId,
        evaluatorAuthUidSnapshot: asTrimmedString(currentAccount.authUid),
        evaluatorNameSnapshot: studentName,
        evaluatorEmployeeIdSnapshot: null,
        evaluatorStudentIdSnapshot: studentId,
        evaluateeEmployeeId: evaluatee.employeeId,
        evaluateeNameSnapshot: evaluatee.employeeNameSnapshot,
        evaluateeDepartmentSnapshot: evaluatee.departmentSnapshot,
        evaluateeEmploymentStatusSnapshot: evaluatee.employmentStatusSnapshot,
        status: 'active',
        dueAt: null,
        sourcePendingRelationId: relationId,
        version: 1,
        createdAt: nowValue,
        updatedAt: nowValue,
        createdByAccountId: actor.accountId,
        createdByAuthUid: actor.authUid,
        updatedByAccountId: actor.accountId,
        updatedByAuthUid: actor.authUid,
      };
      await writeQuarterlyDocument(
        transaction.collection(COLLECTIONS.quarterlyTasks),
        taskId,
        task,
        '季度评价任务未能写入数据库，请刷新后重试。',
      );

      const relationAfter = {
        ...currentRelation,
        evaluatorStudentIdSnapshot: studentId,
        evaluatorStudentNameSnapshot: studentName,
        status: 'assigned',
        assignedTaskId: taskId,
        assignedAt: nowValue,
        boundByAccountId: actor.accountId,
        boundByAuthUid: actor.authUid,
        boundAt: nowValue,
        updatedAt: nowValue,
      };
      const relationWrite = await relationReference.update({
        evaluatorStudentIdSnapshot: relationAfter.evaluatorStudentIdSnapshot,
        evaluatorStudentNameSnapshot: relationAfter.evaluatorStudentNameSnapshot,
        status: relationAfter.status,
        assignedTaskId: relationAfter.assignedTaskId,
        assignedAt: relationAfter.assignedAt,
        boundByAccountId: relationAfter.boundByAccountId,
        boundByAuthUid: relationAfter.boundByAuthUid,
        boundAt: relationAfter.boundAt,
        updatedAt: relationAfter.updatedAt,
      });
      assertTransactionWriteDidNotFail(relationWrite, '来源评价关系未能更新，请刷新后重试。');

      const nextPeriodVersion = (Number.isInteger(period.version) && period.version > 0 ? period.version : 1) + 1;
      const nextRosterVersion = rosterVersion + 1;
      const periodWrite = await periodReference.update({
        version: nextPeriodVersion,
        rosterVersion: nextRosterVersion,
        updatedAt: nowValue,
        updatedByAccountId: actor.accountId,
        updatedByAuthUid: actor.authUid,
      });
      assertTransactionWriteDidNotFail(periodWrite, '季度任务名单版本未能更新，请刷新后重试。');

      await appendAudit({
        database: transaction,
        action: 'bind_quarterly_relation_student',
        targetId: taskId,
        targetName: studentName,
        targetType: 'quarterly_task',
        changed: ['评价人身份', '来源关系状态', '季度评价任务'],
        before: currentRelation,
        after: { ...relationAfter, ...task },
        result: 'success',
        detail: `管理员显式将${relation.periodKey}${quarterlyTypeLabel(relation.type)}来源关系绑定到学员档案“${studentName}”，并创建单条评价任务。`,
      });

      return {
        task: quarterlyTaskPublic(task, null, { ...period, version: nextPeriodVersion, rosterVersion: nextRosterVersion }, nowValue),
        alreadyBound: false,
      };
    });
  }

  function quarterlyEvaluationMatches(record, evaluation) {
    return JSON.stringify(normalizeStoredQuarterlyScores(record?.scores)) === JSON.stringify(evaluation.scores)
      && JSON.stringify(normalizeStoredQuarterlyReasons(record?.reasons)) === JSON.stringify(evaluation.reasons)
      && Number(record?.total) === Number(evaluation.total);
  }

  async function saveQuarterlyEvaluation(input, mode) {
    const taskId = quarterlyRecordId(input.taskId || input.id);
    const expectedVersion = normalizeQuarterlyExpectedVersion(input);
    let task = await requireQuarterlyTaskAccess(taskId, { action: mode === 'submit' ? 'submit_quarterly_review' : 'save_quarterly_draft' });
    let period = null;
    let current = null;
    let evaluation = null;
    let saved = null;
    try {
      period = await getQuarterlyPeriod(task.periodKey);
      assertQuarterlyWriteAllowed(task, period, now(), actor);
      evaluation = normalizeQuarterlyEvaluation(input, { complete: mode === 'submit' });

      await runTransaction(db, async (transaction) => {
        const periodReference = transaction.collection(COLLECTIONS.quarterlyPeriods).doc(quarterlyPeriodId(task.periodKey));
        const currentPeriod = getDocument(await periodReference.get());
        currentQuarterlyPeriodIdentity(currentPeriod, task.periodKey);
        const taskReference = transaction.collection(COLLECTIONS.quarterlyTasks).doc(taskId);
        const currentTask = getDocument(await taskReference.get());
        if (!currentTask) throw new AppError('QUARTERLY_TASK_NOT_FOUND', '未找到对应的季度评价任务。');
        const currentTaskIdentity = currentQuarterlyTaskIdentity(currentTask, taskId);
        if (currentTaskIdentity.periodKey !== asTrimmedString(currentPeriod.periodKey)) {
          throw new AppError('QUARTERLY_PERIOD_IDENTITY_CONFLICT', QUARTERLY_MESSAGES.periodIdentityConflict);
        }
        const transactionServerNow = now();
        const accountReference = transaction.collection(COLLECTIONS.adminAccounts).doc(actor.accountId);
        const currentAccount = assertQuarterlyAccountIdentity(getDocument(await accountReference.get()));
        const currentAccountWithId = { ...currentAccount, accountId: actor.accountId };
        assertQuarterlyWriteAllowed(currentTask, currentPeriod, transactionServerNow, currentAccountWithId);
        assertQuarterlySourceTaskBinding(currentTask, currentAccountWithId);
        assertQuarterlySelfBinding(currentTaskIdentity.type, currentAccount, currentTaskIdentity.evaluateeEmployeeId);
        task = { ...currentTask, _id: taskId };
        const reference = transaction.collection(COLLECTIONS.quarterlyRecords).doc(taskId);
        current = getDocument(await reference.get());
        const currentRecordStatus = asTrimmedString(current?.status);
        if (current && currentRecordStatus === 'submitted') {
          if (mode === 'submit' && quarterlyEvaluationMatches(current, evaluation)) {
            saved = { ...current, _id: taskId };
            return;
          }
          throw new AppError('QUARTERLY_RECORD_STATE', '已提交的季度评价不能再次修改；如需更正，请先由管理员退回。', 409);
        }
        if (current && currentRecordStatus === 'void') {
          throw new AppError('QUARTERLY_RECORD_STATE', '当前季度评价记录状态不允许此操作。', 409);
        }
        const currentVersion = current && Number.isInteger(current.version) && current.version > 0 ? current.version : 0;
        if (current && currentVersion !== expectedVersion) {
          throw new AppError('QUARTERLY_RECORD_VERSION_CONFLICT', '季度评价数据已被其他人修改，请刷新后重试。');
        }
        const nowValue = transactionServerNow;
        const next = {
          taskId,
          periodKey: asTrimmedString(currentTask.periodKey),
          periodName: asTrimmedString(currentTask.periodName),
          type: asTrimmedString(currentTask.type),
          evaluatorAccountId: asTrimmedString(currentTask.evaluatorAccountId),
          evaluatorAuthUidSnapshot: asTrimmedString(currentTask.evaluatorAuthUidSnapshot),
          evaluatorNameSnapshot: asTrimmedString(currentTask.evaluatorNameSnapshot),
          evaluatorEmployeeIdSnapshot: asTrimmedString(currentTask.evaluatorEmployeeIdSnapshot) || null,
          evaluateeEmployeeId: asTrimmedString(currentTask.evaluateeEmployeeId),
          evaluateeNameSnapshot: asTrimmedString(currentTask.evaluateeNameSnapshot),
          evaluateeDepartmentSnapshot: asTrimmedString(currentTask.evaluateeDepartmentSnapshot),
          scores: evaluation.scores,
          reasons: evaluation.reasons,
          total: evaluation.total,
          status: mode === 'submit' ? 'submitted' : 'draft',
          version: expectedVersion + 1,
          createdAt: current?.createdAt || nowValue,
          updatedAt: nowValue,
          createdByAccountId: current?.createdByAccountId || actor.accountId,
          createdByAuthUid: current?.createdByAuthUid || actor.authUid,
          updatedByAccountId: actor.accountId,
          updatedByAuthUid: actor.authUid,
          submittedAt: mode === 'submit' ? (current?.submittedAt || nowValue) : (current?.submittedAt || null),
          submittedByAccountId: mode === 'submit' ? actor.accountId : (current?.submittedByAccountId || null),
          submittedByAuthUid: mode === 'submit' ? actor.authUid : (current?.submittedByAuthUid || null),
          returnedReason: null,
          returnedAt: null,
          returnedByAccountId: null,
          returnedByAuthUid: null,
          managementEdited: current?.managementEdited === true,
          actualOperatorName: actor.displayName,
          lastActorSnapshot: {
            accountId: actor.accountId,
            displayName: actor.displayName,
          },
        };
        if (current) await reference.update(next);
        else await writeQuarterlyDocument(
          transaction.collection(COLLECTIONS.quarterlyRecords),
          taskId,
          next,
          '季度评价记录未能写入数据库，请刷新后重试。',
        );
        saved = { ...next, _id: taskId };
        await appendAudit({
          database: transaction,
          action: mode === 'submit' ? 'submit_quarterly_review' : 'save_quarterly_draft',
          targetId: currentTask.evaluateeEmployeeId,
          targetName: currentTask.evaluateeNameSnapshot,
          targetType: 'employee',
          changed: current ? changedFields(current, saved) : ['季度评分', '季度理由', '记录状态'],
          before: current,
          after: saved,
          result: 'success',
          detail: mode === 'submit' ? `提交${currentTask.periodKey}${quarterlyTypeLabel(currentTask.type)}。` : `保存${currentTask.periodKey}${quarterlyTypeLabel(currentTask.type)}草稿。`,
        });
      });
      return quarterlyRecordPublic(saved);
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: mode === 'submit' ? 'submit_quarterly_review' : 'save_quarterly_draft',
        targetId: task?.evaluateeEmployeeId,
        targetName: task?.evaluateeNameSnapshot,
        targetType: 'employee',
        before: current,
        detail: `${mode === 'submit' ? '提交' : '保存'}${task?.periodKey || ''}${quarterlyTypeLabel(task?.type)}失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function getMyQuarterlyTasks(input) {
    const currentAccount = await currentQuarterlyActorAccount();
    const filters = isPlainObject(input.filters) ? input.filters : input;
    const periodKey = asTrimmedString(filters.periodKey) ? normalizeQuarterlyPeriodKey(filters.periodKey) : '';
    const type = asTrimmedString(filters.type);
    if (type && type !== 'all') normalizeQuarterlyType(type);
    const statusFilter = asTrimmedString(filters.status) || 'all';
    if (statusFilter !== 'all' && statusFilter !== 'pending' && !QUARTERLY_RECORD_STATUSES.includes(statusFilter)) {
      throw new AppError('VALIDATION_ERROR', '季度任务状态筛选条件不合法。', 400, { field: 'status' });
    }
    const tasks = await quarterlyTasksForAccount(currentAccount);
    const records = await listQuarterlyRows(COLLECTIONS.quarterlyRecords);
    const periods = await listQuarterlyRows(COLLECTIONS.quarterlyPeriods);
    const recordsByTask = new Map(records.map((record) => [getRecordId(record) || asTrimmedString(record.taskId), record]));
    const periodsByKey = new Map(periods.map((period) => [asTrimmedString(period.periodKey), period]));
    const filtered = tasks.filter((task) => {
      if (periodKey && asTrimmedString(task.periodKey) !== periodKey) return false;
      if (type && type !== 'all' && asTrimmedString(task.type) !== type) return false;
      const record = recordsByTask.get(getRecordId(task) || asTrimmedString(task.taskId));
      if (statusFilter === 'pending') return !record || ['draft', 'returned'].includes(asTrimmedString(record.status));
      if (statusFilter !== 'all' && asTrimmedString(record?.status) !== statusFilter) return false;
      return true;
    });
    const { page, pageSize } = parsePage(filters);
    const offset = (page - 1) * pageSize;
    const serverNow = now();
    return {
      items: filtered.slice(offset, offset + pageSize).map((task) => quarterlyTaskPublic(
        task,
        recordsByTask.get(getRecordId(task) || asTrimmedString(task.taskId)),
        periodsByKey.get(asTrimmedString(task.periodKey)) || null,
        serverNow,
      )),
      total: filtered.length,
      page,
      pageSize,
    };
  }

  async function getQuarterlyTaskDetail(input) {
    const task = await requireQuarterlyTaskAccess(input.taskId || input.id, {
      management: quarterlyManagementAllowed(),
      action: 'view_quarterly_task',
    });
    const record = await getQuarterlyRecord(getRecordId(task) || task.taskId);
    const period = await findQuarterlyPeriod(task.periodKey);
    return quarterlyTaskPublic(task, record, period, now());
  }

  async function getQuarterlyDraft(input) {
    const task = await requireQuarterlyTaskAccess(input.taskId || input.id, {
      management: quarterlyManagementAllowed(),
      action: 'view_quarterly_draft',
    });
    const record = await getQuarterlyRecord(getRecordId(task) || task.taskId);
    const period = await findQuarterlyPeriod(task.periodKey);
    return {
      task: quarterlyTaskPublic(task, record, period, now()),
      record: record ? quarterlyRecordPublic(record, { management: quarterlyManagementAllowed() }) : null,
    };
  }

  async function getMyQuarterlyResults(input) {
    const currentAccount = await currentQuarterlyActorAccount();
    const periodFilter = asTrimmedString(input.periodKey) ? normalizeQuarterlyPeriodKey(input.periodKey) : '';
    const ownTasks = await quarterlyTasksForAccount(currentAccount);
    const records = await listQuarterlyRows(COLLECTIONS.quarterlyRecords);
    const recordsByTask = new Map(records.map((record) => [getRecordId(record) || asTrimmedString(record.taskId), record]));
    const periods = await listQuarterlyRows(COLLECTIONS.quarterlyPeriods);
    const periodsByKey = new Map(periods.map((period) => [asTrimmedString(period.periodKey), period]));
    const items = [];
    for (const task of ownTasks) {
      const record = recordsByTask.get(getRecordId(task) || asTrimmedString(task.taskId));
      if (!record || asTrimmedString(record.status) !== 'submitted'
        || asTrimmedString(record.evaluatorAccountId) !== asTrimmedString(currentAccount.accountId)
        || (periodFilter && asTrimmedString(record.periodKey) !== periodFilter)) continue;
      items.push(quarterlyResultItem(record, periodsByKey.get(asTrimmedString(record.periodKey)), 'submitted'));
    }
    items.sort((left, right) => `${right.periodKey}-${right.type}-${right.direction}`.localeCompare(`${left.periodKey}-${left.type}-${left.direction}`));
    return { items, total: items.length };
  }

  async function getQuarterlyOverview(input) {
    requirePermission(actor, 'quarterly.manage');
    const requestedPeriodKey = asTrimmedString(input.periodKey) ? normalizeQuarterlyPeriodKey(input.periodKey) : '';
    const periods = (await listQuarterlyRows(COLLECTIONS.quarterlyPeriods))
      .sort((left, right) => asTrimmedString(right.periodKey).localeCompare(asTrimmedString(left.periodKey)));
    const selected = requestedPeriodKey
      ? periods.find((period) => asTrimmedString(period.periodKey) === requestedPeriodKey)
      : periods[0];
    const periodKey = requestedPeriodKey || asTrimmedString(selected?.periodKey);
    const serverNow = now();
    const tasks = (await listQuarterlyRows(COLLECTIONS.quarterlyTasks)).filter((task) => !periodKey || asTrimmedString(task.periodKey) === periodKey);
    const records = (await listQuarterlyRows(COLLECTIONS.quarterlyRecords)).filter((record) => !periodKey || asTrimmedString(record.periodKey) === periodKey);
    const pendingRelations = (await listQuarterlyRowsWithPagination(
      COLLECTIONS.quarterlyPendingRelations,
      {
        _id: true, sourceRelationId: true, periodKey: true, periodName: true, type: true,
        status: true, evaluatorNameSnapshot: true, evaluatorEmployeeIdSnapshot: true,
        evaluatorStudentIdSnapshot: true, evaluatorStudentNameSnapshot: true,
        evaluateeEmployeeId: true, evaluateeNameSnapshot: true, evaluateeDepartmentSnapshot: true,
      },
      db,
      periodKey ? { status: 'pending_binding', periodKey } : { status: 'pending_binding' },
      '读取待处理评价关系失败。',
    )).map((relation) => quarterlyPendingRelationPublic(relation));
    const recordsByTask = new Map();
    for (const record of records) {
      const recordId = getRecordId(record);
      const taskId = asTrimmedString(record.taskId);
      if (recordId) recordsByTask.set(recordId, record);
      if (taskId) recordsByTask.set(taskId, record);
    }
    const activeTasks = tasks.filter((task) => asTrimmedString(task.status) !== 'revoked');
    const byType = QUARTERLY_REVIEW_TYPES.reduce((result, type) => {
      const typeTasks = activeTasks.filter((task) => asTrimmedString(task.type) === type);
      const submitted = typeTasks.filter((task) => asTrimmedString(recordsByTask.get(getRecordId(task) || asTrimmedString(task.taskId))?.status) === 'submitted').length;
      result[type] = { total: typeTasks.length, submitted, pending: typeTasks.length - submitted };
      return result;
    }, {});
    const submittedTaskCount = activeTasks.filter((task) => asTrimmedString(recordsByTask.get(getRecordId(task) || asTrimmedString(task.taskId))?.status) === 'submitted').length;
    const draftTaskCount = activeTasks.filter((task) => ['draft', undefined].includes(recordsByTask.get(getRecordId(task) || asTrimmedString(task.taskId))?.status)).length;
    const returnedTaskCount = activeTasks.filter((task) => asTrimmedString(recordsByTask.get(getRecordId(task) || asTrimmedString(task.taskId))?.status) === 'returned').length;
    const periodsByKey = new Map(periods.map((period) => [asTrimmedString(period.periodKey), period]));
    return {
      period: selected ? quarterlyPeriodPublic(selected, { taskCount: activeTasks.length, submittedTaskCount }, serverNow) : null,
      periods: periods.map((period) => quarterlyPeriodPublic(period, {}, serverNow)),
      taskCount: activeTasks.length,
      submittedTaskCount,
      draftTaskCount,
      returnedTaskCount,
      revokedTaskCount: tasks.length - activeTasks.length,
      completionRate: activeTasks.length ? submittedTaskCount / activeTasks.length : null,
      byType,
      tasks: tasks.map((task) => quarterlyTaskPublic(
        task,
        recordsByTask.get(getRecordId(task) || asTrimmedString(task.taskId)),
        periodsByKey.get(asTrimmedString(task.periodKey)) || null,
        serverNow,
      )),
      pendingRelations,
      records: records.map((record) => quarterlyRecordPublic(record, { management: true })),
    };
  }

  async function listQuarterlyRecords(input) {
    requirePermission(actor, 'quarterly.manage');
    const filters = isPlainObject(input.filters) ? input.filters : input;
    const periodKey = asTrimmedString(filters.periodKey) ? normalizeQuarterlyPeriodKey(filters.periodKey) : '';
    const type = asTrimmedString(filters.type);
    if (type && type !== 'all') normalizeQuarterlyType(type);
    const status = asTrimmedString(filters.status);
    if (status && status !== 'all') normalizeQuarterlyRecordStatus(status);
    const keyword = asTrimmedString(filters.keyword || filters.search).toLowerCase();
    const rows = await listQuarterlyRowsWithPagination(
      COLLECTIONS.quarterlyRecords,
      {
        _id: true,
        taskId: true,
        periodKey: true,
        periodName: true,
        type: true,
        evaluatorAccountId: true,
        evaluatorNameSnapshot: true,
        evaluateeEmployeeId: true,
        evaluateeNameSnapshot: true,
        evaluateeDepartmentSnapshot: true,
        scores: true,
        reasons: true,
        total: true,
        status: true,
        version: true,
        updatedAt: true,
        submittedAt: true,
        returnedReason: true,
        managementEdited: true,
        actualOperatorName: true,
      },
      db,
      periodKey ? { periodKey } : null,
      '读取季度评价记录失败。',
    );
    const filtered = rows.filter((record) => {
      if (periodKey && asTrimmedString(record.periodKey) !== periodKey) return false;
      if (type && type !== 'all' && asTrimmedString(record.type) !== type) return false;
      if (status && status !== 'all' && asTrimmedString(record.status) !== status) return false;
      if (keyword && !`${record.evaluatorNameSnapshot || ''} ${record.evaluateeNameSnapshot || ''} ${record.evaluateeDepartmentSnapshot || ''}`.toLowerCase().includes(keyword)) return false;
      return true;
    }).sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
    const { page, pageSize } = parsePage(filters);
    const offset = (page - 1) * pageSize;
    return {
      items: filtered.slice(offset, offset + pageSize).map((record) => quarterlyRecordPublic(record, { management: true })),
      total: filtered.length,
      page,
      pageSize,
    };
  }

  async function manageQuarterlyRecord(input, mode) {
    requirePermission(actor, 'quarterly.manage');
    const recordId = quarterlyRecordId(input.recordId || input.taskId || input.id);
    const expectedVersion = normalizeQuarterlyExpectedVersion(input);
    const reason = validateTextField(input.reason, '管理操作原因', { required: true, maxLength: 2000 });
    let current = null;
    let saved = null;
    try {
      current = await getQuarterlyRecord(recordId);
      if (!current) throw new AppError('QUARTERLY_RECORD_NOT_FOUND', '未找到对应的季度评价记录。');
      if (asTrimmedString(current.status) === 'void' && mode === 'return') {
        throw new AppError('QUARTERLY_RECORD_STATE', '已作废的季度评价记录不能退回。');
      }
      await runTransaction(db, async (transaction) => {
        const reference = transaction.collection(COLLECTIONS.quarterlyRecords).doc(recordId);
        const transactionCurrent = getDocument(await reference.get());
        if (!transactionCurrent) throw new AppError('QUARTERLY_RECORD_NOT_FOUND', '未找到对应的季度评价记录。');
        const currentVersion = Number.isInteger(transactionCurrent.version) && transactionCurrent.version > 0 ? transactionCurrent.version : 1;
        if (currentVersion !== expectedVersion) throw new AppError('QUARTERLY_RECORD_VERSION_CONFLICT', '季度评价数据已被其他人修改，请刷新后重试。');
        if (mode === 'return' && asTrimmedString(transactionCurrent.status) === 'void') {
          throw new AppError('QUARTERLY_RECORD_STATE', '已作废的季度评价记录不能退回。');
        }
        const nowValue = now();
        const data = {
          status: mode === 'return' ? 'returned' : 'void',
          version: currentVersion + 1,
          updatedAt: nowValue,
          updatedByAccountId: actor.accountId,
          updatedByAuthUid: actor.authUid,
          managementEdited: true,
          actualOperatorName: actor.displayName,
          lastActorSnapshot: { accountId: actor.accountId, displayName: actor.displayName },
        };
        if (mode === 'return') {
          data.returnedReason = reason;
          data.returnedAt = nowValue;
          data.returnedByAccountId = actor.accountId;
          data.returnedByAuthUid = actor.authUid;
        } else {
          data.voidReason = reason;
          data.voidAt = nowValue;
          data.voidByAccountId = actor.accountId;
          data.voidByAuthUid = actor.authUid;
        }
        await reference.update(data);
        saved = { ...transactionCurrent, ...data, _id: recordId };
        await appendAudit({
          database: transaction,
          action: mode === 'return' ? 'return_quarterly_review' : 'void_quarterly_review',
          targetId: asTrimmedString(transactionCurrent.evaluateeEmployeeId),
          targetName: asTrimmedString(transactionCurrent.evaluateeNameSnapshot),
          targetType: 'employee',
          changed: ['status', 'version', mode === 'return' ? 'returnedReason' : 'voidReason', 'actualOperatorName'],
          before: transactionCurrent,
          after: saved,
          result: 'success',
          detail: `${mode === 'return' ? '退回' : '作废'}${asTrimmedString(transactionCurrent.periodKey)}${quarterlyTypeLabel(transactionCurrent.type)}，原因：${reason}。`,
          originalEvaluatorAccountId: asTrimmedString(transactionCurrent.evaluatorAccountId),
          originalEvaluatorNameSnapshot: asTrimmedString(transactionCurrent.evaluatorNameSnapshot),
          actualOperatorNameSnapshot: actor.displayName,
          reason,
        });
      });
      return quarterlyRecordPublic(saved, { management: true });
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: mode === 'return' ? 'return_quarterly_review' : 'void_quarterly_review',
        targetId: asTrimmedString(current?.evaluateeEmployeeId),
        targetName: asTrimmedString(current?.evaluateeNameSnapshot),
        targetType: 'employee',
        before: current,
        detail: `${mode === 'return' ? '退回' : '作废'}季度评价失败：${appError.code}。`,
        originalEvaluatorAccountId: asTrimmedString(current?.evaluatorAccountId),
        originalEvaluatorNameSnapshot: asTrimmedString(current?.evaluatorNameSnapshot),
        actualOperatorNameSnapshot: actor.displayName,
        reason,
      });
      throw appError;
    }
  }

  async function bindAccountEmployee(input) {
    const allowedFields = new Set(['accountId', 'employeeId', 'id', 'operationId', 'expectedGovernanceRevision']);
    if (Object.keys(input).some((key) => !allowedFields.has(key))) {
      throw new AppError('VALIDATION_ERROR', '员工身份绑定请求包含不支持的字段。', 400);
    }
    const accountId = validateTextField(input.accountId, '账号编号', { required: true, maxLength: 160 });
    const hasEmployeeId = hasOwn(input, 'employeeId');
    const rawEmployeeId = hasEmployeeId ? input.employeeId : input.id;
    const unbind = hasEmployeeId && (rawEmployeeId === null || asTrimmedString(rawEmployeeId) === '');
    const employeeId = unbind ? '' : getEmployeeId(input);
    let preflightTarget = null;
    let preflightNewEmployeeAccounts = [];
    let preflightOldEmployeeAccounts = [];

    return executeGovernanceMutation({
      route: 'accounts/bind-employee',
      input,
      targetAccountIds: [accountId],
      action: 'bind_account_employee',
      prepare: async () => {
        preflightTarget = await findAccountById(db, accountId);
        if (asTrimmedString(preflightTarget.status) === 'disabled') {
          throw new AppError('ACCOUNT_INACTIVE', '停用账号不能绑定员工身份。');
        }
        if (isStudentAccount(preflightTarget)) {
          throw new AppError('STUDENT_ACCOUNT_EMPLOYEE_BIND_FORBIDDEN', '学员账号不能绑定员工身份。', 409);
        }
        const preflightEmployeeId = asTrimmedString(preflightTarget.employeeId);
        [preflightNewEmployeeAccounts, preflightOldEmployeeAccounts] = await Promise.all([
          unbind ? Promise.resolve([]) : listAccountsByEmployeeId(db, employeeId, 2),
          preflightEmployeeId ? listAccountsByEmployeeId(db, preflightEmployeeId, 2) : Promise.resolve([]),
        ]);
        return { target: preflightTarget };
      },
      buildPlan: async ({ transaction, actor: currentActor, targets, operationTime, prepared }) => {
        const current = targets.get(accountId);
        if (asTrimmedString(current.status) === 'disabled') {
          throw new AppError('ACCOUNT_INACTIVE', '停用账号不能绑定员工身份。');
        }
        if (isStudentAccount(current)) {
          throw new AppError('STUDENT_ACCOUNT_EMPLOYEE_BIND_FORBIDDEN', '学员账号不能绑定员工身份。', 409);
        }
        const currentEmployeeId = asTrimmedString(current.employeeId);
        if (currentEmployeeId !== asTrimmedString(prepared.target.employeeId)) {
          throw new AppError('QUARTERLY_BINDING_CONFLICT', '账号员工身份已被其他操作修改，请刷新后重试。', 409);
        }
        if (unbind && !currentEmployeeId && !asTrimmedString(current.employeeNameSnapshot)) {
          return { accountWrites: [], audits: [], result: accountSummary(current) };
        }

        let employeeSnapshot = null;
        if (!unbind) employeeSnapshot = await registrationEmployeeSnapshot(transaction, employeeId);
        if (!unbind && currentEmployeeId === employeeSnapshot.employeeId) {
          const currentClaim = getDocument(await transaction.collection(COLLECTIONS.identityClaims)
            .doc(identityClaimDocumentId(employeeSnapshot.employeeId)).get());
          if (currentClaim && asTrimmedString(currentClaim.status) === 'linked'
            && asTrimmedString(currentClaim.accountId) === accountId) {
            return { accountWrites: [], audits: [], result: accountSummary(current) };
          }
        }

        const nowValue = operationTime;
        let oldClaim = null;
        let oldClaimReference = null;
        if (currentEmployeeId && (unbind || currentEmployeeId !== employeeSnapshot?.employeeId)) {
          oldClaimReference = transaction.collection(COLLECTIONS.identityClaims)
            .doc(identityClaimDocumentId(currentEmployeeId));
          oldClaim = getDocument(await oldClaimReference.get());
          if (oldClaim && ['invited', 'creating', 'recovery_required'].includes(asTrimmedString(oldClaim.status))) {
            throw new AppError('QUARTERLY_BINDING_CONFLICT', '该员工身份正在进行其他账号绑定处理，请先核对身份占位。', 409);
          }
        }

        let newClaimReference = null;
        let newClaim = null;
        if (!unbind) {
          newClaimReference = transaction.collection(COLLECTIONS.identityClaims)
            .doc(identityClaimDocumentId(employeeSnapshot.employeeId));
          newClaim = getDocument(await newClaimReference.get());
          if (newClaim && asTrimmedString(newClaim.status) === 'linked'
            && asTrimmedString(newClaim.accountId) === accountId
            && currentEmployeeId === employeeSnapshot.employeeId) {
            return { accountWrites: [], audits: [], result: accountSummary(current) };
          }
          if (newClaim && asTrimmedString(newClaim.status) !== 'unclaimed') {
            throw new AppError('QUARTERLY_BINDING_CONFLICT', '该员工身份已被其他账号或注册流程占用。', 409);
          }
          const duplicateRows = preflightNewEmployeeAccounts.filter((row) => getRecordId(row) !== accountId);
          if (duplicateRows.some((row) => asTrimmedString(row.employeeId) === employeeSnapshot.employeeId)) {
            throw new AppError('QUARTERLY_BINDING_CONFLICT', '该员工已关联其他账号。', 409);
          }
        }

        const nextIdentityVersion = (Number.isInteger(current.identityVersion) && current.identityVersion > 0 ? current.identityVersion : 0) + 1;
        const next = unbind
          ? {
            employeeId: '',
            employeeNameSnapshot: '',
            identityVersion: nextIdentityVersion,
            updatedAt: nowValue,
            updatedByAccountId: currentActor.accountId,
            updatedByAuthUid: currentActor.authUid,
          }
          : {
            employeeId: employeeSnapshot.employeeId,
            employeeNameSnapshot: employeeSnapshot.employeeName,
            identityVersion: nextIdentityVersion,
            updatedAt: nowValue,
            updatedByAccountId: currentActor.accountId,
            updatedByAuthUid: currentActor.authUid,
          };
        const updatedAccount = { ...current, ...next, _id: accountId };
        const audits = [{
          suffix: 'target',
          action: unbind ? 'unbind_account_employee' : 'bind_account_employee',
          targetId: accountId,
          targetName: asTrimmedString(current.displayName),
          changed: ['employeeId', 'employeeNameSnapshot', 'identityVersion'],
          before: accountAuditSnapshot(current),
          after: accountAuditSnapshot(updatedAccount),
          detail: unbind
            ? `账号“${asTrimmedString(current.username)}”已解除员工身份绑定。`
            : `账号“${asTrimmedString(current.username)}”已绑定员工“${employeeSnapshot.employeeName}”。`,
        }];
        return {
          accountWrites: [{ accountId, before: current, after: updatedAccount, patch: next }],
          audits,
          result: accountSummary(updatedAccount),
          writeAdditional: async () => {
            if (oldClaimReference) {
              const remainingAccount = preflightOldEmployeeAccounts.find((row) => getRecordId(row) !== accountId
                && asTrimmedString(row.employeeId) === currentEmployeeId);
              const claimIsOwned = !oldClaim || asTrimmedString(oldClaim.status) === 'unclaimed'
                || (asTrimmedString(oldClaim.status) === 'linked' && asTrimmedString(oldClaim.accountId) === accountId);
              if (claimIsOwned) {
                const oldClaimData = {
                  employeeId: currentEmployeeId,
                  employeeNameSnapshot: asTrimmedString(oldClaim && oldClaim.employeeNameSnapshot) || asTrimmedString(current.employeeNameSnapshot),
                  status: remainingAccount ? 'linked' : 'unclaimed',
                  accountId: remainingAccount ? getRecordId(remainingAccount) : '',
                  authUid: remainingAccount ? asTrimmedString(remainingAccount.authUid) : '',
                  invitationId: '',
                  invitationDocumentId: '',
                  registrationAttemptId: '',
                  updatedAt: nowValue,
                };
                const result = oldClaim
                  ? await oldClaimReference.update(oldClaimData)
                  : await oldClaimReference.set({ ...oldClaimData, createdAt: nowValue });
                assertTransactionWriteDidNotFail(result, '原员工身份占用状态未能与账号绑定一同提交。');
              }
            }
            if (!unbind) {
              const newClaimData = {
                employeeId: employeeSnapshot.employeeId,
                employeeNameSnapshot: employeeSnapshot.employeeName,
                status: 'linked',
                accountId,
                authUid: asTrimmedString(current.authUid),
                invitationId: '',
                invitationDocumentId: '',
                registrationAttemptId: '',
                linkedAt: nowValue,
                updatedAt: nowValue,
              };
              const result = newClaim
                ? await newClaimReference.update(newClaimData)
                : await newClaimReference.set({ ...newClaimData, createdAt: nowValue });
              assertTransactionWriteDidNotFail(result, '新员工身份占用状态未能与账号绑定一同提交。');
            }
          },
        };
      },
    });
  }
  async function getQuarterlyHistory(input) {
    const management = quarterlyManagementAllowed();
    const currentAccount = management ? null : await currentQuarterlyActorAccount();
    const requestedEmployeeId = asTrimmedString(input.employeeId);
    const boundEmployeeId = management ? asTrimmedString(actor.employeeId) : asTrimmedString(currentAccount.employeeId);
    const employeeId = requestedEmployeeId || boundEmployeeId;
    if (!employeeId) {
      throw new AppError('PERMISSION_DENIED', '当前账号未绑定员工身份，不能读取季度履历。', 403);
    }
    if (!management && employeeId !== boundEmployeeId) {
      await appendFailureAudit({ action: 'view_quarterly_history', targetId: employeeId, targetType: 'employee', detail: '拒绝读取其他员工的季度履历。' });
      throw new AppError('PERMISSION_DENIED', '当前账号不能读取其他员工的季度履历。', 403);
    }
    const periodFilter = asTrimmedString(input.periodKey) ? normalizeQuarterlyPeriodKey(input.periodKey) : '';
    const records = await listQuarterlyRows(COLLECTIONS.quarterlyRecords);
    const periods = await listQuarterlyRows(COLLECTIONS.quarterlyPeriods);
    const periodsByKey = new Map(periods.map((period) => [asTrimmedString(period.periodKey), period]));
    const items = records
      .filter((record) => asTrimmedString(record.evaluateeEmployeeId) === employeeId)
      .filter((record) => !periodFilter || asTrimmedString(record.periodKey) === periodFilter)
      .filter((record) => asTrimmedString(record.status) === 'submitted')
      .filter((record) => management || asTrimmedString(record.evaluatorAccountId) === asTrimmedString(currentAccount.accountId))
      .map((record) => {
        const period = periodsByKey.get(asTrimmedString(record.periodKey));
        if (management) return quarterlyRecordPublic(record, { management: true });
        return quarterlyResultItem(record, period, 'submitted');
      });
    return { items, total: items.length };
  }

  async function createEmployee(input) {
    let payload;
    let targetName = asTrimmedString(input.name);
    try {
      const scanRevision = await phoneGuardRevision();
      payload = normalizeEmployeeInput(input);
      targetName = asTrimmedString(payload.name);
      const nowValue = now();
      const data = {
        ...payload,
        ...(hasOwn(payload, 'contract') ? { contract: employeeContractForWrite(payload.contract) } : {}),
        ...(hasOwn(payload, 'vehicle') ? { vehicle: employeeVehicleForCreate(payload.vehicle) } : {}),
        recordType: RECORD_TYPES.employee,
        version: 1,
        status: payload.status || 'active',
        sourceSheet: null,
        sourceRow: null,
        sourceSequence: null,
        createdAt: nowValue,
        updatedAt: nowValue,
        createdByAuthUid: actor.authUid,
        updatedByAuthUid: actor.authUid,
      };
      await assertEmployeePhoneAvailable(data.personalPhone);
      let employee;
      await runTransaction(db, async (transaction) => {
        await advancePhoneGuard(transaction, scanRevision);
        const addResult = await transaction.collection(COLLECTIONS.employees).add(data);
        const employeeId = getDocumentId(addResult);
        if (!employeeId) {
        throw new AppError('DATABASE_WRITE_FAILED', '员工新增未返回档案编号。');
        }
        employee = { ...data, _id: employeeId };
        await appendAudit({
        database: transaction,
        action: 'create_employee',
        targetId: employeeId,
        targetName,
        changed: Object.keys(payload),
        after: employee,
        result: 'success',
        detail: '网页新增员工档案。',
      });
      });
      return employeePublicRecord(employee);
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: 'create_employee',
        targetName,
        changed: Object.keys(payload || {}),
        detail: `网页新增员工档案失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function updateEmployee(input) {
    const employeeId = getEmployeeId(input);
    const expectedVersion = expectedVersionOf(input);
    let current = null;
    let payload = {};
    try {
      const scanRevision = await phoneGuardRevision();
      payload = normalizeEmployeeInput(input, { partial: true });
      if (Object.keys(payload).length === 0) {
        throw new AppError('VALIDATION_ERROR', '没有可保存的员工字段。');
      }
      current = await getEmployee(employeeId);
      if (employeeVersion(current) !== expectedVersion) throw conflictError();
      validateEmployeeEmploymentDates(payload, current);
      const nextStatus = hasOwn(payload, 'status') ? payload.status : asTrimmedString(current.status);
      const nextPersonalPhone = hasOwn(payload, 'personalPhone') ? payload.personalPhone : current.personalPhone;
      if (hasOwn(payload, 'personalPhone') || nextStatus === 'active') {
        await assertEmployeePhoneAvailable(nextPersonalPhone, employeeId);
      }
      let updated;
      await runTransaction(db, async (transaction) => {
        await advancePhoneGuard(transaction, scanRevision);
        const result = await transaction.collection(COLLECTIONS.employees).doc(employeeId).get();
        current = getDocument(result);
        if (!isEmployeeRecord(current)) throw new AppError('EMPLOYEE_NOT_FOUND', '未找到对应的员工档案。');
        if (employeeVersion(current) !== expectedVersion) throw conflictError();
        validateEmployeeEmploymentDates(payload, current);
        const data = {
          ...payload,
          ...(hasOwn(payload, 'contract') ? { contract: employeeContractForWrite(payload.contract, current) } : {}),
          ...(hasOwn(payload, 'vehicle') ? { vehicle: employeeVehicleForWrite(payload.vehicle, current, employeeId) } : {}),
          version: expectedVersion + 1,
          updatedAt: now(),
          updatedByAuthUid: actor.authUid,
        };
        await transaction.collection(COLLECTIONS.employees).doc(employeeId).update(data);
        updated = { ...current, ...data, version: expectedVersion + 1, _id: employeeId };
        await appendAudit({
        database: transaction,
        action: 'update_employee',
        targetId: employeeId,
        targetName: asTrimmedString(updated.name || current.name),
        changed: changedFields(current, updated),
        before: current,
        after: updated,
        result: 'success',
        detail: '网页编辑员工档案。',
      });
      });
      return employeePublicRecord(updated);
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: 'update_employee',
        targetId: employeeId,
        targetName: asTrimmedString(current && current.name),
        changed: Object.keys(payload),
        before: current,
        detail: `网页编辑员工档案失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function archiveEmployee(input) {
    const employeeId = getEmployeeId(input);
    let current = null;
    try {
      const scanRevision = await phoneGuardRevision();
      current = await getEmployee(employeeId);
      const data = {
        status: 'archived',
        archivedAt: now(),
        archivedByAuthUid: actor.authUid,
        updatedAt: now(),
        updatedByAuthUid: actor.authUid,
      };
      let archived;
      await runTransaction(db, async (transaction) => {
        await advancePhoneGuard(transaction, scanRevision);
        await transaction.collection(COLLECTIONS.employees).doc(employeeId).update(data);
        archived = { ...current, ...data, _id: employeeId };
        await appendAudit({
        database: transaction,
        action: 'archive_employee',
        targetId: employeeId,
        targetName: asTrimmedString(current.name),
        changed: ['status'],
        before: current,
        after: archived,
        result: 'success',
        detail: '网页归档员工档案。',
      });
      });
      return employeePublicRecord(archived);
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: 'archive_employee',
        targetId: employeeId,
        targetName: asTrimmedString(current && current.name),
        before: current,
        detail: `网页归档员工档案失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function createCourse(input) {
    const employeeId = getEmployeeId(input);
    const expectedVersion = expectedVersionOf(input);
    let current = null;
    let normalized = null;
    let previousCourseRecords = [];
    let documentUpdated = false;

    try {
      normalized = normalizeCourseFields(input);

      const courseRecord = {
        id: `course-${createRequestId()}`,
        courseName: normalized.courseName,
        status: normalized.status,
        attendedDate: normalized.attendedDate,
        note: normalized.note,
        createdAt: now(),
        createdByAuthUid: actor.authUid,
      };
      let courseRecords;
      let nextVersion;

      // Keep the employee update narrow: this route only appends to the
      // existing courseRecords array and never overwrites other fields.
      await runTransaction(db, async (transaction) => {
        const result = await transaction.collection(COLLECTIONS.employees).doc(employeeId).get();
        current = getDocument(result);
        if (!isEmployeeRecord(current)) throw new AppError('EMPLOYEE_NOT_FOUND', '未找到对应的员工档案。');
        if (employeeVersion(current) !== expectedVersion) throw conflictError();
        previousCourseRecords = Array.isArray(current.courseRecords) ? current.courseRecords : [];
        courseRecords = [...previousCourseRecords, courseRecord];
        nextVersion = expectedVersion + 1;
        await transaction.collection(COLLECTIONS.employees).doc(employeeId).update({ courseRecords, version: nextVersion });
      });
      documentUpdated = true;

      try {
        await appendAudit({
          action: 'add_course',
          targetId: employeeId,
          targetName: asTrimmedString(current.name),
          changed: ['courseRecords'],
          result: 'success',
          detail: `新增课程记录“${normalized.courseName}”。`,
        });
      } catch (auditError) {
        // Keep the course record and its append-only audit entry atomic from
        // the caller's perspective. If the success audit cannot be written,
        // restore the original courseRecords array before returning failure.
        try {
          await runTransaction(db, async (transaction) => {
            const result = await transaction.collection(COLLECTIONS.employees).doc(employeeId).get();
            const latest = getDocument(result);
            if (latest && employeeVersion(latest) === nextVersion) {
              await transaction.collection(COLLECTIONS.employees).doc(employeeId).update({ courseRecords: previousCourseRecords, version: expectedVersion });
            }
          });
          documentUpdated = false;
        } catch (rollbackError) {
          console.error('[employeeArchiveApi] course rollback failed', {
            requestId,
            code: safeErrorCode(rollbackError),
          });
        }
        throw auditError;
      }

      return employeePublicRecord({
        ...current,
        courseRecords, version: nextVersion,
        _id: getRecordId(current) || employeeId,
      });
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: 'add_course',
        targetId: employeeId,
        targetName: asTrimmedString(current && current.name),
        changed: documentUpdated ? ['courseRecords'] : [],
        detail: normalized?.courseName
          ? `新增课程记录“${normalized.courseName}”失败：${appError.code}。`
          : `新增课程记录失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function createEvent(input) {
    let employeeId = '';
    let normalized = null;
    try {
      employeeId = getEmployeeId(input);
      const expectedVersion = expectedVersionOf(input);
      normalized = normalizeEventFields(input);
      const attachmentInput = normalizeEventAttachment(input.attachment, employeeId, storageAuthority);
      if (attachmentInput) {
        if (!hasPermission(actor, 'attachment.write')) throw new AppError('PERMISSION_DENIED', '当前账号没有附件上传权限。');
        await resolveStorageTempUrl(storage, attachmentInput.storageKey, '事件图片暂不可用，请稍后重试。');
      }
      const createdAt = now();
      const eventId = `event-${createRequestId()}`;
      const attachment = attachmentInput ? {
        id: `attachment-${createRequestId()}`,
        ...attachmentInput,
        visibility: 'sensitive',
        uploadedByAuthUid: actor.authUid,
        uploadedAt: createdAt,
        sourceRef: eventId,
      } : null;
      const event = { id: eventId, ...normalized, attachments: attachment ? [attachment] : [], createdAt, createdByAuthUid: actor.authUid };
      const employee = await runImageRegistrationTransaction(db, async (transaction, markWrite) => {
        const current = getDocument(await transaction.collection(COLLECTIONS.employees).doc(employeeId).get());
        if (!isEmployeeRecord(current)) throw new AppError('EMPLOYEE_NOT_FOUND', '未找到对应的员工档案。');
        const previousEvents = Array.isArray(current.events) ? current.events : [];
        if (attachmentInput) {
          const existing = previousEvents.filter(item => Array.isArray(item.attachments)
            && item.attachments.some(image => image.storageKey === attachmentInput.storageKey));
          if (existing.length) {
            const original = existing[0];
            const image = original.attachments.find(item => item.storageKey === attachmentInput.storageKey);
            if (existing.length !== 1 || !sameImageMetadata(image, attachmentInput, actor.authUid)
              || Object.keys(normalized).some(key => asTrimmedString(original[key]) !== normalized[key])) {
              throw new AppError('ATTACHMENT_ALREADY_REGISTERED', '这张图片已登记，不能用于不同的事件内容。', 409);
            }
            // The original transaction also committed its audit. Stale versions
            // must not prevent recovery of that already committed operation.
            return current;
          }
        }
        if (employeeVersion(current) !== expectedVersion) throw conflictError();
        const events = [...previousEvents, event];
        const nextVersion = expectedVersion + 1;
        markWrite();
        const written = await transaction.collection(COLLECTIONS.employees).doc(employeeId).update({ events, version: nextVersion });
        assertTransactionWriteDidNotFail(written, '事件记录未能写入。');
        const audit = await appendAudit({
          database: transaction,
          action: 'add_event', targetId: employeeId, targetName: asTrimmedString(current.name), changed: ['events'],
          result: 'success',
          detail: attachment ? `新增特殊事件“${normalized.summary}”；图片：“${attachment.fileName}”。`
            : `新增特殊事件“${normalized.summary}”；未添加图片。`,
        });
        if (!getRecordId(audit)) throw new AppError('AUDIT_WRITE_FAILED', '事件审计未能写入。');
        return { ...current, events, version: nextVersion };
      });
      return employeePublicRecord(employee);
    } catch (error) {
      const appError = toAppError(error);
      appError.details = { ...(appError.details || {}), submissionOutcome: appError.details?.submissionOutcome || 'not_committed' };
      await appendFailureAudit({
        action: 'add_event', targetId: employeeId, changed: [],
        detail: `新增特殊事件记录未确认成功：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function uploadAttachment(input) {
    let employeeId = '';
    let normalized = null;
    try {
      employeeId = getEmployeeId(input);
      const expectedVersion = expectedVersionOf(input);
      const attachmentValue = isPlainObject(input.attachment) ? input.attachment : input;
      normalized = normalizeGeneralAttachment(attachmentValue, employeeId, storageAuthority);
      if (!normalized) throw new AppError('VALIDATION_ERROR', '请选择要上传的员工附件图片。', 400, { field: 'attachment' });
      await resolveStorageTempUrl(storage, normalized.storageKey, '上传的员工附件暂不可用，请重新选择后重试。');
      const attachment = {
        id: `attachment-${createRequestId()}`, ...normalized, visibility: 'normal',
        uploadedByAuthUid: actor.authUid, uploadedAt: now(), sourceRef: 'employee-attachment',
      };
      const employee = await runImageRegistrationTransaction(db, async (transaction, markWrite) => {
        const current = getDocument(await transaction.collection(COLLECTIONS.employees).doc(employeeId).get());
        if (!isEmployeeRecord(current)) throw new AppError('EMPLOYEE_NOT_FOUND', '未找到对应的员工档案。');
        const previousAttachments = Array.isArray(current.attachments) ? current.attachments : [];
        const existing = previousAttachments.filter(item => item && item.storageKey === normalized.storageKey);
        if (existing.length) {
          if (existing.length !== 1 || !sameImageMetadata(existing[0], normalized, actor.authUid)) {
            throw new AppError('ATTACHMENT_ALREADY_REGISTERED', '这张图片已经登记到该员工档案中。', 409);
          }
          return current;
        }
        if (employeeVersion(current) !== expectedVersion) throw conflictError();
        const attachments = [...previousAttachments, attachment];
        const nextVersion = expectedVersion + 1;
        markWrite();
        const written = await transaction.collection(COLLECTIONS.employees).doc(employeeId).update({ attachments, version: nextVersion });
        assertTransactionWriteDidNotFail(written, '附件记录未能写入。');
        const audit = await appendAudit({
          database: transaction,
          action: 'add_attachment', targetId: employeeId, targetName: asTrimmedString(current.name), changed: ['attachments'],
          result: 'success',
          detail: `为员工“${asTrimmedString(current.name)}”上传员工附件“${attachment.fileName}”。`,
        });
        if (!getRecordId(audit)) throw new AppError('AUDIT_WRITE_FAILED', '附件审计未能写入。');
        return { ...current, attachments, version: nextVersion };
      });
      return employeePublicRecord(employee);
    } catch (error) {
      const appError = toAppError(error);
      appError.details = { ...(appError.details || {}), submissionOutcome: appError.details?.submissionOutcome || 'not_committed' };
      await appendFailureAudit({
        action: 'add_attachment', targetId: employeeId, changed: [],
        detail: `上传员工附件“${normalized?.fileName || '未确认图片'}”未确认成功：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function viewAttachment(input) {
    const employeeId = getEmployeeId(input);
    const eventId = validateTextField(input.eventId, '事件编号', { required: true, maxLength: 160 });
    const attachmentId = validateTextField(input.attachmentId, '附件编号', { required: true, maxLength: 160 });
    let current = null;
    let eventName = '';
    let fileName = '';
    try {
      current = await getEmployee(employeeId);
      const found = findEventAttachment(current, eventId, attachmentId);
      eventName = asTrimmedString(found && found.event && found.event.summary);
      fileName = asTrimmedString(found && found.attachment && found.attachment.fileName);
      const storedStorageKey = asTrimmedString(found && found.attachment && found.attachment.storageKey);
      if (!found || !isValidEventStorageKey(storedStorageKey, employeeId, storageAuthority)) {
        throw new AppError('ATTACHMENT_NOT_FOUND', '未找到可查看的特殊事件图片。');
      }
      const attachment = found.attachment;
      const url = await resolveStorageTempUrl(storage, storedStorageKey, '读取特殊事件图片失败，请稍后重试。');
      await appendAudit({
        action: 'view_attachment',
        targetId: employeeId,
        targetName: asTrimmedString(current.name),
        changed: ['specialEventAttachment'],
        result: 'success',
        detail: `查看员工“${asTrimmedString(current.name) || '未命名员工'}”的特殊事件“${eventName || '未命名事件'}”图片“${fileName || '未命名图片'}”。`,
      });
      return {
        url,
        fileName: fileName || '特殊事件图片',
        mimeType: asTrimmedString(attachment.mimeType).toLowerCase(),
      };
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: 'view_attachment',
        targetId: employeeId,
        targetName: asTrimmedString(current && current.name),
        changed: ['specialEventAttachment'],
        detail: `查看员工“${asTrimmedString(current && current.name) || '未命名员工'}”的特殊事件“${eventName || '未命名事件'}”图片“${fileName || '未命名图片'}”失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function downloadAttachment(input) {
    const employeeId = getEmployeeId(input);
    const attachmentId = validateTextField(input.attachmentId, '附件编号', { required: true, maxLength: 160 });
    let current = null;
    let fileName = '';
    try {
      current = await getEmployee(employeeId);
      const found = findGeneralAttachment(current, attachmentId);
      const attachment = found && found.attachment;
      fileName = asTrimmedString(attachment && attachment.fileName);
      const storedStorageKey = asTrimmedString(attachment && attachment.storageKey);
      if (!found || !isValidGeneralAttachmentStorageKey(storedStorageKey, employeeId, storageAuthority)) {
        throw new AppError('ATTACHMENT_NOT_FOUND', '未找到可查看的员工附件图片。');
      }

      const url = await resolveStorageTempUrl(storage, storedStorageKey, '读取员工附件图片失败，请稍后重试。');
      await appendAudit({
        action: 'view_attachment',
        targetId: employeeId,
        targetName: asTrimmedString(current.name),
        changed: ['employeeAttachment'],
        result: 'success',
        detail: `查看员工附件“${fileName || '未命名图片'}”。`,
      });
      return {
        url,
        fileName: fileName || '员工附件图片',
        mimeType: asTrimmedString(attachment.mimeType).toLowerCase(),
      };
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: 'view_attachment',
        targetId: employeeId,
        targetName: asTrimmedString(current && current.name),
        changed: ['employeeAttachment'],
        detail: fileName
          ? `查看员工附件“${fileName}”失败：${appError.code}。`
          : `查看员工附件图片失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function listAudit(input) {
    const { page, pageSize } = parsePage(input);
    const targetId = asTrimmedString(input.targetId);
    const rows = [];
    try {
      const batchSize = 100;
      for (let batchPage = 0; ; batchPage += 1) {
        let query = db.collection(COLLECTIONS.auditLogs);
        if (targetId) query = query.where({ targetId });
        query = query.orderBy('_id', 'asc').skip(batchPage * batchSize).limit(batchSize);
        const batch = getRows(await query.get());
        rows.push(...batch);
        if (batch.length < batchSize) break;
      }
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '读取操作日志失败。');
    }

    const action = asTrimmedString(input.action);
    const result = asTrimmedString(input.result);
    const employeeName = asTrimmedString(input.employeeName || input.keyword).toLowerCase();
    const filtered = rows
      .filter((row) => asTrimmedString(row.action) !== 'view_student_detail')
      .filter((row) => !targetId || asTrimmedString(row.targetId) === targetId)
      .filter((row) => !action || action === 'all' || row.action === action)
      .filter((row) => !result || result === 'all' || row.result === result)
      .filter(
        (row) =>
          !employeeName ||
          asTrimmedString(row.targetNameSnapshot).toLowerCase().includes(employeeName),
      )
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')) ||
        String(right._id || right.id || '').localeCompare(String(left._id || left.id || '')));
    const offset = (page - 1) * pageSize;
    return {
      items: filtered.slice(offset, offset + pageSize).map(auditPublicRecord),
      total: filtered.length,
      page,
      pageSize,
    };
  }

  async function appendFailureAudit(input) {
    try {
      await appendAudit({
        ...input,
        result: 'failure',
      });
    } catch (auditError) {
      // Do not replace the original business error with an audit implementation error.
      // The request remains failed and the server logs only non-sensitive correlation data.
      console.error('[employeeArchiveApi] audit append failed', {
        requestId,
        code: safeErrorCode(auditError),
      });
    }
  }

  function normalizePermissionUpdate(value) {
    if (!Array.isArray(value)) {
      throw new AppError('VALIDATION_ERROR', 'permissions 必须是权限编号数组。', 400, { field: 'permissions' });
    }
    const permissions = value.map(asTrimmedString);
    const invalid = permissions.find((permission) => !MANAGED_PERMISSION_SET.has(permission));
    if (invalid) {
      throw new AppError('VALIDATION_ERROR', `不支持的权限：${invalid}。`, 400, { field: 'permissions' });
    }
    return [...new Set(permissions)];
  }

  async function governanceTransactionDocument(transaction, collectionName, documentId, missingCode = 'ACCOUNT_NOT_FOUND') {
    let document;
    try {
      document = getDocument(await transaction.collection(collectionName).doc(documentId).get());
    } catch {
      if (collectionName === COLLECTIONS.adminGovernance
        || collectionName === COLLECTIONS.adminGovernanceOperations) {
        throw governanceNotReady('总管理员治理记录暂不可读，账号管理写入已关闭。');
      }
      throw new AppError('DATABASE_READ_FAILED', '读取账号资料失败。');
    }
    if (!document && missingCode) {
      if (collectionName === COLLECTIONS.adminGovernance) {
        throw governanceNotReady('总管理员名额尚未初始化，账号管理写入已关闭。');
      }
      if (missingCode === 'ACCOUNT_NOT_FOUND') throw new AppError('ACCOUNT_NOT_FOUND', '未找到对应账号。');
    }
    return document;
  }

  function validateGovernanceActor(account) {
    if (!account
      || getRecordId(account) !== actor.accountId
      || asTrimmedString(account.authUid) !== actor.authUid
      || asTrimmedString(account.status) !== 'active') {
      throw new AppError('PERMISSION_DENIED', '当前账号已失去账号管理权限，请刷新后重试。', 403);
    }
    const currentActor = buildActor(account, { authUid: actor.authUid });
    requirePermission(currentActor, 'account.manage');
    return currentActor;
  }

  function idempotentGovernanceResult(record, context) {
    if (asTrimmedString(record.actorAccountId) !== context.actorAccountId
      || asTrimmedString(record.route) !== context.route
      || JSON.stringify(record.targetAccountIds || []) !== JSON.stringify(context.targetAccountIds)
      || asTrimmedString(record.requestFingerprint) !== context.requestFingerprint) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED', '该操作标识已用于不同的账号治理请求。', 409);
    }
    if (!isPlainObject(record.resultSnapshot)) {
      throw governanceNotReady('已完成治理操作的结果记录暂不可用，请联系管理员核对。');
    }
    return record.resultSnapshot;
  }

  async function executeGovernanceMutation({ route, input, targetAccountIds, action, validateNewRequest, prepare, buildPlan, allowPreviousLimit = false, allowWhenGovernanceWritesDisabled = false }) {
    if (!hasPermission(actor, 'account.manage') && !asTrimmedString(input.operationId)) {
      throw new AppError('PERMISSION_DENIED', '只有当前启用的总管理员可以管理账号。', 403);
    }
    const normalizedTargetIds = [...new Set(targetAccountIds.map(asTrimmedString).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    if (normalizedTargetIds.length !== targetAccountIds.length) {
      throw new AppError('VALIDATION_ERROR', '账号治理目标无效。', 400);
    }
    const operation = normalizeGovernanceOperationId(input.operationId);
    const expectedRevision = expectedGovernanceRevision(input);
    const requestFingerprint = governanceRequestFingerprint(route, actor.accountId, normalizedTargetIds, input);
    const operationTime = now();
    const operationContext = {
      actorAccountId: actor.accountId,
      route,
      targetAccountIds: normalizedTargetIds,
      requestFingerprint,
    };

    try {
      let prepared;
      if (prepare) {
        const priorOperation = await runGovernanceTransaction(db, async (transaction) => {
          try {
            return getDocument(await transaction.collection(COLLECTIONS.adminGovernanceOperations)
              .doc(operation.documentId).get());
          } catch {
            throw governanceNotReady('总管理员操作记录暂不可读，账号管理写入已关闭。');
          }
        });
        if (priorOperation) return idempotentGovernanceResult(priorOperation, operationContext);
      }
      if (prepare) {
        if (!hasPermission(actor, 'account.manage')) {
          throw new AppError('PERMISSION_DENIED', '只有当前启用的总管理员可以管理账号。', 403);
        }
        prepared = await prepare();
      }
      return await runGovernanceTransaction(db, async (transaction) => {
        let existingOperation;
        try {
          existingOperation = getDocument(await transaction.collection(COLLECTIONS.adminGovernanceOperations)
            .doc(operation.documentId).get());
        } catch {
          throw governanceNotReady('总管理员操作记录暂不可读，账号管理写入已关闭。');
        }
        if (existingOperation) return idempotentGovernanceResult(existingOperation, operationContext);

        if (validateNewRequest) await validateNewRequest();

        if (!governanceWritesEnabled && !allowWhenGovernanceWritesDisabled) {
          throw governanceNotReady('账号治理写入口当前处于关闭状态。');
        }

        const currentActorRecord = await governanceTransactionDocument(
          transaction,
          COLLECTIONS.adminAccounts,
          actor.accountId,
          null,
        );
        const currentActor = validateGovernanceActor(currentActorRecord);
        const roster = await governanceTransactionDocument(
          transaction,
          COLLECTIONS.adminGovernance,
          SUPER_ADMIN_GOVERNANCE.rosterId,
        ).then((roster) => validateGovernanceRoster(roster, { allowPreviousLimit }));
        if (!['ready', 'over_limit'].includes(roster.state)) {
          throw governanceNotReady();
        }
        assertGovernanceAccountMatchesRoster(roster, currentActorRecord);
        if (roster.revision !== expectedRevision) {
          throw new AppError('SUPER_ADMIN_REVISION_CONFLICT', '账号状态已更新，请刷新后重新确认。', 409);
        }

        const targets = new Map();
        for (const targetId of normalizedTargetIds) {
          const target = targetId === actor.accountId
            ? currentActorRecord
            : await governanceTransactionDocument(transaction, COLLECTIONS.adminAccounts, targetId);
          assertGovernanceAccountMatchesRoster(roster, target);
          targets.set(targetId, target);
        }

        const plan = await buildPlan({ transaction, roster, actor: currentActor, targets, operationTime, prepared });
        const accountWrites = Array.isArray(plan.accountWrites) ? plan.accountWrites : [];
        const nextRosterIds = new Set(roster.activeSuperAdminAccountIds);
        const writtenIds = new Set();
        for (const write of accountWrites) {
          const accountId = asTrimmedString(write.accountId);
          if (!accountId || writtenIds.has(accountId) || getRecordId(write.before) !== accountId
            || getRecordId(write.after) !== accountId || !isPlainObject(write.patch)) {
            throw governanceNotReady('账号治理变更方案无效，操作已停止。');
          }
          writtenIds.add(accountId);
          assertGovernanceAccountMatchesRoster(roster, write.before);
          const wasActiveSuperAdmin = asTrimmedString(write.before.status) === 'active'
            && normalizeAccountRole(write.before.role) === 'super_admin';
          if (wasActiveSuperAdmin) nextRosterIds.delete(accountId);
          if (asTrimmedString(write.after.status) === 'active'
            && normalizeAccountRole(write.after.role) === 'super_admin') {
            nextRosterIds.add(accountId);
          }
        }

        const nextIds = [...nextRosterIds].sort((left, right) => left.localeCompare(right));
        if (nextIds.length < 1) {
          throw new AppError('LAST_SUPER_ADMIN', '系统至少需要保留一名有效的总管理员。', 409);
        }
        if (roster.state === 'over_limit' && nextIds.length > roster.activeSuperAdminAccountIds.length) {
          throw new AppError('SUPER_ADMIN_OVER_LIMIT', '当前启用总管理员人数已超过上限，不能继续增加人数。', 409, {
            currentCount: roster.activeSuperAdminAccountIds.length,
            limit: SUPER_ADMIN_GOVERNANCE.limit,
          });
        }
        if (roster.state === 'ready' && nextIds.length > SUPER_ADMIN_GOVERNANCE.limit) {
          throw new AppError('SUPER_ADMIN_QUOTA_FULL', '启用总管理员名额已满，不能继续提升或恢复。', 409, {
            currentCount: roster.activeSuperAdminAccountIds.length,
            limit: SUPER_ADMIN_GOVERNANCE.limit,
          });
        }

        const nextRoster = {
          ...roster,
          limit: Number.isInteger(plan.limit) ? plan.limit : roster.limit,
          state: governanceStateForCount(nextIds.length),
          activeSuperAdminAccountIds: nextIds,
          revision: roster.revision + 1,
          updatedAt: operationTime,
          updatedByAccountId: currentActor.accountId,
        };

        for (const write of accountWrites) {
          const result = await transaction.collection(COLLECTIONS.adminAccounts)
            .doc(write.accountId).update(write.patch);
          assertTransactionWriteDidNotFail(result, '账号变更未能提交，请刷新后重试。');
        }
        if (typeof plan.writeAdditional === 'function') {
          await plan.writeAdditional({ transaction, operationTime, actor: currentActor });
        }
        const rosterResult = await transaction.collection(COLLECTIONS.adminGovernance)
          .doc(SUPER_ADMIN_GOVERNANCE.rosterId).update({
            limit: nextRoster.limit,
            state: nextRoster.state,
            activeSuperAdminAccountIds: nextRoster.activeSuperAdminAccountIds,
            revision: nextRoster.revision,
            updatedAt: nextRoster.updatedAt,
            updatedByAccountId: nextRoster.updatedByAccountId,
          });
        assertTransactionWriteDidNotFail(rosterResult, '总管理员名额变更未能提交，请刷新后重试。');

        for (const audit of (Array.isArray(plan.audits) ? plan.audits : [])) {
          await appendGovernanceAuditDocument({
            database: transaction,
            actor: currentActor,
            requestId,
            operationKeyHash: operation.operationKeyHash,
            createdAt: operationTime,
            ...audit,
          });
        }

        const resultValue = typeof plan.result === 'function'
          ? plan.result({ governance: governanceControlSummary(nextRoster), accountWrites })
          : plan.result;
        const resultSnapshot = JSON.parse(JSON.stringify(resultValue));
        const ledgerResult = await transaction.collection(COLLECTIONS.adminGovernanceOperations)
          .doc(operation.documentId).set({
            schemaVersion: SUPER_ADMIN_GOVERNANCE.schemaVersion,
            operationKeyHash: operation.operationKeyHash,
            actorAccountId: currentActor.accountId,
            route,
            targetAccountIds: normalizedTargetIds,
            requestFingerprint,
            resultSnapshot,
            firstRequestId: requestId,
            createdAt: operationTime,
          });
        assertTransactionWriteDidNotFail(ledgerResult, '治理操作结果未能登记，账号变更已取消。');
        return resultSnapshot;
      });
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action,
        targetId: normalizedTargetIds[0] || null,
        targetType: 'account',
        detail: `账号治理操作失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function initializeSuperAdminGovernance(input) {
    const allowedFields = new Set(['operationId']);
    const operation = normalizeGovernanceOperationId(input.operationId);
    const route = 'accounts/super-admin-governance/initialize';
    const targetAccountIds = [];
    const requestFingerprint = governanceRequestFingerprint(route, actor.accountId, targetAccountIds, input);
    const operationContext = { actorAccountId: actor.accountId, route, targetAccountIds, requestFingerprint };
    const operationTime = now();

    try {
      let priorOperation;
      try {
        priorOperation = getDocument(await db.collection(COLLECTIONS.adminGovernanceOperations)
          .doc(operation.documentId).get());
      } catch {
        throw governanceNotReady('总管理员操作记录暂不可读，初始化已停止。');
      }
      if (priorOperation) return idempotentGovernanceResult(priorOperation, operationContext);
      if (Object.keys(input).some((key) => !allowedFields.has(key))) {
        throw new AppError('VALIDATION_ERROR', '名额初始化请求只接受 operationId。', 400);
      }
      if (actor.role !== 'super_admin' || asTrimmedString(actor.status) !== 'active') {
        throw new AppError('PERMISSION_DENIED', '只有当前启用的总管理员可以初始化名额。', 403);
      }

      let existingRoster;
      try {
        existingRoster = getDocument(await db.collection(COLLECTIONS.adminGovernance)
          .doc(SUPER_ADMIN_GOVERNANCE.rosterId).get());
      } catch {
        throw governanceNotReady('总管理员名额控制记录不可读，初始化已停止。');
      }
      if (existingRoster) throw governanceNotReady('总管理员名额已初始化；不会覆盖现有控制记录。');

      // The complete read-only scan must finish before opening the transaction.
      // Deployment must first freeze governance writes and drain old function
      // versions; that operational evidence is a deployment-stage prerequisite.
      const scannedAccounts = await listAccountRows(db);
      const scannedIds = activeSuperAdminIds(scannedAccounts);
      if (!scannedIds.includes(actor.accountId)) throw governanceNotReady('当前账号不在启用总管理员清单中。');
      if (scannedIds.length > SUPER_ADMIN_GOVERNANCE.initializationTransactionOperationLimit) {
        throw governanceNotReady('启用总管理员名单过大，无法在单一事务内安全初始化，请联系管理员核对。');
      }

      return await runGovernanceTransaction(db, async (transaction) => {
        let existingOperation;
        try {
          existingOperation = getDocument(await transaction.collection(COLLECTIONS.adminGovernanceOperations)
            .doc(operation.documentId).get());
        } catch {
          throw governanceNotReady('总管理员操作记录暂不可读，初始化已停止。');
        }
        if (existingOperation) return idempotentGovernanceResult(existingOperation, operationContext);
        if (governanceWritesEnabled) {
          throw governanceNotReady('名额初始化只允许在治理写入口关闭时执行。');
        }

        const actorRecord = await governanceTransactionDocument(transaction, COLLECTIONS.adminAccounts, actor.accountId, null);
        if (!actorRecord || asTrimmedString(actorRecord.authUid) !== actor.authUid
          || asTrimmedString(actorRecord.status) !== 'active'
          || normalizeAccountRole(actorRecord.role) !== 'super_admin') {
          throw new AppError('PERMISSION_DENIED', '只有当前启用的总管理员可以初始化名额。', 403);
        }
        const currentActor = buildActor(actorRecord, { authUid: actor.authUid });
        let existingRoster;
        try {
          existingRoster = getDocument(await transaction.collection(COLLECTIONS.adminGovernance)
            .doc(SUPER_ADMIN_GOVERNANCE.rosterId).get());
        } catch {
          throw governanceNotReady('总管理员名额控制记录不可读，初始化已停止。');
        }
        if (existingRoster) throw governanceNotReady('总管理员名额已初始化；不会覆盖现有控制记录。');

        for (const accountId of scannedIds) {
          const account = await governanceTransactionDocument(transaction, COLLECTIONS.adminAccounts, accountId, null);
          if (!account || asTrimmedString(account.status) !== 'active'
            || normalizeAccountRole(account.role) !== 'super_admin') {
            throw governanceNotReady('初始化期间账号角色或状态发生变化，请重新核对。');
          }
        }
        const roster = {
          schemaVersion: SUPER_ADMIN_GOVERNANCE.schemaVersion,
          state: governanceStateForCount(scannedIds.length),
          limit: SUPER_ADMIN_GOVERNANCE.limit,
          activeSuperAdminAccountIds: scannedIds,
          revision: 1,
          initializedAt: operationTime,
          updatedAt: operationTime,
          updatedByAccountId: currentActor.accountId,
        };
        const rosterWrite = await transaction.collection(COLLECTIONS.adminGovernance)
          .doc(SUPER_ADMIN_GOVERNANCE.rosterId).set(roster);
        assertTransactionWriteDidNotFail(rosterWrite, '总管理员名额初始化未能提交。');
        const governance = governanceControlSummary(roster);
        await appendGovernanceAuditDocument({
          database: transaction,
          actor: currentActor,
          requestId,
          operationKeyHash: operation.operationKeyHash,
          suffix: 'initialize',
          action: 'initialize_super_admin_governance',
          targetType: 'governance',
          targetId: SUPER_ADMIN_GOVERNANCE.rosterId,
          targetName: '总管理员名额控制',
          changed: ['启用总管理员名单', '名额控制状态'],
          after: governance,
          detail: `已登记当前启用总管理员名单，共 ${scannedIds.length} 名；未更改任何账号角色或身份。`,
          createdAt: operationTime,
        });
        const resultSnapshot = { governance };
        const ledgerWrite = await transaction.collection(COLLECTIONS.adminGovernanceOperations)
          .doc(operation.documentId).set({
            schemaVersion: SUPER_ADMIN_GOVERNANCE.schemaVersion,
            operationKeyHash: operation.operationKeyHash,
            actorAccountId: currentActor.accountId,
            route,
            targetAccountIds,
            requestFingerprint,
            resultSnapshot,
            firstRequestId: requestId,
            createdAt: operationTime,
          });
        assertTransactionWriteDidNotFail(ledgerWrite, '初始化操作结果未能登记。');
        return resultSnapshot;
      });
    } catch (error) {
      const appError = toAppError(error);
      await appendFailureAudit({
        action: 'initialize_super_admin_governance',
        targetId: SUPER_ADMIN_GOVERNANCE.rosterId,
        targetType: 'governance',
        detail: `总管理员名额初始化失败：${appError.code}。`,
      });
      throw appError;
    }
  }

  async function upgradeSuperAdminGovernanceLimit(input) {
    const allowedFields = new Set(['operationId', 'expectedGovernanceRevision']);
    const unsupportedField = Object.keys(input).find((field) => !allowedFields.has(field));
    if (unsupportedField) {
      throw new AppError('VALIDATION_ERROR', '名额升级请求只接受 operationId 和 expectedGovernanceRevision。', 400, { field: unsupportedField });
    }
    return executeGovernanceMutation({
      route: 'accounts/super-admin-governance/upgrade-limit',
      input,
      targetAccountIds: [],
      action: 'upgrade_super_admin_quota',
      allowPreviousLimit: true,
      allowWhenGovernanceWritesDisabled: true,
      buildPlan: async ({ transaction, roster, actor: currentActor }) => {
        if (roster.limit !== PREVIOUS_SUPER_ADMIN_GOVERNANCE_LIMIT) {
          throw governanceNotReady('总管理员名额升级状态暂不可用，请刷新账号列表。');
        }
        if (!roster.activeSuperAdminAccountIds.includes(currentActor.accountId)) {
          throw governanceNotReady();
        }
        const actorAuthUid = asTrimmedString(currentActor.authUid);
        if (!actorAuthUid) throw governanceNotReady();
        const authUids = new Set([actorAuthUid]);
        for (const accountId of roster.activeSuperAdminAccountIds) {
          if (accountId === currentActor.accountId) continue;
          const member = await governanceTransactionDocument(
            transaction,
            COLLECTIONS.adminAccounts,
            accountId,
            null,
          );
          assertGovernanceAccountMatchesRoster(roster, member);
          const authUid = asTrimmedString(member.authUid);
          if (!authUid || authUids.has(authUid)) throw governanceNotReady();
          authUids.add(authUid);
        }
        const nextState = governanceStateForCount(roster.activeSuperAdminAccountIds.length);
        return {
          limit: SUPER_ADMIN_GOVERNANCE.limit,
          audits: [{
            suffix: 'quota-limit',
            action: 'upgrade_super_admin_quota',
            targetType: 'governance',
            targetId: SUPER_ADMIN_GOVERNANCE.rosterId,
            targetName: '总管理员名额控制',
            changed: ['总管理员人数上限'],
            before: {
              activeCount: roster.activeSuperAdminAccountIds.length,
              limit: roster.limit,
              revision: roster.revision,
              state: roster.state,
            },
            after: {
              activeCount: roster.activeSuperAdminAccountIds.length,
              limit: SUPER_ADMIN_GOVERNANCE.limit,
              revision: roster.revision + 1,
              state: nextState,
            },
            detail: '总管理员人数上限由 3 名调整为 5 名；未变更启用总管理员名单及任何账号角色、权限或身份绑定。',
          }],
          result: ({ governance }) => ({ governance }),
        };
      },
    });
  }

  async function listAccounts() {
    requirePermission(actor, 'account.manage');
    const rows = await listAccountRows(db);
    const items = rows
      .map(accountSummary)
      .filter((account) => account.id)
      .sort((left, right) => left.username.localeCompare(right.username));
    const currentIds = activeSuperAdminIds(rows);
    let governance = {
      state: 'not_ready',
      activeCount: currentIds.length,
      limit: SUPER_ADMIN_GOVERNANCE.limit,
      revision: null,
    };
    try {
      const document = getDocument(await db.collection(COLLECTIONS.adminGovernance)
        .doc(SUPER_ADMIN_GOVERNANCE.rosterId).get());
      if (!document) {
        governance = { ...governance, state: 'not_initialized' };
      } else {
        const roster = validateGovernanceRoster(document, { allowPreviousLimit: true });
        const matches = roster.activeSuperAdminAccountIds.length === currentIds.length
          && roster.activeSuperAdminAccountIds.every((id, index) => id === currentIds[index]);
        governance = matches
          ? governanceControlSummary(roster)
          : { ...governance, state: 'drift', revision: Number.isInteger(document.revision) ? document.revision : null };
      }
    } catch {
      governance = { ...governance, state: 'drift' };
    }
    return { items, total: items.length, governance };
  }

  function registrationRecoveryManager() {
    try {
      const manager = typeof managerFactory === 'function' ? managerFactory(envId, env) : null;
      if (!manager || !manager.user || typeof manager.user.describeUserList !== 'function') {
        throw new Error('registration recovery manager unavailable');
      }
      return manager;
    } catch {
      throw new AppError('REGISTRATION_RECOVERY_UNAVAILABLE', '暂时无法核对注册账号状态，请稍后刷新。', 503);
    }
  }

  async function registrationRecoveryActor(database = db) {
    if (!actor || actor.role !== 'super_admin' || asTrimmedString(actor.status) !== 'active') {
      throw new AppError('PERMISSION_DENIED', '只有当前启用的总管理员可以处理注册恢复。', 403);
    }
    let account;
    try {
      account = getDocument(await database.collection(COLLECTIONS.adminAccounts).doc(actor.accountId).get());
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '暂时无法核对当前管理员身份，请稍后重试。');
    }
    if (!account
      || asTrimmedString(account.authUid) !== actor.authUid
      || asTrimmedString(account.status) !== 'active'
      || resolveAccountAuthorization(account).role !== 'super_admin') {
      throw new AppError('PERMISSION_DENIED', '当前账号已不具备注册恢复权限，请刷新后重试。', 403);
    }
    return buildActor(account, { authUid: actor.authUid });
  }

  async function inspectRegistrationRecovery(claim, manager) {
    const claimId = getRecordId(claim);
    const storedType = asTrimmedString(claim.identityType);
    const subjectType = storedType === 'student' || asTrimmedString(claim.studentId) ? 'student' : 'employee';
    const subjectId = asTrimmedString(subjectType === 'student' ? claim.studentId : claim.employeeId);
    const usernameNormalized = asTrimmedString(claim.usernameNormalized).toLowerCase();
    const accountId = registrationAccountDocumentId(subjectId, subjectType);
    if (!claimId || !subjectId || !usernameNormalized
      || (storedType && storedType !== subjectType)
      || asTrimmedString(claim.accountId) !== accountId
      || asTrimmedString(claim.registrationVerificationMethod) !== PHONE_REGISTRATION_METHOD) return null;

    const subjectRecord = getDocument(await db.collection(COLLECTIONS.employees).doc(subjectId).get());
    const phoneNumber = normalizeRegistrationPhone(subjectType === 'student'
      ? subjectRecord && subjectRecord.phoneNumber
      : subjectRecord && subjectRecord.personalPhone);
    if (!phoneNumber) return null;
    const identitySnapshot = await registrationSubjectByPhoneSnapshot(db, phoneNumber, subjectType, subjectId);
    if (!registrationIdentityMatches(claim, identitySnapshot)) return null;

    const account = getDocument(await db.collection(COLLECTIONS.adminAccounts).doc(accountId).get());
    const linkedAccounts = subjectType === 'student'
      ? await listAccountsByStudentId(db, subjectId, 2)
      : await listAccountsByEmployeeId(db, subjectId, 2);
    if (linkedAccounts.length > 1 || linkedAccounts.some((row) => asTrimmedString(getRecordId(row)) !== accountId)) return null;

    const authUid = asTrimmedString(claim.authUid);
    const accountRows = await listAccountRows(db);
    const conflictingAccount = accountRows.some((row) => {
      if (asTrimmedString(getRecordId(row)) === accountId) return false;
      const rowUsername = asTrimmedString(row.usernameNormalized || row.username).toLowerCase();
      return rowUsername === usernameNormalized || (authUid && asTrimmedString(row.authUid) === authUid);
    });
    if (conflictingAccount) return null;

    if (authUid) {
      const users = await managerUsersByUid(manager, authUid);
      const user = users.length === 1 ? users[0] : null;
      const matchingUser = user && managerUserName(user).toLowerCase() === usernameNormalized;
      const accountCanResume = !account || (
        asTrimmedString(account.status) === 'pending_activation'
        && asTrimmedString(account.authUid) === authUid
        && asTrimmedString(account.usernameNormalized).toLowerCase() === usernameNormalized
        && asTrimmedString(account.role) === 'user'
        && Array.isArray(account.permissions)
        && account.permissions.length === 0
        && registrationIdentityMatches(account, identitySnapshot)
      );
      if (matchingUser && managerUserStatus(user) === 'BLOCKED' && accountCanResume) {
        return {
          id: claimId,
          action: 'restore_existing',
          subjectType,
          subjectId,
          identitySnapshot: { ...identitySnapshot, phoneNumber },
          accountId,
          account,
          authUid,
          username: managerUserName(user),
          registrationAttemptId: asTrimmedString(claim.registrationAttemptId),
          displayName: identitySnapshot.name,
        };
      }
      return null;
    }

    if (account || linkedAccounts.length) return null;
    const users = await managerUsersByName(manager, usernameNormalized);
    if (users.length) return null;
    return {
      id: claimId,
      action: 'release_for_retry',
      subjectType,
      subjectId,
      identitySnapshot: { ...identitySnapshot, phoneNumber },
      accountId,
      account: null,
      authUid: '',
      username: usernameNormalized,
      registrationAttemptId: asTrimmedString(claim.registrationAttemptId),
      displayName: identitySnapshot.name,
    };
  }

  async function listRegistrationRecoveries() {
    await registrationRecoveryActor();
    const manager = registrationRecoveryManager();
    const claims = await listRegistrationRecoveryClaimRows(db);
    const items = [];
    for (const claim of claims) {
      const recovery = await inspectRegistrationRecovery(claim, manager);
      if (!recovery) continue;
      items.push({
        id: recovery.id,
        displayName: recovery.displayName,
        identityType: recovery.subjectType,
        action: recovery.action,
        message: recovery.action === 'restore_existing'
          ? '登录账号已创建但档案绑定未完成；恢复后保留原登录名和密码。'
          : '登录账号尚未创建；释放后可重新注册并设置密码。',
        detectedAt: asTrimmedString(claim.recoveryDetectedAt) || null,
      });
    }
    return items;
  }

  async function recoverRegistration(input) {
    const recoveryActor = await registrationRecoveryActor();
    const allowedFields = new Set(['claimId', 'action']);
    const unsupportedField = Object.keys(input).find((field) => !allowedFields.has(field));
    if (unsupportedField) {
      throw new AppError('VALIDATION_ERROR', '注册恢复请求只接受记录编号和处理方式。', 400, { field: unsupportedField });
    }
    const claimId = validateTextField(input.claimId, '注册记录编号', { required: true, maxLength: 240 });
    const action = asTrimmedString(input.action);
    if (!['restore_existing', 'release_for_retry'].includes(action)) {
      throw new AppError('VALIDATION_ERROR', '注册恢复处理方式无效。', 400, { field: 'action' });
    }

    let claim;
    try {
      claim = getDocument(await db.collection(COLLECTIONS.identityClaims).doc(claimId).get());
    } catch {
      throw new AppError('DATABASE_READ_FAILED', '读取待恢复注册记录失败。');
    }
    if (!claim || asTrimmedString(claim.status) !== 'recovery_required') {
      throw new AppError('REGISTRATION_RECOVERY_NOT_FOUND', '这条注册记录已处理或状态已变化，请刷新列表。', 409);
    }

    const manager = registrationRecoveryManager();
    const recovery = await inspectRegistrationRecovery(claim, manager);
    if (!recovery || recovery.action !== action) {
      throw new AppError('REGISTRATION_RECOVERY_CHANGED', '账号或档案状态已变化，请刷新列表后重新核对。', 409);
    }

    if (action === 'release_for_retry') {
      const previousClaimStatus = ['unclaimed', 'invited'].includes(asTrimmedString(claim.previousClaimStatus))
        ? asTrimmedString(claim.previousClaimStatus)
        : (asTrimmedString(claim.invitationId) || asTrimmedString(claim.invitationDocumentId) ? 'invited' : 'unclaimed');
      await runPhoneRegistrationTransaction({
        db,
        phoneNumber: recovery.identitySnapshot.phoneNumber,
        subjectType: recovery.subjectType,
        subjectId: recovery.subjectId,
        work: async (transaction, currentSubject) => {
          await registrationRecoveryActor(transaction);
          const claimReference = transaction.collection(COLLECTIONS.identityClaims).doc(claimId);
          const currentClaim = getDocument(await claimReference.get());
          if (!currentClaim
            || asTrimmedString(currentClaim.status) !== 'recovery_required'
            || asTrimmedString(currentClaim.registrationAttemptId) !== recovery.registrationAttemptId
            || asTrimmedString(currentClaim.authUid)
            || asTrimmedString(currentClaim.accountId) !== recovery.accountId
            || asTrimmedString(currentClaim.usernameNormalized).toLowerCase() !== recovery.username.toLowerCase()
            || !registrationIdentityMatches(currentClaim, currentSubject)) {
            throw new AppError('REGISTRATION_RECOVERY_CHANGED', '注册记录已变化，请刷新列表后重试。', 409);
          }
          const account = getDocument(await transaction.collection(COLLECTIONS.adminAccounts).doc(recovery.accountId).get());
          if (account) throw new AppError('REGISTRATION_RECOVERY_CHANGED', '账号已创建，请刷新列表后重新核对。', 409);
          const updatedAt = now();
          await claimReference.update({
            status: previousClaimStatus,
            accountId: '',
            authUid: '',
            usernameNormalized: '',
            registrationAttemptId: '',
            registrationVerificationMethod: '',
            previousClaimStatus: '',
            reservedAt: '',
            recoveryCode: '',
            recoveryDetectedAt: '',
            updatedAt,
          });
          await appendAuditDocument({
            database: transaction,
            actor: recoveryActor,
            requestId,
            action: 'release_failed_registration',
            targetId: recovery.subjectId,
            targetName: currentSubject.name,
            targetType: recovery.subjectType === 'student' ? 'student' : 'employee',
            changed: ['注册状态'],
            before: { status: 'recovery_required' },
            after: { status: previousClaimStatus },
            result: 'success',
            detail: `已解除${registrationIdentityLabel(recovery.subjectType)}“${currentSubject.name}”未完成的注册占用，允许重新发起注册。`,
            now,
          });
          return true;
        },
      });
      return { action, displayName: recovery.displayName, recovered: true };
    }

    const recoveryAttemptId = crypto.randomUUID();
    const pendingAccount = await runPhoneRegistrationTransaction({
      db,
      phoneNumber: recovery.identitySnapshot.phoneNumber,
      subjectType: recovery.subjectType,
      subjectId: recovery.subjectId,
      work: async (transaction, currentSubject) => {
        await registrationRecoveryActor(transaction);
        const claimReference = transaction.collection(COLLECTIONS.identityClaims).doc(claimId);
        const currentClaim = getDocument(await claimReference.get());
        if (!currentClaim
          || asTrimmedString(currentClaim.status) !== 'recovery_required'
          || asTrimmedString(currentClaim.registrationAttemptId) !== recovery.registrationAttemptId
          || asTrimmedString(currentClaim.authUid) !== recovery.authUid
          || asTrimmedString(currentClaim.accountId) !== recovery.accountId
          || asTrimmedString(currentClaim.usernameNormalized).toLowerCase() !== recovery.username.toLowerCase()
          || !registrationIdentityMatches(currentClaim, currentSubject)) {
          throw new AppError('REGISTRATION_RECOVERY_CHANGED', '注册记录已变化，请刷新列表后重试。', 409);
        }
        const accountReference = transaction.collection(COLLECTIONS.adminAccounts).doc(recovery.accountId);
        const existingAccount = getDocument(await accountReference.get());
        let accountData;
        if (existingAccount) {
          if (asTrimmedString(existingAccount.status) !== 'pending_activation'
            || asTrimmedString(existingAccount.authUid) !== recovery.authUid
            || asTrimmedString(existingAccount.usernameNormalized).toLowerCase() !== recovery.username.toLowerCase()
            || asTrimmedString(existingAccount.role) !== 'user'
            || !Array.isArray(existingAccount.permissions)
            || existingAccount.permissions.length !== 0
            || !registrationIdentityMatches(existingAccount, currentSubject)) {
            throw new AppError('REGISTRATION_RECOVERY_CHANGED', '账号绑定状态已变化，请管理员进一步核对。', 409);
          }
          accountData = { ...existingAccount, _id: getRecordId(existingAccount) || recovery.accountId };
        } else {
          const completedAt = now();
          accountData = {
            authUid: recovery.authUid,
            username: recovery.username,
            usernameNormalized: recovery.username.toLowerCase(),
            displayName: currentSubject.name,
            displayNameNormalized: currentSubject.name.toLowerCase(),
            ...registrationIdentityFields(currentSubject),
            registrationVerificationMethod: PHONE_REGISTRATION_METHOD,
            identityVersion: 1,
            status: 'pending_activation',
            role: 'user',
            permissions: [],
            permissionVersion: 1,
            createdAt: completedAt,
            updatedAt: completedAt,
          };
          await accountReference.set(accountData);
          accountData = { ...accountData, _id: recovery.accountId };
        }
        const updatedAt = now();
        await claimReference.update({
          status: 'linked',
          accountId: recovery.accountId,
          authUid: recovery.authUid,
          registrationAttemptId: recoveryAttemptId,
          registrationVerificationMethod: PHONE_REGISTRATION_METHOD,
          recoveredFromRegistrationAttemptId: recovery.registrationAttemptId,
          recoveryResolvedAt: updatedAt,
          updatedAt,
        });
        await appendAuditDocument({
          database: transaction,
          actor: recoveryActor,
          requestId,
          action: 'recover_registration_binding',
          targetId: recovery.accountId,
          targetName: currentSubject.name,
          targetType: 'account',
          changed: ['账号状态', '角色', '权限', `${registrationIdentityLabel(recovery.subjectType)}身份`, '身份绑定'],
          before: accountAuditSnapshot(existingAccount),
          after: accountAuditSnapshot({ ...accountData, status: 'pending_activation', updatedAt }),
          result: 'success',
          detail: `总管理员“${recoveryActor.displayName}”核对后，将未完成注册的账号关联到${registrationIdentityLabel(recovery.subjectType)}“${currentSubject.name}”；账号按普通用户、无业务权限恢复。`,
          verificationMethod: PHONE_REGISTRATION_METHOD,
          now: () => updatedAt,
        });
        return accountData;
      },
    });

    try {
      await setAndVerifyManagerUserStatus(manager, recovery.authUid, 'ACTIVE');
      const activatedAccount = await completePhoneRegistrationActivation({
        db,
        claimId,
        accountId: recovery.accountId,
        identitySnapshot: recovery.identitySnapshot,
        authUid: recovery.authUid,
        registrationAttemptId: recoveryAttemptId,
        requestId,
        now,
        auditActor: recoveryActor,
        auditAction: 'recover_registration_activation_confirmed',
        auditDetailPrefix: `总管理员“${recoveryActor.displayName}”恢复注册后，`,
      });
      return { action, displayName: recovery.displayName, recovered: true, account: safeAccount(activatedAccount) };
    } catch (error) {
      let providerBlocked = false;
      try {
        await setAndVerifyManagerUserStatus(manager, recovery.authUid, 'BLOCKED');
        providerBlocked = true;
      } catch {
        providerBlocked = false;
      }
      await recoverPhoneRegistrationReservation({
        db,
        claimId,
        registrationAttemptId: recoveryAttemptId,
        authUid: recovery.authUid,
        errorCode: providerBlocked ? safeErrorCode(error) : 'REGISTRATION_PROVIDER_BLOCK_UNVERIFIED',
        now,
        requestId,
      });
      throw new AppError('REGISTRATION_RECOVERY_REQUIRED', '账号绑定已保存，但登录状态尚未完成核验；请刷新账号页后继续处理。', 503);
    }
  }

  async function updateAccountRole(input) {
    const accountId = validateTextField(input.accountId, '账号编号', { required: true, maxLength: 160 });
    const nextRole = asTrimmedString(input.role);
    if (!['admin', 'user', 'super_admin'].includes(nextRole)) {
      throw new AppError('VALIDATION_ERROR', '账号角色无效。', 400, { field: 'role' });
    }
    return executeGovernanceMutation({
      route: 'accounts/update-role',
      input,
      targetAccountIds: [accountId],
      action: 'update_account_role',
      buildPlan: async ({ actor: currentActor, targets, operationTime }) => {
        const target = targets.get(accountId);
        if (isStudentAccount(target)) {
          throw new AppError('STUDENT_ACCOUNT_ROLE_FIXED', '学员账号固定为普通用户且不授予业务权限。', 409);
        }
        const currentRole = resolveAccountAuthorization(target).role;
        const currentStatus = asTrimmedString(target.status);
        if (currentStatus === 'pending_activation') {
          throw new AppError('ACCOUNT_INACTIVE', '待安全激活账号不能调整角色。', 409);
        }
        if (nextRole === 'super_admin'
          && (currentStatus !== 'active' || !['admin', 'user'].includes(currentRole))) {
          throw new AppError('SUPER_ADMIN_TARGET_INVALID', '只能提升另一名启用中的普通账号。', 409);
        }
        if (target.id === currentActor.accountId || accountId === currentActor.accountId) {
          if (currentRole !== nextRole) {
            throw new AppError('SUPER_ADMIN_TARGET_INVALID', '不能通过角色编辑降级自己的总管理员身份。', 409);
          }
        }
        const authorization = resolveAccountAuthorization(target);
        const permissions = nextRole === 'admin'
          ? authorization.permissions
          : [];
        const after = {
          ...target,
          role: nextRole,
          permissions,
          permissionVersion: (Number.isInteger(target.permissionVersion) ? target.permissionVersion : 1) + 1,
          updatedAt: operationTime,
          updatedByAuthUid: currentActor.authUid,
        };
        const patch = {
          role: after.role,
          permissions: after.permissions,
          permissionVersion: after.permissionVersion,
          updatedAt: after.updatedAt,
          updatedByAuthUid: after.updatedByAuthUid,
        };
        const roleLabel = nextRole === 'super_admin' ? '总管理员' : nextRole === 'admin' ? '管理员' : '只读用户';
        return {
          accountWrites: [{ accountId, before: target, after, patch }],
          audits: [{
            suffix: 'target',
            action: 'update_account_role',
            targetId: accountId,
            targetName: asTrimmedString(target.displayName),
            changed: ['角色', '权限'],
            before: accountAuditSnapshot(target),
            after: accountAuditSnapshot(after),
            detail: `账号“${asTrimmedString(target.username)}”角色已调整为${roleLabel}。`,
          }],
          result: accountSummary(after),
        };
      },
    });
  }

  async function updateAccountPermissions(input, mode) {
    const accountId = validateTextField(input.accountId, '账号编号', { required: true, maxLength: 160 });
    const requested = normalizePermissionUpdate(input.permissions);
    const action = mode === 'grant' ? 'grant_account_permissions' : 'revoke_account_permissions';
    return executeGovernanceMutation({
      route: mode === 'grant' ? 'accounts/grant-permissions' : 'accounts/revoke-permissions',
      input,
      targetAccountIds: [accountId],
      action,
      buildPlan: async ({ actor: currentActor, targets, operationTime }) => {
        const target = targets.get(accountId);
        if (isStudentAccount(target)) {
          throw new AppError('STUDENT_ACCOUNT_ROLE_FIXED', '学员账号固定为普通用户且不授予业务权限。', 409);
        }
        if (resolveAccountAuthorization(target).role !== 'admin') {
          throw new AppError('VALIDATION_ERROR', '只有管理员账号可以授予或收回业务权限。', 400, { field: 'accountId' });
        }
        const current = new Set(resolveAccountAuthorization(target).permissions);
        requested.forEach((permission) => {
          if (mode === 'grant') current.add(permission);
          else current.delete(permission);
        });
        const after = {
          ...target,
          permissions: [...current].filter((permission) => MANAGED_PERMISSION_SET.has(permission)),
          permissionVersion: (Number.isInteger(target.permissionVersion) ? target.permissionVersion : 1) + 1,
          updatedAt: operationTime,
          updatedByAuthUid: currentActor.authUid,
        };
        const patch = {
          permissions: after.permissions,
          permissionVersion: after.permissionVersion,
          updatedAt: after.updatedAt,
          updatedByAuthUid: after.updatedByAuthUid,
        };
        return {
          accountWrites: [{ accountId, before: target, after, patch }],
          audits: [{
            suffix: 'target',
            action,
            targetId: accountId,
            targetName: asTrimmedString(target.displayName),
            changed: ['权限'],
            before: accountAuditSnapshot(target),
            after: accountAuditSnapshot(after),
            detail: `${mode === 'grant' ? '授予' : '收回'}账号“${asTrimmedString(target.username)}”权限：${permissionLabels(requested).join('、') || '无'}。`,
          }],
          result: accountSummary(after),
        };
      },
    });
  }

  async function setAccountStatus(input, status) {
    const accountId = validateTextField(input.accountId, '账号编号', { required: true, maxLength: 160 });
    const action = status === 'disabled' ? 'disable_account' : 'restore_account';
    return executeGovernanceMutation({
      route: status === 'disabled' ? 'accounts/disable' : 'accounts/restore',
      input,
      targetAccountIds: [accountId],
      action,
      buildPlan: async ({ actor: currentActor, targets, operationTime }) => {
        const target = targets.get(accountId);
        if (status === 'active' && asTrimmedString(target.status) === 'pending_activation') {
          throw new AppError('ACCOUNT_INACTIVE', '待安全激活账号不能通过恢复操作启用。', 409);
        }
        const after = {
          ...target,
          status,
          updatedAt: operationTime,
          updatedByAuthUid: currentActor.authUid,
        };
        const patch = {
          status: after.status,
          updatedAt: after.updatedAt,
          updatedByAuthUid: after.updatedByAuthUid,
        };
        return {
          accountWrites: [{ accountId, before: target, after, patch }],
          audits: [{
            suffix: 'target',
            action,
            targetId: accountId,
            targetName: asTrimmedString(target.displayName),
            changed: ['账号状态'],
            before: accountAuditSnapshot(target),
            after: accountAuditSnapshot(after),
            detail: `账号“${asTrimmedString(target.username)}”已${status === 'disabled' ? '停用' : '恢复'}。`,
          }],
          result: accountSummary(after),
        };
      },
    });
  }
  async function transferSuperAdmin(input) {
    const allowedFields = new Set(['targetAccountId', 'operationId', 'expectedGovernanceRevision']);
    const targetAccountId = asTrimmedString(input.targetAccountId);
    const targetAccountIds = targetAccountId && targetAccountId !== actor.accountId
      ? [actor.accountId, targetAccountId]
      : [actor.accountId];
    return executeGovernanceMutation({
      route: 'accounts/transfer-super-admin',
      input,
      targetAccountIds,
      action: 'transfer_super_admin',
      validateNewRequest: async () => {
        if (Object.keys(input).some((key) => !allowedFields.has(key))) {
          throw new AppError('VALIDATION_ERROR', '转让请求只能指定受让账号和操作确认信息。', 400);
        }
        validateTextField(input.targetAccountId, 'targetAccountId', { required: true, maxLength: 160 });
        if (targetAccountId === actor.accountId) {
          throw new AppError('SUPER_ADMIN_TARGET_INVALID', '受让账号必须是另一名启用账号。', 409);
        }
      },
      buildPlan: async ({ actor: currentActor, targets, operationTime }) => {
        const source = targets.get(currentActor.accountId);
        const target = targets.get(targetAccountId);
        if (isStudentAccount(source) || isStudentAccount(target)) {
          throw new AppError('STUDENT_ACCOUNT_ROLE_FIXED', '学员账号固定为普通用户且不授予业务权限。', 409);
        }
        if (normalizeAccountRole(source.role) !== 'super_admin'
          || asTrimmedString(source.status) !== 'active') {
          throw new AppError('PERMISSION_DENIED', '只有当前启用的总管理员可以转让自己的身份。', 403);
        }
        const targetRole = resolveAccountAuthorization(target).role;
        if (asTrimmedString(target.status) !== 'active' || !['admin', 'user'].includes(targetRole)) {
          throw new AppError('SUPER_ADMIN_TARGET_INVALID', '受让账号必须是另一名启用中的普通账号。', 409);
        }

        const sourceAfter = {
          ...source,
          role: 'admin',
          permissions: resolveAccountAuthorization(source).permissions,
          permissionVersion: (Number.isInteger(source.permissionVersion) ? source.permissionVersion : 1) + 1,
          updatedAt: operationTime,
          updatedByAuthUid: currentActor.authUid,
        };
        const targetAfter = {
          ...target,
          role: 'super_admin',
          permissions: [],
          permissionVersion: (Number.isInteger(target.permissionVersion) ? target.permissionVersion : 1) + 1,
          updatedAt: operationTime,
          updatedByAuthUid: currentActor.authUid,
        };
        const sourceLabel = asTrimmedString(source.displayName) || asTrimmedString(source.username);
        const targetLabel = asTrimmedString(target.displayName) || asTrimmedString(target.username);
        const accountWrites = [
          {
            accountId: currentActor.accountId,
            before: source,
            after: sourceAfter,
            patch: {
              role: sourceAfter.role,
              permissions: sourceAfter.permissions,
              permissionVersion: sourceAfter.permissionVersion,
              updatedAt: sourceAfter.updatedAt,
              updatedByAuthUid: sourceAfter.updatedByAuthUid,
            },
          },
          {
            accountId: targetAccountId,
            before: target,
            after: targetAfter,
            patch: {
              role: targetAfter.role,
              permissions: targetAfter.permissions,
              permissionVersion: targetAfter.permissionVersion,
              updatedAt: targetAfter.updatedAt,
              updatedByAuthUid: targetAfter.updatedByAuthUid,
            },
          },
        ];
        return {
          accountWrites,
          audits: [
            {
              suffix: 'source',
              action: 'transfer_super_admin',
              targetId: currentActor.accountId,
              targetName: sourceLabel,
              changed: ['角色', '权限'],
              before: accountAuditSnapshot(source),
              after: accountAuditSnapshot(sourceAfter),
              detail: `总管理员“${sourceLabel}”已将身份转让给“${targetLabel}”，并保留日常业务权限。`,
            },
            {
              suffix: 'target',
              action: 'transfer_super_admin',
              targetId: targetAccountId,
              targetName: targetLabel,
              changed: ['角色', '权限'],
              before: accountAuditSnapshot(target),
              after: accountAuditSnapshot(targetAfter),
              detail: `账号“${targetLabel}”已接任总管理员身份；启用总管理员人数不变。`,
            },
          ],
          result: ({ governance }) => ({
            sourceAccount: accountSummary(sourceAfter),
            targetAccount: accountSummary(targetAfter),
            governance,
          }),
        };
      },
    });
  }
  async function rejectAccountDisplayNameUpdate() {
    await appendFailureAudit({
      action: 'update_account_display_name',
      changed: [],
      detail: '拒绝修改显示名称：注册后不可修改。',
    });
    throw new AppError('DISPLAY_NAME_IMMUTABLE', '显示名称注册后不可修改。', 409);
  }

  async function resetAccountPassword(input) {
    async function rejectBeforeReset(error, target = null) {
      await appendFailureAudit({
        action: 'reset_account_password',
        targetId: getRecordId(target) || null,
        targetName: target ? (asTrimmedString(target.username) || null) : null,
        targetType: 'account',
        changed: [],
        detail: '管理员账号密码重置请求未能执行。',
      });
      throw error;
    }

    async function readCurrentResetActor() {
      if (!actor || actor.role !== 'super_admin' || asTrimmedString(actor.status) !== 'active') {
        throw new AppError('PERMISSION_DENIED', '只有当前启用的总管理员可以重置账号密码。', 403);
      }
      let currentAccount;
      try {
        currentAccount = getDocument(await db.collection(COLLECTIONS.adminAccounts).doc(actor.accountId).get());
      } catch {
        throw new AppError('DATABASE_READ_FAILED', '暂时无法核对当前管理员身份，请稍后重试。');
      }
      if (!currentAccount
        || getRecordId(currentAccount) !== actor.accountId
        || asTrimmedString(currentAccount.authUid) !== actor.authUid
        || asTrimmedString(currentAccount.status) !== 'active'
        || resolveAccountAuthorization(currentAccount).role !== 'super_admin') {
        throw new AppError('PERMISSION_DENIED', '当前账号已不具备重置密码权限，请刷新后重试。', 403);
      }
      return buildActor(currentAccount, { authUid: actor.authUid });
    }

    async function readCurrentRoster(currentActor) {
      let rosterDocument;
      try {
        rosterDocument = getDocument(await db.collection(COLLECTIONS.adminGovernance)
          .doc(SUPER_ADMIN_GOVERNANCE.rosterId).get());
      } catch {
        throw governanceNotReady();
      }
      const roster = validateGovernanceRoster(rosterDocument);
      if (!['ready', 'over_limit'].includes(roster.state)) throw governanceNotReady();
      assertGovernanceAccountMatchesRoster(roster, {
        _id: currentActor.accountId,
        role: currentActor.role,
        status: currentActor.status,
      });
      if (roster.revision !== expectedRevision) {
        throw new AppError('SUPER_ADMIN_REVISION_CONFLICT', '账号状态已更新，请刷新后重新确认。', 409);
      }
      return roster;
    }

    let currentActor;
    try {
      currentActor = await readCurrentResetActor();
    } catch (error) {
      return rejectBeforeReset(error);
    }
    let accountId;
    let newPassword;
    let expectedRevision;
    try {
      const allowedFields = new Set(['accountId', 'newPassword', 'expectedGovernanceRevision']);
      if (Object.keys(input).some((field) => !allowedFields.has(field))) {
        throw new AppError('VALIDATION_ERROR', '密码重置请求参数无效。', 400);
      }
      accountId = typeof input.accountId === 'string' ? input.accountId.trim() : '';
      newPassword = typeof input.newPassword === 'string' ? input.newPassword : '';
      expectedRevision = expectedGovernanceRevision(input);
      if (!accountId || accountId.length > 240 || hasControlCharacters(accountId)) {
        throw new AppError('VALIDATION_ERROR', '目标账号无效。', 400, { field: 'accountId' });
      }
      const allowedPasswordSpecialCharacters = new Set('()!@#$%^&*|?><_-');
      const hasInvalidPasswordCharacter = [...newPassword].some((character) =>
        !/[A-Za-z0-9]/.test(character) && !allowedPasswordSpecialCharacters.has(character));
      const passwordClasses = [
        /[a-z]/.test(newPassword),
        /[A-Z]/.test(newPassword),
        /[0-9]/.test(newPassword),
        /[^A-Za-z0-9]/.test(newPassword),
      ].filter(Boolean).length;
      if (newPassword.length < 8 || newPassword.length > 32
        || /^[^A-Za-z0-9]/.test(newPassword)
        || hasInvalidPasswordCharacter
        || passwordClasses < 3) {
        throw new AppError('VALIDATION_ERROR', '密码不符合设置要求。', 400, { field: 'newPassword' });
      }
    } catch (error) {
      return rejectBeforeReset(error);
    }
    if (!governanceWritesEnabled) {
      return rejectBeforeReset(governanceNotReady('账号治理写入口当前处于关闭状态。'));
    }
    try {
      await readCurrentRoster(currentActor);
    } catch (error) {
      return rejectBeforeReset(error);
    }
    if (accountId === currentActor.accountId) {
      return rejectBeforeReset(new AppError('ACCOUNT_NOT_FOUND', '未找到可重置的账号。', 404));
    }
    let target;
    try {
      target = getDocument(await db.collection(COLLECTIONS.adminAccounts).doc(accountId).get());
    } catch {
      return rejectBeforeReset(new AppError('DATABASE_READ_FAILED', '读取账号资料失败。'));
    }
    const targetAuthUid = asTrimmedString(target && target.authUid);
    if (!target
      || getRecordId(target) !== accountId
      || asTrimmedString(target.status) !== 'active'
      || !targetAuthUid
      || targetAuthUid === currentActor.authUid
      || isStudentAccount(target)) {
      return rejectBeforeReset(new AppError('ACCOUNT_NOT_FOUND', '未找到可重置的账号。', 404), target);
    }
    const targetRole = resolveAccountAuthorization(target).role;
    if (targetRole === 'super_admin') {
      try {
        const roster = await readCurrentRoster(currentActor);
        assertGovernanceAccountMatchesRoster(roster, target);
      } catch (error) {
        return rejectBeforeReset(error, target);
      }
    }

    const pendingAudit = await appendAudit({
      action: 'reset_account_password',
      targetId: accountId,
      targetName: asTrimmedString(target.username) || null,
      changed: [],
      targetType: 'account',
      result: 'unknown',
      detail: '管理员发起了账号密码重置，结果待确认。',
    });
    async function finishAudit(result, detail) {
      try {
        const writeResult = await db.collection(COLLECTIONS.auditLogs).doc(pendingAudit._id)
          .update({ result, detail });
        assertTransactionWriteDidNotFail(writeResult, '账号密码重置审计结果暂不可确认。');
        return true;
      } catch {
        return false;
      }
    }

    let outcome = 'failure';
    let latestTarget = null;
    try {
      const latestActor = await readCurrentResetActor();
      const latestRoster = await readCurrentRoster(latestActor);
      latestTarget = getDocument(await db.collection(COLLECTIONS.adminAccounts).doc(accountId).get());
      if (!latestTarget
        || getRecordId(latestTarget) !== accountId
        || asTrimmedString(latestTarget.status) !== 'active'
        || asTrimmedString(latestTarget.authUid) !== targetAuthUid
        || isStudentAccount(latestTarget)
        || resolveAccountAuthorization(latestTarget).role !== targetRole) {
        latestTarget = null;
      } else if (targetRole === 'super_admin') {
        assertGovernanceAccountMatchesRoster(latestRoster, latestTarget);
      }
    } catch {
      latestTarget = null;
    }
    if (latestTarget) {
      let manager = null;
      try {
        manager = typeof managerFactory === 'function' ? managerFactory(envId, env) : null;
      } catch {
        manager = null;
      }
      if (manager && manager.user && typeof manager.user.modifyUser === 'function') {
        try {
          const result = await manager.user.modifyUser({ uid: targetAuthUid, password: newPassword });
          const responseData = isPlainObject(result && result.Data)
            ? result.Data
            : isPlainObject(result && result.data) ? result.data : null;
          if (responseData && responseData.Success === true) outcome = 'success';
          else if (responseData && responseData.Success === false) outcome = 'failure';
          else outcome = 'unknown';
        } catch {
          outcome = 'unknown';
        }
      }
    }

    const auditResult = outcome === 'success' ? 'success' : outcome === 'failure' ? 'failure' : 'unknown';
    const auditDetail = outcome === 'success'
      ? '管理员重置了账号密码。'
      : outcome === 'failure'
        ? '管理员重置账号密码失败。'
        : '管理员重置账号密码的结果暂不可确认。';
    const auditConfirmed = await finishAudit(auditResult, auditDetail);
    if (outcome === 'success' && auditConfirmed) return { reset: true };
    if (outcome === 'failure' && auditConfirmed) {
      throw new AppError('PASSWORD_RESET_FAILED', '密码重置未成功，请稍后重试。', 502);
    }
    throw new AppError('PASSWORD_RESET_RESULT_UNKNOWN', '密码重置结果暂不可确认，请核对操作日志后再处理。', 503);
  }

  async function dispatch(route, input) {
    if (NOT_IMPLEMENTED_ROUTES.has(route)) {
      throw new AppError('NOT_IMPLEMENTED', '该功能已预留，但本阶段不提供账号维护或 Excel 导入接口。', 501);
    }

    const routePermission = {
      'employees/create': ['employee.write', 'create_employee'],
      'employees/update': ['employee.write', 'update_employee'],
      'employees/archive': ['employee.write', 'archive_employee'],
      'students/list': ['employee.write', 'view_student_list'],
      'students/get': ['employee.write', 'view_student_detail'],
      'students/create': ['employee.write', 'create_student'],
      'students/update': ['employee.write', 'update_student'],
      'students/archive': ['employee.write', 'archive_student'],
      'students/restore': ['employee.write', 'restore_student'],
      'courses/create': ['history.write', 'add_course'],
      'events/create': ['history.write', 'add_event'],
      'attachments/view': ['attachment.read', 'view_attachment'],
      'attachments/download': ['attachment.read', 'view_attachment'],
      'attachments/upload': ['attachment.write', 'add_attachment'],
      'audit/list': ['audit.read', 'view_audit'],
      'monthlyAssessments/save': ['monthly_assessment_edit', 'save_monthly_assessment'],
      'quarterly/assignment-options': ['quarterly.manage', 'view_quarterly_assignment_options'],
      'quarterly/pending-relations/bind-student': ['quarterly.manage', 'bind_quarterly_relation_student'],
      'quarterly/periods/save': ['quarterly.manage', 'save_quarterly_period'],
      'quarterly/periods/schedule': ['quarterly.manage', 'schedule_quarterly_period'],
      'quarterly/tasks/save': ['quarterly.manage', 'save_quarterly_task'],
      'quarterly/tasks/materialize-confirmed/preview': ['quarterly.manage', 'preview_quarterly_task_materialization'],
      'quarterly/tasks/materialize-confirmed': ['quarterly.manage', 'materialize_quarterly_tasks'],
      'quarterly/tasks/copy-previous/preview': ['quarterly.manage', 'preview_previous_quarterly_task_copy'],
      'quarterly/tasks/copy-previous': ['quarterly.manage', 'copy_previous_quarterly_tasks'],
      'quarterly/overview': ['quarterly.manage', 'view_quarterly_overview'],
      'quarterly/records': ['quarterly.manage', 'view_quarterly_records'],
      'quarterly/revise': ['quarterly.manage', 'revise_quarterly_review'],
      'quarterly/return': ['quarterly.manage', 'return_quarterly_review'],
      'quarterly/void': ['quarterly.manage', 'void_quarterly_review'],
      'accounts/registration-recoveries': ['account.manage', 'view_registration_recoveries'],
      'accounts/recover-registration': ['account.manage', 'recover_registration'],
    }[route];
    if (routePermission && !hasPermission(actor, routePermission[0])) {
      if (route !== 'students/get') {
        await appendFailureAudit({
          action: routePermission[1],
          targetId: asTrimmedString(input.employeeId || input.targetId) || null,
          targetName: route === 'monthlyAssessments/save' ? null : asTrimmedString(input.targetName) || null,
          detail: `拒绝执行${route}：当前账号没有所需权限。`,
        });
      }
      requirePermission(actor, routePermission[0]);
    }

    switch (route) {
      case 'session':
        return {
          account: safeAccount(actor),
          authenticated: true,
        };
      case 'account/update-display-name':
        return rejectAccountDisplayNameUpdate();
      case 'accounts/list':
        return listAccounts();
      case 'accounts/registration-recoveries':
        return listRegistrationRecoveries();
      case 'accounts/recover-registration':
        return recoverRegistration(input);
      case 'accounts/reset-password':
        return resetAccountPassword(input);
      case 'accounts/super-admin-governance/initialize':
        return initializeSuperAdminGovernance(input);
      case 'accounts/super-admin-governance/upgrade-limit':
        return upgradeSuperAdminGovernanceLimit(input);
      case 'accounts/transfer-super-admin':
        return transferSuperAdmin(input);
      case 'accounts/update-role':
        return updateAccountRole(input);
      case 'accounts/grant-permissions':
        return updateAccountPermissions(input, 'grant');
      case 'accounts/revoke-permissions':
        return updateAccountPermissions(input, 'revoke');
      case 'accounts/disable':
        return setAccountStatus(input, 'disabled');
      case 'accounts/restore':
        return setAccountStatus(input, 'active');
      case 'accounts/bind-employee':
        return bindAccountEmployee(input);
      case 'employees/list':
        return listEmployees(input);
      case 'employees/get':
        {
          const employeeId = getEmployeeId(input);
          await requireEmployeeReadAccess(employeeId, 'view_employee');
          const employee = await getEmployee(employeeId);
          return actor.role === 'user' ? scopedEmployeePublic(employee) : employeePublicRecord(employee);
        }
      case 'employees/create':
        return createEmployee(input);
      case 'employees/update':
        return updateEmployee(input);
      case 'employees/archive':
        return archiveEmployee(input);
      case 'students/list':
        return listStudents(input);
      case 'students/get':
        return getStudentDetails(input);
      case 'students/create':
        return createStudent(input);
      case 'students/update':
        return updateStudent(input);
      case 'students/archive':
        return setStudentStatus(input, 'inactive');
      case 'students/restore':
        return setStudentStatus(input, 'active');
      case 'courses/create':
        return createCourse(input);
      case 'events/create':
        return createEvent(input);
      case 'attachments/view':
        return viewAttachment(input);
      case 'attachments/upload':
        return uploadAttachment(input);
      case 'attachments/download':
        return downloadAttachment(input);
      case 'audit/list':
        return listAudit(input);
      case 'monthlyAssessments/overview':
        return getMonthlyOverview(input);
      case 'monthlyAssessments/get':
        return getMonthlyAssessment(input);
      case 'monthlyAssessments/save':
        return saveMonthlyAssessment(input);
      case 'quarterly/periods/list':
        return listQuarterlyPeriods();
      case 'quarterly/assignment-options':
        return getQuarterlyAssignmentOptions();
      case 'quarterly/pending-relations/bind-student':
        return bindQuarterlyPendingRelationToStudent(input);
      case 'quarterly/periods/save':
        return saveQuarterlyPeriod(input);
      case 'quarterly/periods/schedule':
        return scheduleQuarterlyPeriod(input);
      case 'quarterly/tasks/save':
        return saveQuarterlyTasks(input);
      case 'quarterly/tasks/materialize-confirmed/preview':
        return quarterlyMaterializationPreview(input);
      case 'quarterly/tasks/materialize-confirmed':
        return quarterlyMaterializationExecute(input);
      case 'quarterly/tasks/copy-previous/preview':
        return quarterlyPreviousTaskCopyPreview(input);
      case 'quarterly/tasks/copy-previous':
        return quarterlyPreviousTaskCopyExecute(input);
      case 'quarterly/my-tasks':
        return getMyQuarterlyTasks(input);
      case 'quarterly/task':
        return getQuarterlyTaskDetail(input);
      case 'quarterly/draft':
        return hasOwn(input, 'expectedVersion') || hasOwn(input, 'scores') || hasOwn(input, 'reasons')
          ? saveQuarterlyEvaluation(input, 'draft')
          : getQuarterlyDraft(input);
      case 'quarterly/submit':
        return saveQuarterlyEvaluation(input, 'submit');
      case 'quarterly/my-results':
        return getMyQuarterlyResults(input);
      case 'quarterly/overview':
        return getQuarterlyOverview(input);
      case 'quarterly/records':
        return listQuarterlyRecords(input);
      case 'quarterly/revise':
        return reviseQuarterlyRecord(input);
      case 'quarterly/return':
        return manageQuarterlyRecord(input, 'return');
      case 'quarterly/void':
        return manageQuarterlyRecord(input, 'void');
      case 'quarterly/history':
        return getQuarterlyHistory(input);
      default:
        throw new AppError('ROUTE_NOT_FOUND', '未找到对应的员工档案服务路由。', 404);
    }
  }

  return { dispatch };
}

function createHandler({
  sdkFactory = loadCloudBaseSdk,
  managerFactory = createCloudBaseManager,
  env = process.env,
  now = () => new Date().toISOString(),
  requestIdFactory = createRequestId,
} = {}) {
  return async function main(event) {
    const requestId = requestIdFactory();
    let requestRoute;
    try {
      const { route, input } = normalizeRequest(event);
      requestRoute = route;
      const envId = getEnvironmentId(env);
      const publicRegistrationRoute = route === 'accounts/register' || route === 'accounts/invitations/preview';
      const publicPasswordResetRoute = route === 'accounts/self-reset-password';
      const storageAuthority = publicRegistrationRoute || publicPasswordResetRoute ? null : getStorageAuthority(envId);
      const sdk = sdkFactory();
      const app = sdk.init({ env: envId });
      const auth = app.auth();
      const db = app.database();
      if (route === 'accounts/register') {
        if (hasOwn(input, 'invitationCode') && !hasOwn(input, 'phoneNumber')) {
          throw new AppError('REGISTRATION_METHOD_RETIRED', '邀请码注册方式已停用，请使用手机号注册。', 410);
        }
        const data = await registerAccountByPhone({ db, managerFactory, envId, env, input, requestId, now });
        return successResponse(requestId, data);
      }
      if (route === 'accounts/invitations/preview') {
        throw new AppError('REGISTRATION_METHOD_RETIRED', '邀请码注册方式已停用，请使用手机号注册。', 410);
      }
      if (publicPasswordResetRoute) {
        const data = await resetAccountPasswordByIdentity({ db, auth, managerFactory, envId, env, input, requestId, now });
        return successResponse(requestId, data);
      }
      const identity = await readCallerIdentity(auth);
      const account = await findActiveAccount(db, identity.authUid);
      const actor = buildActor(account, identity);
      const router = createRouter({ db, storage: app, actor, requestId, storageAuthority, managerFactory, envId, now, env });
      const data = await router.dispatch(route, input);
      return successResponse(requestId, data);
    } catch (error) {
      if (requestRoute === 'accounts/register') {
        logPhoneRegistrationDiagnostic({ requestId, reasonCode: 'REGISTRATION_REQUEST_FAILED', error });
      }
      return errorResponse(requestId, error);
    }
  };
}

exports.main = createHandler();
exports.AppError = AppError;
exports.COLLECTIONS = COLLECTIONS;
exports.createHandler = createHandler;
exports.createRequestId = createRequestId;
exports.getEnvironmentId = getEnvironmentId;
exports.getStorageAuthority = getStorageAuthority;
exports.normalizeEmployeeInput = normalizeEmployeeInput;
exports.normalizeRegistrationInput = normalizeRegistrationInput;
exports.normalizeMonthlyMonthKey = normalizeMonthlyMonthKey;
exports.normalizeMonthlyResults = normalizeMonthlyResults;
exports.normalizeMonthlyNote = normalizeMonthlyNote;
exports.resolveAccountAuthorization = resolveAccountAuthorization;
exports.MANAGED_PERMISSIONS = MANAGED_PERMISSIONS;
exports.MONTHLY_ASSESSMENT_METRICS = MONTHLY_ASSESSMENT_METRICS;
exports.DEFAULT_MONTHLY_ROSTER_KEY = DEFAULT_MONTHLY_ROSTER_KEY;
exports.normalizeRequest = normalizeRequest;
exports.readCallerIdentity = readCallerIdentity;
exports.auditSummary = auditSummary;
exports.safePublicRecord = safePublicRecord;
