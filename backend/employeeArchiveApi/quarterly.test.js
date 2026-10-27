/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { COLLECTIONS, createHandler } = require('./index');

const TEST_ENV_ID = 'archive-demo-environment';
const NOW = '2026-09-20T08:00:00.000Z';
const DIMENSIONS = ['任务完成', '规范执行', '问题处理', '沟通协作', '学习成长', '服务支持'];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scores(value) {
  return DIMENSIONS.reduce((result, dimension) => {
    result[dimension] = value;
    return result;
  }, {});
}

function reasons(value) {
  return DIMENSIONS.reduce((result, dimension) => {
    result[dimension] = value;
    return result;
  }, {});
}

function taskId(periodKey, type, evaluatorAccountId, evaluateeEmployeeId) {
  return `quarterly-task:${periodKey}:${type}:${evaluatorAccountId}:${evaluateeEmployeeId}`;
}

function pendingRelation(periodKey, type, sourceRelationId, overrides = {}) {
  const id = `quarterly-pending:${periodKey}:${type}:${sourceRelationId}`;
  return {
    _id: id,
    sourceRelationId,
    periodKey,
    periodName: `${periodKey}季度评价`,
    type,
    status: 'pending_binding',
    evaluatorNameSnapshot: '普通评价人',
    evaluatorEmployeeIdSnapshot: 'employee-self',
    evaluateeEmployeeId: 'employee-target',
    evaluateeNameSnapshot: '被评价员工',
    evaluateeDepartmentSnapshot: '演示综合组',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function identityClaim(employeeId, accountId, authUid, overrides = {}) {
  const hash = crypto.createHash('sha256').update(employeeId, 'utf8').digest('hex');
  return {
    _id: `employee-identity:${hash}`,
    employeeId,
    employeeNameSnapshot: employeeId,
    status: 'linked',
    accountId,
    authUid,
    invitationId: '',
    invitationDocumentId: '',
    registrationAttemptId: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function period(periodKey, overrides = {}) {
  return {
    _id: `quarterly-period:${periodKey}`,
    periodKey,
    periodName: `${periodKey}季度评价`,
    status: 'open',
    resultVisibility: 'hidden',
    scoringStandardVersion: 'showcase-standard-v1',
    rosterVersion: 1,
    dueAt: '2026-10-15T23:59:59.000+08:00',
    version: 1,
    ...overrides,
  };
}

function task(periodKey, type, evaluatorAccountId, evaluateeEmployeeId, overrides = {}) {
  const id = taskId(periodKey, type, evaluatorAccountId, evaluateeEmployeeId);
  return {
    _id: id,
    taskId: id,
    periodKey,
    periodName: `${periodKey}季度评价`,
    type,
    evaluatorAccountId,
    evaluatorAuthUidSnapshot: `auth-${evaluatorAccountId}`,
    evaluatorNameSnapshot: evaluatorAccountId === 'account-user' ? '普通评价人' : '其他评价人',
    evaluatorEmployeeIdSnapshot: evaluatorAccountId === 'account-user' ? 'employee-self' : null,
    evaluateeEmployeeId,
    evaluateeNameSnapshot: evaluateeEmployeeId === 'employee-self' ? '本人员工' : '被评价员工',
    evaluateeDepartmentSnapshot: '演示研发组',
    evaluateeEmploymentStatusSnapshot: 'active',
    status: 'active',
    dueAt: '2026-10-15T23:59:59.000+08:00',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function recordFor(taskRow, overrides = {}) {
  return {
    _id: taskRow._id,
    taskId: taskRow._id,
    periodKey: taskRow.periodKey,
    periodName: taskRow.periodName,
    type: taskRow.type,
    evaluatorAccountId: taskRow.evaluatorAccountId,
    evaluatorAuthUidSnapshot: taskRow.evaluatorAuthUidSnapshot,
    evaluatorNameSnapshot: taskRow.evaluatorNameSnapshot,
    evaluatorEmployeeIdSnapshot: taskRow.evaluatorEmployeeIdSnapshot,
    evaluateeEmployeeId: taskRow.evaluateeEmployeeId,
    evaluateeNameSnapshot: taskRow.evaluateeNameSnapshot,
    evaluateeDepartmentSnapshot: taskRow.evaluateeDepartmentSnapshot,
    scores: scores(22),
    reasons: reasons('以具体行动完成本季度目标。'),
    total: 132,
    status: 'submitted',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    submittedAt: NOW,
    ...overrides,
  };
}

function createMockCloudBase({
  identity,
  accounts,
  employees = [],
  periods = [],
  tasks = [],
  records = [],
  pendingRelations = [],
  identityClaims = [],
  audits = [],
  governanceRoster = null,
  governanceOperations = [],
  beforeTransaction = null,
  materializationConflict = null,
  silentSetNoOp = false,
  bareIdSetNoOp = false,
  silentSetReportsSuccessNoMutation = false,
  noAckSetSuccess = false,
  silentPeriodUpdateNoOp = false,
  noAckPeriodUpdateSuccess = false,
  manualTransactions = false,
  silentTransactionAddNoOp = false,
}) {
  const state = {
    identity: { ...identity },
    accounts: accounts.map((item) => ({ ...item })),
    employees: employees.map((item) => ({ ...item })),
    periods: periods.map((item) => ({ ...item })),
    tasks: tasks.map((item) => ({ ...item })),
    records: records.map((item) => ({ ...item })),
    pendingRelations: pendingRelations.map((item) => ({ ...item })),
    identityClaims: identityClaims.map((item) => ({ ...item })),
    audits: audits.map((item) => ({ ...item })),
    adminGovernance: governanceRoster ? [{ ...governanceRoster, _id: governanceRoster._id || 'active-super-admin-roster' }] : [],
    adminGovernanceOperations: governanceOperations.map((item) => ({ ...item })),
    transactionCallCount: 0,
    updatePayloads: [],
    commitCount: 0,
  };
  let sequence = 1;
  let transactionHook = beforeTransaction;
  let materializationConflictPending = Boolean(materializationConflict);

  function rowsFor(collectionName) {
    if (collectionName === COLLECTIONS.adminAccounts) return state.accounts;
    if (collectionName === COLLECTIONS.employees) return state.employees;
    if (collectionName === COLLECTIONS.quarterlyPeriods) return state.periods;
    if (collectionName === COLLECTIONS.quarterlyTasks) return state.tasks;
    if (collectionName === COLLECTIONS.quarterlyRecords) return state.records;
    if (collectionName === COLLECTIONS.quarterlyPendingRelations) return state.pendingRelations;
    if (collectionName === COLLECTIONS.identityClaims) return state.identityClaims;
    if (collectionName === COLLECTIONS.auditLogs) return state.audits;
    if (collectionName === COLLECTIONS.adminGovernance) return state.adminGovernance;
    if (collectionName === COLLECTIONS.adminGovernanceOperations) return state.adminGovernanceOperations;
    throw new Error(`Unexpected collection: ${collectionName}`);
  }

  function rowId(row) {
    return String(row._id || row.id || '');
  }

  function buildCollection(collectionName) {
    const initialRows = rowsFor(collectionName);
    let rows = initialRows;
    const query = {
      where(filter) {
        rows = rows.filter((row) => Object.entries(filter).every(([key, value]) => row[key] === value));
        return query;
      },
      field(projection) {
        rows = rows.map((row) => Object.fromEntries(
          Object.keys(projection)
            .filter((key) => projection[key] === true && row[key] !== undefined)
            .map((key) => [key, row[key]]),
        ));
        return query;
      },
      orderBy(field, direction = 'asc') {
        rows = rows.slice().sort((left, right) => {
          const leftValue = String(left[field] ?? '');
          const rightValue = String(right[field] ?? '');
          const comparison = leftValue.localeCompare(rightValue);
          return direction === 'desc' ? -comparison : comparison;
        });
        return query;
      },
      skip(count) {
        rows = rows.slice(count);
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
            const row = initialRows.find((item) => rowId(item) === String(id));
            return { data: row ? clone(row) : [] };
          },
          async update(payload) {
            assert.equal(Object.prototype.hasOwnProperty.call(payload, '_id'), false);
            if (collectionName === COLLECTIONS.quarterlyPeriods && silentPeriodUpdateNoOp) return { updated: 1 };
            const row = initialRows.find((item) => rowId(item) === String(id));
            if (!row) throw new Error('document not found');
            if (collectionName === COLLECTIONS.adminAccounts
              && Object.prototype.hasOwnProperty.call(payload, 'quarterlyMaterializationVersion')
              && materializationConflictPending) {
              materializationConflictPending = false;
              const error = new Error('transaction conflict');
              error.code = 'EMPLOYEE_CONFLICT';
              error.accountId = String(id);
              error.rebindEmployeeId = String(materializationConflict.rebindEmployeeId || '');
              throw error;
            }
            state.updatePayloads.push({ collectionName, id: String(id), payload: clone(payload) });
            Object.assign(row, clone(payload));
            if (collectionName === COLLECTIONS.quarterlyPeriods && noAckPeriodUpdateSuccess) return undefined;
            return { updated: 1 };
          },
          async set(payload) {
            assert.equal(Object.prototype.hasOwnProperty.call(payload, '_id'), false);
            if (silentSetNoOp) return { upserted: 0, updated: 0 };
            if (bareIdSetNoOp) return { id: String(id) };
            if (silentSetReportsSuccessNoMutation) return { upserted: 1, updated: 0 };
            const row = initialRows.find((item) => rowId(item) === String(id));
            if (row) Object.assign(row, clone(payload));
            else initialRows.push({ ...clone(payload), _id: String(id) });
            if (noAckSetSuccess) return undefined;
            return { upserted: 1, updated: 0 };
          },
        };
      },
      async add(payload) {
        const explicitId = Object.prototype.hasOwnProperty.call(payload, '_id');
        const id = explicitId ? String(payload._id) : `${collectionName}-test-${sequence++}`;
        if (explicitId && silentSetNoOp) return { inserted: 0 };
        if (explicitId && bareIdSetNoOp) return { id };
        if (explicitId && silentSetReportsSuccessNoMutation) return { id, inserted: 1 };
        if (initialRows.some((item) => rowId(item) === id)) throw new Error('duplicate document id');
        initialRows.unshift({ ...clone(payload), _id: id });
        if (explicitId && noAckSetSuccess) return undefined;
        return { id };
      },
    };
    return query;
  }

  function buildTransactionCollection(collectionName) {
    const collection = buildCollection(collectionName);
    if (silentTransactionAddNoOp && collectionName === COLLECTIONS.quarterlyPeriods) {
      collection.add = async (payload) => ({ id: payload._id });
    }
    return collection;
  }

  const database = {
    collection(collectionName) {
      return buildCollection(collectionName);
    },
    async runTransaction(work) {
      state.transactionCallCount += 1;
      if (transactionHook) {
        const hook = transactionHook;
        transactionHook = null;
        await hook(state);
      }
      const snapshotKeys = [
        'accounts', 'employees', 'periods', 'tasks', 'records', 'pendingRelations', 'identityClaims', 'audits',
        'adminGovernance', 'adminGovernanceOperations', 'updatePayloads',
      ];
      const snapshot = Object.fromEntries(snapshotKeys.map((key) => [key, clone(state[key])]));
      try {
        return await work({ collection: (collectionName) => buildTransactionCollection(collectionName) });
      } catch (error) {
        if (error && error.code === 'EMPLOYEE_CONFLICT') {
          for (const key of snapshotKeys) state[key].splice(0, state[key].length, ...snapshot[key].map(clone));
          if (error.rebindEmployeeId) {
            const account = state.accounts.find((item) => item._id === error.accountId);
            const employee = state.employees.find((item) => item._id === error.rebindEmployeeId);
            if (account) {
              account.employeeId = error.rebindEmployeeId;
              account.employeeNameSnapshot = employee?.name || error.rebindEmployeeId;
              account.identityVersion = (Number.isInteger(account.identityVersion) ? account.identityVersion : 0) + 1;
            }
          }
        }
        throw error;
      }
    },
  };
  if (manualTransactions) {
    database.startTransaction = async () => ({
      collection: (collectionName) => buildTransactionCollection(collectionName),
      async commit() { state.commitCount += 1; return { ok: 1 }; },
      async rollback() {},
    });
  }

  const sdk = {
    init(options) {
      assert.deepEqual(options, { env: TEST_ENV_ID });
      return {
        auth() {
          return { getUserInfo: () => state.identity };
        },
        database() {
          return database;
        },
      };
    },
  };

  return { sdk, state };
}

function handlerFor(mock, currentTime = NOW) {
  return createHandler({
    sdkFactory: () => mock.sdk,
    env: { TCB_ENV_ID: TEST_ENV_ID },
    now: typeof currentTime === 'function' ? currentTime : () => currentTime,
    requestIdFactory: () => 'quarterly-request-001',
  });
}

async function call(handler, route, input = {}) {
  return handler({ route, input });
}

function accounts() {
  return [
    {
      _id: 'account-admin',
      authUid: 'auth-admin',
      username: 'quarterly-admin',
      displayName: '季度管理员',
      status: 'active',
      role: 'admin',
      permissions: ['quarterly.manage', 'audit.read'],
    },
    {
      _id: 'account-user',
      authUid: 'auth-user',
      username: 'quarterly-user',
      displayName: '普通评价人',
      status: 'active',
      role: 'user',
      permissions: [],
      employeeId: 'employee-self',
      employeeNameSnapshot: '本人员工',
      identityVersion: 1,
    },
    {
      _id: 'account-other',
      authUid: 'auth-other',
      username: 'other-user',
      displayName: '其他评价人',
      status: 'active',
      role: 'user',
      permissions: [],
      employeeId: 'employee-other',
      employeeNameSnapshot: '其他员工',
      identityVersion: 1,
    },
  ];
}

function employees() {
  return [
    { _id: 'employee-self', name: '本人员工', department: '演示研发组', status: 'active' },
    { _id: 'employee-other', name: '其他员工', department: '演示支持组', status: 'active' },
    { _id: 'employee-target', name: '被评价员工', department: '演示综合组', status: 'active' },
  ];
}

test('ordinary my-results returns only own submitted evaluations regardless of publication', async () => {
  const userTask = task('2026-Q3', 'first', 'account-user', 'employee-target');
  const selfTask = task('2026-Q2', 'self', 'account-user', 'employee-self');
  const draftTask = task('2026-Q3', 'second', 'account-user', 'employee-target');
  const otherTask = task('2026-Q3', 'second', 'account-other', 'employee-target');
  const receivedTask = task('2026-Q3', 'first', 'account-other', 'employee-self');
  const hiddenTask = task('2026-Q2', 'first', 'account-other', 'employee-self');
  const mock = createMockCloudBase({
    identity: { uid: 'auth-user' },
    accounts: accounts(),
    employees: employees(),
    periods: [
      period('2026-Q3', { resultVisibility: 'published' }),
      period('2026-Q2', { status: 'closed', resultVisibility: 'hidden' }),
      period('2026-Q4', { status: 'draft', resultVisibility: 'hidden' }),
    ],
    tasks: [userTask, selfTask, draftTask, otherTask, receivedTask, hiddenTask],
    records: [
      recordFor(userTask),
      recordFor(selfTask),
      recordFor(draftTask, { status: 'draft' }),
      recordFor(receivedTask),
      recordFor(hiddenTask),
    ],
  });
  const handler = handlerFor(mock);

  const periods = await call(handler, 'quarterly/periods/list');
  assert.equal(periods.ok, true);
  assert.deepEqual(periods.data.items.map((item) => item.periodKey), ['2026-Q3', '2026-Q2']);
  assert.equal(periods.data.items[0].taskCount, 2);
  assert.equal(periods.data.items[0].submittedTaskCount, 1);
  assert.equal(periods.data.items[0].resultVisibility, 'published');
  assert.equal(periods.data.items[0].evaluatorAccountId, undefined);

  const ownTasks = await call(handler, 'quarterly/my-tasks', {
    filters: { periodKey: '2026-Q3', type: 'all', status: 'all', page: 1, pageSize: 20 },
  });
  assert.equal(ownTasks.ok, true);
  assert.deepEqual(new Set(ownTasks.data.items.map((item) => item.id)), new Set([userTask._id, draftTask._id]));
  assert.equal(ownTasks.data.items[0].evaluateeEmployeeId, 'employee-target');

  const forbiddenTask = await call(handler, 'quarterly/task', { taskId: otherTask._id });
  assert.equal(forbiddenTask.ok, false);
  assert.equal(forbiddenTask.error.code, 'PERMISSION_DENIED');

  const results = await call(handler, 'quarterly/my-results');
  assert.equal(results.ok, true);
  assert.deepEqual(results.data.items.map((item) => item.id), [userTask._id, selfTask._id]);
  assert.ok(results.data.items.every((item) => item.direction === 'submitted'));
  assert.equal(results.data.items[0].published, true);
  assert.deepEqual(results.data.items[1].scores, scores(22));
  assert.deepEqual(results.data.items[0].scores, scores(22));

  const filteredResults = await call(handler, 'quarterly/my-results', { periodKey: '2026-Q2' });
  assert.equal(filteredResults.ok, true);
  assert.deepEqual(filteredResults.data.items.map((item) => item.id), [selfTask._id]);

  const history = await call(handler, 'quarterly/history', { employeeId: 'employee-self' });
  assert.equal(history.ok, true);
  assert.deepEqual(history.data.items.map((item) => item.id), [selfTask._id]);
});

test('unbound ordinary users do not gain employee-wide quarterly access', async () => {
  const ownTask = task('2026-Q3', 'first', 'account-user', 'employee-target');
  const mock = createMockCloudBase({
    identity: { uid: 'auth-user' },
    accounts: accounts().map((account) => account._id === 'account-user'
      ? { ...account, employeeId: undefined, employeeNameSnapshot: undefined }
      : account),
    employees: employees(),
    periods: [period('2026-Q3')],
    tasks: [ownTask],
  });
  const handler = handlerFor(mock);

  const periods = await call(handler, 'quarterly/periods/list');
  assert.equal(periods.ok, true);
  assert.deepEqual(periods.data.items.map((item) => item.periodKey), []);

  const ownTasks = await call(handler, 'quarterly/my-tasks');
  assert.deepEqual(ownTasks.data.items, []);
  const denied = await call(handler, 'quarterly/task', { taskId: ownTask._id });
  assert.equal(denied.error.code, 'PERMISSION_DENIED');

  const results = await call(handler, 'quarterly/my-results');
  assert.equal(results.ok, true);
  assert.deepEqual(results.data.items, []);

  const history = await call(handler, 'quarterly/history');
  assert.equal(history.ok, false);
  assert.equal(history.error.code, 'PERMISSION_DENIED');
});

test('a bound pending relation stays unchanged across reads and requires manager confirmation', async () => {
  const relation = pendingRelation('2026-Q3', 'first', 'source-relation-001');
  const mock = createMockCloudBase({
    identity: { uid: 'auth-user' },
    accounts: accounts(),
    employees: employees(),
    periods: [period('2026-Q3')],
    pendingRelations: [relation],
  });
  const handler = handlerFor(mock);

  const firstRead = await call(handler, 'quarterly/my-tasks', {
    filters: { periodKey: '2026-Q3', type: 'all', status: 'all', page: 1, pageSize: 20 },
  });
  assert.equal(firstRead.ok, true);
  assert.equal(firstRead.data.total, 0);
  const secondRead = await call(handler, 'quarterly/my-tasks');
  assert.deepEqual(secondRead.data.items, []);
  assert.equal(mock.state.tasks.length, 0);
  assert.equal(mock.state.pendingRelations[0].status, 'pending_binding');
  for (const route of ['quarterly/tasks/materialize-confirmed/preview', 'quarterly/tasks/materialize-confirmed']) {
    const denied = await call(handler, route, { periodKey: '2026-Q3' });
    assert.equal(denied.error.code, 'PERMISSION_DENIED');
  }
});

test('a manager explicitly binds one pending relation to a selected student account and that account can submit it', async () => {
  const relation = pendingRelation('2026-Q3', 'first', 'source-student-relation', {
    evaluatorNameSnapshot: '虚构人员2',
    evaluatorEmployeeIdSnapshot: null,
  });
  const studentProfile = {
    _id: 'student-zhang-jingang',
    recordType: 'student',
    name: '虚构人员2',
    status: 'active',
    version: 1,
  };
  const studentAccount = {
    _id: 'account-student-zhang',
    authUid: 'auth-student-zhang',
    username: 'zhang.student',
    displayName: '虚构人员2',
    identityType: 'student',
    studentId: studentProfile._id,
    studentNameSnapshot: studentProfile.name,
    identityVersion: 1,
    status: 'active',
    role: 'user',
    permissions: [],
  };
  const untouchedTasks = Array.from({ length: 90 }, (_, index) => task(
    '2026-Q3',
    'first',
    'account-other',
    `employee-unrelated-${String(index).padStart(2, '0')}`,
  ));
  const untouchedSnapshot = clone(untouchedTasks);
  const mock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: [...accounts(), studentAccount],
    employees: [...employees(), studentProfile],
    periods: [period('2026-Q3')],
    tasks: untouchedTasks,
    pendingRelations: [relation],
  });
  const handler = handlerFor(mock);

  mock.state.identity = { uid: studentAccount.authUid };
  const beforeBinding = await call(handler, 'quarterly/my-tasks', {
    filters: { periodKey: '2026-Q3', type: 'all', status: 'all' },
  });
  assert.equal(beforeBinding.ok, true);
  assert.equal(beforeBinding.data.total, 0);
  assert.equal(mock.state.pendingRelations[0].status, 'pending_binding');
  assert.equal(mock.state.tasks.length, 90);

  mock.state.identity = { uid: 'auth-admin' };
  const assignmentOptions = await call(handler, 'quarterly/assignment-options');
  assert.equal(assignmentOptions.ok, true);
  assert.deepEqual(assignmentOptions.data.students, [{ studentId: studentProfile._id, name: studentProfile.name }]);

  const binding = await call(handler, 'quarterly/pending-relations/bind-student', {
    relationId: relation._id,
    studentId: studentProfile._id,
    expectedRosterVersion: 1,
    acknowledged: true,
  });
  assert.equal(binding.ok, true);
  assert.equal(binding.data.alreadyBound, false);
  assert.equal(binding.data.task.evaluatorStudentIdSnapshot, studentProfile._id);
  assert.equal(binding.data.task.evaluatorEmployeeIdSnapshot, null);
  assert.equal(mock.state.pendingRelations[0].status, 'assigned');
  assert.equal(mock.state.pendingRelations[0].evaluatorStudentIdSnapshot, studentProfile._id);
  assert.equal(mock.state.periods[0].rosterVersion, 2);
  assert.equal(mock.state.tasks.length, 91);
  assert.deepEqual(mock.state.tasks.filter((item) => item._id !== binding.data.task.id), untouchedSnapshot);
  assert.equal(mock.state.audits.some((item) => item.action === 'bind_quarterly_relation_student'), true);

  const repeatedBinding = await call(handler, 'quarterly/pending-relations/bind-student', {
    relationId: relation._id,
    studentId: studentProfile._id,
    expectedRosterVersion: 1,
    acknowledged: true,
  });
  assert.equal(repeatedBinding.ok, true);
  assert.equal(repeatedBinding.data.alreadyBound, true);
  assert.equal(mock.state.tasks.length, 91);
  assert.equal(mock.state.periods[0].rosterVersion, 2);

  mock.state.identity = { uid: studentAccount.authUid };
  const ownTasks = await call(handler, 'quarterly/my-tasks', {
    filters: { periodKey: '2026-Q3', type: 'all', status: 'all' },
  });
  assert.equal(ownTasks.ok, true);
  assert.equal(ownTasks.data.total, 1);
  assert.equal(ownTasks.data.items[0].id, binding.data.task.id);
  assert.equal(ownTasks.data.items[0].availability.canWrite, true);

  const draft = await call(handler, 'quarterly/draft', { taskId: binding.data.task.id });
  assert.equal(draft.ok, true);
  assert.equal(draft.data.task.evaluatorStudentIdSnapshot, studentProfile._id);
  assert.equal(draft.data.record, null);

  const submitted = await call(handler, 'quarterly/submit', {
    taskId: binding.data.task.id,
    expectedVersion: 0,
    scores: scores(22),
    reasons: reasons('已核对本季度目标完成情况。'),
  });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.data.status, 'submitted');
  assert.equal(submitted.data.total, 132);
  assert.equal(mock.state.records.length, 1);
  assert.equal(mock.state.tasks.length, 91);
  assert.deepEqual(mock.state.tasks.filter((item) => item._id !== binding.data.task.id), untouchedSnapshot);
});

test('ordinary reads do not invoke materialization transactions or assign a stale identity', async (t) => {
  await t.test('a pending materialization conflict is never triggered by a reader', async () => {
    const relation = pendingRelation('2026-Q3', 'first', 'source-relation-conflict-retry');
    const mock = createMockCloudBase({
      identity: { uid: 'auth-user' },
      accounts: accounts(),
      employees: employees(),
      periods: [period('2026-Q3')],
      pendingRelations: [relation],
      materializationConflict: {},
    });

    const result = await call(handlerFor(mock), 'quarterly/my-tasks');

    assert.equal(result.ok, true);
    assert.equal(result.data.total, 0);
    assert.equal(mock.state.tasks.length, 0);
    assert.equal(mock.state.pendingRelations[0].status, 'pending_binding');
    assert.equal(mock.state.transactionCallCount, 0);
    assert.equal(mock.state.accounts.find((item) => item._id === 'account-user').quarterlyMaterializationVersion, undefined);
  });

  await t.test('a rebound reader cannot acquire the old employee relation', async () => {
    const relation = pendingRelation('2026-Q3', 'first', 'source-relation-conflict-rebind');
    const mock = createMockCloudBase({
      identity: { uid: 'auth-user' },
      accounts: accounts(),
      employees: [...employees(), { _id: 'employee-new', name: '新绑定员工', department: '教研组', status: 'active' }],
      periods: [period('2026-Q3')],
      pendingRelations: [relation],
      materializationConflict: { rebindEmployeeId: 'employee-new' },
    });
    const handler = handlerFor(mock);

    mock.state.accounts.find((item) => item._id === 'account-user').employeeId = 'employee-new';
    const racedRead = await call(handler, 'quarterly/my-tasks');

    assert.equal(racedRead.ok, true);
    assert.deepEqual(racedRead.data.items, []);
    assert.equal(mock.state.transactionCallCount, 0);
    assert.equal(mock.state.accounts.find((item) => item._id === 'account-user').employeeId, 'employee-new');
    assert.equal(mock.state.accounts.find((item) => item._id === 'account-user').quarterlyMaterializationVersion, undefined);
    assert.equal(mock.state.tasks.length, 0);
    assert.equal(mock.state.pendingRelations[0].status, 'pending_binding');

    const subsequentRead = await call(handler, 'quarterly/my-tasks');
    assert.equal(subsequentRead.ok, true);
    assert.deepEqual(subsequentRead.data.items, []);
    assert.equal(mock.state.tasks.length, 0);
    assert.equal(mock.state.pendingRelations[0].status, 'pending_binding');
  });
});

test('tasks materialized in a draft period are visible but cannot be changed', async () => {
  const relation = pendingRelation('2026-Q3', 'first', 'source-relation-draft');
  const mock = createMockCloudBase({
    identity: { uid: 'auth-user' },
    accounts: accounts(),
    employees: employees(),
    periods: [period('2026-Q3', { status: 'draft' })],
    pendingRelations: [{ ...relation, status: 'assigned' }],
    tasks: [task('2026-Q3', 'first', 'account-user', 'employee-target', { sourcePendingRelationId: relation._id })],
  });
  const handler = handlerFor(mock);

  const taskList = await call(handler, 'quarterly/my-tasks');
  assert.equal(taskList.ok, true);
  assert.equal(taskList.data.total, 1);
  const ownTask = taskList.data.items[0];
  assert.equal(ownTask.availability.canWrite, false);
  assert.match(ownTask.availability.reason, /尚未开放|未开放|草稿/);

  const listedPeriods = await call(handler, 'quarterly/periods/list');
  assert.equal(listedPeriods.ok, true);
  assert.equal(listedPeriods.data.items[0].status, 'draft');
  assert.equal(listedPeriods.data.items[0].taskCount, 1);

  const detail = await call(handler, 'quarterly/task', { taskId: ownTask.id });
  assert.equal(detail.ok, true);
  assert.equal(detail.data.availability.canWrite, false);

  const draft = await call(handler, 'quarterly/draft', {
    taskId: ownTask.id,
    expectedVersion: 0,
    scores: { 任务完成: 20 },
    reasons: { 任务完成: '草稿期不应允许填写。' },
  });
  assert.equal(draft.ok, false);
  assert.equal(draft.error.code, 'QUARTERLY_PERIOD_CLOSED');

  const submitted = await call(handler, 'quarterly/submit', {
    taskId: ownTask.id,
    expectedVersion: 0,
    scores: scores(20),
    reasons: reasons('草稿期不应允许提交。'),
  });
  assert.equal(submitted.ok, false);
  assert.equal(submitted.error.code, 'QUARTERLY_PERIOD_CLOSED');
  assert.equal(mock.state.records.length, 0);
  assert.equal(mock.state.pendingRelations[0].status, 'assigned');
});

test('scheduled period opens at the server boundary, then permits employee writes and locks the roster', async () => {
  let currentTime = '2026-09-20T07:59:59.999Z';
  const scheduledTask = task('2026-Q3', 'first', 'account-user', 'employee-target');
  const mock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: accounts(),
    employees: employees(),
    periods: [period('2026-Q3', {
      status: 'draft',
      opensAt: '2026-09-20T08:00:00.000Z',
      dueAt: '2026-09-20T08:30:00.000Z',
    })],
    tasks: [scheduledTask],
  });
  const handler = handlerFor(mock, () => currentTime);

  const beforeOpen = await call(handler, 'quarterly/periods/list');
  assert.equal(beforeOpen.data.items[0].status, 'draft');
  assert.equal(mock.state.periods[0].status, 'draft');

  mock.state.identity = { uid: 'auth-user' };
  const lockedDraft = await call(handler, 'quarterly/draft', {
    taskId: scheduledTask._id,
    expectedVersion: 0,
    scores: { 任务完成: 20 },
    reasons: { 任务完成: '开放前不可填写。' },
  });
  assert.equal(lockedDraft.ok, false);
  assert.equal(lockedDraft.error.code, 'QUARTERLY_PERIOD_CLOSED');

  currentTime = '2026-09-20T08:00:00.000Z';
  mock.state.identity = { uid: 'auth-admin' };
  const atOpen = await call(handler, 'quarterly/periods/list');
  assert.equal(atOpen.data.items[0].status, 'open');
  assert.equal(mock.state.periods[0].status, 'draft');
  const changedDeadline = await call(handler, 'quarterly/periods/save', {
    periodKey: '2026-Q3',
    periodName: '2026年第三季度评价',
    status: 'open',
    resultVisibility: 'hidden',
    scoringStandardVersion: 'showcase-standard-v1',
    rosterVersion: 1,
    opensAt: '2026-09-20T08:00:00.000Z',
    dueAt: '2026-09-20T08:45:00.000Z',
    expectedVersion: 1,
  });
  assert.equal(changedDeadline.ok, false);
  assert.equal(changedDeadline.error.code, 'QUARTERLY_PERIOD_STATE_INVALID');
  assert.equal(mock.state.periods[0].dueAt, '2026-09-20T08:30:00.000Z');
  const rosterWrite = await call(handler, 'quarterly/tasks/save', {
    periodKey: '2026-Q3',
    type: 'second',
    evaluatorAccountId: 'account-other',
    evaluateeEmployeeId: 'employee-target',
    dueAt: null,
    status: 'active',
    expectedVersion: 0,
  });
  assert.equal(rosterWrite.ok, false);
  assert.equal(rosterWrite.error.code, 'QUARTERLY_PERIOD_CLOSED');

  mock.state.identity = { uid: 'auth-user' };
  const openDraft = await call(handler, 'quarterly/draft', {
    taskId: scheduledTask._id,
    expectedVersion: 0,
    scores: { 任务完成: 20 },
    reasons: { 任务完成: '开放时允许填写。' },
  });
  assert.equal(openDraft.ok, true);
  assert.equal(openDraft.data.status, 'draft');
});

