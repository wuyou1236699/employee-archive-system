/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { COLLECTIONS, DEFAULT_MONTHLY_ROSTER_KEY, createHandler } = require('./index');

const TEST_ENV_ID = 'archive-demo-environment';
const CURRENT_MONTH = '2026-09';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createMonthlyMock({ identity, account, employees = [], roster = [], targets = [], assessments = [], audits = [], targetPairRaceIds = [], targetReferencePayloadIdsWithoutRecordId = [], targetReferenceMissingDocumentReturnsEmptyObject = false }) {
  const state = {
    accounts: [clone(account)],
    employees: clone(employees),
    roster: clone(roster),
    targets: clone(targets),
    assessments: clone(assessments),
    audits: clone(audits),
  };
  let sequence = 1;
  const simulatedEmptyTargetPairReads = new Set(targetPairRaceIds);
  const targetReferencePayloadIdsWithoutRecordIdSet = new Set(targetReferencePayloadIdsWithoutRecordId);

  function rowsFor(collectionName) {
    if (collectionName === COLLECTIONS.adminAccounts) return state.accounts;
    if (collectionName === COLLECTIONS.employees) return state.employees;
    if (collectionName === COLLECTIONS.monthlyAssessmentRoster) return state.roster;
    if (collectionName === COLLECTIONS.monthlyAssessmentTargets) return state.targets;
    if (collectionName === COLLECTIONS.monthlyAssessments) return state.assessments;
    if (collectionName === COLLECTIONS.auditLogs) return state.audits;
    throw new Error(`Unexpected collection: ${collectionName}`);
  }

  function buildCollection(collectionName) {
    const initialRows = rowsFor(collectionName);
    let rows = initialRows;
    const query = {
      where(filter) {
        if (collectionName === COLLECTIONS.monthlyAssessmentTargets && Object.prototype.hasOwnProperty.call(filter, 'monthKey') && Object.prototype.hasOwnProperty.call(filter, 'employeeId')) {
          const pairKey = `target:${filter.monthKey}:${filter.employeeId}`;
          if (simulatedEmptyTargetPairReads.delete(pairKey)) {
            rows = [];
            return query;
          }
        }
        rows = rows.filter((row) => Object.entries(filter).every(([key, value]) => row[key] === value));
        return query;
      },
      limit(count) {
        rows = rows.slice(0, count);
        return query;
      },
      async get() {
        return { data: rows.map(clone) };
      },
      doc(id) {
        return {
          async get() {
            const row = initialRows.find((item) => String(item._id || item.id) === String(id));
            if (!row) {
              if (collectionName === COLLECTIONS.monthlyAssessmentTargets && targetReferenceMissingDocumentReturnsEmptyObject) {
                return { data: {} };
              }
              return { data: [] };
            }
            const payload = clone(row);
            if (collectionName === COLLECTIONS.monthlyAssessmentTargets && targetReferencePayloadIdsWithoutRecordIdSet.has(String(id))) {
              delete payload._id;
              delete payload.id;
            }
            return { data: payload };
          },
          async update(payload) {
            const row = initialRows.find((item) => String(item._id || item.id) === String(id));
            if (!row) throw new Error('document not found');
            Object.assign(row, clone(payload));
            return { updated: 1 };
          },
          async set(payload) {
            const row = initialRows.find((item) => String(item._id || item.id) === String(id));
            if (row) Object.assign(row, clone(payload));
            else initialRows.push({ ...clone(payload), _id: id });
            return { id };
          },
        };
      },
      async add(payload) {
        const id = `${collectionName}-test-${sequence}`;
        sequence += 1;
        initialRows.unshift({ ...clone(payload), _id: id });
        return { id };
      },
    };
    return query;
  }

  function makeDatabase() {
    return {
      collection(collectionName) {
        return buildCollection(collectionName);
      },
      async runTransaction(work) {
        return work({ collection: (collectionName) => buildCollection(collectionName) });
      },
    };
  }

  const sdk = {
    init(options) {
      assert.deepEqual(options, { env: TEST_ENV_ID });
      return {
        auth() {
          return { getUserInfo: () => identity };
        },
        database: makeDatabase,
      };
    },
  };

  return { sdk, state };
}