test('rebinding or unbinding an account leaves its unmatched pending relations untouched', async () => {
  const superAdmin = {
    _id: 'account-super',
    authUid: 'auth-super',
    username: 'root',
    displayName: '总管理员',
    status: 'active',
    role: 'super_admin',
  };
  const relation = pendingRelation('2026-Q3', 'first', 'source-relation-old-identity');
  const mock = createMockCloudBase({
    identity: { uid: 'auth-user' },
    accounts: [...accounts(), superAdmin],
    employees: [...employees(), { _id: 'employee-new', name: '新绑定员工', department: '教研组', status: 'active' }],
    periods: [period('2026-Q3')],
    pendingRelations: [relation],
    governanceRoster: { schemaVersion: 1, state: 'ready', limit: 5, activeSuperAdminAccountIds: ['account-super'], revision: 1 },
    identityClaims: [identityClaim('employee-self', 'account-user', 'auth-user', {
      employeeNameSnapshot: '本人员工',
    })],
  });
  const handler = createHandler({ sdkFactory: () => mock.sdk, env: { TCB_ENV_ID: TEST_ENV_ID, ACCOUNT_GOVERNANCE_WRITES_ENABLED: 'true' }, now: () => NOW, requestIdFactory: () => 'quarterly-request-001' });

  mock.state.identity = { uid: 'auth-super' };
  const rebound = await call(handler, 'accounts/bind-employee', {
    accountId: 'account-user',
    employeeId: 'employee-new', operationId: '91111111-1111-4111-8111-111111111111', expectedGovernanceRevision: 1,
  });
  assert.equal(rebound.ok, true, JSON.stringify(rebound));
  assert.equal(rebound.data.employeeId, 'employee-new');
  assert.equal(mock.state.identityClaims.find((item) => item.employeeId === 'employee-self').status, 'unclaimed');

  mock.state.identity = { uid: 'auth-user' };
  const afterRebind = await call(handler, 'quarterly/my-tasks');
  assert.equal(afterRebind.ok, true);
  assert.deepEqual(afterRebind.data.items, []);
  assert.equal(mock.state.tasks.length, 0);
  assert.equal(mock.state.pendingRelations[0].status, 'pending_binding');

  mock.state.identity = { uid: 'auth-super' };
  const unbound = await call(handler, 'accounts/bind-employee', {
    accountId: 'account-user',
    employeeId: null, operationId: '92222222-2222-4222-8222-222222222222', expectedGovernanceRevision: 2,
  });
  assert.equal(unbound.ok, true);
  assert.equal(unbound.data.employeeId, null);
  assert.equal(mock.state.identityClaims.find((item) => item.employeeId === 'employee-new').status, 'unclaimed');

  mock.state.identity = { uid: 'auth-user' };
  const afterUnbind = await call(handler, 'quarterly/my-tasks');
  assert.equal(afterUnbind.ok, true);
  assert.deepEqual(afterUnbind.data.items, []);
  assert.equal(mock.state.tasks.length, 0);
  assert.equal(mock.state.pendingRelations[0].status, 'pending_binding');
});