function handlerWith(mock) {
  return createHandler({
    sdkFactory: () => mock.sdk,
    env: { TCB_ENV_ID: TEST_ENV_ID },
    now: () => '2026-09-15T08:00:00.000Z',
    requestIdFactory: () => 'monthly-request-001',
  });
}

function targetForMonth(monthKey, employeeId, overrides = {}) {
  return {
    _id: `target:${monthKey}:${employeeId}`,
    monthKey,
    employeeId,
    eligible: true,
    matchStatus: 'matched',
    ...overrides,
  };
}

function target(employeeId) {
  return targetForMonth(CURRENT_MONTH, employeeId);
}

function employee(employeeId, name = '月度员工') {
  return { _id: employeeId, name, department: '演示研发组', status: 'active' };
}

function rosterRow(employeeId, sourceName = 'Excel姓名', sourceRows = [3], rosterVersion = 1) {
  return {
    _id: `roster:${DEFAULT_MONTHLY_ROSTER_KEY}:${employeeId}`,
    rosterKey: DEFAULT_MONTHLY_ROSTER_KEY,
    rosterVersion,
    employeeId,
    enabled: true,
    sourceName,
    sourceNameNormalized: sourceName,
    sourceFileName: '2026月度考核表(1).xlsx',
    sourceSheet: '月度考核明细',
    sourceRows,
  };
}

test('read-only users can view the monthly overview but cannot save', async () => {
  const mock = createMonthlyMock({
    identity: { uid: 'monthly-reader' },
    account: { _id: 'account-reader', authUid: 'monthly-reader', username: 'reader', displayName: '只读管理员查看账号', role: 'admin', permissions: [], status: 'active' },
    employees: [employee('employee-monthly-1')],
    roster: [rosterRow('employee-monthly-1')],
    targets: [target('employee-monthly-1')],
  });
  const handler = handlerWith(mock);

  const overview = await handler({
    route: 'monthlyAssessments/overview',
    input: { monthKey: CURRENT_MONTH, metric: 'all', metricStatus: 'all', page: 1, pageSize: 50 },
  });
  assert.equal(overview.ok, true);
  assert.equal(overview.data.stats.eligibleActiveCount, 1);
  assert.equal(overview.data.items[0].hasRecord, false);
  assert.deepEqual(overview.data.items[0].results, {
    meeting: 'unassessed', renewalRate: 'unassessed', influence: 'unassessed', visits: 'unassessed', nineGrid: 'unassessed',
  });
  assert.equal(overview.data.stats.metrics.meeting.achievementRate, null);

  const save = await handler({
    route: 'monthlyAssessments/save',
    input: {
      employeeId: 'employee-monthly-1',
      monthKey: CURRENT_MONTH,
      results: { meeting: 'achieved', renewalRate: 'unassessed', influence: 'unassessed', visits: 'unassessed', nineGrid: 'unassessed' },
      note: '',
      expectedVersion: 0,
    },
  });
  assert.equal(save.ok, false);
  assert.equal(save.error.code, 'PERMISSION_DENIED');
  assert.equal(mock.state.assessments.length, 0);
  assert.equal(mock.state.audits[0].result, 'failure');
});