test('pending relations remain available to managers when their period is closed', async () => {
  const relation = pendingRelation('2026-Q3', 'first', 'source-relation-closed');
  const mock = createMockCloudBase({
    identity: { uid: 'auth-user' },
    accounts: accounts(),
    employees: employees(),
    periods: [period('2026-Q3', { status: 'closed' })],
    pendingRelations: [relation],
  });
  const handler = handlerFor(mock);

  const userTasks = await call(handler, 'quarterly/my-tasks');
  assert.equal(userTasks.ok, true);
  assert.deepEqual(userTasks.data.items, []);
  assert.equal(mock.state.tasks.length, 0);
  assert.equal(mock.state.pendingRelations[0].status, 'pending_binding');

  mock.state.identity = { uid: 'auth-admin' };
  const overview = await call(handler, 'quarterly/overview', { periodKey: '2026-Q3' });
  assert.equal(overview.ok, true);
  assert.equal(overview.data.taskCount, 0);
  assert.deepEqual(overview.data.pendingRelations.map((item) => item.id), [relation._id]);
  assert.equal(overview.data.pendingRelations[0].status, 'pending_binding');
});

test('manager overview returns every pending relation even without a saved period', async () => {
  const relations = Array.from({ length: 121 }, (_, index) => pendingRelation(
    '2026-Q3', 'first', `source-relation-${String(index).padStart(3, '0')}`,
  ));
  const mock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: accounts(),
    employees: employees(),
    pendingRelations: relations,
  });
  const overview = await call(handlerFor(mock), 'quarterly/overview', { periodKey: '2026-Q3' });
  assert.equal(overview.ok, true);
  assert.equal(overview.data.period, null);
  assert.equal(overview.data.pendingRelations.length, relations.length);
  assert.equal(new Set(overview.data.pendingRelations.map((item) => item.id)).size, relations.length);
});

test('manager period and task writes use optimistic versions and ordinary users cannot manage them', async () => {
  const existingTask = task('2026-Q3', 'first', 'account-user', 'employee-target');
  const mock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: accounts(),
    employees: employees(),
    periods: [period('2026-Q3', { status: 'draft', version: 1 })],
    tasks: [existingTask],
  });
  const handler = handlerFor(mock);

  const savedPeriod = await call(handler, 'quarterly/periods/save', {
    periodKey: '2026-Q3',
    periodName: '2026年第三季度评价（更新）',
    status: 'draft',
    resultVisibility: 'hidden',
    scoringStandardVersion: 'showcase-standard-v1',
    rosterVersion: 1,
    dueAt: null,
    expectedVersion: 1,
  });
  assert.equal(savedPeriod.ok, true);
  assert.equal(savedPeriod.data.version, 2);
  assert.equal(mock.state.periods[0].version, 2);

  const stalePeriod = await call(handler, 'quarterly/periods/save', {
    periodKey: '2026-Q3',
    periodName: '覆盖失败',
    status: 'draft',
    resultVisibility: 'hidden',
    scoringStandardVersion: 'showcase-standard-v1',
    rosterVersion: 1,
    dueAt: null,
    expectedVersion: 1,
  });
  assert.equal(stalePeriod.ok, false);
  assert.equal(stalePeriod.error.code, 'QUARTERLY_PERIOD_VERSION_CONFLICT');
  assert.equal(mock.state.periods[0].periodName, '2026年第三季度评价（更新）');

  const savedTask = await call(handler, 'quarterly/tasks/save', {
    periodKey: '2026-Q3',
    type: 'first',
    evaluatorAccountId: 'account-user',
    evaluateeEmployeeId: 'employee-target',
    dueAt: null,
    status: 'active',
    expectedVersion: 1,
  });
  assert.equal(savedTask.ok, true);
  assert.equal(savedTask.data.task.version, 2);
  assert.equal(mock.state.tasks[0].version, 2);

  const staleTask = await call(handler, 'quarterly/tasks/save', {
    periodKey: '2026-Q3',
    type: 'first',
    evaluatorAccountId: 'account-user',
    evaluateeEmployeeId: 'employee-target',
    dueAt: null,
    status: 'active',
    expectedVersion: 1,
  });
  assert.equal(staleTask.ok, false);
  assert.equal(staleTask.error.code, 'QUARTERLY_TASK_VERSION_CONFLICT');

  const userDenied = await call(handler, 'quarterly/overview', { periodKey: '2026-Q3' });
  assert.equal(userDenied.ok, true);
  assert.deepEqual(userDenied.data.tasks.map((item) => item.id), [existingTask._id]);
  assert.equal(userDenied.data.tasks[0].evaluatorNameSnapshot, '本人员工');
  assert.equal(userDenied.data.tasks[0].record, null);

  mock.state.identity = { uid: 'auth-user' };
  const ordinaryManagerRoute = await call(handler, 'quarterly/periods/save', {
    periodKey: '2026-Q3',
    periodName: '不应保存',
    status: 'open',
    resultVisibility: 'hidden',
    scoringStandardVersion: 'showcase-standard-v1',
    rosterVersion: 1,
    dueAt: null,
  });
  assert.equal(ordinaryManagerRoute.ok, false);
  assert.equal(ordinaryManagerRoute.error.code, 'PERMISSION_DENIED');
});