test('monthly editor saves three-state results, returns the record, and rejects stale versions', async () => {
  const mock = createMonthlyMock({
    identity: { uid: 'monthly-editor' },
    account: { _id: 'account-editor', authUid: 'monthly-editor', username: 'editor', displayName: '考核管理员', role: 'admin', permissions: ['monthly_assessment_edit'], status: 'active' },
    employees: [employee('employee-monthly-2', '第二名员工')],
    roster: [rosterRow('employee-monthly-2')],
    targets: [target('employee-monthly-2')],
  });
  const handler = handlerWith(mock);
  const results = { meeting: 'achieved', renewalRate: 'not_achieved', influence: 'unassessed', visits: 'achieved', nineGrid: 'unassessed' };

  const saved = await handler({
    route: 'monthlyAssessments/save',
    input: { employeeId: 'employee-monthly-2', monthKey: CURRENT_MONTH, results, note: '  本月复盘\r\n已完成  ', expectedVersion: 0 },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.data.version, 1);
  assert.equal(saved.data.filledCount, 3);
  assert.equal(saved.data.note, '本月复盘\n已完成');
  assert.equal(mock.state.audits[0].action, 'save_monthly_assessment');
  assert.equal(mock.state.audits[0].result, 'success');

  const stale = await handler({
    route: 'monthlyAssessments/save',
    input: { employeeId: 'employee-monthly-2', monthKey: CURRENT_MONTH, results, note: '覆盖尝试', expectedVersion: 0 },
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'MONTHLY_ASSESSMENT_VERSION_CONFLICT');
  assert.equal(mock.state.assessments[0].version, 1);
  assert.equal(mock.state.assessments[0].note, '本月复盘\n已完成');
  assert.equal(mock.state.audits[0].result, 'failure');

  const filtered = await handler({
    route: 'monthlyAssessments/overview',
    input: { monthKey: CURRENT_MONTH, metric: 'meeting', metricStatus: 'achieved', page: 1, pageSize: 50 },
  });
  assert.equal(filtered.ok, true);
  assert.equal(filtered.data.total, 1);
  assert.equal(filtered.data.stats.metrics.meeting.achieved, 1);
  assert.equal(filtered.data.stats.metrics.renewalRate.not_achieved, 1);
});

test('monthly routes reject future months and employees outside the confirmed target list', async () => {
  const mock = createMonthlyMock({
    identity: { uid: 'monthly-editor-2' },
    account: { _id: 'account-editor-2', authUid: 'monthly-editor-2', username: 'editor2', displayName: '考核管理员二', role: 'admin', permissions: ['monthly_assessment_edit'], status: 'active' },
    employees: [employee('employee-outside')],
    targets: [],
  });
  const handler = handlerWith(mock);
  const future = await handler({ route: 'monthlyAssessments/overview', input: { monthKey: '2999-01' } });
  assert.equal(future.ok, false);
  assert.equal(future.error.code, 'MONTHLY_FUTURE_MONTH');

  const futureDetail = await handler({
    route: 'monthlyAssessments/get',
    input: { employeeId: 'employee-outside', monthKey: '2999-01' },
  });
  assert.equal(futureDetail.ok, false);
  assert.equal(futureDetail.error.code, 'MONTHLY_FUTURE_MONTH');

  const futureSave = await handler({
    route: 'monthlyAssessments/save',
    input: {
      employeeId: 'employee-outside',
      monthKey: '2999-01',
      results: { meeting: 'unassessed', renewalRate: 'unassessed', influence: 'unassessed', visits: 'unassessed', nineGrid: 'unassessed' },
      note: '',
      expectedVersion: 0,
    },
  });
  assert.equal(futureSave.ok, false);
  assert.equal(futureSave.error.code, 'MONTHLY_FUTURE_MONTH');

  const outside = await handler({
    route: 'monthlyAssessments/save',
    input: {
      employeeId: 'employee-outside',
      monthKey: CURRENT_MONTH,
      results: { meeting: 'unassessed', renewalRate: 'unassessed', influence: 'unassessed', visits: 'unassessed', nineGrid: 'unassessed' },
      note: '',
      expectedVersion: 0,
    },
  });
  assert.equal(outside.ok, false);
  assert.equal(outside.error.code, 'MONTHLY_TARGET_NOT_FOUND');
  assert.equal(mock.state.assessments.length, 0);
});

test('current month materializes the fixed roster once and excludes former members from active statistics', async () => {
  const mock = createMonthlyMock({
    identity: { uid: 'monthly-roster-reader' },
    account: { _id: 'account-roster-reader', authUid: 'monthly-roster-reader', username: 'roster-reader', displayName: '名单查看管理员', role: 'admin', permissions: [], status: 'active' },
    employees: [employee('employee-roster-active', '当前在职员工'), { ...employee('employee-roster-former', '历史成员'), status: 'former' }],
    roster: [rosterRow('employee-roster-active', 'Excel在职姓名', [3]), rosterRow('employee-roster-former', 'Excel历史姓名', [4])],
  });
  const handler = handlerWith(mock);
  const input = { monthKey: CURRENT_MONTH, metric: 'all', metricStatus: 'all', page: 1, pageSize: 50 };

  const first = await handler({ route: 'monthlyAssessments/overview', input });
  assert.equal(first.ok, true);
  assert.equal(first.data.total, 1);
  assert.equal(first.data.stats.eligibleActiveCount, 1);
  assert.equal(mock.state.targets.length, 2);
  assert.equal(mock.state.targets[0].rosterKey, DEFAULT_MONTHLY_ROSTER_KEY);
  assert.equal(mock.state.targets[0].sourceFileName, '2026月度考核表(1).xlsx');
  assert.deepEqual(mock.state.targets[0].sourceRows, [3]);
  assert.equal(mock.state.audits.filter((item) => item.action === 'materialize_monthly_assessment_targets' && item.result === 'success').length, 1);

  const second = await handler({ route: 'monthlyAssessments/overview', input });
  assert.equal(second.ok, true);
  assert.equal(second.data.total, 1);
  assert.equal(mock.state.targets.length, 2);
  assert.equal(mock.state.audits.filter((item) => item.action === 'materialize_monthly_assessment_targets' && item.result === 'success').length, 1);
});

test('current month reuses a deterministic target created between the pair lookup and reference read', async () => {
  const employeeId = 'employee-roster-race';
  const mock = createMonthlyMock({
    identity: { uid: 'monthly-race-reader' },
    account: { _id: 'account-race-reader', authUid: 'monthly-race-reader', username: 'race-reader', displayName: '并发查看管理员', role: 'admin', permissions: [], status: 'active' },
    employees: [employee(employeeId)],
    roster: [rosterRow(employeeId)],
    targets: [target(employeeId)],
    targetPairRaceIds: [`target:${CURRENT_MONTH}:${employeeId}`],
  });
  const handler = handlerWith(mock);
  const input = { monthKey: CURRENT_MONTH, metric: 'all', metricStatus: 'all', page: 1, pageSize: 50 };

  const first = await handler({ route: 'monthlyAssessments/overview', input });
  assert.equal(first.ok, true);
  assert.equal(first.data.total, 1);
  assert.equal(mock.state.targets.length, 1);

  const second = await handler({ route: 'monthlyAssessments/overview', input });
  assert.equal(second.ok, true);
  assert.equal(second.data.total, 1);
  assert.equal(mock.state.targets.length, 1);
});

test('current month trusts deterministic references when doc.get payload omits _id and id', async () => {
  const employeeIds = Array.from({ length: 16 }, (_, index) => `employee-deterministic-${index + 1}`);
  const deterministicTargetIds = employeeIds.map((employeeId) => `target:${CURRENT_MONTH}:${employeeId}`);
  const mock = createMonthlyMock({
    identity: { uid: 'monthly-deterministic-reader' },
    account: { _id: 'account-deterministic-reader', authUid: 'monthly-deterministic-reader', username: 'deterministic-reader', displayName: '确定性引用管理员', role: 'admin', permissions: [], status: 'active' },
    employees: employeeIds.map((employeeId, index) => employee(employeeId, `确定性员工${index + 1}`)),
    roster: employeeIds.map((employeeId, index) => rosterRow(employeeId, `Excel确定性姓名${index + 1}`, [index + 3])),
    targets: employeeIds.map((employeeId) => target(employeeId)),
    targetPairRaceIds: deterministicTargetIds,
    targetReferencePayloadIdsWithoutRecordId: deterministicTargetIds,
  });
  const handler = handlerWith(mock);
  const overview = await handler({
    route: 'monthlyAssessments/overview',
    input: { monthKey: CURRENT_MONTH, metric: 'all', metricStatus: 'all', page: 1, pageSize: 50 },
  });

  assert.equal(overview.ok, true);
  assert.equal(overview.data.total, 16);
  assert.equal(overview.data.stats.eligibleActiveCount, 16);
  assert.equal(mock.state.targets.length, 16);
  assert.equal(mock.state.audits.some((item) => item.result === 'failure' && item.detail.includes('MONTHLY_TARGET_SNAPSHOT_CONFLICT')), false);

  const detail = await handler({
    route: 'monthlyAssessments/get',
    input: { employeeId: employeeIds[0], monthKey: CURRENT_MONTH },
  });
  assert.equal(detail.ok, true);
  assert.equal(detail.data.inScope, true);
  assert.equal(detail.data.employeeId, employeeIds[0]);
});

test('current month materializes all 16 roster targets when missing deterministic reads return empty documents', async () => {
  const employeeIds = Array.from({ length: 16 }, (_, index) => `employee-empty-reference-${index + 1}`);
  const mock = createMonthlyMock({
    identity: { uid: 'monthly-empty-reference-reader' },
    account: { _id: 'account-empty-reference-reader', authUid: 'monthly-empty-reference-reader', username: 'empty-reference-reader', displayName: '空对象引用管理员', role: 'admin', permissions: [], status: 'active' },
    employees: employeeIds.map((employeeId, index) => employee(employeeId, `空对象员工${index + 1}`)),
    roster: employeeIds.map((employeeId, index) => rosterRow(employeeId, `Excel空对象姓名${index + 1}`, [index + 3])),
    targets: [],
    targetReferenceMissingDocumentReturnsEmptyObject: true,
  });
  const handler = handlerWith(mock);
  const overview = await handler({
    route: 'monthlyAssessments/overview',
    input: { monthKey: CURRENT_MONTH, metric: 'all', metricStatus: 'all', page: 1, pageSize: 50 },
  });

  assert.equal(overview.ok, true);
  assert.equal(overview.data.total, 16);
  assert.equal(overview.data.stats.eligibleActiveCount, 16);
  assert.equal(mock.state.targets.length, 16);
  assert.deepEqual(new Set(mock.state.targets.map((item) => item.employeeId)), new Set(employeeIds));

  const detail = await handler({
    route: 'monthlyAssessments/get',
    input: { employeeId: employeeIds[0], monthKey: CURRENT_MONTH },
  });
  assert.equal(detail.ok, true);
  assert.equal(detail.data.inScope, true);
  assert.equal(detail.data.employeeId, employeeIds[0]);
});

test('saving the first current-month assessment materializes the fixed roster before writing the result', async () => {
  const mock = createMonthlyMock({
    identity: { uid: 'monthly-roster-editor' },
    account: { _id: 'account-roster-editor', authUid: 'monthly-roster-editor', username: 'roster-editor', displayName: '名单编辑账号', role: 'admin', permissions: ['monthly_assessment_edit'], status: 'active' },
    employees: [employee('employee-roster-save')],
    roster: [rosterRow('employee-roster-save', 'Excel来源姓名', [5])],
  });
  const response = await handlerWith(mock)({
    route: 'monthlyAssessments/save',
    input: {
      employeeId: 'employee-roster-save',
      monthKey: CURRENT_MONTH,
      results: { meeting: 'achieved', renewalRate: 'unassessed', influence: 'unassessed', visits: 'unassessed', nineGrid: 'unassessed' },
      note: '',
      expectedVersion: 0,
    },
  });
  assert.equal(response.ok, true);
  assert.equal(mock.state.targets.length, 1);
  assert.equal(mock.state.assessments.length, 1);
  assert.equal(mock.state.targets[0]._id, `target:${CURRENT_MONTH}:employee-roster-save`);
});

test('current month excludes orphan targets that are not in the enabled default roster', async () => {
  const mock = createMonthlyMock({
    identity: { uid: 'monthly-roster-filter-reader' },
    account: { _id: 'account-roster-filter-reader', authUid: 'monthly-roster-filter-reader', username: 'roster-filter-reader', displayName: '名单范围管理员', role: 'admin', permissions: [], status: 'active' },
    employees: [employee('employee-roster-kept', '固定名单员工'), employee('employee-roster-orphan', '孤立对象员工'), employee('employee-roster-disabled', '停用名单员工')],
    roster: [
      rosterRow('employee-roster-kept', '固定名单来源姓名', [6]),
      { ...rosterRow('employee-roster-disabled', '停用名单来源姓名', [7]), enabled: false },
    ],
    targets: [target('employee-roster-orphan'), target('employee-roster-disabled')],
  });
  const response = await handlerWith(mock)({
    route: 'monthlyAssessments/overview',
    input: { monthKey: CURRENT_MONTH, page: 1, pageSize: 50 },
  });
  assert.equal(response.ok, true);
  assert.equal(response.data.total, 1);
  assert.equal(response.data.items[0].employeeId, 'employee-roster-kept');
  assert.equal(mock.state.targets.length, 3);
});

test('existing current-month target is not overwritten and a missing roster employee fails explicitly', async () => {
  const existingTarget = {
    ...target('employee-roster-existing'),
    _id: `target:${CURRENT_MONTH}:employee-roster-existing`,
    employeeNameSnapshot: '已存在的历史快照',
    departmentSnapshot: '旧部门',
    employmentStatusSnapshot: 'active',
    sourceName: '原始来源姓名',
  };
  const existingMock = createMonthlyMock({
    identity: { uid: 'monthly-existing-reader' },
    account: { _id: 'account-existing-reader', authUid: 'monthly-existing-reader', username: 'existing-reader', displayName: '已有对象管理员', role: 'admin', permissions: [], status: 'active' },
    employees: [employee('employee-roster-existing', '当前主档姓名')],
    roster: [rosterRow('employee-roster-existing', '新的来源姓名', [8])],
    targets: [existingTarget],
  });
  const existingResponse = await handlerWith(existingMock)({
    route: 'monthlyAssessments/overview',
    input: { monthKey: CURRENT_MONTH, page: 1, pageSize: 50 },
  });
  assert.equal(existingResponse.ok, true);
  assert.equal(existingMock.state.targets.length, 1);
  assert.equal(existingMock.state.targets[0].employeeNameSnapshot, '已存在的历史快照');
  assert.equal(existingMock.state.targets[0].sourceName, '原始来源姓名');

  const missingMock = createMonthlyMock({
    identity: { uid: 'monthly-missing-reader' },
    account: { _id: 'account-missing-reader', authUid: 'monthly-missing-reader', username: 'missing-reader', displayName: '缺失员工管理员', role: 'admin', permissions: [], status: 'active' },
    employees: [],
    roster: [rosterRow('employee-roster-missing', '缺失来源姓名', [9])],
  });
  const missingResponse = await handlerWith(missingMock)({
    route: 'monthlyAssessments/overview',
    input: { monthKey: CURRENT_MONTH, page: 1, pageSize: 50 },
  });
  assert.equal(missingResponse.ok, false);
  assert.equal(missingResponse.error.code, 'MONTHLY_ROSTER_EMPLOYEE_NOT_FOUND');
  assert.equal(missingMock.state.targets.length, 0);
  assert.equal(missingMock.state.audits[0].result, 'failure');
});

test('historical monthly overview materializes the default roster on first access and remains idempotent', async () => {
  const historicalMonth = '2026-08';
  const activeEmployeeId = 'employee-history-materialized-active';
  const formerEmployeeId = 'employee-history-materialized-former';
  const mock = createMonthlyMock({
    identity: { uid: 'monthly-history-materializer' },
    account: { _id: 'account-history-materializer', authUid: 'monthly-history-materializer', username: 'history-materializer', displayName: '历史物化管理员', role: 'admin', permissions: [], status: 'active' },
    employees: [
      employee(activeEmployeeId, '档案当前姓名'),
      { ...employee(formerEmployeeId, '已离职档案姓名'), department: '历史部门', status: 'former' },
    ],
    roster: [
      rosterRow(activeEmployeeId, 'Excel中不同的姓名', [13]),
      rosterRow(formerEmployeeId, 'Excel中另一不同姓名', [14]),
    ],
  });
  const handler = handlerWith(mock);
  const input = { monthKey: historicalMonth, metric: 'all', metricStatus: 'all', page: 1, pageSize: 50 };

  const first = await handler({ route: 'monthlyAssessments/overview', input });
  assert.equal(first.ok, true);
  assert.equal(first.data.total, 1);
  assert.equal(first.data.items[0].employeeId, activeEmployeeId);
  assert.equal(first.data.items[0].employeeName, '档案当前姓名');
  assert.equal(mock.state.targets.length, 2);
  assert.deepEqual(mock.state.targets.map((item) => item._id).sort(), [
    `target:${historicalMonth}:${activeEmployeeId}`,
    `target:${historicalMonth}:${formerEmployeeId}`,
  ].sort());
  const activeTarget = mock.state.targets.find((item) => item.employeeId === activeEmployeeId);
  const formerTarget = mock.state.targets.find((item) => item.employeeId === formerEmployeeId);
  assert.equal(activeTarget.employeeNameSnapshot, '档案当前姓名');
  assert.equal(activeTarget.departmentSnapshot, '演示研发组');
  assert.equal(activeTarget.employmentStatusSnapshot, 'active');
  assert.equal(activeTarget.sourceName, 'Excel中不同的姓名');
  assert.equal(formerTarget.employeeNameSnapshot, '已离职档案姓名');
  assert.equal(formerTarget.employmentStatusSnapshot, 'former');
  assert.equal(mock.state.audits.filter((item) => item.action === 'materialize_monthly_assessment_targets' && item.result === 'success').length, 1);

  const second = await handler({ route: 'monthlyAssessments/overview', input });
  assert.equal(second.ok, true);
  assert.equal(second.data.total, 1);
  assert.equal(mock.state.targets.length, 2);
  assert.equal(mock.state.audits.filter((item) => item.action === 'materialize_monthly_assessment_targets' && item.result === 'success').length, 1);

  mock.state.employees[0].name = '后来修改的主档姓名';
  mock.state.employees[0].department = '后来修改的部门';
  mock.state.employees[0].status = 'former';
  const newlyAddedEmployeeId = 'employee-history-materialized-later';
  mock.state.employees.push(employee(newlyAddedEmployeeId, '后来新增员工'));
  mock.state.roster.push(rosterRow(newlyAddedEmployeeId, '后来新增的Excel姓名', [17]));

  const frozen = await handler({ route: 'monthlyAssessments/overview', input });
  assert.equal(frozen.ok, true);
  assert.equal(frozen.data.total, 1);
  assert.equal(frozen.data.items[0].employeeId, activeEmployeeId);
  assert.equal(frozen.data.items[0].employeeName, '档案当前姓名');
  assert.equal(frozen.data.items[0].department, '演示研发组');
  assert.equal(mock.state.targets.length, 2);
  assert.equal(mock.state.targets.some((item) => item.employeeId === newlyAddedEmployeeId), false);
});

test('historical monthly detail uses the saved target snapshot without rereading current employee data', async () => {
  const historicalMonth = '2026-08';
  const employeeId = 'employee-history-detail';
  const mock = createMonthlyMock({
    identity: { uid: 'monthly-history-detail-reader' },
    account: { _id: 'account-history-detail-reader', authUid: 'monthly-history-detail-reader', username: 'history-detail-reader', displayName: '历史详情管理员', role: 'admin', permissions: [], status: 'active' },
    employees: [employee(employeeId, '首次物化姓名')],
    roster: [rosterRow(employeeId, 'Excel来源姓名', [15])],
  });
  const handler = handlerWith(mock);

  const firstDetail = await handler({
    route: 'monthlyAssessments/get',
    input: { employeeId, monthKey: historicalMonth },
  });
  assert.equal(firstDetail.ok, true);
  assert.equal(firstDetail.data.inScope, true);
  assert.equal(mock.state.targets.length, 1);

  mock.state.employees.length = 0;
  const detail = await handler({
    route: 'monthlyAssessments/get',
    input: { employeeId, monthKey: historicalMonth },
  });
  assert.equal(detail.ok, true);
  assert.equal(detail.data.inScope, true);
  assert.equal(detail.data.employeeId, employeeId);
  assert.equal(detail.data.employeeName, '首次物化姓名');
  assert.equal(detail.data.department, '演示研发组');
  assert.equal(detail.data.employmentStatus, 'active');
});

test('monthly editor can save a historical assessment after first target materialization', async () => {
  const historicalMonth = '2026-08';
  const employeeId = 'employee-history-save';
  const mock = createMonthlyMock({
    identity: { uid: 'monthly-history-editor' },
    account: { _id: 'account-history-editor', authUid: 'monthly-history-editor', username: 'history-editor', displayName: '历史考核管理员', role: 'admin', permissions: ['monthly_assessment_edit'], status: 'active' },
    employees: [employee(employeeId, '历史保存员工')],
    roster: [rosterRow(employeeId, 'Excel保存来源姓名', [16])],
  });

  const saved = await handlerWith(mock)({
    route: 'monthlyAssessments/save',
    input: {
      employeeId,
      monthKey: historicalMonth,
      results: { meeting: 'achieved', renewalRate: 'not_achieved', influence: 'unassessed', visits: 'achieved', nineGrid: 'unassessed' },
      note: '历史月份修订',
      expectedVersion: 0,
    },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.data.inScope, true);
  assert.equal(saved.data.employeeName, '历史保存员工');
  assert.equal(saved.data.version, 1);
  assert.equal(saved.data.filledCount, 3);
  assert.equal(mock.state.targets.length, 1);
  assert.equal(mock.state.targets[0].employeeNameSnapshot, '历史保存员工');
  assert.equal(mock.state.targets[0].departmentSnapshot, '演示研发组');
  assert.equal(mock.state.targets[0].employmentStatusSnapshot, 'active');
  assert.equal(mock.state.assessments.length, 1);
  assert.equal(mock.state.assessments[0].monthKey, historicalMonth);
});

test('read-only users cannot save a historical assessment', async () => {
  const historicalMonth = '2026-08';
  const employeeId = 'employee-history-read-only';
  const mock = createMonthlyMock({
    identity: { uid: 'monthly-history-reader-save-attempt' },
    account: { _id: 'account-history-reader-save-attempt', authUid: 'monthly-history-reader-save-attempt', username: 'history-reader-save-attempt', displayName: '历史只读管理员', role: 'admin', permissions: [], status: 'active' },
    employees: [employee(employeeId)],
    roster: [rosterRow(employeeId)],
  });

  const response = await handlerWith(mock)({
    route: 'monthlyAssessments/save',
    input: {
      employeeId,
      monthKey: historicalMonth,
      results: { meeting: 'achieved', renewalRate: 'unassessed', influence: 'unassessed', visits: 'unassessed', nineGrid: 'unassessed' },
      note: '',
      expectedVersion: 0,
    },
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'PERMISSION_DENIED');
  assert.equal(mock.state.targets.length, 0);
  assert.equal(mock.state.assessments.length, 0);
});

test('historical monthly overview uses the saved target snapshot instead of current employee data', async () => {
  const historicalMonth = '2026-08';
  const mock = createMonthlyMock({
    identity: { uid: 'monthly-history-reader' },
    account: { _id: 'account-history-reader', authUid: 'monthly-history-reader', username: 'history-reader', displayName: '历史查看管理员', role: 'admin', permissions: [], status: 'active' },
    employees: [employee('employee-history-1', '当前主档姓名')],
    roster: [rosterRow('employee-history-1', '当前Excel姓名', [18])],
    targets: [{
      _id: `target:${historicalMonth}:employee-history-1`,
      monthKey: historicalMonth,
      employeeId: 'employee-history-1',
      eligible: true,
      matchStatus: 'matched',
      employeeNameSnapshot: '历史快照姓名',
      departmentSnapshot: '历史部门',
      employmentStatusSnapshot: 'active',
    }],
  });
  const response = await handlerWith(mock)({
    route: 'monthlyAssessments/overview',
    input: { monthKey: historicalMonth, page: 1, pageSize: 50 },
  });
  assert.equal(response.ok, true);
  assert.equal(response.data.total, 1);
  assert.equal(response.data.items[0].employeeName, '历史快照姓名');
  assert.equal(response.data.items[0].department, '历史部门');
});