test('zero-count set result is not trusted unless the quarterly period can be read back', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: accounts(),
    employees: employees(),
    silentSetNoOp: true,
  });
  const handler = handlerFor(mock);

  const result = await call(handler, 'quarterly/periods/save', {
    periodKey: '2026-Q3',
    periodName: '2026年第三季度评价',
    status: 'draft',
    resultVisibility: 'hidden',
    scoringStandardVersion: 'showcase-standard-v1',
    rosterVersion: 1,
    dueAt: null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DATABASE_WRITE_VERIFICATION_FAILED');
  assert.equal(mock.state.periods.length, 0);
  assert.equal(mock.state.audits.some((item) => item.action === 'save_quarterly_period' && item.result === 'success'), false);
});

test('bare id set result is not trusted unless the quarterly period can be read back', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: accounts(),
    employees: employees(),
    bareIdSetNoOp: true,
  });
  const handler = handlerFor(mock);

  const result = await call(handler, 'quarterly/periods/save', {
    periodKey: '2026-Q3',
    periodName: '2026年第三季度评价',
    status: 'draft',
    resultVisibility: 'hidden',
    scoringStandardVersion: 'showcase-standard-v1',
    rosterVersion: 1,
    dueAt: null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DATABASE_WRITE_VERIFICATION_FAILED');
  assert.equal(mock.state.periods.length, 0);
  assert.equal(mock.state.audits.some((item) => item.action === 'save_quarterly_period' && item.result === 'success'), false);
});

test('Node SDK upserted set result allows a new quarterly period to be saved', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: accounts(),
    employees: employees(),
  });
  const handler = handlerFor(mock);

  const result = await call(handler, 'quarterly/periods/save', {
    periodKey: '2026-Q3',
    periodName: '2026年第三季度评价',
    status: 'draft',
    resultVisibility: 'hidden',
    scoringStandardVersion: 'showcase-standard-v1',
    rosterVersion: 1,
    dueAt: null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.periodKey, '2026-Q3');
  assert.equal(mock.state.periods.length, 1);
  assert.equal(mock.state.audits.some((item) => item.action === 'save_quarterly_period' && item.result === 'success'), true);
});

test('quarterly period save explicitly commits when the SDK supports manual transactions', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: accounts(),
    employees: employees(),
    manualTransactions: true,
  });
  const result = await call(handlerFor(mock), 'quarterly/periods/save', {
    periodKey: '2026-Q3',
    periodName: '2026年第三季度评价',
    status: 'draft',
    resultVisibility: 'hidden',
    scoringStandardVersion: 'showcase-standard-v1',
    rosterVersion: 1,
    dueAt: null,
  });
  assert.equal(result.ok, true);
  assert.equal(mock.state.commitCount, 1);
  assert.equal(mock.state.periods.length, 1);
});

test('new period falls back to verified direct insertion when transactional add is not persisted', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: accounts(),
    employees: employees(),
    manualTransactions: true,
    silentTransactionAddNoOp: true,
  });
  const result = await call(handlerFor(mock), 'quarterly/periods/save', {
    periodKey: '2026-Q3',
    periodName: '2026年第三季度评价',
    status: 'draft',
    resultVisibility: 'hidden',
    scoringStandardVersion: 'showcase-standard-v1',
    rosterVersion: 1,
    dueAt: null,
  });
  assert.equal(result.ok, true);
  assert.equal(mock.state.commitCount, 1);
  assert.equal(mock.state.periods.length, 1);
  assert.equal(mock.state.periods[0]._id, 'quarterly-period:2026-Q3');
});

test('transaction set without write counters succeeds after committed period readback', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: accounts(),
    employees: employees(),
    noAckSetSuccess: true,
  });
  const handler = handlerFor(mock);

  const result = await call(handler, 'quarterly/periods/save', {
    periodKey: '2026-Q3',
    periodName: '2026年第三季度评价',
    status: 'draft',
    resultVisibility: 'hidden',
    scoringStandardVersion: 'showcase-standard-v1',
    rosterVersion: 1,
    dueAt: null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.periodKey, '2026-Q3');
  assert.equal(mock.state.periods.length, 1);
  assert.equal(mock.state.audits.some((item) => item.action === 'save_quarterly_period' && item.result === 'success'), true);
});

test('transaction task writes without counters are counted after the refreshed plan finds the task', async () => {
  const relation = pendingRelation('2026-Q3', 'first', 'source-relation-no-write-counters');
  const mock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: accounts(),
    employees: employees(),
    periods: [period('2026-Q3', { status: 'draft' })],
    pendingRelations: [relation],
    noAckSetSuccess: true,
  });
  const handler = handlerFor(mock);
  const preview = await call(handler, 'quarterly/tasks/materialize-confirmed/preview', {
    periodKey: '2026-Q3',
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.data.eligibleCount, 1);

  const result = await call(handler, 'quarterly/tasks/materialize-confirmed', {
    periodKey: '2026-Q3',
    acknowledged: true,
    expectedEligibleCount: preview.data.eligibleCount,
    expectedPreviewToken: preview.data.previewToken,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.createdCount, 1);
  assert.equal(result.data.remainingCount, 0);
  assert.equal(result.data.complete, true);
  assert.equal(mock.state.tasks.length, 1);
  assert.equal(mock.state.pendingRelations[0].status, 'assigned');
});

test('new quarterly period is not reported successful until committed data can be read back', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: accounts(),
    employees: employees(),
    silentSetReportsSuccessNoMutation: true,
  });
  const handler = handlerFor(mock);

  const result = await call(handler, 'quarterly/periods/save', {
    periodKey: '2026-Q3',
    periodName: '2026年第三季度评价',
    status: 'draft',
    resultVisibility: 'hidden',
    scoringStandardVersion: 'showcase-standard-v1',
    rosterVersion: 1,
    dueAt: null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DATABASE_WRITE_VERIFICATION_FAILED');
  assert.equal(mock.state.periods.length, 0);
  assert.equal(mock.state.audits.some((item) => item.action === 'save_quarterly_period' && item.result === 'success'), false);
});

test('natural quarter schedule is not reported successful until its committed settings can be read back', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: accounts(),
    employees: employees(),
    periods: [period('2026-Q3', { status: 'draft', dueAt: null })],
    tasks: [task('2026-Q3', 'first', 'account-user', 'employee-target', { dueAt: null })],
    silentPeriodUpdateNoOp: true,
  });
  const handler = handlerFor(mock);

  const result = await call(handler, 'quarterly/periods/schedule', {
    periodKey: '2026-Q3',
    expectedVersion: 1,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DATABASE_WRITE_VERIFICATION_FAILED');
  assert.equal(mock.state.periods[0].naturalQuarterSchedule, undefined);
  assert.equal(mock.state.audits.some((item) => item.action === 'schedule_quarterly_period' && item.result === 'success'), false);
});

test('natural quarter schedule accepts an empty transaction update receipt after readback', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: accounts(),
    employees: employees(),
    periods: [period('2026-Q3', { status: 'draft', dueAt: null })],
    tasks: [task('2026-Q3', 'first', 'account-user', 'employee-target', { dueAt: null })],
    noAckPeriodUpdateSuccess: true,
  });
  const handler = handlerFor(mock);

  const result = await call(handler, 'quarterly/periods/schedule', {
    periodKey: '2026-Q3',
    expectedVersion: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(mock.state.periods[0].naturalQuarterSchedule, true);
  assert.equal(mock.state.audits.some((item) => item.action === 'schedule_quarterly_period' && item.result === 'success'), true);
});

test('ordinary task records enforce ownership, validation, idempotent submit, and versions', async () => {
  const ownTask = task('2026-Q3', 'self', 'account-user', 'employee-self');
  const otherTask = task('2026-Q3', 'first', 'account-other', 'employee-target');
  const mock = createMockCloudBase({
    identity: { uid: 'auth-user' },
    accounts: accounts(),
    employees: employees(),
    periods: [period('2026-Q3', { status: 'open' })],
    tasks: [ownTask, otherTask],
  });
  const handler = handlerFor(mock);

  const forbidden = await call(handler, 'quarterly/submit', {
    taskId: otherTask._id,
    expectedVersion: 0,
    scores: scores(20),
    reasons: reasons('不应提交'),
  });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.error.code, 'PERMISSION_DENIED');

  const draft = await call(handler, 'quarterly/draft', {
    taskId: ownTask._id,
    expectedVersion: 0,
    scores: { 任务完成: 22, 规范执行: null },
    reasons: { 任务完成: '完成关键目标。' },
  });
  assert.equal(draft.ok, true);
  assert.equal(draft.data.status, 'draft');
  assert.equal(draft.data.version, 1);
  assert.equal(draft.data.total, 22);
  assert.equal(mock.state.records.length, 1);

  const staleDraft = await call(handler, 'quarterly/draft', {
    taskId: ownTask._id,
    expectedVersion: 0,
    scores: { 任务完成: 23 },
    reasons: { 任务完成: '新理由。' },
  });
  assert.equal(staleDraft.ok, false);
  assert.equal(staleDraft.error.code, 'QUARTERLY_RECORD_VERSION_CONFLICT');

  const incompleteSubmit = await call(handler, 'quarterly/submit', {
    taskId: ownTask._id,
    expectedVersion: 1,
    scores: { 任务完成: 22 },
    reasons: { 任务完成: '完成关键目标。' },
  });
  assert.equal(incompleteSubmit.ok, false);
  assert.equal(incompleteSubmit.error.code, 'VALIDATION_ERROR');

  const submitted = await call(handler, 'quarterly/submit', {
    taskId: ownTask._id,
    expectedVersion: 1,
    scores: scores(22),
    reasons: reasons('完成关键目标。'),
  });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.data.status, 'submitted');
  assert.equal(submitted.data.version, 2);
  assert.equal(submitted.data.total, 132);

  const retry = await call(handler, 'quarterly/submit', {
    taskId: ownTask._id,
    expectedVersion: 1,
    scores: scores(22),
    reasons: reasons('完成关键目标。'),
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.data.version, 2);
  assert.equal(mock.state.records.length, 1);
});

test('management supplement, revise, return, and void preserve operator traceability', async () => {
  const managedTask = task('2026-Q3', 'first', 'account-user', 'employee-target');
  const mock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: accounts(),
    employees: employees(),
    periods: [period('2026-Q3', { status: 'closed', resultVisibility: 'published' })],
    tasks: [managedTask],
  });
  const handler = handlerFor(mock);

  const supplement = await call(handler, 'quarterly/revise', {
    taskId: managedTask._id,
    expectedVersion: 0,
    scores: scores(21),
    reasons: reasons('管理员代录：依据已核对的季度材料。'),
    reason: '原评价人无法登录，由管理员按纸面材料代录。',
  });
  assert.equal(supplement.ok, true);
  assert.equal(supplement.data.status, 'submitted');
  assert.equal(supplement.data.managementEdited, true);
  assert.equal(supplement.data.actualOperatorName, '季度管理员');
  assert.equal(mock.state.records[0].createdByAccountId, 'account-user');
  assert.equal(mock.state.records[0].submittedByAccountId, 'account-user');
  assert.equal(mock.state.records[0].updatedByAccountId, 'account-admin');
  assert.equal(mock.state.audits[0].action, 'revise_quarterly_review');
  assert.equal(mock.state.audits[0].originalEvaluatorAccountId, 'account-user');
  assert.equal(mock.state.audits[0].actualOperatorNameSnapshot, '季度管理员');
  assert.equal(mock.state.audits[0].reason, '原评价人无法登录，由管理员按纸面材料代录。');

  const returned = await call(handler, 'quarterly/return', {
    recordId: managedTask._id,
    expectedVersion: 1,
    reason: '请补充本季度目标达成依据。',
  });
  assert.equal(returned.ok, true);
  assert.equal(returned.data.status, 'returned');
  assert.equal(returned.data.version, 2);
  assert.equal(mock.state.audits[0].action, 'return_quarterly_review');
  assert.equal(mock.state.audits[0].originalEvaluatorNameSnapshot, '普通评价人');

  const revised = await call(handler, 'quarterly/revise', {
    taskId: managedTask._id,
    expectedVersion: 2,
    scores: scores(24),
    reasons: reasons('管理员修订：补充核验依据。'),
    reason: '根据补充材料修订评分。',
  });
  assert.equal(revised.ok, true);
  assert.equal(revised.data.status, 'submitted');
  assert.equal(revised.data.version, 3);
  assert.equal(revised.data.total, 144);
  assert.equal(mock.state.records[0].managementEditReason, '根据补充材料修订评分。');
  assert.equal(mock.state.audits[0].action, 'revise_quarterly_review');

  const voided = await call(handler, 'quarterly/void', {
    recordId: managedTask._id,
    expectedVersion: 3,
    reason: '发现该条记录属于错误周期，作废处理。',
  });
  assert.equal(voided.ok, true);
  assert.equal(voided.data.status, 'void');
  assert.equal(voided.data.version, 4);
  assert.equal(mock.state.audits[0].action, 'void_quarterly_review');
  assert.equal(mock.state.audits[0].reason, '发现该条记录属于错误周期，作废处理。');

  const reviseVoided = await call(handler, 'quarterly/revise', {
    taskId: managedTask._id,
    expectedVersion: 4,
    scores: scores(20),
    reasons: reasons('不应修改已作废记录。'),
    reason: '不应允许。',
  });
  assert.equal(reviseVoided.ok, false);
  assert.equal(reviseVoided.error.code, 'QUARTERLY_RECORD_STATE');
});

test('only super administrators can bind or unbind employees and account projections remain complete', async () => {
  const superAdmin = {
    _id: 'account-super',
    authUid: 'auth-super',
    username: 'root',
    displayName: '总管理员',
    status: 'active',
    role: 'super_admin',
  };
  const target = {
    _id: 'account-target',
    authUid: 'auth-target',
    username: 'target',
    displayName: '待绑定账号',
    status: 'active',
    role: 'user',
    permissions: [],
    identityVersion: 3,
  };
  const other = {
    _id: 'account-other-binding',
    authUid: 'auth-other-binding',
    username: 'other-binding',
    displayName: '其他绑定账号',
    status: 'active',
    role: 'user',
    permissions: [],
    employeeId: 'employee-two',
    employeeNameSnapshot: '员工二',
    identityVersion: 1,
  };
  const mock = createMockCloudBase({
    identity: { uid: 'auth-super' },
    accounts: [superAdmin, target, other],
    employees: [
      { _id: 'employee-one', name: '员工一', department: '演示研发组', status: 'active' },
      { _id: 'employee-two', name: '员工二', department: '演示支持组', status: 'active' },
      { _id: 'employee-three', name: '员工三', department: '演示综合组', status: 'active' },
    ],
    governanceRoster: {
      schemaVersion: 1,
      state: 'ready',
      limit: 5,
      activeSuperAdminAccountIds: ['account-super'],
      revision: 1,
    },
  });
  const handler = createHandler({
    sdkFactory: () => mock.sdk,
    env: { TCB_ENV_ID: TEST_ENV_ID, ACCOUNT_GOVERNANCE_WRITES_ENABLED: 'true' },
    now: () => NOW,
    requestIdFactory: () => 'quarterly-request-001',
  });

  const listed = await call(handler, 'accounts/list');
  assert.equal(listed.ok, true);
  const listedTarget = listed.data.items.find((item) => item.id === 'account-target');
  assert.deepEqual(
    {
      employeeId: listedTarget.employeeId,
      employeeNameSnapshot: listedTarget.employeeNameSnapshot,
      identityVersion: listedTarget.identityVersion,
    },
    { employeeId: null, employeeNameSnapshot: null, identityVersion: 3 },
  );

  const bound = await call(handler, 'accounts/bind-employee', {
    accountId: 'account-target',
    employeeId: 'employee-one',
    operationId: '11111111-1111-4111-8111-111111111111',
    expectedGovernanceRevision: 1,
  });
  assert.equal(bound.ok, true);
  assert.equal(bound.data.id, 'account-target');
  assert.equal(bound.data.employeeId, 'employee-one');
  assert.equal(bound.data.employeeNameSnapshot, '员工一');
  assert.equal(bound.data.identityVersion, 4);
  assert.equal(mock.state.accounts.find((item) => item._id === 'account-target').employeeId, 'employee-one');
  const firstClaim = mock.state.identityClaims.find((item) => item.employeeId === 'employee-one');
  assert.equal(firstClaim.status, 'linked');
  assert.equal(firstClaim.accountId, 'account-target');
  assert.equal(firstClaim.authUid, 'auth-target');

  const transactionCountBeforeDuplicate = mock.state.transactionCallCount;
  const duplicate = await call(handler, 'accounts/bind-employee', {
    accountId: 'account-other-binding',
    employeeId: 'employee-one',
    operationId: '22222222-2222-4222-8222-222222222222',
    expectedGovernanceRevision: 2,
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'QUARTERLY_BINDING_CONFLICT');
  assert.equal(mock.state.transactionCallCount - transactionCountBeforeDuplicate, 2);

  const rebound = await call(handler, 'accounts/bind-employee', {
    accountId: 'account-target',
    employeeId: 'employee-three',
    operationId: '33333333-3333-4333-8333-333333333333',
    expectedGovernanceRevision: 2,
  });
  assert.equal(rebound.ok, true);
  assert.equal(rebound.data.employeeId, 'employee-three');
  assert.equal(rebound.data.identityVersion, 5);
  assert.equal(mock.state.identityClaims.find((item) => item.employeeId === 'employee-one').status, 'unclaimed');
  const reboundClaim = mock.state.identityClaims.find((item) => item.employeeId === 'employee-three');
  assert.equal(reboundClaim.status, 'linked');
  assert.equal(reboundClaim.accountId, 'account-target');
  assert.equal(reboundClaim.authUid, 'auth-target');

  const unbound = await call(handler, 'accounts/bind-employee', {
    accountId: 'account-target',
    employeeId: null,
    operationId: '44444444-4444-4444-8444-444444444444',
    expectedGovernanceRevision: 3,
  });
  assert.equal(unbound.ok, true);
  assert.equal(unbound.data.id, 'account-target');
  assert.equal(unbound.data.employeeId, null);
  assert.equal(unbound.data.employeeNameSnapshot, null);
  assert.equal(unbound.data.identityVersion, 6);
  assert.equal(mock.state.identityClaims.find((item) => item.employeeId === 'employee-three').status, 'unclaimed');
  const unbindAudit = mock.state.audits.find((item) => item.action === 'unbind_account_employee');
  assert.ok(unbindAudit);
  assert.equal(unbindAudit.before.employeeId, 'employee-three');
  assert.equal(unbindAudit.after.employeeId, null);
  assert.equal(unbindAudit.after.employeeNameSnapshot, null);
  assert.equal(unbindAudit.before.identityVersion, 5);
  assert.equal(unbindAudit.after.identityVersion, 6);

  mock.state.identity = { uid: 'auth-target' };
  const ordinaryUnbind = await call(handler, 'accounts/bind-employee', {
    accountId: 'account-other-binding',
    employeeId: null,
    operationId: '55555555-5555-4555-8555-555555555555',
    expectedGovernanceRevision: 4,
  });
  assert.equal(ordinaryUnbind.ok, false);
  assert.equal(ordinaryUnbind.error.code, 'PERMISSION_DENIED');
});

test('session scope follows the resolved role', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'auth-user' },
    accounts: accounts(),
  });
  const handler = handlerFor(mock);

  const userSession = await call(handler, 'session');
  assert.equal(userSession.ok, true);
  assert.equal(userSession.data.account.scope, 'self');

  mock.state.identity = { uid: 'auth-admin' };
  const adminSession = await call(handler, 'session');
  assert.equal(adminSession.ok, true);
  assert.equal(adminSession.data.account.scope, 'all');
});

test('quarterly assignment options require quarterly.manage, page every row, and return only selection fields', async () => {
  const optionEmployees = Array.from({ length: 205 }, (_, index) => {
    const suffix = String(index).padStart(3, '0');
    return {
      _id: `employee-option-${suffix}`,
      name: `员工${suffix}`,
      department: `部门${index % 5}`,
      status: 'active',
      phone: `1380000${suffix}`,
      salary: 10000 + index,
      permissions: ['employee.write'],
    };
  });
  const optionStudents = Array.from({ length: 130 }, (_, index) => {
    const suffix = String(index).padStart(3, '0');
    return {
      _id: `student-profile-option-${suffix}`,
      recordType: 'student',
      name: `学员${suffix}`,
      status: 'active',
      phoneNumber: `1381111${suffix}`,
      privateNote: 'not-for-clients',
    };
  });
  const optionAccounts = [
    {
      _id: 'account-admin',
      authUid: 'auth-admin',
      username: 'quarterly-admin',
      displayName: '季度管理员',
      status: 'active',
      role: 'admin',
      permissions: ['quarterly.manage'],
      employeeId: 'employee-option-204',
      identityVersion: 1,
      phone: '13800006075',
      passwordHash: 'not-for-clients',
      secret: 'not-for-clients',
    },
    ...Array.from({ length: 204 }, (_, index) => {
      const suffix = String(index).padStart(3, '0');
      return {
        _id: `account-option-${suffix}`,
        authUid: `auth-option-${suffix}`,
        username: `login-${suffix}`,
        displayName: `评价人${suffix}`,
        status: index === 2 ? 'disabled' : index === 3 ? 'pending' : 'active',
        role: 'user',
        permissions: ['sensitive.read'],
        employeeId: `employee-option-${suffix}`,
        employeeNameSnapshot: `员工${suffix}`,
        phone: `1370000${suffix}`,
        credentials: { token: 'not-for-clients' },
      };
    }),
    ...optionStudents.map((student, index) => ({
      _id: `account-student-option-${String(index).padStart(3, '0')}`,
      authUid: `auth-student-option-${String(index).padStart(3, '0')}`,
      username: `student-login-${String(index).padStart(3, '0')}`,
      displayName: student.name,
      identityType: 'student',
      studentId: student._id,
      status: 'active',
      role: 'user',
      permissions: [],
      phone: `1391111${String(index).padStart(3, '0')}`,
      credential: 'not-for-clients',
    })),
  ];
  const managerMock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: optionAccounts,
    employees: [...optionEmployees, ...optionStudents],
  });
  const managerResult = await call(handlerFor(managerMock), 'quarterly/assignment-options');

  assert.equal(managerResult.ok, true);
  assert.equal(managerResult.data.accounts.length, 205);
  assert.equal(managerResult.data.employees.length, 205);
  assert.equal(managerResult.data.students.length, 130);
  assert.deepEqual(managerResult.data.students.find((item) => item.studentId === 'student-profile-option-129'), {
    studentId: 'student-profile-option-129',
    name: '学员129',
  });
  assert.deepEqual(Object.keys(managerResult.data.students[0]).sort(), ['name', 'studentId']);
  const accountOption = managerResult.data.accounts.find((item) => item.accountId === 'account-option-002');
  assert.deepEqual(accountOption, {
    accountId: 'account-option-002',
    displayName: '员工002',
    username: 'login-002',
    employeeId: 'employee-option-002',
    employeeName: '员工002',
    department: '部门2',
    status: 'disabled',
  });
  const unknownStatusOption = managerResult.data.accounts.find((item) => item.accountId === 'account-option-003');
  assert.equal(unknownStatusOption.status, 'disabled');
  const managerOption = managerResult.data.accounts.find((item) => item.accountId === 'account-admin');
  assert.equal(managerOption.employeeId, 'employee-option-204');
  assert.equal(managerOption.employeeName, '员工204');
  assert.deepEqual(Object.keys(managerResult.data.accounts[0]).sort(), [
    'accountId', 'department', 'displayName', 'employeeId', 'employeeName', 'status', 'username',
  ]);
  assert.deepEqual(Object.keys(managerResult.data.employees[0]).sort(), [
    'department', 'employeeId', 'name', 'status',
  ]);
  assert.equal(JSON.stringify(managerResult.data).includes('not-for-clients'), false);
  assert.equal(JSON.stringify(managerResult.data).includes('1380000'), false);
  assert.equal(JSON.stringify(managerResult.data).includes('1381111'), false);
  assert.equal(JSON.stringify(managerResult.data).includes('sensitive.read'), false);

  const ordinaryMock = createMockCloudBase({
    identity: { uid: 'auth-user' },
    accounts: accounts(),
    employees: employees(),
  });
  const ordinaryResult = await call(handlerFor(ordinaryMock), 'quarterly/assignment-options');
  assert.equal(ordinaryResult.ok, false);
  assert.equal(ordinaryResult.error.code, 'PERMISSION_DENIED');
});

test('quarterly task availability includes the period and uses the earliest deadline', async () => {
  const ownTask = task('2026-Q3', 'self', 'account-user', 'employee-self', {
    dueAt: '2026-09-22T08:00:00.000Z',
  });
  const mock = createMockCloudBase({
    identity: { uid: 'auth-user' },
    accounts: accounts(),
    employees: employees(),
    periods: [period('2026-Q3', { dueAt: '2026-09-23T08:00:00.000Z' })],
    tasks: [ownTask],
  });
  const handler = handlerFor(mock, '2026-09-22T07:59:59.999Z');

  const taskList = await call(handler, 'quarterly/my-tasks');
  assert.equal(taskList.ok, true);
  assert.equal(taskList.data.items[0].availability.canWrite, true);
  assert.equal(taskList.data.items[0].availability.dueAt, '2026-09-22T08:00:00.000Z');

  const taskDetail = await call(handler, 'quarterly/task', { taskId: ownTask._id });
  assert.equal(taskDetail.ok, true);
  assert.equal(taskDetail.data.availability.canWrite, true);
  assert.equal(taskDetail.data.availability.dueAt, '2026-09-22T08:00:00.000Z');

  const draftDetail = await call(handler, 'quarterly/draft', { taskId: ownTask._id });
  assert.equal(draftDetail.ok, true);
  assert.equal(draftDetail.data.task.availability.canWrite, true);
});

test('quarterly writes reject a closed period, inactive task, and invalid deadline', async (t) => {
  const cases = [
    {
      name: 'period is not open',
      periodOverrides: { status: 'closed' },
      taskOverrides: {},
      expectedCode: 'QUARTERLY_PERIOD_CLOSED',
    },
    {
      name: 'task is not active',
      periodOverrides: {},
      taskOverrides: { status: 'revoked' },
      expectedCode: 'QUARTERLY_TASK_REVOKED',
    },
    {
      name: 'deadline has an impossible calendar date',
      periodOverrides: {},
      taskOverrides: { dueAt: '2026-02-30T08:00:00.000Z' },
      expectedCode: 'QUARTERLY_INVALID_DUE_AT',
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const ownTask = task('2026-Q3', 'self', 'account-user', 'employee-self', scenario.taskOverrides);
      const mock = createMockCloudBase({
        identity: { uid: 'auth-user' },
        accounts: accounts(),
        employees: employees(),
        periods: [period('2026-Q3', scenario.periodOverrides)],
        tasks: [ownTask],
      });
      const result = await call(handlerFor(mock), 'quarterly/draft', {
        taskId: ownTask._id,
        expectedVersion: 0,
        scores: { 任务完成: 20 },
        reasons: { 任务完成: '按期完成本季度目标。' },
      });

      assert.equal(result.ok, false);
      assert.equal(result.error.code, scenario.expectedCode);
      assert.equal(mock.state.records.length, 0);
    });
  }
});

test('quarterly draft, submit, and returned re-entry reject writes at the earliest deadline boundary', async (t) => {
  const cutoff = '2026-09-20T08:00:00.000Z';
  const cases = [
    {
      name: 'task deadline is earlier than the period deadline',
      periodDueAt: '2026-09-21T08:00:00.000Z',
      taskDueAt: cutoff,
      mode: 'draft',
      status: null,
    },
    {
      name: 'period deadline is earlier than the task deadline',
      periodDueAt: cutoff,
      taskDueAt: '2026-09-21T08:00:00.000Z',
      mode: 'submit',
      status: null,
    },
    {
      name: 'a returned record cannot be re-entered after the deadline',
      periodDueAt: '2026-09-21T08:00:00.000Z',
      taskDueAt: cutoff,
      mode: 'draft',
      status: 'returned',
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const ownTask = task('2026-Q3', 'self', 'account-user', 'employee-self', { dueAt: scenario.taskDueAt });
      const mock = createMockCloudBase({
        identity: { uid: 'auth-user' },
        accounts: accounts(),
        employees: employees(),
        periods: [period('2026-Q3', { dueAt: scenario.periodDueAt })],
        tasks: [ownTask],
        records: scenario.status ? [recordFor(ownTask, { status: scenario.status, version: 1 })] : [],
      });
      const input = {
        taskId: ownTask._id,
        expectedVersion: scenario.status ? 1 : 0,
        ...(scenario.mode === 'submit' ? { scores: scores(20), reasons: reasons('按期完成本季度目标。') } : { scores: { 任务完成: 20 }, reasons: { 任务完成: '按期完成本季度目标。' } }),
      };
      const result = await call(handlerFor(mock, cutoff), `quarterly/${scenario.mode}`, input);

      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'QUARTERLY_DEADLINE_PASSED');
      assert.equal(mock.state.records.length, scenario.status ? 1 : 0);
      const taskDetail = await call(handlerFor(mock, cutoff), 'quarterly/task', { taskId: ownTask._id });
      assert.equal(taskDetail.data.availability.canWrite, false);
      assert.equal(taskDetail.data.availability.dueAt, cutoff);
    });
  }
});

test('quarterly writes re-read current period, task, account identity, and time inside the transaction', async (t) => {
  const cases = [
    {
      name: 'closed period',
      expectedCode: 'QUARTERLY_PERIOD_CLOSED',
      beforeTransaction(state) { state.periods[0].status = 'closed'; },
      currentTime: NOW,
    },
    {
      name: 'revoked task',
      expectedCode: 'QUARTERLY_TASK_REVOKED',
      beforeTransaction(state) { state.tasks[0].status = 'revoked'; },
      currentTime: NOW,
    },
    {
      name: 'changed account identity',
      expectedCode: 'QUARTERLY_ACCOUNT_IDENTITY_CHANGED',
      beforeTransaction(state) {
        const account = state.accounts.find((item) => item._id === 'account-user');
        account.employeeId = 'employee-other';
        account.identityVersion = 2;
      },
      currentTime: NOW,
    },
    {
      name: 'deadline reached while the save is being prepared',
      expectedCode: 'QUARTERLY_DEADLINE_PASSED',
      beforeTransaction() { this.setCurrentTime('2026-10-15T15:59:59.000Z'); },
      currentTime: NOW,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const ownTask = task('2026-Q3', 'self', 'account-user', 'employee-self');
      let currentTime = scenario.currentTime;
      const mock = createMockCloudBase({
        identity: { uid: 'auth-user' },
        accounts: accounts(),
        employees: employees(),
        periods: [period('2026-Q3')],
        tasks: [ownTask],
        beforeTransaction: (state) => scenario.beforeTransaction.call({
          setCurrentTime(value) { currentTime = value; },
        }, state),
      });
      const result = await call(handlerFor(mock, () => currentTime), 'quarterly/draft', {
        taskId: ownTask._id,
        expectedVersion: 0,
        scores: { 任务完成: 20 },
        reasons: { 任务完成: '按期完成本季度目标。' },
      });

      assert.equal(result.ok, false);
      assert.equal(result.error.code, scenario.expectedCode);
      assert.equal(mock.state.records.length, 0);
    });
  }
});

test('self task assignment and every ordinary write require the current account employee binding', async (t) => {
  const managerMock = createMockCloudBase({
    identity: { uid: 'auth-admin' },
    accounts: accounts(),
    employees: employees(),
    periods: [period('2026-Q3', { status: 'draft', dueAt: null })],
    beforeTransaction(state) {
      const account = state.accounts.find((item) => item._id === 'account-user');
      account.employeeId = 'employee-other';
    },
  });
  const managerHandler = handlerFor(managerMock);
  const assignmentBase = {
    periodKey: '2026-Q3',
    type: 'self',
    evaluatorAccountId: 'account-user',
    status: 'active',
  };

  const mismatch = await call(managerHandler, 'quarterly/tasks/save', {
    ...assignmentBase,
    evaluateeEmployeeId: 'employee-target',
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error.code, 'QUARTERLY_SELF_BINDING_MISMATCH');
  const unbound = await call(managerHandler, 'quarterly/tasks/save', {
    ...assignmentBase,
    evaluatorAccountId: 'account-admin',
    evaluateeEmployeeId: 'employee-self',
  });
  assert.equal(unbound.ok, false);
  assert.equal(unbound.error.code, 'QUARTERLY_SELF_BINDING_REQUIRED');

  const currentBindingChanged = await call(managerHandler, 'quarterly/tasks/save', {
    ...assignmentBase,
    evaluateeEmployeeId: 'employee-self',
  });
  assert.equal(currentBindingChanged.ok, false);
  assert.equal(currentBindingChanged.error.code, 'QUARTERLY_SELF_BINDING_MISMATCH');
  assert.equal(managerMock.state.tasks.length, 0);
  managerMock.state.accounts.find((item) => item._id === 'account-user').employeeId = 'employee-self';
  const validSelfAssignment = await call(managerHandler, 'quarterly/tasks/save', {
    ...assignmentBase,
    evaluateeEmployeeId: 'employee-self',
  });
  assert.equal(validSelfAssignment.ok, true, JSON.stringify(validSelfAssignment));
  assert.equal(validSelfAssignment.data.task.type, 'self');
  assert.equal(managerMock.state.tasks.length, 1);

  const ordinaryCases = [
    {
      name: 'draft rejects a changed employee binding',
      mode: 'draft',
      mutate(account) { account.employeeId = 'employee-other'; },
      expectedCode: 'PERMISSION_DENIED',
    },
    {
      name: 'submit rejects an unbound account',
      mode: 'submit',
      mutate(account) { delete account.employeeId; },
      expectedCode: 'PERMISSION_DENIED',
    },
  ];

  for (const scenario of ordinaryCases) {
    await t.test(scenario.name, async () => {
      const ownTask = task('2026-Q3', 'self', 'account-user', 'employee-self');
      const mock = createMockCloudBase({
        identity: { uid: 'auth-user' },
        accounts: accounts(),
        employees: employees(),
        periods: [period('2026-Q3')],
        tasks: [ownTask],
        beforeTransaction(state) {
          scenario.mutate(state.accounts.find((item) => item._id === 'account-user'));
        },
      });
      const result = await call(handlerFor(mock), `quarterly/${scenario.mode}`, {
        taskId: ownTask._id,
        expectedVersion: 0,
        ...(scenario.mode === 'submit' ? { scores: scores(20), reasons: reasons('按期完成本季度目标。') } : { scores: { 任务完成: 20 }, reasons: { 任务完成: '按期完成本季度目标。' } }),
      });

      assert.equal(result.ok, false);
      assert.equal(result.error.code, scenario.expectedCode);
      assert.equal(mock.state.records.length, 0);
    });
  }
});
