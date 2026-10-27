/* global require, Buffer, structuredClone, console */
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  COLLECTIONS,
  createHandler,
  getEnvironmentId,
  getStorageAuthority,
  normalizeEmployeeInput,
  normalizeRegistrationInput,
  normalizeRequest,
  auditSummary,
  MANAGED_PERMISSIONS,
} = require('./index');

function imageSafetyFixture(t, kind, options = {}) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'employee-image-fiction-'));
  const imagePath = path.join(directory, 'fiction.png');
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
  fs.writeFileSync(imagePath, bytes);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const employeeId = 'fixture-image-employee';
  const folder = kind === 'event' ? 'events' : 'attachments';
  const storageKey = `cloud://${TEST_STORAGE_AUTHORITY}/employee-archive/${folder}/${employeeId}/fiction.png`;
  const deleted = [];
  const storage = {
    async getTempFileURL() {
      assert.equal(fs.existsSync(imagePath), true, 'the stored file must exist');
      return { fileList: [{ fileID: storageKey, tempFileURL: 'https://example.invalid/fiction.png' }] };
    },
    async deleteFile({ fileList }) {
      deleted.push(...fileList);
      if (fileList.includes(storageKey)) fs.unlinkSync(imagePath);
      return { code: 'SUCCESS' };
    },
  };
  const mock = createMockCloudBase({
    identity: { uid: 'fixture-image-operator' },
    accounts: [{ _id: 'fixture-image-account', authUid: 'fixture-image-operator', status: 'active', username: 'fixture' }],
    employees: [{ _id: employeeId, name: '虚构附件测试员工', department: '虚构测试组', status: 'active', version: 1, events: [], attachments: [] }],
    storage, rejectTransactionWhere: true, imageNativeTransactions: true, ...options,
  });
  const input = {
    employeeId, expectedVersion: 1,
    attachment: { storageKey, fileName: '虚构测试图片.png', mimeType: 'image/png', size: bytes.length },
    ...(kind === 'event' ? { eventDate: '2026-01-01', eventType: '虚构事件', summary: '虚构图片恢复验证', detail: '仅本地测试' } : {}),
  };
  return {
    mock, input, storageKey, route: kind === 'event' ? 'events/create' : 'attachments/upload',
    records() {
      const employee = mock.state.employees.find(row => row._id === employeeId);
      return kind === 'event' ? employee.events.flatMap(event => event.attachments) : employee.attachments;
    },
    assertFile() {
      assert.deepEqual(deleted, [], 'registration must never request file deletion');
      assert.equal(fs.existsSync(imagePath), true);
      assert.deepEqual(fs.readFileSync(imagePath), bytes, 'the file bytes must remain intact');
    },
  };
}

for (const kind of ['general', 'event']) {
  test(`${kind} image: lost success response recovers same key without duplicate metadata or success audit`, async t => {
    const f = imageSafetyFixture(t, kind);
    const handler = handlerWith(f.mock);
    const discardedResponse = await handler({ route: f.route, input: f.input });
    assert.equal(discardedResponse.ok, true);
    assert.equal(f.records().length, 1);
    f.assertFile();
    const replay = await handler({ route: f.route, input: f.input });
    assert.equal(replay.ok, true);
    assert.equal(f.records().length, 1);
    assert.equal(f.mock.state.employees[0].version, 2);
    assert.equal(f.mock.state.audits.filter(audit => audit.result === 'success').length, 1);
    const successWrites = f.mock.state.transactionWrites.filter(write =>
      write.collectionName === COLLECTIONS.employees || write.collectionName === COLLECTIONS.auditLogs);
    assert.equal(new Set(successWrites.map(write => write.transactionId)).size, 1);
    assert.deepEqual(f.mock.state.transactionQueryReads, []);
    f.assertFile();
  });

  test(`${kind} image: conflicting duplicate key retains the already referenced file`, async t => {
    const f = imageSafetyFixture(t, kind);
    const handler = handlerWith(f.mock);
    assert.equal((await handler({ route: f.route, input: f.input })).ok, true);
    const input = { ...f.input, attachment: { ...f.input.attachment, fileName: '不同内容.png' } };
    const rejected = await handler({ route: f.route, input });
    assert.equal(rejected.error.code, 'ATTACHMENT_ALREADY_REGISTERED');
    assert.equal(f.records().length, 1);
    assert.equal(f.records()[0].storageKey, f.storageKey);
    f.assertFile();
  });

  test(`${kind} image: stale version rejects registration while preserving the uploaded file`, async t => {
    const f = imageSafetyFixture(t, kind);
    f.mock.state.employees[0].version = 2;
    const response = await handlerWith(f.mock)({ route: f.route, input: f.input });
    assert.equal(response.error.code, 'EMPLOYEE_CONFLICT');
    assert.equal(response.error.details.submissionOutcome, 'not_committed');
    assert.equal(f.records().length, 0);
    f.assertFile();
  });

  test(`${kind} image: SDK-managed rollback uncertainty retains uploaded file and allows same-key recovery`, async t => {
    const f = imageSafetyFixture(t, kind, {
      imageNativeTransactions: false,
      failTransactionWrite: () => true,
    });
    const response = await handlerWith(f.mock)({ route: f.route, input: f.input });
    assert.equal(response.ok, false);
    assert.equal(response.error.details.submissionOutcome, 'uncertain');
    assert.equal(f.records().length, 0);
    f.assertFile();
  });

  test(`${kind} image: audit failure atomically rolls back metadata and preserves the file`, async t => {
    const f = imageSafetyFixture(t, kind, { failAuditWrites: true });
    const response = await handlerWith(f.mock)({ route: f.route, input: f.input });
    assert.equal(response.error.code, 'AUDIT_WRITE_FAILED');
    assert.equal(response.error.details.submissionOutcome, 'not_committed');
    assert.equal(f.records().length, 0);
    assert.equal(f.mock.state.employees[0].version, 1);
    assert.equal(f.mock.state.audits.length, 0);
    f.assertFile();
  });

  test(`${kind} image: unconfirmed rollback reports uncertainty and never deletes the file`, async t => {
    const f = imageSafetyFixture(t, kind, { failAuditWrites: true, failImageRollback: true });
    const response = await handlerWith(f.mock)({ route: f.route, input: f.input });
    assert.equal(response.error.details.submissionOutcome, 'uncertain');
    assert.equal(f.records().length, 0);
    f.assertFile();
  });

  test(`${kind} image: committed transaction with lost COMMIT reply retains references and supports recovery`, async t => {
    let loseReply = true;
    const f = imageSafetyFixture(t, kind, { loseImageCommitResponse: () => { const lose = loseReply; loseReply = false; return lose; } });
    const handler = handlerWith(f.mock);
    const response = await handler({ route: f.route, input: f.input });
    assert.equal(response.ok, false);
    assert.equal(response.error.details.submissionOutcome, 'uncertain');
    assert.equal(f.records().length, 1);
    assert.equal(f.records()[0].storageKey, f.storageKey);
    f.assertFile();
    assert.equal((await handler({ route: f.route, input: f.input })).ok, true);
    assert.equal(f.records().length, 1);
    assert.equal(f.mock.state.audits.filter(audit => audit.result === 'success').length, 1);
    f.assertFile();
  });

  test(`${kind} image: recovery remains valid after a different employee field advances its version`, async t => {
    const f = imageSafetyFixture(t, kind);
    const handler = handlerWith(f.mock);
    assert.equal((await handler({ route: f.route, input: f.input })).ok, true);
    f.mock.state.employees[0].version = 3;
    f.mock.state.employees[0].notes = '其他操作的虚构备注';
    const response = await handler({ route: f.route, input: f.input });
    assert.equal(response.ok, true);
    assert.equal(response.data.version, 3);
    assert.equal(response.data.notes, '其他操作的虚构备注');
    assert.equal(f.records().length, 1);
    f.assertFile();
  });
}

test('event image: reusing a key for different event content never edits or deletes the original', async t => {
  const f = imageSafetyFixture(t, 'event');
  const handler = handlerWith(f.mock);
  assert.equal((await handler({ route: f.route, input: f.input })).ok, true);
  const response = await handler({ route: f.route, input: { ...f.input, summary: '不同的虚构事件' } });
  assert.equal(response.error.code, 'ATTACHMENT_ALREADY_REGISTERED');
  assert.equal(f.records().length, 1);
  assert.equal(f.mock.state.employees[0].events[0].summary, f.input.summary);
  f.assertFile();
});

test('event image: server upload permission rejection leaves uploaded file intact', async t => {
  const f = imageSafetyFixture(t, 'event', {
    accounts: [{ _id: 'fixture-image-account', authUid: 'fixture-image-operator', status: 'active', username: 'fixture', role: 'admin', permissions: ['history.write'] }],
  });
  const response = await handlerWith(f.mock)({ route: f.route, input: f.input });
  assert.equal(response.error.code, 'PERMISSION_DENIED');
  assert.equal(response.error.details.submissionOutcome, 'not_committed');
  assert.equal(f.records().length, 0);
  f.assertFile();
});

const TEST_ENV_ID = 'archive-demo-environment';
const TEST_STORAGE_AUTHORITY = 'archive-demo-environment.7465-archive-demo-environment-1234567890';
const SIMILAR_ENV_STORAGE_AUTHORITY = 'archive-demo-environment2.7465-archive-demo-environment-1234567890';
const LEGACY_INVITES_COLLECTION = 'employee_registration_invites';
const ACTUAL_EVENT_EMPLOYEE_ID = '84994827aa58728dabbf50db96f678fd';
const ACTUAL_EVENT_ID = '4526312f-fda2-47c5-86fe-1ad5c3ea0c14';
const ACTUAL_EVENT_ATTACHMENT_ID = 'attachment-migration-62e06c91992600a769a21789acf69588bb1c2dd4b174120d7d6ac3480317ddbe';
const ACTUAL_EVENT_STORAGE_KEY = `cloud://${TEST_STORAGE_AUTHORITY}/employee-archive/events/${ACTUAL_EVENT_EMPLOYEE_ID}/image1-deadbeef00000001.jpeg`;

function createMockCloudBase({ identity, accounts, employees = [], students = [], audits = [], registrationInvites = [], identityClaims = [], governanceRoster = null, governanceOperations = [], storage = {}, updateError = '', failAuditWrites = false, failTransactionWrite = null, beforeTransactionCommit = null, afterTransactionCommit = null, failDocumentRead = null, failQueryRead = null, applyDefaultAuthorization = true, rejectTransactionWhere = false, emptyTransactionDocumentEnvelope = false, onTransactionEmployeeRead = null, defaultQueryLimit = Infinity, beforeTransaction = null, enforcePhoneGuardConflicts = false, retryPhoneGuardConflicts = false, imageNativeTransactions = false, loseImageCommitResponse = false, failImageRollback = false }) {
  const state = {
    // Existing baseline fixtures represent the former all-active-admin test
    // contract explicitly. Real legacy records without role/permissions are
    // handled by resolveAccountAuthorization as read-only.
    accounts: accounts.map((item) => applyDefaultAuthorization ? ({
      role: 'admin',
      permissions: [...MANAGED_PERMISSIONS],
      permissionVersion: 1,
      ...item,
    }) : ({ ...item })),
    employees: [
      ...employees.map((item) => ({ ...item })),
      ...students.map((item) => ({ ...item, recordType: 'student' })),
    ],
    audits: audits.map((item) => ({ ...item })),
    registrationInvites: registrationInvites.map((item) => ({ ...item })),
    identityClaims: identityClaims.map((item) => ({ ...item })),
    adminGovernance: governanceRoster ? [{ ...governanceRoster, _id: governanceRoster._id || 'active-super-admin-roster' }] : [],
    adminGovernanceOperations: governanceOperations.map((item) => ({ ...item })),
    updatePayloads: [],
    queryReads: [],
    transactionQueryReads: [],
    queryFieldSelections: [],
    queryOrderBys: [],
    documentReads: [],
    transactionDocumentReads: [],
    transactionWrites: [],
  };
  let sequence = 1;
  let transactionSequence = 0;
  let transactionHook = beforeTransaction;

  function stateFor(collectionName, sourceState = state) {
    if (collectionName === COLLECTIONS.adminAccounts) return sourceState.accounts;
    if (collectionName === COLLECTIONS.employees) return sourceState.employees;
    if (collectionName === COLLECTIONS.auditLogs) return sourceState.audits;
    if (collectionName === LEGACY_INVITES_COLLECTION) return sourceState.registrationInvites;
    if (collectionName === COLLECTIONS.identityClaims) return sourceState.identityClaims;
    if (collectionName === COLLECTIONS.adminGovernance) return sourceState.adminGovernance;
    if (collectionName === COLLECTIONS.adminGovernanceOperations) return sourceState.adminGovernanceOperations;
    throw new Error(`Unexpected collection: ${collectionName}`);
  }

  function buildCollection(collectionName, initialRows, { transactionScoped = false, transactionId = null } = {}) {
    let rows = initialRows;
    let selectedFields = null;
    let requestedLimit = null;
    let queryOffset = 0;
    const query = {
      where(filter) {
        if (transactionScoped) {
          state.transactionQueryReads.push(collectionName);
          if (rejectTransactionWhere) throw new Error('transaction where is unsupported');
        }
        rows = rows.filter((row) => Object.entries(filter).every(([key, value]) => row[key] === value));
        return query;
      },
      orderBy(field, direction = 'asc') {
        state.queryOrderBys.push({ collectionName, field, direction });
        rows = [...rows].sort((left, right) => {
          const comparison = String(left[field] ?? '').localeCompare(String(right[field] ?? ''));
          return direction === 'desc' ? -comparison : comparison;
        });
        return query;
      },
      field(fields) {
        selectedFields = fields;
        state.queryFieldSelections.push({ collectionName, fields: { ...fields } });
        return query;
      },
      skip(count) {
        queryOffset = count;
        rows = rows.slice(count);
        return query;
      },
      limit(count) {
        requestedLimit = count;
        rows = rows.slice(0, count);
        return query;
      },
      async get() {
        state.queryReads.push(collectionName);
        if (typeof failQueryRead === 'function'
          && failQueryRead({ collectionName, offset: queryOffset, transactionScoped })) {
          throw new Error('injected query read failure');
        }
        return { data: rows.slice(0, requestedLimit ?? defaultQueryLimit).map((row) => selectedFields
          ? Object.fromEntries(Object.keys(selectedFields).filter((key) => selectedFields[key]).map((key) => [key, row[key]]))
          : ({ ...row })) };
      },
      doc(id) {
        return {
          async get() {
            state.documentReads.push({ collectionName, id: String(id) });
            if (typeof failDocumentRead === 'function'
              && failDocumentRead({ collectionName, id: String(id), transactionScoped })) {
              throw new Error('injected document read failure');
            }
            const row = initialRows.find((item) => String(item._id || item.id) === String(id));
            if (transactionScoped) {
              state.transactionDocumentReads.push({ collectionName, id: String(id) });
              if (collectionName === COLLECTIONS.employees && typeof onTransactionEmployeeRead === 'function') {
                onTransactionEmployeeRead(row);
              }
            }
            if (!row && transactionScoped && emptyTransactionDocumentEnvelope) {
              return { data: null, requestId: 'transaction-missing-document-test' };
            }
            return { data: row ? { ...row } : [] };
          },
          async set(payload) {
            assert.equal(Object.prototype.hasOwnProperty.call(payload, '_id'), false);
            if (failAuditWrites && collectionName === COLLECTIONS.auditLogs) throw new Error('audit write failed');
            if (transactionScoped && typeof failTransactionWrite === 'function'
              && failTransactionWrite({ collectionName, id: String(id), payload: { ...payload } })) {
              throw new Error('injected transaction write failure');
            }
            const existing = initialRows.find((item) => String(item._id || item.id) === String(id));
            if (existing) Object.assign(existing, payload);
            else initialRows.push({ ...payload, _id: String(id) });
            if (transactionScoped) state.transactionWrites.push({ transactionId, collectionName, id: String(id), operation: 'set', payload: structuredClone(payload) });
            return { id: String(id) };
          },
          async update(payload) {
            assert.equal(Object.prototype.hasOwnProperty.call(payload, '_id'), false);
            state.updatePayloads.push({ collectionName, id, payload: { ...payload } });
            if (transactionScoped && typeof failTransactionWrite === 'function'
              && failTransactionWrite({ collectionName, id: String(id), payload: { ...payload } })) {
              throw new Error('injected transaction write failure');
            }
            if (updateError) throw new Error(updateError);
            const row = initialRows.find((item) => String(item._id || item.id) === String(id));
            if (!row) throw new Error('document not found');
            Object.assign(row, payload);
            if (transactionScoped) state.transactionWrites.push({ transactionId, collectionName, id: String(id), operation: 'update', payload: structuredClone(payload) });
            return { updated: 1 };
          },
        };
      },
      async add(payload) {
        if (failAuditWrites && collectionName === COLLECTIONS.auditLogs) {
          throw new Error('audit write failed');
        }
        const id = `${collectionName}-test-${sequence}`;
        sequence += 1;
        assert.equal(Object.prototype.hasOwnProperty.call(payload, '_id'), false);
        const row = { ...payload, _id: id };
        initialRows.unshift(row);
        if (transactionScoped) state.transactionWrites.push({ transactionId, collectionName, id, operation: 'add', payload: structuredClone(payload) });
        return { id };
      },
    };
    return query;
  }

  function transaction(sourceState = state, transactionId = null) {
    return {
      collection: (collectionName) => buildCollection(collectionName, stateFor(collectionName, sourceState), { transactionScoped: true, transactionId }),
    };
  }

  const sdk = {
    init(options) {
      assert.deepEqual(options, { env: TEST_ENV_ID });
      return {
        auth() {
          return {
            getUserInfo() {
              return identity;
            },
          };
        },
        database() {
          return {
            ...(imageNativeTransactions ? {
              async startTransaction() {
                transactionSequence += 1;
                const transactionId = transactionSequence;
                const transactionState = {
                  ...state,
                  accounts: structuredClone(state.accounts), employees: structuredClone(state.employees),
                  audits: structuredClone(state.audits),
                };
                return {
                  ...transaction(transactionState, transactionId),
                  async commit() {
                    for (const key of ['accounts', 'employees', 'audits']) state[key] = transactionState[key];
                    if (typeof loseImageCommitResponse === 'function' ? loseImageCommitResponse() : loseImageCommitResponse) {
                      throw new Error('injected committed reply lost');
                    }
                    return { ok: 1 };
                  },
                  async rollback() {
                    if (failImageRollback) throw new Error('injected rollback reply lost');
                    return { ok: 1 };
                  },
                };
              },
            } : {}),
            collection(collectionName) {
              return buildCollection(collectionName, stateFor(collectionName));
            },
            async runTransaction(work) {
              if (transactionHook) {
                const hook = transactionHook;
                transactionHook = null;
                await hook(state);
              }
              const attempt = async (allowRetry) => {
                transactionSequence += 1;
                const transactionId = transactionSequence;
                const initialGuardRevision = state.employees.find((row) => row._id === 'system:directory-phone-guard')?.revision ?? 0;
                const transactionState = {
                  ...state,
                  accounts: structuredClone(state.accounts),
                  employees: structuredClone(state.employees),
                  audits: structuredClone(state.audits),
                  registrationInvites: structuredClone(state.registrationInvites),
                  identityClaims: structuredClone(state.identityClaims),
                  adminGovernance: structuredClone(state.adminGovernance),
                  adminGovernanceOperations: structuredClone(state.adminGovernanceOperations),
                };
                const result = await work(transaction(transactionState, transactionId));
                const writes = state.transactionWrites.filter((write) => write.transactionId === transactionId);
                if (typeof beforeTransactionCommit === 'function') {
                  await beforeTransactionCommit({ state, transactionState, transactionId, writes });
                }
                const wrotePhoneGuard = writes.some((write) => write.collectionName === COLLECTIONS.employees && write.id === 'system:directory-phone-guard');
                if (enforcePhoneGuardConflicts && wrotePhoneGuard
                  && (state.employees.find((row) => row._id === 'system:directory-phone-guard')?.revision ?? 0) !== initialGuardRevision) {
                  if (allowRetry && retryPhoneGuardConflicts) {
                    // The SDK retries with fresh documents but the callback must
                    // keep the revision captured before its original phone scan.
                    return attempt(false);
                  }
                  const error = new Error('transaction conflict');
                  error.code = 'EMPLOYEE_CONFLICT';
                  throw error;
                }
                for (const key of [
                  'accounts', 'employees', 'audits', 'registrationInvites', 'identityClaims',
                  'adminGovernance', 'adminGovernanceOperations',
                ]) state[key] = transactionState[key];
                if (typeof afterTransactionCommit === 'function') await afterTransactionCommit(state);
                return result;
              };
              return attempt(true);
            },
          };
        },
        ...storage,
      };
    },
  };

  return { sdk, state };
}

function handlerWith(mock, now = () => '2026-09-15T08:00:00.000Z', options = {}) {
  const handler = createHandler({
    sdkFactory: () => mock.sdk,
    env: { TCB_ENV_ID: TEST_ENV_ID, ACCOUNT_GOVERNANCE_WRITES_ENABLED: 'true' },
    now,
    requestIdFactory: () => 'request-test-001',
    ...options,
  });
  return async (event) => {
    const route = event && event.route;
    const input = event && event.input ? { ...event.input } : { ...(event || {}) };
    delete input.route;
    if (['employees/update', 'courses/create', 'events/create', 'attachments/upload'].includes(route) && !Object.prototype.hasOwnProperty.call(input, 'expectedVersion')) {
      const employee = mock.state.employees.find((item) => String(item._id || item.id) === String(input.employeeId));
      input.expectedVersion = employee && Number.isInteger(employee.version) ? employee.version : 1;
    }
    return handler({ ...event, input });
  };
}

function makeRegistrationFixture({ invitationCode = 'one-time-code_123', employeeId = 'employee-register-001', employeeName = '新注册员工', invitationStatus = 'active', personalPhone = '13800001234' } = {}) {
  const invitationDocumentId = crypto.createHash('sha256').update(invitationCode, 'utf8').digest('hex');
  const claimId = `employee-identity:${crypto.createHash('sha256').update(employeeId, 'utf8').digest('hex')}`;
  const invitationId = `invitation-${employeeId}`;
  return {
    invitationCode,
    invitationDocumentId,
    claimId,
    employees: [{ _id: employeeId, name: employeeName, department: '演示研发组', status: 'active', personalPhone }],
    registrationInvites: [{
      _id: invitationDocumentId,
      invitationId,
      employeeId,
      employeeNameSnapshot: employeeName,
      status: invitationStatus,
      expiresAt: '2026-09-22T08:00:00.000Z',
      createdByAccountId: 'issuer-account-001',
      createdByAuthUid: 'issuer-auth-001',
      createdByDisplayNameSnapshot: '发码总管理员',
    }],
    identityClaims: [{
      _id: claimId,
      employeeId,
      status: 'invited',
      invitationId,
      invitationDocumentId,
    }],
  };
}

function makeRegistrationRecoveryFixture({ employeeId = 'employee-recovery-001', employeeName = '注册恢复员工', phoneNumber = '13800004802', username = 'recovery-user', authUid = '' } = {}) {
  const accountId = `employee-account:${crypto.createHash('sha256').update(employeeId, 'utf8').digest('hex').slice(0, 40)}`;
  const claimId = `employee-identity:${crypto.createHash('sha256').update(employeeId, 'utf8').digest('hex')}`;
  return {
    employeeId,
    employeeName,
    phoneNumber,
    accountId,
    claimId,
    username,
    employees: [{ _id: employeeId, name: employeeName, department: '演示研发组', status: 'active', personalPhone: phoneNumber }],
    identityClaims: [{
      _id: claimId,
      employeeId,
      status: 'recovery_required',
      accountId,
      authUid,
      usernameNormalized: username.toLowerCase(),
      registrationAttemptId: `attempt-${employeeId}`,
      registrationVerificationMethod: 'personal_phone_match',
      previousClaimStatus: 'unclaimed',
      reservedAt: '2026-10-08T02:00:00.000Z',
      recoveryDetectedAt: '2026-10-08T02:01:00.000Z',
    }],
  };
}

test('missing environment configuration returns a clear config error', () => {
  assert.throws(
    () => getEnvironmentId({ TCB_ENV_ID: '', CLOUDBASE_ENV_ID: '' }),
    (error) => error.code === 'CONFIG_MISSING' && /TCB_ENV_ID/.test(error.message),
  );
});

test('request normalization strips only the CloudBase-injected top-level tcbContext', () => {
  const injectedContext = { requestId: 'cloudbase-context-marker' };
  const sdkEvent = normalizeRequest({
    route: 'students/create',
    name: '测试学员甲',
    phoneNumber: '13800003206',
    tcbContext: injectedContext,
  });
  assert.deepEqual(sdkEvent.input, {
    name: '测试学员甲',
    phoneNumber: '13800003206',
  });

  const callerPayload = { route: 'students/create', input: {
    name: '测试学员乙',
    phoneNumber: '13800004775',
    tcbContext: { requestId: 'caller-controlled-marker' },
  } };
  const normalizedPayload = normalizeRequest(callerPayload);
  assert.equal(normalizedPayload.input.tcbContext, callerPayload.input.tcbContext);
});

test('uses the exact observed CloudBase storage authority and fails closed for an unknown environment', () => {
  assert.equal(getStorageAuthority(TEST_ENV_ID), TEST_STORAGE_AUTHORITY);
  assert.throws(
    () => getStorageAuthority(`${TEST_ENV_ID}-similar`),
    (error) => error.code === 'CONFIG_MISSING',
  );
});

test('employee input ignores client actor/authUid/role and keeps the server-owned field set', () => {
  const payload = normalizeEmployeeInput({
    name: '  示例员工甲 ',
    department: '演示研发组',
    actor: 'client',
    authUid: 'client-uid',
    role: 'global_admin',
    storageKey: 'private/key',
  });
  assert.deepEqual(payload, { name: '示例员工甲', department: '演示研发组' });
});

test('employee contract input normalizes the nested record and accepts the existing flat draft fields', () => {
  assert.deepEqual(normalizeEmployeeInput({
    contract: {
      id: 'client-contract-id-is-not-trusted',
      type: ' 固定期限合同 ',
      startDate: '2026-01-02',
      endDate: '2027-01-01',
      notes: ' 虚构合同备注 ',
    },
  }, { partial: true }), {
    contract: {
      type: '固定期限合同',
      startDate: '2026-01-02',
      endDate: '2027-01-01',
      notes: '虚构合同备注',
    },
  });
  assert.deepEqual(normalizeEmployeeInput({
    contractType: '历史客户端合同',
    contractStartDate: '2025-01-01',
    contractEndDate: '2025-12-31',
    contractNotes: '兼容旧版表单提交',
  }, { partial: true }), {
    contract: {
      type: '历史客户端合同',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      notes: '兼容旧版表单提交',
    },
  });
  assert.throws(
    () => normalizeEmployeeInput({ contract: { startDate: '2026-02-01', endDate: '2026-01-01' } }, { partial: true }),
    (error) => error.code === 'VALIDATION_ERROR' && error.details.field === 'contractEndDate',
  );
});

test('registration validation follows the server-side username and password rules', () => {
  assert.deepEqual(normalizeRegistrationInput({ username: ' new.user_01 ', password: 'GoodPass1!', phoneNumber: '＋８６ １３８-００００-１２３４' }), {
    username: 'new.user_01',
    password: 'GoodPass1!',
    phoneNumber: '13800001234',
  });
  for (const input of [
    { username: '1bad space', password: 'GoodPass1!', phoneNumber: '13800001234' },
    { username: 'valid-user', password: 'weakpass', phoneNumber: '13800001234' },
    { username: 'valid-user', password: 'GoodPass1!', phoneNumber: 'not-a-phone' },
    { username: 'valid-user', password: 'GoodPass1!' },
    { username: 'valid-user', password: 'GoodPass1!', phoneNumber: '13800001234', invitationCode: 'legacy-code' },
    { username: 'valid-user', password: 'GoodPass1!', phoneNumber: '13800001234', role: 'super_admin' },
    { username: 'valid-user', password: 'GoodPass1!', phoneNumber: '13800001234', permissions: ['account.manage'] },
  ]) {
    assert.throws(
      () => normalizeRegistrationInput(input),
      (error) => error.code === 'VALIDATION_ERROR',
    );
  }
});

test('public registration rejects client role or permission fields before account creation', async () => {
  for (const privilegeFields of [
    { role: 'super_admin' },
    { role: 'admin' },
    { permissions: [...MANAGED_PERMISSIONS] },
    { permissions: ['account.manage'] },
  ]) {
    const fixture = makeRegistrationFixture();
    const mock = createMockCloudBase({
      identity: { uid: 'public-registration-no-auth-required' },
      accounts: [],
      employees: fixture.employees,
      identityClaims: fixture.identityClaims,
    });
    let managerCalls = 0;
    const response = await handlerWith(mock, undefined, {
      managerFactory: () => { managerCalls += 1; throw new Error('registration must reject privilege fields before auth user creation'); },
    })({
      route: 'accounts/register',
      input: {
        username: 'safe-new-user',
        password: 'GoodPass1!',
        phoneNumber: '13800001234',
        ...privilegeFields,
      },
    });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'VALIDATION_ERROR');
    assert.equal(mock.state.accounts.length, 0);
    assert.equal(managerCalls, 0);
  }
});

test('registration rejects every unsupported password character before reserving an identity', async () => {
  const invalidPasswords = ['!GoodPass1', 'GoodPass1.', 'GoodPass1+', 'GoodPass1=', 'GoodPass1 ', 'GoodPass1中', 'GoodPass1\n', 'GoodPa1', 'GoodPass1'.repeat(4) + '!'];
  for (const password of invalidPasswords) {
    const fixture = makeRegistrationFixture();
    const mock = createMockCloudBase({ identity: { uid: 'public-validation-caller' }, accounts: [], employees: fixture.employees, identityClaims: fixture.identityClaims });
    let managerCalls = 0;
    const response = await handlerWith(mock, undefined, {
      managerFactory: () => { managerCalls += 1; throw new Error('provider should not be initialized'); },
    })({ route: 'accounts/register', input: { username: 'validation-user', password, phoneNumber: fixture.employees[0].personalPhone } });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'VALIDATION_ERROR');
    assert.equal(response.error.details.field, 'password');
    assert.equal(managerCalls, 0);
    assert.deepEqual(mock.state.identityClaims, fixture.identityClaims);
    assert.equal(mock.state.transactionWrites.length, 0);
  }
  for (const character of '()!@#$%^&*|?><_-') {
    assert.doesNotThrow(() => normalizeRegistrationInput({ username: 'validation-user', password: `GoodPass1${character}`, phoneNumber: '13800001234' }));
  }
  assert.doesNotThrow(() => normalizeRegistrationInput({ username: 'validation-user', password: 'Aa1'.repeat(10) + 'Aa', phoneNumber: '13800001234' }));
  assert.doesNotThrow(() => normalizeRegistrationInput({ username: 'validation-user', password: 'GoodPass1', phoneNumber: '13800001234' }));
});

test('explicit provider parameter rejection releases only its own reservation and permits retry', async () => {
  const providerErrors = [
    { code: 'INVALID_PARAM' },
    { code: 'TCBAUTH.INVALID_PARAM' },
    { errCode: 'tcbauth.invalid_param' },
    { errorCode: 'InvalidParameterValue.Password' },
    { Code: 'InvalidParameter' },
    { Response: { Error: { Code: 'INVALID_PARAM' } } },
  ];
  for (const providerError of providerErrors) {
    const fixture = makeRegistrationFixture();
    const mock = createMockCloudBase({ identity: { uid: 'public-provider-rejection-caller' }, accounts: [], employees: fixture.employees, identityClaims: fixture.identityClaims });
    let createCalls = 0;
    const handler = handlerWith(mock, undefined, {
      managerFactory: () => ({ user: {
        async createUser() { createCalls += 1; throw providerError; },
        async modifyUser() { throw new Error('rejected create must not modify Auth users'); },
        async describeUserList() { throw new Error('rejected create must not query Auth users'); },
      } }),
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await handler({ route: 'accounts/register', input: { username: 'rejected-user', password: 'GoodPass1!', phoneNumber: fixture.employees[0].personalPhone } });
      assert.equal(response.error.code, 'VALIDATION_ERROR');
      assert.equal(response.error.details.field, 'registration');
      assert.equal(mock.state.identityClaims[0].status, 'invited');
      for (const field of ['accountId', 'authUid', 'usernameNormalized', 'registrationAttemptId', 'previousClaimStatus', 'reservedAt', 'recoveryCode', 'recoveryDetectedAt']) {
        assert.equal(mock.state.identityClaims[0][field], '');
      }
    }
    assert.equal(createCalls, 2);
    assert.equal(mock.state.accounts.length, 0);
    assert.equal(mock.state.audits.length, 0);
  }
});

test('provider rejection cannot release a reservation that changed ownership', async () => {
  const fixture = makeRegistrationFixture();
  const mock = createMockCloudBase({ identity: { uid: 'public-owner-race-caller' }, accounts: [], employees: fixture.employees, identityClaims: fixture.identityClaims });
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => ({ user: {
      async createUser() {
        Object.assign(mock.state.identityClaims[0], { registrationAttemptId: 'another-registration-attempt', usernameNormalized: 'another-user' });
        throw { code: 'INVALID_PARAM' };
      },
      async modifyUser() {},
      async describeUserList() { return { Data: { UserList: [] } }; },
    } }),
  })({ route: 'accounts/register', input: { username: 'rejected-user', password: 'GoodPass1!', phoneNumber: fixture.employees[0].personalPhone } });
  assert.equal(response.error.code, 'REGISTRATION_RECOVERY_REQUIRED');
  assert.equal(mock.state.identityClaims[0].status, 'creating');
  assert.equal(mock.state.identityClaims[0].registrationAttemptId, 'another-registration-attempt');
  assert.equal(mock.state.identityClaims[0].usernameNormalized, 'another-user');
});

test('failed reservation release and uncertain provider results remain blocked for admin recovery', async () => {
  for (const releaseFailure of [true, false]) {
    const fixture = makeRegistrationFixture();
    const mock = createMockCloudBase({
      identity: { uid: 'public-uncertain-provider-caller' }, accounts: [], employees: fixture.employees, identityClaims: fixture.identityClaims,
      failTransactionWrite: ({ collectionName, payload }) => releaseFailure && collectionName === COLLECTIONS.identityClaims && payload.status === 'invited',
    });
    let createCalls = 0;
    const handler = handlerWith(mock, undefined, {
      managerFactory: () => ({ user: {
        async createUser() {
          createCalls += 1;
          throw releaseFailure ? { code: 'INVALID_PARAM' } : { code: 'ETIMEDOUT', message: 'creation result unknown; INVALID_PARAM or username already exists' };
        },
        async modifyUser() {},
        async describeUserList() { return { Data: { UserList: [] } }; },
      } }),
    });
    const event = { route: 'accounts/register', input: { username: 'uncertain-user', password: 'GoodPass1!', phoneNumber: fixture.employees[0].personalPhone } };
    const response = await handler(event);
    assert.equal(response.error.code, 'REGISTRATION_RECOVERY_REQUIRED');
    assert.equal(mock.state.identityClaims[0].status, 'recovery_required');
    const claimBeforeRetry = structuredClone(mock.state.identityClaims[0]);
    const repeated = await handler(event);
    assert.equal(repeated.error.code, 'REGISTRATION_RECOVERY_REQUIRED');
    assert.deepEqual(mock.state.identityClaims[0], claimBeforeRetry);
    assert.equal(createCalls, 1);
    assert.equal(mock.state.accounts.length, 0);
  }
});

test('phone registration binds one matched student with user role and no permissions', async () => {
  const student = { _id: 'student-register-001', name: '测试学员甲', status: 'active', phoneNumber: '13800006302' };
  const mock = createMockCloudBase({
    identity: { uid: 'student-public-registration' },
    accounts: [],
    employees: [{ ...student, recordType: 'student' }],
  });
  let providerStatus = '';
  const managerFactory = () => ({ user: {
    async createUser(input) {
      providerStatus = input.userStatus;
      return { Data: { Uid: 'student-auth-001' } };
    },
    async modifyUser(input) {
      providerStatus = input.userStatus;
      return { Data: { Success: true } };
    },
    async describeUserList() {
      return { Data: { UserList: [{ Uid: 'student-auth-001', UserStatus: providerStatus }] } };
    },
  } });

  const response = await handlerWith(mock, undefined, { managerFactory })(
    { route: 'accounts/register', input: { username: 'student-user', password: 'GoodPass1!', phoneNumber: '13800006302' } },
  );

  assert.equal(response.ok, true);
  assert.equal(response.data.account.role, 'user');
  assert.deepEqual(response.data.account.permissions, []);
  assert.equal(response.data.account.studentId, 'student-register-001');
  assert.equal(response.data.account.studentNameSnapshot, '测试学员甲');
  assert.equal(response.data.account.employeeId, undefined);
  assert.equal(mock.state.accounts.length, 1);
  assert.equal(mock.state.accounts[0].role, 'user');
  assert.deepEqual(mock.state.accounts[0].permissions, []);
  assert.equal(mock.state.accounts[0].studentId, 'student-register-001');
  assert.equal(mock.state.identityClaims[0].identityType, 'student');
  assert.equal(mock.state.identityClaims[0].studentId, 'student-register-001');
  assert.equal(mock.state.identityClaims[0].employeeId, undefined);
  assert.equal(mock.state.accounts[0]._id.startsWith('student-account:'), true);
  assert.equal(mock.state.identityClaims[0]._id.startsWith('student-identity:'), true);
  assert.equal(mock.state.accounts[0].status, 'active');
});

test('phone registration rejects a phone shared by an employee and student before binding', async () => {
  const phoneNumber = '13800004763';
  const mock = createMockCloudBase({
    identity: { uid: 'ambiguous-public-registration' },
    accounts: [],
    employees: [
      { _id: 'employee-ambiguous-001', name: '测试员工甲', department: '演示研发组', status: 'active', personalPhone: phoneNumber },
      { _id: 'student-ambiguous-001', recordType: 'student', name: '测试学员乙', status: 'active', phoneNumber },
    ],
  });
  let managerCalls = 0;
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => { managerCalls += 1; throw new Error('ambiguous identity must fail before Auth creation'); },
  })({ route: 'accounts/register', input: { username: 'ambiguous-user', password: 'GoodPass1!', phoneNumber } });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'REGISTRATION_IDENTITY_MATCH_AMBIGUOUS');
  assert.equal(managerCalls, 0);
  assert.equal(mock.state.accounts.length, 0);
  assert.equal(mock.state.identityClaims.length, 0);
});

test('phone registration rechecks shared identity matches after reserving a claim', async () => {
  let injectedDuplicate = false;
  const mock = createMockCloudBase({
    identity: { uid: 'concurrent-ambiguous-public-registration' },
    accounts: [],
    employees: [
      { _id: 'employee-concurrent-001', name: '测试员工丙', department: '演示研发组', status: 'active', personalPhone: '13800003199' },
    ],
    afterTransactionCommit: async (state) => {
      if (injectedDuplicate) return;
      injectedDuplicate = true;
      state.employees.push({
        _id: 'student-concurrent-001',
        recordType: 'student',
        name: '测试学员丁',
        status: 'active',
        phoneNumber: '13800003199',
      });
    },
  });
  let createUserCalls = 0;
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => {
      return { user: {
        async createUser() { createUserCalls += 1; throw new Error('ambiguous match must fail before Auth creation'); },
        async modifyUser() { return { Data: { Success: true } }; },
        async describeUserList() { return { Data: { UserList: [] } }; },
      } };
    },
  })({ route: 'accounts/register', input: { username: 'concurrent-user', password: 'GoodPass1!', phoneNumber: '13800003199' } });

  assert.equal(injectedDuplicate, true, `error=${response.error && response.error.code}; claims=${mock.state.identityClaims.map((claim) => claim.status).join(',')}`);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'REGISTRATION_IDENTITY_MATCH_AMBIGUOUS');
  assert.equal(createUserCalls, 0);
  assert.equal(mock.state.accounts.length, 0);
  assert.equal(mock.state.identityClaims[0].status, 'unclaimed');
});

test('phone registration rechecks shared identity matches before binding after Auth creation', async () => {
  const phoneNumber = '13800009877';
  const mock = createMockCloudBase({
    identity: { uid: 'late-ambiguous-public-registration' },
    accounts: [],
    employees: [
      { _id: 'employee-late-001', name: '测试员工丁', department: '演示研发组', status: 'active', personalPhone: phoneNumber },
    ],
  });
  let providerStatus = '';
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => ({ user: {
      async createUser(input) {
        providerStatus = input.userStatus;
        mock.state.employees.push({
          _id: 'student-late-001', recordType: 'student', name: '测试学员戊', status: 'active', phoneNumber,
        });
        return { Data: { Uid: 'late-ambiguous-auth-001' } };
      },
      async modifyUser(input) { providerStatus = input.userStatus; return { Data: { Success: true } }; },
      async describeUserList() { return { Data: { UserList: [{ Uid: 'late-ambiguous-auth-001', UserStatus: providerStatus }] } }; },
    } }),
  })({ route: 'accounts/register', input: { username: 'late-ambiguous-user', password: 'GoodPass1!', phoneNumber } });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'REGISTRATION_RECOVERY_REQUIRED');
  assert.equal(providerStatus, 'BLOCKED');
  assert.equal(mock.state.accounts.length, 0);
  assert.equal(mock.state.identityClaims[0].status, 'recovery_required');
  assert.equal(mock.state.identityClaims[0].authUid, 'late-ambiguous-auth-001');
});

for (const stage of [
  { name: 'reservation', transactionId: 1 },
  { name: 'pending activation binding', transactionId: 2 },
  { name: 'final activation', transactionId: 3 },
]) {
  for (const retryPhoneGuardConflicts of [false, true]) {
    test(`registration ${stage.name} writes the phone guard and rejects an external directory update before commit${retryPhoneGuardConflicts ? ' on callback retry' : ''}`, async () => {
      const fixture = makeRegistrationFixture();
      const phoneNumber = fixture.employees[0].personalPhone;
      const guardId = 'system:directory-phone-guard';
      const initialRevision = 11;
      const otherStudentId = 'other-student-phone-race';
      let observedAttempt;
      let providerStatus = '';
      const providerStatuses = [];
      let createUserCalls = 0;
      const mock = createMockCloudBase({
        identity: { uid: 'public-registration-phone-guard-race' },
        accounts: [],
        employees: [
          ...fixture.employees,
          { _id: guardId, recordType: 'phone_guard', revision: initialRevision },
        ],
        students: [{ _id: otherStudentId, name: '并发修改学员', status: 'active', phoneNumber: '13800001427' }],
        identityClaims: fixture.identityClaims,
        enforcePhoneGuardConflicts: true,
        retryPhoneGuardConflicts,
        beforeTransactionCommit({ state, transactionState, transactionId, writes }) {
          if (transactionId !== stage.transactionId || observedAttempt) return;
          observedAttempt = {
            writes: structuredClone(writes),
            snapshotStudentPhone: transactionState.employees.find((row) => row._id === otherStudentId).phoneNumber,
            snapshotAccountStatus: transactionState.accounts[0]?.status,
          };
          // This independent directory writer commits after the registration's
          // snapshot and subject recheck, so only a shared guard write conflicts.
          state.employees.find((row) => row._id === otherStudentId).phoneNumber = phoneNumber;
          state.employees.find((row) => row._id === guardId).revision += 1;
        },
      });
      const authUid = `auth-registration-guard-${stage.transactionId}`;
      const response = await handlerWith(mock, undefined, {
        managerFactory: () => ({ user: {
          async createUser(input) {
            createUserCalls += 1;
            providerStatus = input.userStatus;
            providerStatuses.push(providerStatus);
            return { Data: { Uid: authUid } };
          },
          async modifyUser(input) {
            providerStatus = input.userStatus;
            providerStatuses.push(providerStatus);
            return { Data: { Success: true } };
          },
          async describeUserList() {
            return { Data: { UserList: [{ Uid: authUid, UserStatus: providerStatus }] } };
          },
        } }),
      })({ route: 'accounts/register', input: { username: 'phone-guard-user', password: 'GoodPass1!', phoneNumber } });

      assert.ok(observedAttempt, 'the external write must run after this registration transaction has completed its callback');
      assert.equal(observedAttempt.snapshotStudentPhone, '13800001427');
      assert.equal(observedAttempt.snapshotAccountStatus, stage.transactionId === 1 ? undefined : stage.transactionId === 2 ? 'pending_activation' : 'active');
      const guardWrite = observedAttempt.writes.find((write) => write.collectionName === COLLECTIONS.employees && write.id === guardId);
      assert.deepEqual(guardWrite, {
        transactionId: stage.transactionId,
        collectionName: COLLECTIONS.employees,
        id: guardId,
        operation: 'set',
        payload: { recordType: 'phone_guard', revision: initialRevision + stage.transactionId },
      }, 'registration must really write and increment the shared guard');
      assert.equal(response.ok, false);
      assert.equal(response.error.code, stage.transactionId === 1
        ? retryPhoneGuardConflicts ? 'PHONE_DIRECTORY_CONFLICT' : 'EMPLOYEE_CONFLICT'
        : 'REGISTRATION_RECOVERY_REQUIRED');
      assert.equal(mock.state.employees.find((row) => row._id === otherStudentId).phoneNumber, phoneNumber);
      assert.equal(mock.state.employees.find((row) => row._id === guardId).revision, initialRevision + stage.transactionId);
      assert.deepEqual(mock.state.transactionWrites
        .filter((write) => write.collectionName === COLLECTIONS.employees && write.id === guardId)
        .map((write) => write.payload.revision),
      Array.from({ length: stage.transactionId }, (_, index) => initialRevision + index + 1));
      assert.equal(createUserCalls, stage.transactionId === 1 ? 0 : 1);
      assert.equal(mock.state.accounts.length, stage.transactionId === 3 ? 1 : 0);
      assert.equal(mock.state.identityClaims[0].status, stage.transactionId === 1 ? 'invited' : 'recovery_required');
      assert.equal(mock.state.audits.some((audit) => audit.action === 'register_account_activation_confirmed'), false);
      if (stage.transactionId === 3) {
        assert.equal(mock.state.accounts[0].status, 'pending_activation');
        assert.equal(mock.state.accounts[0].role, 'user');
        assert.deepEqual(mock.state.accounts[0].permissions, []);
      }
      assert.deepEqual(providerStatuses, stage.transactionId === 1 ? [] : stage.transactionId === 2 ? ['BLOCKED'] : ['BLOCKED', 'ACTIVE', 'BLOCKED']);
    });
  }
}

for (const subjectType of ['employee', 'student']) {
  test(`registration finds a matching ${subjectType} after more than 1000 active directory records`, async () => {
    const phoneNumber = '13800009244';
    const subjectId = `z-registration-${subjectType}-after-1000`;
    const records = Array.from({ length: 1100 }, (_, index) => ({
      _id: `directory-registration-${String(index).padStart(4, '0')}`,
      recordType: index % 2 === 0 ? 'employee' : 'student',
      name: `测试人员${index}`,
      department: '演示研发组',
      status: 'active',
      ...(index % 2 === 0 ? { personalPhone: `137${String(index).padStart(8, '0')}` } : { phoneNumber: `136${String(index).padStart(8, '0')}` }),
    }));
    records.push({
      _id: subjectId,
      recordType: subjectType,
      name: '分页注册人员',
      department: '演示研发组',
      status: 'active',
      ...(subjectType === 'student' ? { phoneNumber } : { personalPhone: phoneNumber }),
    });
    const mock = createMockCloudBase({
      identity: { uid: 'public-registration-after-1000' },
      accounts: [],
      employees: records,
      defaultQueryLimit: 100,
      rejectTransactionWhere: true,
    });
    const authUid = `auth-registration-after-1000-${subjectType}`;
    let providerStatus = '';
    const response = await handlerWith(mock, undefined, {
      managerFactory: () => ({ user: {
        async createUser(input) { providerStatus = input.userStatus; return { Data: { Uid: authUid } }; },
        async modifyUser(input) { providerStatus = input.userStatus; return { Data: { Success: true } }; },
        async describeUserList() { return { Data: { UserList: [{ Uid: authUid, UserStatus: providerStatus }] } }; },
      } }),
    })({ route: 'accounts/register', input: { username: `page-${subjectType}-user`, password: 'GoodPass1!', phoneNumber } });

    assert.equal(response.ok, true);
    assert.equal(response.data.account[`${subjectType}Id`], subjectId);
    assert.equal(mock.state.accounts[0].status, 'active');
    assert.equal(mock.state.queryReads.filter((name) => name === COLLECTIONS.employees).length, 96);
    assert.equal(mock.state.queryOrderBys.every((item) => item.field === '_id' && item.direction === 'asc'), true);
    assert.deepEqual(mock.state.transactionQueryReads, []);
    assert.deepEqual(mock.state.transactionWrites
      .filter((write) => write.collectionName === COLLECTIONS.employees && write.id === 'system:directory-phone-guard')
      .map((write) => write.payload.revision), [1, 2, 3]);
  });

  test(`registration rejects an ambiguous ${subjectType} phone match after more than 1000 active directory records`, async () => {
    const fixture = makeRegistrationFixture({ employeeId: 'a-registration-first-match' });
    const phoneNumber = fixture.employees[0].personalPhone;
    const mock = createMockCloudBase({
      identity: { uid: 'public-registration-ambiguous-after-1000' },
      accounts: [],
      employees: [
        ...fixture.employees,
        ...Array.from({ length: 1100 }, (_, index) => ({
          _id: `directory-filler-${String(index).padStart(4, '0')}`,
          name: `其他测试员工${index}`,
          department: '演示研发组',
          status: 'active',
          personalPhone: `137${String(index).padStart(8, '0')}`,
        })),
        {
          _id: 'z-registration-last-match',
          recordType: subjectType,
          name: '最后一页重复人员',
          status: 'active',
          ...(subjectType === 'student' ? { phoneNumber } : { personalPhone: phoneNumber }),
        },
      ],
      defaultQueryLimit: 100,
    });
    let managerCalls = 0;
    const response = await handlerWith(mock, undefined, {
      managerFactory: () => { managerCalls += 1; throw new Error('ambiguous identity must fail before creating Auth'); },
    })({ route: 'accounts/register', input: { username: 'ambiguous-page-user', password: 'GoodPass1!', phoneNumber } });

    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'REGISTRATION_IDENTITY_MATCH_AMBIGUOUS');
    assert.equal(managerCalls, 0);
    assert.equal(mock.state.accounts.length, 0);
    assert.equal(mock.state.identityClaims.length, 0);
    assert.equal(mock.state.transactionWrites.length, 0);
  });
}

test('student create returns a phone-free list projection and rejects duplicate phones', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'student-manager-001' },
    accounts: [{ _id: 'student-manager-account', authUid: 'student-manager-001', username: 'student-manager', displayName: '档案管理员', status: 'active' }],
  });
  const first = await handlerWith(mock)({
    route: 'students/create',
    name: '测试学员丙',
    phoneNumber: '13800002736',
    tcbContext: { requestId: 'sdk-injected-context' },
  });
  assert.equal(first.ok, true);
  assert.equal(first.data.name, '测试学员丙');
  assert.equal(first.data.recordType, 'student');
  assert.equal(Object.prototype.hasOwnProperty.call(first.data, 'phoneNumber'), false);
  assert.equal(mock.state.employees.filter((record) => record.recordType === 'student').length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(mock.state.employees[0], 'tcbContext'), false);

  const callerSuppliedContext = await handlerWith(mock)({
    route: 'students/create',
    input: { name: '上下文不应被接受', phoneNumber: '13800009584', tcbContext: { requestId: 'caller-controlled-context' } },
  });
  assert.equal(callerSuppliedContext.ok, false);
  assert.equal(callerSuppliedContext.error.code, 'VALIDATION_ERROR');
  assert.equal(callerSuppliedContext.error.details.field, 'tcbContext');

  const list = await handlerWith(mock)({ route: 'students/list' });
  assert.equal(list.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(list.data.items[0], 'phoneNumber'), false);
  const detail = await handlerWith(mock)({ route: 'students/get', input: { studentId: first.data.id } });
  assert.equal(detail.ok, true);
  assert.equal(typeof detail.data.phoneNumber, 'string');
  assert.equal(mock.state.audits.some((audit) => audit.action === 'view_student_detail'), false);
  const missingDetail = await handlerWith(mock)({ route: 'students/get', input: { studentId: 'missing-student' } });
  assert.equal(missingDetail.ok, false);
  assert.equal(missingDetail.error.code, 'STUDENT_NOT_FOUND');
  assert.equal(mock.state.audits.some((audit) => audit.action === 'view_student_detail'), false);

  const duplicate = await handlerWith(mock)({
    route: 'students/create',
    input: { name: '另一测试学员', phoneNumber: '13800002736' },
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'STUDENT_PHONE_DUPLICATE');
  assert.equal(mock.state.employees.filter((record) => record.recordType === 'student').length, 1);
  assert.equal(mock.state.audits.some((audit) => audit.action === 'create_student' && audit.result === 'success'), true);

  const archived = await handlerWith(mock)({
    route: 'students/archive',
    input: { studentId: first.data.id, expectedVersion: 1 },
  });
  assert.equal(archived.ok, true);
  assert.equal(archived.data.status, 'inactive');
  const archivedDuplicate = await handlerWith(mock)({
    route: 'students/create',
    input: { name: '归档后重复号码学员', phoneNumber: '13800002736' },
  });
  assert.equal(archivedDuplicate.ok, false);
  assert.equal(archivedDuplicate.error.code, 'STUDENT_PHONE_DUPLICATE');
  const restored = await handlerWith(mock)({
    route: 'students/restore',
    input: { studentId: first.data.id, expectedVersion: 2 },
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.data.status, 'active');
});

test('shared employee list and student list keep record types and phone projection separate', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'shared-list-admin' },
    accounts: [{ _id: 'shared-list-account', authUid: 'shared-list-admin', username: 'shared-list-admin', status: 'active' }],
    employees: [
      { _id: 'shared-employee', name: '列表员工', department: '演示研发组', status: 'active', personalPhone: '13800005913' },
      { _id: 'shared-student', recordType: 'student', name: '列表学员', status: 'active', phoneNumber: '13800003339' },
    ],
  });

  const employeeList = await handlerWith(mock)({ route: 'employees/list' });
  assert.equal(employeeList.ok, true);
  assert.equal(employeeList.data.total, 1);
  assert.equal(employeeList.data.items[0].recordType, 'employee');
  assert.equal(employeeList.data.items[0].name, '列表员工');

  const studentList = await handlerWith(mock)({ route: 'students/list' });
  assert.equal(studentList.ok, true);
  assert.equal(studentList.data.total, 1);
  assert.equal(studentList.data.items[0].recordType, 'student');
  assert.equal(Object.prototype.hasOwnProperty.call(studentList.data.items[0], 'phoneNumber'), false);

  const studentDetail = await handlerWith(mock)({ route: 'students/get', input: { studentId: 'shared-student' } });
  assert.equal(studentDetail.ok, true);
  assert.equal(studentDetail.data.recordType, 'student');
  assert.equal(typeof studentDetail.data.phoneNumber, 'string');
  assert.equal(mock.state.audits.some((audit) => audit.action === 'view_student_detail'), false);
});

test('student detail still requires employee.write without recording a view audit', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'student-limited-manager' },
    accounts: [{ _id: 'student-limited-account', authUid: 'student-limited-manager', username: 'student-limited-manager', status: 'active', role: 'admin', permissions: ['history.write'] }],
    students: [{ _id: 'limited-student', name: '权限测试学员', status: 'active', phoneNumber: '13800007414' }],
  });

  const denied = await handlerWith(mock)({ route: 'students/get', input: { studentId: 'limited-student' } });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'PERMISSION_DENIED');
  assert.equal(mock.state.audits.some((audit) => audit.action === 'view_student_detail'), false);
});

test('employee and student writes reject personal phone conflicts across the shared collection', async () => {
  const studentPhone = '13800003000';
  const mock = createMockCloudBase({
    identity: { uid: 'phone-conflict-admin' },
    accounts: [{ _id: 'phone-conflict-account', authUid: 'phone-conflict-admin', username: 'phone-conflict-admin', status: 'active' }],
    employees: [
      { _id: 'phone-conflict-student', recordType: 'student', name: '查重学员', status: 'active', phoneNumber: studentPhone },
      { _id: 'phone-conflict-former', name: '离职员工', department: '演示研发组', status: 'former', personalPhone: '13800002307', version: 1 },
    ],
  });

  const studentDuplicate = await handlerWith(mock)({
    route: 'students/create',
    input: { name: '重复号码学员', phoneNumber: '13800002307' },
  });
  assert.equal(studentDuplicate.ok, false);
  assert.equal(studentDuplicate.error.code, 'STUDENT_PHONE_DUPLICATE');

  const employeeDuplicate = await handlerWith(mock)({
    route: 'employees/create',
    input: { name: '重复号码员工', department: '演示研发组', personalPhone: studentPhone },
  });
  assert.equal(employeeDuplicate.ok, false);
  assert.equal(employeeDuplicate.error.code, 'EMPLOYEE_PHONE_DUPLICATE');

  const restoreDuplicate = await handlerWith(mock)({
    route: 'employees/update',
    input: { employeeId: 'phone-conflict-former', expectedVersion: 1, status: 'active', personalPhone: studentPhone },
  });
  assert.equal(restoreDuplicate.ok, false);
  assert.equal(restoreDuplicate.error.code, 'EMPLOYEE_PHONE_DUPLICATE');
  assert.equal(mock.state.employees.find((row) => row._id === 'phone-conflict-former').status, 'former');
});

test('employee and student directory endpoints paginate beyond the database default limit', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'directory-page-admin' },
    accounts: [{ _id: 'directory-page-account', authUid: 'directory-page-admin', username: 'directory-page-admin', status: 'active' }],
    employees: Array.from({ length: 205 }, (_, index) => ({
      _id: `directory-employee-${String(index).padStart(3, '0')}`,
      name: `员工${index}`,
      department: '演示研发组',
      status: 'active',
      personalPhone: `139${String(index).padStart(8, '0')}`,
    })),
    students: Array.from({ length: 205 }, (_, index) => ({
      _id: `directory-student-${String(index).padStart(3, '0')}`,
      name: `学员${index}`,
      status: 'active',
      phoneNumber: `138${String(index).padStart(8, '0')}`,
    })),
    defaultQueryLimit: 100,
  });
  const handler = handlerWith(mock);

  const employees = await handler({ route: 'employees/list', input: { page: 3, pageSize: 100 } });
  assert.equal(employees.ok, true);
  assert.equal(employees.data.total, 205);
  assert.equal(employees.data.items.length, 5);
  assert.equal(employees.data.items[0].id, 'directory-employee-200');

  const students = await handler({ route: 'students/list', input: { page: 3, pageSize: 100 } });
  assert.equal(students.ok, true);
  assert.equal(students.data.total, 205);
  assert.equal(students.data.items.length, 5);
  assert.equal(students.data.items[0].id, 'directory-student-200');
  assert.equal(Object.prototype.hasOwnProperty.call(students.data.items[0], 'phoneNumber'), false);
});

test('a retried phone update cannot reuse a directory scan from an older guard revision', async () => {
  let mock;
  let concurrentWriteInjected = false;
  mock = createMockCloudBase({
    identity: { uid: 'phone-guard-race-admin' },
    accounts: [{ _id: 'phone-guard-race-account', authUid: 'phone-guard-race-admin', username: 'phone-guard-race-admin', status: 'active' }],
    enforcePhoneGuardConflicts: true,
    retryPhoneGuardConflicts: true,
    onTransactionEmployeeRead() {
      if (concurrentWriteInjected) return;
      concurrentWriteInjected = true;
      mock.state.employees.push({
        _id: 'system:directory-phone-guard',
        recordType: 'phone_guard',
        revision: 1,
      });
    },
  });

  const result = await handlerWith(mock)({
    route: 'students/create',
    input: { name: '并发建档学员', phoneNumber: '13800009045' },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PHONE_DIRECTORY_CONFLICT');
  assert.equal(mock.state.employees.some((row) => row.recordType === 'student'), false);
  assert.equal(mock.state.employees.find((row) => row._id === 'system:directory-phone-guard')?.revision, 1);
  assert.equal(mock.state.audits.some((audit) => audit.action === 'create_student' && audit.result === 'success'), false);
});

test('student profile and success audit roll back together when audit persistence fails', async () => {
  const student = {
    _id: 'student-audit-atomic',
    recordType: 'student',
    name: '原学员名',
    status: 'active',
    phoneNumber: '13800006445',
    version: 1,
  };
  const scenarios = [
    {
      route: 'students/create',
      students: [],
      input: { name: '新增学员', phoneNumber: '13800008567' },
    },
    {
      route: 'students/update',
      students: [student],
      input: { studentId: student._id, expectedVersion: 1, name: '修改后学员名' },
    },
    {
      route: 'students/archive',
      students: [student],
      input: { studentId: student._id, expectedVersion: 1 },
    },
    {
      route: 'students/restore',
      students: [{ ...student, status: 'inactive' }],
      input: { studentId: student._id, expectedVersion: 1 },
    },
  ];

  for (const scenario of scenarios) {
    const mock = createMockCloudBase({
      identity: { uid: `student-audit-${scenario.route}` },
      accounts: [{ _id: `student-audit-account-${scenario.route}`, authUid: `student-audit-${scenario.route}`, username: 'student-audit-admin', status: 'active' }],
      students: scenario.students,
      failAuditWrites: true,
    });
    const before = structuredClone(mock.state.employees);
    const result = await handlerWith(mock)({ route: scenario.route, input: scenario.input });

    assert.equal(result.ok, false, `${scenario.route} should fail when its audit cannot be persisted`);
    assert.deepEqual(mock.state.employees, before, `${scenario.route} should roll back profile changes`);
    assert.equal(mock.state.employees.some((row) => row._id === 'system:directory-phone-guard'), false, `${scenario.route} should roll back the guard write`);
    assert.equal(mock.state.audits.some((audit) => audit.targetType === 'student' && audit.result === 'success'), false);
  }
});

test('student account identity stays ordinary and is excluded from quarterly employee candidates', async () => {
  const studentAccount = {
    _id: 'student-account-scope',
    authUid: 'student-scope-auth',
    username: 'student-scope',
    displayName: '学员账号',
    status: 'active',
    role: 'super_admin',
    permissions: [...MANAGED_PERMISSIONS],
    studentId: 'shared-student-scope',
    employeeId: 'shared-employee-scope',
  };
  const studentSessionMock = createMockCloudBase({
    identity: { uid: 'student-scope-auth' },
    accounts: [studentAccount],
    employees: [{ _id: 'shared-employee-scope', name: '不应绑定的员工', department: '演示研发组', status: 'active' }],
  });
  const session = await handlerWith(studentSessionMock)({ route: 'session' });
  assert.equal(session.ok, true);
  assert.equal(session.data.account.role, 'user');
  assert.deepEqual(session.data.account.permissions, []);
  assert.equal(session.data.account.identityType, 'student');
  assert.equal(session.data.account.employeeId, undefined);
  const selfDirectory = await handlerWith(studentSessionMock)({ route: 'employees/list' });
  assert.equal(selfDirectory.ok, true);
  assert.equal(selfDirectory.data.total, 0);

  const managerMock = createMockCloudBase({
    identity: { uid: 'candidate-super-auth' },
    accounts: [
      { _id: 'candidate-super', authUid: 'candidate-super-auth', username: 'candidate-root', status: 'active', role: 'super_admin' },
      { _id: 'candidate-student-account', authUid: 'student-other-auth', username: 'candidate-student', status: 'active', role: 'user', permissions: [], studentId: 'shared-student-candidate' },
    ],
    employees: [
      { _id: 'candidate-employee', name: '季度员工候选', department: '演示研发组', status: 'active' },
      { _id: 'shared-student-candidate', recordType: 'student', name: '季度学员候选', status: 'active' },
    ],
    governanceRoster: {
      schemaVersion: 1,
      state: 'ready',
      limit: 5,
      activeSuperAdminAccountIds: ['candidate-super'],
      revision: 1,
    },
  });
  const candidates = await handlerWith(managerMock)({ route: 'quarterly/assignment-options' });
  assert.equal(candidates.ok, true);
  assert.deepEqual(candidates.data.employees.map((row) => row.employeeId), ['candidate-employee']);
  assert.equal(candidates.data.accounts.some((row) => row.accountId === 'candidate-student-account'), false);

  const promotion = await handlerWith(managerMock)({
    route: 'accounts/update-role',
    input: {
      accountId: 'candidate-student-account',
      role: 'admin',
      operationId: '44444444-4444-4444-8444-444444444444',
      expectedGovernanceRevision: 1,
    },
  });
  assert.equal(promotion.ok, false);
  assert.equal(promotion.error.code, 'STUDENT_ACCOUNT_ROLE_FIXED');
  const bind = await handlerWith(managerMock)({
    route: 'accounts/bind-employee',
    input: {
      accountId: 'candidate-student-account',
      employeeId: 'candidate-employee',
      operationId: '55555555-5555-4555-8555-555555555555',
      expectedGovernanceRevision: 1,
    },
  });
  assert.equal(bind.ok, false);
  assert.equal(bind.error.code, 'STUDENT_ACCOUNT_EMPLOYEE_BIND_FORBIDDEN');
});

test('missing, ambiguous, and inactive phone matches fail without identifying the employee', async () => {
  const fixture = makeRegistrationFixture();
  const cases = [
    {
      employees: fixture.employees.map((employee) => ({ ...employee, workPhone: '13800008828' })),
      accounts: [{ _id: 'account-existing', authUid: 'existing-auth', username: 'Existing_User', displayName: '已有用户', status: 'active' }],
      phoneNumber: '13800008828',
    },
    {
      employees: [...fixture.employees, { ...fixture.employees[0], _id: 'employee-duplicate-phone', name: '另一员工' }],
      accounts: [],
      phoneNumber: '13800001234',
    },
    {
      employees: fixture.employees.map((employee) => ({ ...employee, status: 'inactive', personalPhone: '13800008828' })),
      accounts: [],
      phoneNumber: '13800008828',
    },
  ];
  const responses = [];
  let createUserCalls = 0;
  for (const [index, item] of cases.entries()) {
    const mock = createMockCloudBase({
      identity: { uid: `not-used-for-public-registration-${index}` },
      accounts: item.accounts,
      employees: item.employees,
      identityClaims: item.accounts.length ? [] : fixture.identityClaims,
    });
    const response = await handlerWith(mock, undefined, {
      managerFactory: () => ({ user: {
        async createUser() { createUserCalls += 1; return { Data: { Uid: 'unexpected-user' } }; },
        async modifyUser() {},
        async describeUserList() { return { Data: { UserList: [] } }; },
      } }),
    })({
      route: 'accounts/register',
      input: { username: index === 0 ? 'Existing_User' : 'brand-new-user', password: 'GoodPass1!', phoneNumber: item.phoneNumber },
    });
    responses.push(response);
    assert.equal(mock.state.audits.length, 0);
  }

  assert.deepEqual(responses.map((response) => response.error.code), [
    'REGISTRATION_EMPLOYEE_MATCH_FAILED',
    'REGISTRATION_IDENTITY_MATCH_AMBIGUOUS',
    'REGISTRATION_EMPLOYEE_MATCH_FAILED',
  ]);
  assert.equal(responses.every((response) => !/新注册员工|另一员工|13800001234|13800008828/.test(response.error.message)), true);
  assert.equal(createUserCalls, 0);
});

test('registration fails closed when a later page of the directory phone scan cannot be read', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'not-used-for-registration-scan-cap' },
    accounts: [],
    employees: Array.from({ length: 1100 }, (_, index) => ({
      _id: `employee-${index}`,
      name: `员工${index}`,
      department: '演示研发组',
      status: 'active',
      personalPhone: `138${String(index).padStart(8, '0')}`,
      workPhone: '13800001234',
    })),
    failQueryRead: ({ collectionName, offset }) => collectionName === COLLECTIONS.employees && offset === 1000,
  });
  let managerCalled = false;
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => {
      managerCalled = true;
      throw new Error('registration must stop before account creation when a directory page is unreadable');
    },
  })({
    route: 'accounts/register',
    input: { username: 'new-user', password: 'GoodPass1!', phoneNumber: '13800001234' },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'DATABASE_READ_FAILED');
  assert.equal(managerCalled, false);
  assert.deepEqual(mock.state.queryFieldSelections[0].fields, {
    _id: true,
    recordType: true,
    name: true,
    department: true,
    status: true,
    personalPhone: true,
  });
});

test('legacy invitation preview is disabled without revealing stored employee details', async () => {
  const fixture = makeRegistrationFixture();
  const mock = createMockCloudBase({
    identity: { uid: 'not-used-for-retired-invitation-preview' },
    accounts: [],
    employees: fixture.employees,
    registrationInvites: fixture.registrationInvites,
    identityClaims: fixture.identityClaims,
  });
  const response = await handlerWith(mock)({
    route: 'accounts/invitations/preview',
    input: { invitationCode: fixture.invitationCode },
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'REGISTRATION_METHOD_RETIRED');
  assert.equal(response.error.message.includes('新注册员工'), false);
  assert.equal(mock.state.registrationInvites[0].status, 'active');
  assert.equal(mock.state.queryReads.includes(LEGACY_INVITES_COLLECTION), false);
});

test('old invitation registration and administration routes are retired without touching stored invitation records', async () => {
  const fixture = makeRegistrationFixture();
  const before = JSON.stringify(fixture.registrationInvites);
  const mock = createMockCloudBase({
    identity: { uid: 'retired-invitation-admin' },
    accounts: [{ _id: 'retired-invitation-admin-account', authUid: 'retired-invitation-admin', username: 'root-admin', displayName: '总管理员', status: 'active', role: 'super_admin' }],
    employees: fixture.employees,
    registrationInvites: fixture.registrationInvites,
    identityClaims: fixture.identityClaims,
  });

  const oldRegister = await handlerWith(mock)({
    route: 'accounts/register',
    input: { username: 'old-user', password: 'GoodPass1!', invitationCode: fixture.invitationCode },
  });
  assert.equal(oldRegister.ok, false);
  assert.equal(oldRegister.error.code, 'REGISTRATION_METHOD_RETIRED');

  const missingPhone = await handlerWith(mock)({
    route: 'accounts/register',
    input: { username: 'new-user', password: 'GoodPass1!' },
  });
  assert.equal(missingPhone.ok, false);
  assert.equal(missingPhone.error.code, 'VALIDATION_ERROR');

  for (const route of ['accounts/invitations/create', 'accounts/invitations/list', 'accounts/invitations/revoke']) {
    const response = await handlerWith(mock)({ route, input: { invitationId: fixture.registrationInvites[0].invitationId } });
    assert.equal(response.ok, false, route);
    assert.equal(response.error.code, 'ROUTE_NOT_FOUND', route);
  }

  assert.equal(JSON.stringify(mock.state.registrationInvites), before);
  assert.equal(mock.state.queryReads.includes(LEGACY_INVITES_COLLECTION), false);
  assert.equal(mock.state.updatePayloads.some((item) => item.collectionName === LEGACY_INVITES_COLLECTION), false);
});

test('phone registration binds one matched employee, preserves legacy invite records, and verifies provider activation', async () => {
  const fixture = makeRegistrationFixture();
  const mock = createMockCloudBase({
    identity: { uid: 'not-used-for-public-registration' },
    accounts: [],
    employees: fixture.employees,
    registrationInvites: fixture.registrationInvites,
    identityClaims: fixture.identityClaims,
    rejectTransactionWhere: true,
    emptyTransactionDocumentEnvelope: true,
  });
  const providerCalls = [];
  let providerStatus = '';
  const managerFactory = (envId, env) => {
    assert.equal(envId, TEST_ENV_ID);
    assert.equal(env.TCB_ENV_ID, TEST_ENV_ID);
    return { user: {
      async createUser(input) {
        providerCalls.push({ action: 'create', input });
        providerStatus = input.userStatus;
        return { Data: { Uid: 'auth-new-user-001' } };
      },
      async modifyUser(input) {
        providerCalls.push({ action: 'modify', input });
        if (input.userStatus === 'ACTIVE') {
          assert.equal(providerStatus, 'BLOCKED');
          assert.equal(mock.state.accounts[0].status, 'pending_activation');
          assert.equal(mock.state.accounts[0].role, 'user');
        }
        providerStatus = input.userStatus;
        return { Data: { Success: true } };
      },
      async describeUserList(input) {
        providerCalls.push({ action: 'describe', input });
        return { Data: { UserList: [{ Uid: 'auth-new-user-001', UserStatus: providerStatus }] } };
      },
    } };
  };
  const response = await handlerWith(mock, undefined, { managerFactory })({
    route: 'accounts/register',
    input: { username: 'new-user', password: 'GoodPass1!', phoneNumber: '＋８６ １３８-００００-１２３４' },
  });

  assert.equal(response.ok, true);
  assert.equal(response.data.registered, true);
  assert.deepEqual(response.data.account, {
    username: 'new-user',
    displayName: '新注册员工',
    scope: 'self',
    role: 'user',
    permissions: [],
    status: 'active',
    employeeId: 'employee-register-001',
    employeeNameSnapshot: '新注册员工',
    identityVersion: 1,
  });
  assert.deepEqual(providerCalls.map((call) => call.action), ['create', 'modify', 'describe']);
  assert.deepEqual(providerCalls[0].input, {
    name: 'new-user',
    password: 'GoodPass1!',
    type: 'externalUser',
    userStatus: 'BLOCKED',
    nickName: '新注册员工',
  });
  assert.deepEqual(providerCalls[1].input, { uid: 'auth-new-user-001', userStatus: 'ACTIVE' });
  assert.deepEqual(providerCalls[2].input, { uidList: ['auth-new-user-001'] });
  assert.equal(mock.state.accounts.length, 1);
  assert.equal(mock.state.accounts[0].authUid, 'auth-new-user-001');
  assert.equal(mock.state.accounts[0].employeeId, 'employee-register-001');
  assert.equal(mock.state.accounts[0].displayName, '新注册员工');
  assert.equal(mock.state.accounts[0].role, 'user');
  assert.equal(mock.state.accounts[0].status, 'active');
  assert.deepEqual(mock.state.accounts[0].permissions, []);
  assert.equal(mock.state.identityClaims[0].status, 'linked');
  assert.equal(mock.state.identityClaims[0].authUid, 'auth-new-user-001');
  assert.equal(JSON.stringify(mock.state.registrationInvites), JSON.stringify(fixture.registrationInvites));
  assert.equal(mock.state.accounts[0].registrationVerificationMethod, 'personal_phone_match');
  assert.equal(mock.state.identityClaims[0].registrationVerificationMethod, 'personal_phone_match');
  assert.equal(mock.state.identityClaims[0].invitationId, '');
  assert.equal(mock.state.identityClaims[0].invitationDocumentId, '');
  assert.equal(mock.state.queryReads.includes(LEGACY_INVITES_COLLECTION), false);
  assert.equal(mock.state.updatePayloads.some((item) => item.collectionName === LEGACY_INVITES_COLLECTION), false);
  assert.deepEqual(mock.state.queryFieldSelections.find((item) => item.collectionName === COLLECTIONS.employees)?.fields, {
    _id: true,
    recordType: true,
    name: true,
    department: true,
    status: true,
    personalPhone: true,
  });
  assert.equal(mock.state.queryOrderBys.some((item) => item.collectionName === COLLECTIONS.employees && item.field === '_id' && item.direction === 'asc'), true);
  assert.deepEqual(mock.state.transactionQueryReads, []);
  assert.equal(mock.state.transactionDocumentReads.filter((item) => item.collectionName === COLLECTIONS.employees && item.id === 'employee-register-001').length, 3);
  assert.equal(mock.state.transactionDocumentReads.filter((item) => item.collectionName === COLLECTIONS.employees && item.id === 'system:directory-phone-guard').length, 3);
  assert.deepEqual(mock.state.transactionWrites
    .filter((write) => write.collectionName === COLLECTIONS.employees && write.id === 'system:directory-phone-guard')
    .map((write) => write.payload.revision), [1, 2, 3]);
  assert.equal(JSON.stringify(mock.state.accounts).includes('13800001234'), false);
  assert.equal(JSON.stringify(mock.state.identityClaims).includes('13800001234'), false);
  assert.equal(JSON.stringify(mock.state.audits).includes('13800001234'), false);
  assert.equal(mock.state.audits[0].verificationMethod, 'personal_phone_match');
  assert.deepEqual(mock.state.audits.map((record) => record.action), [
    'register_account_pending_activation',
    'register_account_activation_confirmed',
  ]);
  assert.equal(mock.state.audits[0].targetType, 'account');
  assert.equal(JSON.stringify(mock.state.audits).includes('GoodPass1!'), false);

  const retry = await handlerWith(mock, undefined, { managerFactory })({
    route: 'accounts/register',
    input: { username: 'another-name', password: 'GoodPass1!', phoneNumber: '13800001234' },
  });
  assert.equal(retry.ok, false);
  assert.equal(retry.error.code, 'REGISTRATION_IDENTITY_CLAIMED');
  assert.equal(mock.state.accounts.length, 1);
});

test('registration stays pending while Auth is blocked and governance cannot promote it in that window', async () => {
  const fixture = makeRegistrationFixture();
  const callerIdentity = { uid: 'public-registration-caller' };
  const superAdmin = {
    _id: 'governance-super-account',
    authUid: 'governance-super-auth',
    username: 'governance-root',
    displayName: '总管理员',
    status: 'active',
    role: 'super_admin',
    permissions: [],
  };
  let providerStatus = '';
  let concurrentPromotion;
  const mock = createMockCloudBase({
    identity: callerIdentity,
    accounts: [superAdmin],
    employees: fixture.employees,
    identityClaims: fixture.identityClaims,
    governanceRoster: {
      schemaVersion: 1,
      state: 'ready',
      limit: 5,
      activeSuperAdminAccountIds: [superAdmin._id],
      revision: 1,
    },
  });
  const managerFactory = () => ({ user: {
    async createUser() {
      providerStatus = 'BLOCKED';
      return { Data: { Uid: 'auth-race-registration-user' } };
    },
    async modifyUser(input) {
      if (input.userStatus === 'ACTIVE') {
        assert.equal(providerStatus, 'BLOCKED');
        const stagedAccount = mock.state.accounts.find((account) => account.authUid === 'auth-race-registration-user');
        assert.ok(stagedAccount);
        assert.equal(stagedAccount.status, 'pending_activation');
        assert.equal(stagedAccount.role, 'user');
        callerIdentity.uid = superAdmin.authUid;
        concurrentPromotion = await handlerWith(mock)({
          route: 'accounts/update-role',
          input: {
            accountId: stagedAccount._id,
            role: 'super_admin',
            operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            expectedGovernanceRevision: 1,
          },
        });
      }
      providerStatus = input.userStatus;
      return { Data: { Success: true } };
    },
    async describeUserList() {
      return { Data: { UserList: [{ Uid: 'auth-race-registration-user', UserStatus: providerStatus }] } };
    },
  } });

  const response = await handlerWith(mock, undefined, { managerFactory })({
    route: 'accounts/register',
    input: { username: 'race-user', password: 'GoodPass1!', phoneNumber: fixture.employees[0].personalPhone },
  });

  assert.equal(response.ok, true);
  assert.equal(response.data.account.role, 'user');
  assert.equal(response.data.account.status, 'active');
  assert.equal(concurrentPromotion.ok, false);
  assert.equal(concurrentPromotion.error.code, 'ACCOUNT_INACTIVE');
  const registeredAccount = mock.state.accounts.find((account) => account.authUid === 'auth-race-registration-user');
  assert.equal(registeredAccount.status, 'active');
  assert.equal(registeredAccount.role, 'user');
  assert.deepEqual(mock.state.adminGovernance[0].activeSuperAdminAccountIds, [superAdmin._id]);
  assert.equal(mock.state.adminGovernance[0].revision, 1);
});

test('phone registration rechecks the matched employee document in a transaction and rejects a changed phone', async () => {
  const fixture = makeRegistrationFixture();
  let changed = false;
  const mock = createMockCloudBase({
    identity: { uid: 'not-used-for-public-registration-phone-recheck' },
    accounts: [],
    employees: fixture.employees,
    identityClaims: fixture.identityClaims,
    rejectTransactionWhere: true,
    onTransactionEmployeeRead(employee) {
      if (!changed && employee) {
        employee.personalPhone = 'changed-after-preflight';
        changed = true;
      }
    },
  });
  let createUserCalls = 0;
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => ({ user: {
      async createUser() { createUserCalls += 1; return { Data: { Uid: 'unexpected-user' } }; },
      async modifyUser() {},
      async describeUserList() { return { Data: { UserList: [] } }; },
    } }),
  })({
    route: 'accounts/register',
    input: { username: 'recheck-user', password: 'GoodPass1!', phoneNumber: fixture.employees[0].personalPhone },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'REGISTRATION_EMPLOYEE_MATCH_FAILED');
  assert.equal(createUserCalls, 0);
  assert.equal(mock.state.identityClaims[0].status, 'invited');
  assert.equal(mock.state.transactionDocumentReads.filter((item) => item.collectionName === COLLECTIONS.employees && item.id === 'employee-register-001').length, 1);
  assert.deepEqual(mock.state.transactionQueryReads, []);
});

test('account and identity claim conflicts use a distinct registration error', async () => {
  const fixture = makeRegistrationFixture();
  const cases = [
    {
      accounts: [{ _id: 'already-bound-account', authUid: 'existing-auth', username: 'bound-user', employeeId: 'employee-register-001', status: 'active' }],
      identityClaims: fixture.identityClaims,
    },
    {
      accounts: [],
      identityClaims: [{ ...fixture.identityClaims[0], status: 'linked', accountId: 'already-bound-account', authUid: 'existing-auth' }],
    },
  ];

  for (const [index, item] of cases.entries()) {
    const mock = createMockCloudBase({
      identity: { uid: `not-used-for-registration-conflict-${index}` },
      accounts: item.accounts,
      employees: fixture.employees,
      identityClaims: item.identityClaims,
      rejectTransactionWhere: true,
    });
    let createUserCalls = 0;
    const response = await handlerWith(mock, undefined, {
      managerFactory: () => ({ user: {
        async createUser() { createUserCalls += 1; return { Data: { Uid: 'unexpected-user' } }; },
        async modifyUser() {},
        async describeUserList() { return { Data: { UserList: [] } }; },
      } }),
    })({
      route: 'accounts/register',
      input: { username: `conflict-user-${index}`, password: 'GoodPass1!', phoneNumber: fixture.employees[0].personalPhone },
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'REGISTRATION_IDENTITY_CLAIMED');
    assert.notEqual(response.error.code, 'REGISTRATION_EMPLOYEE_MATCH_FAILED');
    assert.equal(createUserCalls, 0);
  }
});

test('registration diagnostics include only request id, allowlisted reason, and safe error code', async () => {
  const fixture = makeRegistrationFixture({ employeeId: 'private-employee-id-marker', employeeName: 'Private Employee Name Marker' });
  const mock = createMockCloudBase({
    identity: { uid: 'not-used-for-registration-log-redaction' },
    accounts: [],
    employees: fixture.employees,
    identityClaims: [{
      ...fixture.identityClaims[0],
      status: 'linked',
      accountId: 'private-account-id-marker',
      authUid: 'private-auth-uid-marker',
    }],
    rejectTransactionWhere: true,
  });
  const priorWarn = console.warn;
  const diagnosticCalls = [];
  console.warn = (...args) => diagnosticCalls.push(args);
  let response;
  try {
    response = await handlerWith(mock, undefined, {
      managerFactory: () => ({ user: {
        async createUser() { throw new Error('unexpected account creation'); },
        async modifyUser() {},
        async describeUserList() { return { Data: { UserList: [] } }; },
      } }),
    })({
      route: 'accounts/register',
      input: {
        username: 'private-user-marker',
        password: 'PrivatePasswordMarker1!',
        phoneNumber: fixture.employees[0].personalPhone,
      },
    });
  } finally {
    console.warn = priorWarn;
  }

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'REGISTRATION_IDENTITY_CLAIMED');
  assert.equal(diagnosticCalls.length, 1);
  assert.equal(diagnosticCalls[0][0], '[employeeArchiveApi] phone registration diagnostic');
  assert.deepEqual(Object.keys(diagnosticCalls[0][1]).sort(), ['errorCode', 'reasonCode', 'requestId']);
  assert.deepEqual(diagnosticCalls[0][1], {
    requestId: 'request-test-001',
    reasonCode: 'IDENTITY_CLAIM_CONFLICT',
    errorCode: 'REGISTRATION_IDENTITY_CLAIMED',
  });
  const output = JSON.stringify({ response, diagnosticCalls });
  for (const secret of [
    'Private Employee Name Marker',
    'private-employee-id-marker',
    'private-account-id-marker',
    'private-auth-uid-marker',
    'private-user-marker',
    'PrivatePasswordMarker1!',
    fixture.employees[0].personalPhone,
  ]) {
    assert.equal(output.includes(secret), false);
  }
});

test('phone registration requires admin recovery when identity recheck fails after Auth creation', async () => {
  const fixture = makeRegistrationFixture();
  const mock = createMockCloudBase({
    identity: { uid: 'not-used-for-public-registration-recheck-failure' },
    accounts: [],
    employees: fixture.employees,
    identityClaims: fixture.identityClaims,
  });
  const providerCalls = [];
  let providerStatus = '';
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => ({ user: {
      async createUser(input) {
        providerCalls.push({ action: 'create', userStatus: input.userStatus });
        providerStatus = input.userStatus;
        mock.state.employees[0].personalPhone = 'changed-after-auth-creation';
        return { Data: { Uid: 'auth-recheck-failure-user-001' } };
      },
      async modifyUser(input) {
        providerCalls.push({ action: 'modify', userStatus: input.userStatus });
        providerStatus = input.userStatus;
      },
      async describeUserList() {
        providerCalls.push({ action: 'describe' });
        return { Data: { UserList: [{ Uid: 'auth-recheck-failure-user-001', UserStatus: providerStatus }] } };
      },
    } }),
  })({
    route: 'accounts/register',
    input: { username: 'recheck-failure-user', password: 'GoodPass1!', phoneNumber: fixture.employees[0].personalPhone },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'REGISTRATION_RECOVERY_REQUIRED');
  assert.deepEqual(providerCalls, [{ action: 'create', userStatus: 'BLOCKED' }]);
  assert.equal(providerStatus, 'BLOCKED');
  assert.equal(mock.state.identityClaims[0].status, 'recovery_required');
  assert.equal(mock.state.identityClaims[0].authUid, 'auth-recheck-failure-user-001');
  assert.equal(mock.state.accounts.length, 0);
});

test('registration rejects a username conflict and restores the identity claim state', async () => {
  const fixture = makeRegistrationFixture({ invitationCode: 'duplicate-name-code_123' });
  const mock = createMockCloudBase({
    identity: { uid: 'not-used-for-public-registration-duplicate' },
    accounts: [{ _id: 'account-existing', authUid: 'existing-auth', username: 'Existing_User', displayName: '已有用户', status: 'active' }],
    employees: fixture.employees,
    registrationInvites: fixture.registrationInvites,
    identityClaims: fixture.identityClaims,
  });
  let createUserCalled = false;
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => ({ user: {
      async createUser() { createUserCalled = true; return { Data: { Uid: 'unexpected-user' } }; },
      async modifyUser() {},
      async describeUserList() { return { Data: { UserList: [] } }; },
    } }),
  })({
    route: 'accounts/register',
    input: { username: ' existing_user ', password: 'GoodPass1!', phoneNumber: fixture.employees[0].personalPhone },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'ACCOUNT_USERNAME_TAKEN');
  assert.equal(createUserCalled, false);
  assert.equal(mock.state.accounts.length, 1);
  assert.equal(mock.state.audits.length, 0);
  assert.equal(mock.state.registrationInvites[0].status, 'active');
  assert.equal(mock.state.identityClaims[0].status, 'invited');
});

test('registration rejects client-selected employee names, IDs, and legacy invite codes', async () => {
  for (const extraInput of [{ displayName: '伪造姓名' }, { employeeId: 'another-employee' }, { invitationCode: 'legacy-invite' }]) {
    const fixture = makeRegistrationFixture({ invitationCode: 'identity-bound-code_123' });
    const mock = createMockCloudBase({
      identity: { uid: 'not-used-for-public-registration-identity' },
      accounts: [],
      employees: fixture.employees,
      registrationInvites: fixture.registrationInvites,
      identityClaims: fixture.identityClaims,
    });
    let managerCalled = false;
    const response = await handlerWith(mock, undefined, {
      managerFactory: () => {
        managerCalled = true;
        return { user: {
          async createUser() { throw new Error('client-selected identity must be rejected before provider creation'); },
          async modifyUser() {},
          async describeUserList() { return { Data: { UserList: [] } }; },
        } };
      },
    })({
      route: 'accounts/register',
      input: { username: 'new-user', password: 'GoodPass1!', phoneNumber: '13800001234', ...extraInput },
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'VALIDATION_ERROR');
    assert.equal(managerCalled, false);
    assert.equal(mock.state.accounts.length, 0);
    assert.equal(mock.state.registrationInvites[0].status, 'active');
    assert.equal(mock.state.identityClaims[0].status, 'invited');
  }
});

test('registration remains pending when provider activation cannot be verified', async () => {
  const fixture = makeRegistrationFixture({ invitationCode: 'activation-check-code_123' });
  const mock = createMockCloudBase({
    identity: { uid: 'not-used-for-public-registration-activation-failure' },
    accounts: [],
    employees: fixture.employees,
    registrationInvites: fixture.registrationInvites,
    identityClaims: fixture.identityClaims,
  });
  const providerStatuses = [];
  let providerStatus = '';
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => ({ user: {
      async createUser(input) {
        providerStatus = input.userStatus;
        return { Data: { Uid: 'auth-pending-user-001' } };
      },
      async modifyUser(input) {
        providerStatuses.push(input.userStatus);
        if (input.userStatus === 'BLOCKED') providerStatus = 'BLOCKED';
        return { Data: { Success: true } };
      },
      async describeUserList() {
        return { Data: { UserList: [{ Uid: 'auth-pending-user-001', UserStatus: providerStatus }] } };
      },
    } }),
  })({
    route: 'accounts/register',
    input: { username: 'pending-user', password: 'GoodPass1!', phoneNumber: fixture.employees[0].personalPhone },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'REGISTRATION_RECOVERY_REQUIRED');
  assert.deepEqual(providerStatuses, ['ACTIVE', 'BLOCKED']);
  assert.equal(mock.state.accounts[0].status, 'pending_activation');
  assert.equal(mock.state.accounts[0].role, 'user');
  assert.equal(mock.state.identityClaims[0].status, 'recovery_required');
  assert.equal(mock.state.audits.some((record) => record.action === 'register_account_activation_confirmed'), false);
  assert.equal(JSON.stringify(mock.state.registrationInvites), JSON.stringify(fixture.registrationInvites));
});

test('registration recovery never demotes an already-promoted account outside the roster transaction', async () => {
  const fixture = makeRegistrationFixture();
  const callerIdentity = { uid: 'public-registration-recovery-caller' };
  const superAdmin = {
    _id: 'recovery-super-account',
    authUid: 'recovery-super-auth',
    username: 'recovery-root',
    displayName: '总管理员',
    status: 'active',
    role: 'super_admin',
    permissions: [],
  };
  let providerStatus = 'BLOCKED';
  const mock = createMockCloudBase({
    identity: callerIdentity,
    accounts: [superAdmin],
    employees: fixture.employees,
    identityClaims: fixture.identityClaims,
    governanceRoster: {
      schemaVersion: 1,
      state: 'ready',
      limit: 5,
      activeSuperAdminAccountIds: [superAdmin._id],
      revision: 1,
    },
  });
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => ({ user: {
      async createUser() { return { Data: { Uid: 'auth-recovery-race-user' } }; },
      async modifyUser(input) {
        if (input.userStatus === 'ACTIVE') {
          const account = mock.state.accounts.find((row) => row.authUid === 'auth-recovery-race-user');
          assert.equal(account.status, 'pending_activation');
          // Simulate an already-committed legacy/concurrent role mutation. Its
          // roster update is included to keep this fixture internally valid.
          account.status = 'active';
          account.role = 'super_admin';
          const roster = mock.state.adminGovernance[0];
          roster.activeSuperAdminAccountIds = [...roster.activeSuperAdminAccountIds, account._id].sort();
          roster.revision += 1;
          return { Data: { Success: true } };
        }
        providerStatus = input.userStatus;
        return { Data: { Success: true } };
      },
      async describeUserList() {
        return { Data: { UserList: [{ Uid: 'auth-recovery-race-user', UserStatus: providerStatus }] } };
      },
    } }),
  })({
    route: 'accounts/register',
    input: { username: 'recovery-race-user', password: 'GoodPass1!', phoneNumber: fixture.employees[0].personalPhone },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'REGISTRATION_RECOVERY_REQUIRED');
  assert.equal(providerStatus, 'BLOCKED');
  const account = mock.state.accounts.find((row) => row.authUid === 'auth-recovery-race-user');
  assert.equal(account.status, 'active');
  assert.equal(account.role, 'super_admin');
  assert.deepEqual(mock.state.adminGovernance[0].activeSuperAdminAccountIds, [superAdmin._id, account._id].sort());
  assert.equal(mock.state.adminGovernance[0].revision, 2);
  assert.equal(mock.state.identityClaims[0].status, 'recovery_required');
});

test('registration recovery is restricted to an active super administrator', async () => {
  const recovery = makeRegistrationRecoveryFixture({ authUid: 'blocked-auth-for-recovery' });
  const account = {
    _id: 'recovery-ordinary-admin',
    authUid: 'recovery-ordinary-admin-auth',
    username: 'ordinary-admin',
    displayName: '普通管理员',
    status: 'active',
    role: 'admin',
    permissions: [...MANAGED_PERMISSIONS],
  };
  let managerCalls = 0;
  const mock = createMockCloudBase({
    identity: { uid: account.authUid },
    accounts: [account],
    employees: recovery.employees,
    identityClaims: recovery.identityClaims,
  });
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => {
      managerCalls += 1;
      return { user: { async describeUserList() { return { Data: { UserList: [] } }; } } };
    },
  })({ route: 'accounts/registration-recoveries' });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'PERMISSION_DENIED');
  assert.equal(managerCalls, 0);
});

test('super administrator can restore a blocked registration account with ordinary-user permissions', async () => {
  const recovery = makeRegistrationRecoveryFixture({ authUid: 'blocked-auth-for-recovery', username: 'zheng-user' });
  const superAdmin = {
    _id: 'recovery-super-account',
    authUid: 'recovery-super-auth',
    username: 'recovery-root',
    displayName: '总管理员',
    status: 'active',
    role: 'super_admin',
    permissions: [],
  };
  let providerStatus = 'BLOCKED';
  const providerUser = { Uid: recovery.identityClaims[0].authUid, Name: recovery.username, UserStatus: providerStatus };
  const mock = createMockCloudBase({
    identity: { uid: superAdmin.authUid },
    accounts: [superAdmin],
    employees: recovery.employees,
    identityClaims: recovery.identityClaims,
  });
  const handler = handlerWith(mock, undefined, {
    managerFactory: () => ({ user: {
      async describeUserList(input) {
        const users = [providerUser].filter((user) => (!input.uidList || input.uidList.includes(user.Uid))
          && (!input.name || user.Name.toLowerCase().includes(input.name.toLowerCase())));
        return { Data: { UserList: users } };
      },
      async modifyUser(input) {
        assert.equal(input.uid, recovery.identityClaims[0].authUid);
        providerStatus = input.userStatus;
        providerUser.UserStatus = providerStatus;
        return { Data: { Success: true } };
      },
    } }),
  });

  const listed = await handler({ route: 'accounts/registration-recoveries' });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.data.map(({ id, displayName, action }) => ({ id, displayName, action })), [{
    id: recovery.claimId,
    displayName: recovery.employeeName,
    action: 'restore_existing',
  }]);

  const result = await handler({
    route: 'accounts/recover-registration',
    input: { claimId: recovery.claimId, action: 'restore_existing' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.account.username, recovery.username);
  assert.equal(result.data.account.status, 'active');
  assert.equal(result.data.account.role, 'user');
  assert.deepEqual(result.data.account.permissions, []);
  assert.equal(providerStatus, 'ACTIVE');
  assert.equal(mock.state.identityClaims[0].status, 'linked');
  assert.equal(mock.state.identityClaims[0].authUid, recovery.identityClaims[0].authUid);
  assert.equal(mock.state.accounts.find((row) => row._id === recovery.accountId).status, 'active');
  assert.deepEqual(mock.state.audits.map((record) => record.action).sort(), [
    'recover_registration_activation_confirmed',
    'recover_registration_binding',
  ].sort());
});

test('super administrator can safely release a failed registration when no Auth user exists', async () => {
  const recovery = makeRegistrationRecoveryFixture({ username: 'wang-user' });
  const superAdmin = {
    _id: 'recovery-super-account',
    authUid: 'recovery-super-auth',
    username: 'recovery-root',
    displayName: '总管理员',
    status: 'active',
    role: 'super_admin',
    permissions: [],
  };
  let providerStatusChanges = 0;
  const mock = createMockCloudBase({
    identity: { uid: superAdmin.authUid },
    accounts: [superAdmin],
    employees: recovery.employees,
    identityClaims: recovery.identityClaims,
  });
  const handler = handlerWith(mock, undefined, {
    managerFactory: () => ({ user: {
      async describeUserList(input) {
        assert.equal(input.name, undefined, 'absence is verified without a case-sensitive name filter');
        return { Data: { UserList: [] } };
      },
      async modifyUser() { providerStatusChanges += 1; return { Data: { Success: true } }; },
    } }),
  });

  const listed = await handler({ route: 'accounts/registration-recoveries' });
  assert.equal(listed.ok, true);
  assert.equal(listed.data[0].action, 'release_for_retry');

  const result = await handler({
    route: 'accounts/recover-registration',
    input: { claimId: recovery.claimId, action: 'release_for_retry' },
  });
  assert.equal(result.ok, true);
  assert.equal(providerStatusChanges, 0);
  assert.equal(mock.state.accounts.length, 1, 'no application account is created for the failed registration');
  assert.equal(mock.state.identityClaims[0].status, 'unclaimed');
  assert.equal(mock.state.identityClaims[0].accountId, '');
  assert.equal(mock.state.identityClaims[0].authUid, '');
  assert.equal(mock.state.identityClaims[0].registrationAttemptId, '');
  assert.deepEqual(mock.state.audits.map((record) => record.action), ['release_failed_registration']);
});

test('registration recovery refuses malformed, partial, or over-limit Auth user lists', async () => {
  const cases = [
    { name: 'missing-list', response: {} },
    { name: 'error-envelope', response: { Data: { UserList: [] }, Error: { Code: 'INVALID_PARAM' } } },
    { name: 'null-list', response: { Data: { UserList: null } } },
    { name: 'invalid-user', response: { Data: { UserList: [null] } } },
    { name: 'missing-name', response: { Data: { UserList: [{}] } } },
    { name: 'partial-list', response: { Data: { UserList: [], Total: 1 } } },
    { name: 'invalid-total', response: { Data: { UserList: [], Total: '0' } } },
    { name: 'scan-limit', response: { Data: { UserList: Array.from({ length: 100 }, (_, index) => ({ Uid: `other-auth-${index}`, Name: `other-user-${index}` })) } } },
  ];
  for (const item of cases) {
    const recovery = makeRegistrationRecoveryFixture();
    const superAdmin = { _id: 'recovery-super-account', authUid: 'recovery-super-auth', username: 'recovery-root', displayName: '总管理员', status: 'active', role: 'super_admin', permissions: [] };
    const mock = createMockCloudBase({ identity: { uid: superAdmin.authUid }, accounts: [superAdmin], employees: recovery.employees, identityClaims: recovery.identityClaims });
    let queries = 0;
    const handler = handlerWith(mock, undefined, {
      managerFactory: () => ({ user: {
        async describeUserList() { queries += 1; return item.response; },
        async modifyUser() { throw new Error('incomplete Auth read must not change users'); },
      } }),
    });
    const claimBefore = structuredClone(mock.state.identityClaims[0]);
    const result = await handler({ route: 'accounts/recover-registration', input: { claimId: recovery.claimId, action: 'release_for_retry' } });
    assert.equal(result.error.code, 'REGISTRATION_RECOVERY_UNAVAILABLE', item.name);
    assert.deepEqual(mock.state.identityClaims[0], claimBefore, item.name);
    assert.equal(mock.state.audits.length, 0, item.name);
    assert.equal(queries, item.name === 'scan-limit' ? 10 : 1);
  }
});

test('registration recovery checks later Auth pages and original username casing before release', async () => {
  const recovery = makeRegistrationRecoveryFixture();
  const superAdmin = { _id: 'recovery-super-account', authUid: 'recovery-super-auth', username: 'recovery-root', displayName: '总管理员', status: 'active', role: 'super_admin', permissions: [] };
  const mock = createMockCloudBase({ identity: { uid: superAdmin.authUid }, accounts: [superAdmin], employees: recovery.employees, identityClaims: recovery.identityClaims });
  const queriedPages = [];
  const handler = handlerWith(mock, undefined, {
    managerFactory: () => ({ user: {
      async describeUserList(input) {
        assert.equal(input.name, undefined);
        queriedPages.push(input.pageNo);
        const users = input.pageNo === 1
          ? Array.from({ length: 100 }, (_, index) => ({ Uid: `other-auth-${index}`, Name: `other-user-${index}` }))
          : [{ Uid: 'existing-registration-auth', Name: 'Recovery-User', UserStatus: 'BLOCKED' }];
        return { Data: { UserList: users, Total: 101 } };
      },
      async modifyUser() { throw new Error('the missing UID must not be guessed or rebound'); },
    } }),
  });
  const claimBefore = structuredClone(mock.state.identityClaims[0]);
  const listed = await handler({ route: 'accounts/registration-recoveries' });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.data, []);
  const result = await handler({ route: 'accounts/recover-registration', input: { claimId: recovery.claimId, action: 'release_for_retry' } });
  assert.equal(result.error.code, 'REGISTRATION_RECOVERY_CHANGED');
  assert.deepEqual(queriedPages, [1, 2, 1, 2]);
  assert.deepEqual(mock.state.identityClaims[0], claimBefore);
  assert.equal(mock.state.audits.length, 0);
});

for (const changedField of ['status', 'recordType', 'phone']) {
  test(`final registration transaction rechecks ${changedField} before activating an employee or student account`, async () => {
    for (const subjectType of ['employee', 'student']) {
      const subjectId = `final-recheck-${subjectType}`;
      const phoneNumber = '13800009416';
      let subjectReads = 0;
      let providerStatus = '';
      const providerStatuses = [];
      const mock = createMockCloudBase({
        identity: { uid: 'public-registration-final-subject-recheck' },
        accounts: [],
        employees: [{
          _id: subjectId,
          recordType: subjectType,
          name: '最终核对人员',
          department: '演示研发组',
          status: 'active',
          ...(subjectType === 'student' ? { phoneNumber } : { personalPhone: phoneNumber }),
        }],
        onTransactionEmployeeRead(subject) {
          if (subject?._id !== subjectId) return;
          subjectReads += 1;
          if (subjectReads !== 3) return;
          if (changedField === 'status') subject.status = 'inactive';
          if (changedField === 'recordType') subject.recordType = subjectType === 'student' ? 'employee' : 'student';
          if (changedField === 'phone') subject[subjectType === 'student' ? 'phoneNumber' : 'personalPhone'] = '13800006471';
        },
      });
      const authUid = `auth-final-subject-recheck-${subjectType}`;
      const response = await handlerWith(mock, undefined, {
        managerFactory: () => ({ user: {
          async createUser(input) { providerStatus = input.userStatus; return { Data: { Uid: authUid } }; },
          async modifyUser(input) {
            providerStatus = input.userStatus;
            providerStatuses.push(providerStatus);
            return { Data: { Success: true } };
          },
          async describeUserList() { return { Data: { UserList: [{ Uid: authUid, UserStatus: providerStatus }] } }; },
        } }),
      })({ route: 'accounts/register', input: { username: `recheck-${subjectType}-user`, password: 'GoodPass1!', phoneNumber } });

      assert.equal(subjectReads, 3, `${subjectType} must be rechecked in every registration transaction`);
      assert.equal(response.ok, false);
      assert.equal(response.error.code, 'REGISTRATION_RECOVERY_REQUIRED');
      assert.deepEqual(providerStatuses, ['ACTIVE', 'BLOCKED']);
      assert.equal(providerStatus, 'BLOCKED');
      assert.equal(mock.state.accounts[0].status, 'pending_activation');
      assert.equal(mock.state.accounts[0].role, 'user');
      assert.deepEqual(mock.state.accounts[0].permissions, []);
      assert.equal(mock.state.identityClaims[0].status, 'recovery_required');
      assert.equal(mock.state.employees.find((row) => row._id === 'system:directory-phone-guard').revision, 2, 'the failed activation guard write must roll back');
      assert.equal(mock.state.audits.some((audit) => audit.action === 'register_account_activation_confirmed'), false);
    }
  });
}

test('registration finalization write failure keeps the local account pending and re-blocks Auth', async () => {
  const fixture = makeRegistrationFixture();
  let providerStatus = 'BLOCKED';
  const mock = createMockCloudBase({
    identity: { uid: 'public-registration-finalize-failure' },
    accounts: [],
    employees: fixture.employees,
    identityClaims: fixture.identityClaims,
    failTransactionWrite: ({ collectionName, payload }) => collectionName === COLLECTIONS.adminAccounts
      && payload.status === 'active',
  });
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => ({ user: {
      async createUser() { return { Data: { Uid: 'auth-finalize-failure-user' } }; },
      async modifyUser(input) { providerStatus = input.userStatus; return { Data: { Success: true } }; },
      async describeUserList() {
        return { Data: { UserList: [{ Uid: 'auth-finalize-failure-user', UserStatus: providerStatus }] } };
      },
    } }),
  })({
    route: 'accounts/register',
    input: { username: 'finalize-failure-user', password: 'GoodPass1!', phoneNumber: fixture.employees[0].personalPhone },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'REGISTRATION_RECOVERY_REQUIRED');
  assert.equal(providerStatus, 'BLOCKED');
  assert.equal(mock.state.accounts[0].status, 'pending_activation');
  assert.equal(mock.state.accounts[0].role, 'user');
  assert.equal(mock.state.identityClaims[0].status, 'recovery_required');
  assert.equal(mock.state.audits.some((record) => record.action === 'register_account_activation_confirmed'), false);
});

test('unknown finalization outcome is not reported as success when readback fails', async () => {
  const fixture = makeRegistrationFixture();
  let providerStatus = 'BLOCKED';
  let lostFinalizationAck = false;
  let hideReadback = false;
  const mock = createMockCloudBase({
    identity: { uid: 'public-registration-unknown-finalization' },
    accounts: [],
    employees: fixture.employees,
    identityClaims: fixture.identityClaims,
    afterTransactionCommit: async (state) => {
      const account = state.accounts.find((row) => row.authUid === 'auth-unknown-finalization-user');
      if (!lostFinalizationAck && account && account.status === 'active') {
        lostFinalizationAck = true;
        hideReadback = true;
        throw new Error('commit acknowledgement unavailable');
      }
    },
    failDocumentRead: ({ transactionScoped }) => hideReadback && !transactionScoped,
  });
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => ({ user: {
      async createUser() { return { Data: { Uid: 'auth-unknown-finalization-user' } }; },
      async modifyUser(input) { providerStatus = input.userStatus; return { Data: { Success: true } }; },
      async describeUserList() {
        return { Data: { UserList: [{ Uid: 'auth-unknown-finalization-user', UserStatus: providerStatus }] } };
      },
    } }),
  })({
    route: 'accounts/register',
    input: { username: 'unknown-finalization-user', password: 'GoodPass1!', phoneNumber: fixture.employees[0].personalPhone },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'REGISTRATION_RECOVERY_REQUIRED');
  assert.equal(lostFinalizationAck, true);
  assert.equal(providerStatus, 'BLOCKED');
  assert.equal(mock.state.accounts[0].status, 'active');
  assert.equal(mock.state.accounts[0].role, 'user');
  assert.equal(mock.state.identityClaims[0].status, 'recovery_required');
  assert.equal(mock.state.audits.some((record) => record.action === 'register_account_activation_confirmed'), true);
});

test('anonymous identity is rejected before account lookup', async () => {
  const mock = createMockCloudBase({ identity: { uid: 'anonymous-uid', is_anonymous: true }, accounts: [] });
  const response = await handlerWith(mock)({ route: 'session' });
  assert.equal(response.ok, false);
  assert.equal(response.requestId, 'request-test-001');
  assert.equal(response.error.code, 'AUTH_REQUIRED');
});

test('anonymous loginType and login_type are rejected case-insensitively', async () => {
  for (const field of ['loginType', 'login_type']) {
    const identity = { uid: `anonymous-${field}`, [field]: 'AnOnYmOuS' };
    const mock = createMockCloudBase({ identity, accounts: [] });
    const response = await handlerWith(mock)({ route: 'session' });
    assert.equal(response.ok, false, field);
    assert.equal(response.error.code, 'AUTH_REQUIRED', field);
  }
});

test('active account can create an employee and appends a server-attributed success audit', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-001' },
    accounts: [
      {
        _id: 'account-001',
        authUid: 'server-user-001',
        username: 'leader-a',
        displayName: '领导甲',
        status: 'active',
      },
    ],
  });
  const response = await handlerWith(mock)({
    route: 'employees/create',
    requestId: 'client-must-not-control-this',
    input: {
      name: '示例员工甲',
      department: '演示研发组',
      actor: 'client-actor',
      authUid: 'client-uid',
      role: 'global_admin',
      personalPhone: '13800000006',
      storageKey: 'private/secret',
    },
  });

  assert.equal(response.ok, true);
  assert.equal(response.requestId, 'request-test-001');
  assert.equal(response.data.name, '示例员工甲');
  assert.equal(response.data.authUid, undefined);
  assert.equal(mock.state.employees[0].createdByAuthUid, 'server-user-001');
  assert.equal(mock.state.employees[0].storageKey, undefined);
  assert.equal(mock.state.audits.length, 1);
  assert.equal(mock.state.audits[0].result, 'success');
  assert.equal(mock.state.audits[0].actorAuthUid, 'server-user-001');
  assert.equal(mock.state.audits[0].actorAccountId, 'account-001');
  assert.equal(mock.state.audits[0].requestId, 'request-test-001');
  assert.equal(mock.state.audits[0].after.personalPhone, '138****0006');
});

test('session returns the active account projection without raw auth identity', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-session' },
    accounts: [
      {
        _id: 'account-session',
        authUid: 'server-user-session',
        username: 'leader-session',
        displayName: '登录领导',
        status: 'active',
      },
    ],
  });
  const response = await handlerWith(mock)({ route: 'session' });
  assert.equal(response.ok, true);
  assert.deepEqual(response.data.account, {
    username: 'leader-session',
    displayName: '登录领导',
    scope: 'all',
    role: 'admin',
    permissions: [...MANAGED_PERMISSIONS],
    status: 'active',
  });
  assert.equal(response.data.account.authUid, undefined);
  assert.equal(response.data.account.accountId, undefined);
});

test('legacy account records without role fields are kept read-only instead of being promoted', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'legacy-auth-001' },
    applyDefaultAuthorization: false,
    accounts: [{ _id: 'legacy-account-001', authUid: 'legacy-auth-001', username: 'legacy-user', displayName: '历史账号', status: 'active' }],
    employees: [{ _id: 'legacy-employee-001', name: '员工', department: '演示研发组', status: 'active' }],
  });
  const session = await handlerWith(mock)({ route: 'session' });
  assert.equal(session.ok, true);
  assert.equal(session.data.account.role, 'user');
  assert.deepEqual(session.data.account.permissions, []);

  const write = await handlerWith(mock)({ route: 'employees/create', input: { name: '不应写入', department: '演示研发组' } });
  assert.equal(write.ok, false);
  assert.equal(write.error.code, 'PERMISSION_DENIED');
  assert.equal(mock.state.employees.length, 1);
});

test('ordinary registered users stay within the bound employee scope and cannot forge a role', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'registered-user-001' },
    accounts: [{ _id: 'registered-account-001', authUid: 'registered-user-001', username: 'registered-user', displayName: '普通用户', status: 'active', role: 'user', permissions: [], employeeId: 'registered-employee-001', employeeNameSnapshot: '员工' }],
    employees: [{ _id: 'registered-employee-001', name: '员工', department: '演示研发组', status: 'active', personalPhone: '13800001234' }],
  });
  const read = await handlerWith(mock)({ route: 'employees/list' });
  assert.equal(read.ok, true);
  assert.equal(read.data.items.length, 1);
  assert.equal(read.data.items[0].personalPhone, undefined);
  assert.equal(read.data.items[0].name, '员工');
  const detail = await handlerWith(mock)({ route: 'employees/get', input: { employeeId: 'registered-employee-001' } });
  assert.equal(detail.ok, true);
  assert.equal(detail.data.personalPhone, undefined);
  assert.equal(detail.data.name, '员工');

  const write = await handlerWith(mock)({
    route: 'employees/create',
    input: { name: '伪造总管理员', department: '演示研发组', role: 'super_admin', permissions: [...MANAGED_PERMISSIONS] },
  });
  assert.equal(write.ok, false);
  assert.equal(write.error.code, 'PERMISSION_DENIED');
  assert.equal(mock.state.employees.length, 1);

});

test('admin can use only explicitly granted business permissions and cannot manage accounts', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'limited-admin-001' },
    accounts: [{ _id: 'limited-admin-account', authUid: 'limited-admin-001', username: 'limited-admin', displayName: '受限管理员', status: 'active', role: 'admin', permissions: ['history.write'] }],
    employees: [{ _id: 'limited-employee-001', name: '员工', department: '演示研发组', status: 'active', personalPhone: '13800001234' }],
  });
  const write = await handlerWith(mock)({ route: 'employees/update', input: { employeeId: 'limited-employee-001', department: '演示综合组' } });
  assert.equal(write.ok, false);
  assert.equal(write.error.code, 'PERMISSION_DENIED');

  const listAccounts = await handlerWith(mock)({ route: 'accounts/list' });
  assert.equal(listAccounts.ok, false);
  assert.equal(listAccounts.error.code, 'PERMISSION_DENIED');
});

test('super_admin has full business access and can view account summaries', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'super-admin-001' },
    accounts: [
      { _id: 'super-account-001', authUid: 'super-admin-001', username: 'root-admin', displayName: '总管理员', status: 'active', role: 'super_admin' },
      { _id: 'target-account-001', authUid: 'target-auth-001', username: 'target-user', displayName: '目标用户', status: 'active', role: 'user', permissions: [] },
    ],
    employees: [],
  });
  const create = await handlerWith(mock)({ route: 'employees/create', input: { name: '总管理员新增', department: '演示研发组' } });
  assert.equal(create.ok, true);
  const list = await handlerWith(mock)({ route: 'accounts/list' });
  assert.equal(list.ok, true);
  assert.deepEqual(list.data.items.map((item) => item.username).sort(), ['root-admin', 'target-user']);
});

test('only super_admin can grant and revoke admin permissions', async () => {
  const adminMock = createMockCloudBase({
    identity: { uid: 'other-admin-001' },
    accounts: [{ _id: 'other-admin-account', authUid: 'other-admin-001', username: 'other-admin', displayName: '其他管理员', status: 'active', role: 'admin', permissions: [...MANAGED_PERMISSIONS] }],
  });
  const denied = await handlerWith(adminMock)({ route: 'accounts/update-role', input: { accountId: 'someone', role: 'super_admin' } });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'PERMISSION_DENIED');

  const superMock = createMockCloudBase({
    identity: { uid: 'super-admin-002' },
    accounts: [
      { _id: 'super-account-002', authUid: 'super-admin-002', username: 'root-admin-2', displayName: '总管理员二', status: 'active', role: 'super_admin' },
      { _id: 'managed-account-002', authUid: 'managed-auth-002', username: 'managed-user', displayName: '待授权用户', status: 'active', role: 'user', permissions: [] },
    ],
    governanceRoster: {
      schemaVersion: 1,
      state: 'ready',
      limit: 5,
      activeSuperAdminAccountIds: ['super-account-002'],
      revision: 1,
    },
  });
  const handler = handlerWith(superMock);
  const promoted = await handler({
    route: 'accounts/update-role',
    accountId: 'managed-account-002',
    role: 'admin',
    operationId: '11111111-1111-4111-8111-111111111111',
    expectedGovernanceRevision: 1,
    tcbContext: { requestId: 'sdk-injected-context' },
  });
  assert.equal(promoted.ok, true);
  assert.equal(promoted.data.role, 'admin');
  const crossRouteReplay = await handler({
    route: 'accounts/grant-permissions',
    input: {
      accountId: 'managed-account-002',
      permissions: ['employee.write'],
      operationId: '11111111-1111-4111-8111-111111111111',
      expectedGovernanceRevision: 2,
    },
  });
  assert.equal(crossRouteReplay.ok, false);
  assert.equal(crossRouteReplay.error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(superMock.state.adminGovernance[0].revision, 2);
  const granted = await handler({
    route: 'accounts/grant-permissions',
    input: {
      accountId: 'managed-account-002',
      permissions: ['employee.write', 'history.write'],
      operationId: '22222222-2222-4222-8222-222222222222',
      expectedGovernanceRevision: 2,
    },
  });
  assert.equal(granted.ok, true);
  assert.deepEqual(granted.data.permissions.sort(), ['employee.write', 'history.write']);
  const revoked = await handler({
    route: 'accounts/revoke-permissions',
    input: {
      accountId: 'managed-account-002',
      permissions: ['history.write'],
      operationId: '33333333-3333-4333-8333-333333333333',
      expectedGovernanceRevision: 3,
    },
  });
  assert.equal(revoked.ok, true);
  assert.deepEqual(revoked.data.permissions, ['employee.write']);
  assert.equal(superMock.state.accounts.find((account) => account._id === 'managed-account-002').role, 'admin');
  assert.equal(superMock.state.audits.filter((audit) => audit.result === 'success').length, 3);
  assert.equal(superMock.state.adminGovernance[0].revision, 4);
  assert.equal(superMock.state.adminGovernanceOperations.length, 3);
});

test('super-admin roster initialization is explicit, retryable, and does not mutate account records', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'init-super-auth' },
    accounts: [
      { _id: 'init-super-account', authUid: 'init-super-auth', username: 'init-root', displayName: '初始化总管理员', status: 'active', role: 'super_admin', employeeId: 'employee-bound', employeeNameSnapshot: '绑定员工', permissions: [] },
      { _id: 'init-user-account', authUid: 'init-user-auth', username: 'init-user', status: 'active', role: 'user', permissions: [] },
    ],
  });
  const beforeAccounts = structuredClone(mock.state.accounts);
  const handler = handlerWith(mock, undefined, {
    env: { TCB_ENV_ID: TEST_ENV_ID, ACCOUNT_GOVERNANCE_WRITES_ENABLED: 'false' },
  });
  const request = {
    route: 'accounts/super-admin-governance/initialize',
    operationId: '44444444-4444-4444-8444-444444444444',
    tcbContext: { requestId: 'sdk-injected-context' },
  };
  const initialized = await handler(request);
  assert.equal(initialized.ok, true);
  assert.deepEqual(initialized.data.governance, { state: 'ready', activeCount: 1, limit: 5, revision: 1 });
  assert.deepEqual(mock.state.accounts, beforeAccounts);
  assert.deepEqual(mock.state.adminGovernance[0].activeSuperAdminAccountIds, ['init-super-account']);
  assert.equal(mock.state.adminGovernanceOperations.length, 1);
  assert.equal(mock.state.audits.filter((audit) => audit.result === 'success').length, 1);
  assert.equal(mock.state.updatePayloads.some((write) => write.collectionName === COLLECTIONS.adminAccounts), false);

  const callerSuppliedContext = await handler({
    route: 'accounts/super-admin-governance/initialize',
    input: { operationId: '66666666-6666-4666-8666-666666666666', tcbContext: { requestId: 'caller-controlled-context' } },
  });
  assert.equal(callerSuppliedContext.ok, false);
  assert.equal(callerSuppliedContext.error.code, 'VALIDATION_ERROR');
  assert.match(callerSuppliedContext.error.message, /名额初始化请求只接受 operationId/);

  const replay = await handler(request);
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.data, initialized.data);
  assert.equal(mock.state.adminGovernanceOperations.length, 1);
  assert.equal(mock.state.audits.filter((audit) => audit.result === 'success').length, 1);

  const secondInitialization = await handler({
    route: 'accounts/super-admin-governance/initialize',
    input: { operationId: '55555555-5555-4555-8555-555555555555' },
  });
  assert.equal(secondInitialization.ok, false);
  assert.equal(secondInitialization.error.code, 'SUPER_ADMIN_GOVERNANCE_NOT_READY');
  assert.deepEqual(mock.state.adminGovernance[0].activeSuperAdminAccountIds, ['init-super-account']);

  const closedGateMock = createMockCloudBase({
    identity: { uid: 'closed-gate-auth' },
    accounts: [
      { _id: 'closed-gate-super', authUid: 'closed-gate-auth', username: 'closed-gate-root', status: 'active', role: 'super_admin' },
      { _id: 'closed-gate-target', authUid: 'closed-gate-target-auth', username: 'closed-gate-user', status: 'active', role: 'user' },
    ],
    governanceRoster: {
      schemaVersion: 1,
      state: 'ready',
      limit: 5,
      activeSuperAdminAccountIds: ['closed-gate-super'],
      revision: 1,
    },
  });
  const gateResponse = await handlerWith(closedGateMock, undefined, {
    env: { TCB_ENV_ID: TEST_ENV_ID, ACCOUNT_GOVERNANCE_WRITES_ENABLED: 'false' },
  })({
    route: 'accounts/update-role',
    input: {
      accountId: 'closed-gate-target',
      role: 'super_admin',
      operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedGovernanceRevision: 1,
    },
  });
  assert.equal(gateResponse.ok, false);
  assert.equal(gateResponse.error.code, 'SUPER_ADMIN_GOVERNANCE_NOT_READY');
  assert.equal(closedGateMock.state.accounts.find((account) => account._id === 'closed-gate-target').role, 'user');
  assert.equal(closedGateMock.state.adminGovernance[0].revision, 1);
});

test('legacy roster limit upgrades atomically to five without changing account records', async () => {
  const activeSuperAdmins = ['legacy-super-1', 'legacy-super-2'].map((id, index) => ({
    _id: id,
    authUid: `legacy-super-auth-${index + 1}`,
    username: `legacy-root-${index + 1}`,
    status: 'active',
    role: 'super_admin',
    permissions: [],
    employeeId: `legacy-employee-${index + 1}`,
    employeeNameSnapshot: `旧绑定员工${index + 1}`,
    identityVersion: index + 1,
  }));
  const mock = createMockCloudBase({
    identity: { uid: activeSuperAdmins[0].authUid },
    accounts: [...activeSuperAdmins, { _id: 'legacy-user', authUid: 'legacy-user-auth', username: 'legacy-user', status: 'active', role: 'user', permissions: [] }],
    governanceRoster: {
      schemaVersion: 1,
      state: 'ready',
      limit: 3,
      activeSuperAdminAccountIds: activeSuperAdmins.map((account) => account._id).sort(),
      revision: 8,
    },
  });
  const accountsBefore = structuredClone(mock.state.accounts);
  const handler = handlerWith(mock, undefined, {
    env: { TCB_ENV_ID: TEST_ENV_ID, ACCOUNT_GOVERNANCE_WRITES_ENABLED: 'false' },
  });
  const before = await handler({ route: 'accounts/list' });
  assert.equal(before.ok, true);
  assert.deepEqual(before.data.governance, { state: 'ready', activeCount: 2, limit: 3, revision: 8 });

  const request = {
    route: 'accounts/super-admin-governance/upgrade-limit',
    input: {
      operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      expectedGovernanceRevision: 8,
    },
  };
  const upgraded = await handler(request);
  assert.equal(upgraded.ok, true);
  assert.deepEqual(upgraded.data.governance, { state: 'ready', activeCount: 2, limit: 5, revision: 9 });
  assert.deepEqual(mock.state.adminGovernance[0].activeSuperAdminAccountIds, ['legacy-super-1', 'legacy-super-2']);
  assert.equal(mock.state.adminGovernance[0].limit, 5);
  assert.equal(mock.state.adminGovernance[0].revision, 9);
  assert.deepEqual(mock.state.accounts, accountsBefore);
  assert.equal(mock.state.updatePayloads.some((write) => write.collectionName === COLLECTIONS.adminAccounts), false);

  const upgradeAudit = mock.state.audits.find((audit) => audit.action === 'upgrade_super_admin_quota');
  assert.ok(upgradeAudit);
  assert.equal(upgradeAudit.before.limit, 3);
  assert.equal(upgradeAudit.after.limit, 5);
  assert.equal(upgradeAudit.before.activeCount, 2);
  assert.equal(upgradeAudit.after.activeCount, 2);
  assert.equal(upgradeAudit.before.revision, 8);
  assert.equal(upgradeAudit.after.revision, 9);
  assert.equal(mock.state.adminGovernanceOperations.length, 1);

  const replay = await handler(request);
  assert.deepEqual(replay.data, upgraded.data);
  assert.equal(mock.state.adminGovernanceOperations.length, 1);
  assert.equal(mock.state.audits.filter((audit) => audit.action === 'upgrade_super_admin_quota').length, 1);

  const stale = await handler({
    route: 'accounts/super-admin-governance/upgrade-limit',
    input: {
      operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      expectedGovernanceRevision: 8,
    },
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'SUPER_ADMIN_REVISION_CONFLICT');
  assert.equal(mock.state.adminGovernance[0].limit, 5);
  assert.equal(mock.state.adminGovernance[0].revision, 9);
  assert.deepEqual(mock.state.accounts, accountsBefore);
});

test('legacy roster migration fails closed when a listed account is missing, mismatched, or has a duplicate identity', async () => {
  const actor = { _id: 'legacy-migration-actor', authUid: 'legacy-migration-auth', username: 'legacy-root', status: 'active', role: 'super_admin', permissions: [] };
  const cases = [
    { name: 'missing', member: null, memberId: 'legacy-migration-missing' },
    { name: 'mismatched role', member: { _id: 'legacy-migration-member', authUid: 'legacy-member-auth', username: 'legacy-member', status: 'active', role: 'user', permissions: [] }, memberId: 'legacy-migration-member' },
    { name: 'duplicate auth identity', member: { _id: 'legacy-migration-member', authUid: actor.authUid, username: 'legacy-member', status: 'active', role: 'super_admin', permissions: [] }, memberId: 'legacy-migration-member' },
  ];

  for (const [index, scenario] of cases.entries()) {
    const mock = createMockCloudBase({
      identity: { uid: actor.authUid },
      accounts: [actor, ...(scenario.member ? [scenario.member] : [])],
      governanceRoster: {
        schemaVersion: 1,
        state: 'ready',
        limit: 3,
        activeSuperAdminAccountIds: ['legacy-migration-actor', scenario.memberId].sort(),
        revision: 12,
      },
    });
    const accountsBefore = structuredClone(mock.state.accounts);
    const rosterBefore = structuredClone(mock.state.adminGovernance[0]);
    const response = await handlerWith(mock, undefined, {
      env: { TCB_ENV_ID: TEST_ENV_ID, ACCOUNT_GOVERNANCE_WRITES_ENABLED: 'false' },
    })({
      route: 'accounts/super-admin-governance/upgrade-limit',
      input: {
        operationId: `ffffffff-ffff-4fff-8fff-${String(index + 1).repeat(12)}`,
        expectedGovernanceRevision: 12,
      },
    });

    assert.equal(response.ok, false, scenario.name);
    assert.equal(response.error.code, 'SUPER_ADMIN_GOVERNANCE_NOT_READY', scenario.name);
    assert.deepEqual(mock.state.accounts, accountsBefore, scenario.name);
    assert.deepEqual(mock.state.adminGovernance[0], rosterBefore, scenario.name);
    assert.equal(mock.state.adminGovernanceOperations.length, 0, scenario.name);
    assert.equal(mock.state.audits.some((audit) => audit.result === 'success'), false, scenario.name);
  }
});

test('only an active super admin can migrate the legacy quota while ordinary governance writes are closed', async () => {
  const root = { _id: 'migration-root', authUid: 'migration-root-auth', username: 'migration-root', status: 'active', role: 'super_admin', permissions: [] };
  const user = { _id: 'migration-user', authUid: 'migration-user-auth', username: 'migration-user', status: 'active', role: 'user', permissions: [] };
  const mock = createMockCloudBase({
    identity: { uid: user.authUid },
    accounts: [root, user],
    governanceRoster: {
      schemaVersion: 1,
      state: 'ready',
      limit: 3,
      activeSuperAdminAccountIds: [root._id],
      revision: 3,
    },
  });
  const response = await handlerWith(mock, undefined, {
    env: { TCB_ENV_ID: TEST_ENV_ID, ACCOUNT_GOVERNANCE_WRITES_ENABLED: 'false' },
  })({
    route: 'accounts/super-admin-governance/upgrade-limit',
    input: {
      operationId: '11111111-1111-4111-8111-111111111111',
      expectedGovernanceRevision: 3,
    },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'PERMISSION_DENIED');
  assert.equal(mock.state.adminGovernance[0].limit, 3);
  assert.equal(mock.state.adminGovernance[0].revision, 3);
  assert.equal(mock.state.adminGovernanceOperations.length, 0);
  assert.equal(mock.state.audits.some((audit) => audit.result === 'success'), false);
});

test('super-admin quota allows a fifth active admin and rejects a sixth', async () => {
  const activeSuperAdmins = Array.from({ length: 4 }, (_, index) => ({
    _id: `quota-super-${index + 1}`,
    authUid: `quota-super-auth-${index + 1}`,
    username: `quota-root-${index + 1}`,
    status: 'active',
    role: 'super_admin',
    permissions: [],
  }));
  const fifth = { _id: 'quota-fifth', authUid: 'quota-fifth-auth', username: 'quota-fifth', status: 'active', role: 'admin', permissions: [] };
  const sixth = { _id: 'quota-sixth', authUid: 'quota-sixth-auth', username: 'quota-sixth', status: 'active', role: 'user', permissions: [] };
  const rosterIds = activeSuperAdmins.map((account) => account._id).sort();
  const mock = createMockCloudBase({
    identity: { uid: activeSuperAdmins[0].authUid },
    accounts: [...activeSuperAdmins, fifth, sixth],
    governanceRoster: {
      schemaVersion: 1,
      state: 'ready',
      limit: 5,
      activeSuperAdminAccountIds: rosterIds,
      revision: 1,
    },
  });
  const handler = handlerWith(mock);
  const promotedToFifth = await handler({
    route: 'accounts/update-role',
    input: {
      accountId: fifth._id,
      role: 'super_admin',
      operationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      expectedGovernanceRevision: 1,
    },
  });
  assert.equal(promotedToFifth.ok, true);
  assert.equal(mock.state.accounts.find((account) => account._id === fifth._id).role, 'super_admin');
  const fiveMemberRoster = [...rosterIds, fifth._id].sort();
  assert.deepEqual(mock.state.adminGovernance[0].activeSuperAdminAccountIds, fiveMemberRoster);
  assert.equal(mock.state.adminGovernance[0].limit, 5);
  assert.equal(mock.state.adminGovernance[0].state, 'ready');

  const rejectedSixth = await handler({
    route: 'accounts/update-role',
    input: {
      accountId: sixth._id,
      role: 'super_admin',
      operationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      expectedGovernanceRevision: 2,
    },
  });
  assert.equal(rejectedSixth.ok, false);
  assert.equal(rejectedSixth.error.code, 'SUPER_ADMIN_QUOTA_FULL');
  assert.equal(mock.state.accounts.find((account) => account._id === sixth._id).role, 'user');
  assert.deepEqual(mock.state.adminGovernance[0].activeSuperAdminAccountIds, fiveMemberRoster);
  assert.equal(mock.state.adminGovernance[0].revision, 2);
});

test('self-transfer atomically swaps the roster, preserves business permissions, and permits safe replay', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'transfer-source-auth' },
    accounts: [
      { _id: 'transfer-source', authUid: 'transfer-source-auth', username: 'source-root', displayName: '原总管理员', status: 'active', role: 'super_admin', permissions: [], employeeId: 'employee-source', employeeNameSnapshot: '来源员工', identityVersion: 7 },
      { _id: 'transfer-target', authUid: 'transfer-target-auth', username: 'target-admin', displayName: '受让管理员', status: 'active', role: 'admin', permissions: ['history.write'], employeeId: 'employee-target', employeeNameSnapshot: '目标员工', identityVersion: 3 },
    ],
    governanceRoster: {
      schemaVersion: 1,
      state: 'ready',
      limit: 5,
      activeSuperAdminAccountIds: ['transfer-source'],
      revision: 4,
    },
  });
  const request = {
    route: 'accounts/transfer-super-admin',
    input: {
      targetAccountId: 'transfer-target',
      operationId: '66666666-6666-4666-8666-666666666666',
      expectedGovernanceRevision: 4,
    },
  };
  const result = await handlerWith(mock)(request);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.governance, { state: 'ready', activeCount: 1, limit: 5, revision: 5 });
  const source = mock.state.accounts.find((account) => account._id === 'transfer-source');
  const target = mock.state.accounts.find((account) => account._id === 'transfer-target');
  assert.equal(source.role, 'admin');
  assert.deepEqual(source.permissions, [...MANAGED_PERMISSIONS]);
  assert.equal(target.role, 'super_admin');
  assert.equal(source.authUid, 'transfer-source-auth');
  assert.equal(target.authUid, 'transfer-target-auth');
  assert.equal(source.employeeId, 'employee-source');
  assert.equal(target.employeeId, 'employee-target');
  assert.equal(source.identityVersion, 7);
  assert.equal(target.identityVersion, 3);
  assert.deepEqual(mock.state.adminGovernance[0].activeSuperAdminAccountIds, ['transfer-target']);
  assert.equal(mock.state.adminGovernanceOperations.length, 1);
  assert.equal(mock.state.audits.filter((audit) => audit.result === 'success').length, 2);
  assert.equal(mock.state.audits.some((audit) => Object.hasOwn(audit, 'actorAuthUid')), false);
  assert.equal(JSON.stringify(mock.state.adminGovernanceOperations).includes('66666666-6666-4666-8666-666666666666'), false);

  const replay = await handlerWith(mock)(request);
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.data, result.data);
  assert.equal(mock.state.adminGovernanceOperations.length, 1);
  assert.equal(mock.state.audits.filter((audit) => audit.result === 'success').length, 2);

  const forgedSource = await handlerWith(mock)({
    route: 'accounts/transfer-super-admin',
    input: {
      sourceAccountId: 'transfer-source',
      targetAccountId: 'transfer-source',
      operationId: '77777777-7777-4777-8777-777777777777',
      expectedGovernanceRevision: 5,
    },
  });
  assert.equal(forgedSource.ok, false);
  assert.equal(forgedSource.error.code, 'VALIDATION_ERROR');

  const auditFailureMock = createMockCloudBase({
    identity: { uid: 'atomic-transfer-source-auth' },
    accounts: [
      { _id: 'atomic-transfer-source', authUid: 'atomic-transfer-source-auth', username: 'atomic-source', status: 'active', role: 'super_admin' },
      { _id: 'atomic-transfer-target', authUid: 'atomic-transfer-target-auth', username: 'atomic-target', status: 'active', role: 'user' },
    ],
    governanceRoster: {
      schemaVersion: 1,
      state: 'ready',
      limit: 5,
      activeSuperAdminAccountIds: ['atomic-transfer-source'],
      revision: 1,
    },
    failAuditWrites: true,
  });
  const beforeAccounts = structuredClone(auditFailureMock.state.accounts);
  const failedTransfer = await handlerWith(auditFailureMock)({
    route: 'accounts/transfer-super-admin',
    input: {
      targetAccountId: 'atomic-transfer-target',
      operationId: '99999999-9999-4999-8999-999999999999',
      expectedGovernanceRevision: 1,
    },
  });
  assert.equal(failedTransfer.ok, false);
  assert.equal(failedTransfer.error.code, 'AUDIT_WRITE_FAILED');
  assert.deepEqual(auditFailureMock.state.accounts, beforeAccounts);
  assert.equal(auditFailureMock.state.adminGovernance[0].revision, 1);
  assert.deepEqual(auditFailureMock.state.adminGovernance[0].activeSuperAdminAccountIds, ['atomic-transfer-source']);
  assert.equal(auditFailureMock.state.adminGovernanceOperations.length, 0);
  assert.equal(auditFailureMock.state.audits.length, 0);
});

test('account employee binding shares roster lock and writes identity claims and audit atomically', async () => {
  const employeeId = 'binding-new-employee';
  const identityClaimId = `employee-identity:${crypto.createHash('sha256').update(employeeId, 'utf8').digest('hex')}`;
  const oldEmployeeId = 'binding-old-employee';
  const oldClaimId = `employee-identity:${crypto.createHash('sha256').update(oldEmployeeId, 'utf8').digest('hex')}`;
  const mock = createMockCloudBase({
    identity: { uid: 'binding-super-auth' },
    accounts: [
      { _id: 'binding-super', authUid: 'binding-super-auth', username: 'binding-root', status: 'active', role: 'super_admin' },
      { _id: 'binding-target', authUid: 'binding-target-auth', username: 'binding-user', status: 'active', role: 'user', employeeId: oldEmployeeId, employeeNameSnapshot: '旧员工', identityVersion: 1 },
    ],
    employees: [
      { _id: oldEmployeeId, name: '旧员工', department: '演示支持组', status: 'active' },
      { _id: employeeId, name: '新员工', department: '演示研发组', status: 'active' },
    ],
    identityClaims: [{ _id: oldClaimId, employeeId: oldEmployeeId, employeeNameSnapshot: '旧员工', status: 'linked', accountId: 'binding-target', authUid: 'binding-target-auth' }],
    governanceRoster: {
      schemaVersion: 1,
      state: 'ready',
      limit: 5,
      activeSuperAdminAccountIds: ['binding-super'],
      revision: 2,
    },
    rejectTransactionWhere: true,
  });
  const response = await handlerWith(mock)({
    route: 'accounts/bind-employee',
    input: {
      accountId: 'binding-target',
      employeeId,
      operationId: '88888888-8888-4888-8888-888888888888',
      expectedGovernanceRevision: 2,
    },
  });
  assert.equal(response.ok, true);
  const target = mock.state.accounts.find((account) => account._id === 'binding-target');
  assert.equal(target.employeeId, employeeId);
  assert.equal(target.employeeNameSnapshot, '新员工');
  assert.equal(target.identityVersion, 2);
  assert.equal(mock.state.identityClaims.find((claim) => claim._id === oldClaimId).status, 'unclaimed');
  const newClaim = mock.state.identityClaims.find((claim) => claim._id === identityClaimId);
  assert.equal(newClaim.status, 'linked');
  assert.equal(newClaim.accountId, 'binding-target');
  assert.equal(mock.state.adminGovernance[0].revision, 3);
  assert.equal(mock.state.adminGovernanceOperations.length, 1);
  assert.equal(mock.state.audits.filter((audit) => audit.result === 'success').length, 1);
  assert.equal(mock.state.transactionQueryReads.includes(COLLECTIONS.adminAccounts), false);
});

test('disabled accounts are rejected even when their auth identity is still logged in', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'disabled-auth-001' },
    accounts: [{ _id: 'disabled-account-001', authUid: 'disabled-auth-001', username: 'disabled-user', displayName: '已停用用户', status: 'disabled', role: 'user', permissions: [] }],
  });
  const response = await handlerWith(mock)({ route: 'session' });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'ACCOUNT_INACTIVE');
});

test('update success excludes _id from the SDK update payload and appends before/after audit summary', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-002' },
    accounts: [
      { _id: 'account-002', authUid: 'server-user-002', username: 'leader-b', displayName: '领导乙', status: 'active' },
    ],
    employees: [{ _id: 'employee-001', name: '示例员工乙', department: '演示支持组', status: 'active', personalPhone: '13800000028' }],
  });
  const response = await handlerWith(mock)({
    route: 'employees/update',
    input: { employeeId: 'employee-001', name: '示例员工乙', department: '演示综合组', actor: 'bad-value', authUid: 'bad-value' },
  });

  assert.equal(response.ok, true);
  assert.equal(mock.state.updatePayloads.length, 1);
  assert.equal(mock.state.updatePayloads[0].payload._id, undefined);
  assert.equal(mock.state.updatePayloads[0].payload.updatedByAuthUid, 'server-user-002');
  assert.equal(mock.state.audits[0].result, 'success');
  assert.deepEqual(mock.state.audits[0].changedFields.sort(), ['department', 'version']);
  assert.equal(mock.state.audits[0].before.department, '演示支持组');
  assert.equal(mock.state.audits[0].after.department, '演示综合组');
});

test('update failure appends a failure audit and returns unified error envelope', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-003' },
    accounts: [
      { _id: 'account-003', authUid: 'server-user-003', username: 'leader-c', displayName: '领导丙', status: 'active' },
    ],
  });
  const response = await handlerWith(mock)({ route: 'employees/update', input: { employeeId: 'missing', department: '演示综合组' } });

  assert.equal(response.ok, false);
  assert.equal(response.requestId, 'request-test-001');
  assert.equal(response.error.code, 'EMPLOYEE_NOT_FOUND');
  assert.equal(mock.state.audits.length, 1);
  assert.equal(mock.state.audits[0].result, 'failure');
  assert.equal(mock.state.audits[0].action, 'update_employee');
});

test('authenticated employee reads complete phone fields and keeps audit summaries masked', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-sensitive' },
    accounts: [
      { _id: 'account-sensitive', authUid: 'server-user-sensitive', username: 'leader-sensitive', displayName: '敏感资料领导', status: 'active' },
    ],
    employees: [{ _id: 'employee-sensitive', name: '示例员工乙', department: '演示支持组', status: 'active', personalPhone: '13800000028', workPhone: '010-00000000', phonePlan: '移动' }],
  });

  const normalResponse = await handlerWith(mock)({ route: 'employees/get', input: { employeeId: 'employee-sensitive' } });
  assert.equal(normalResponse.ok, true);
  assert.equal(normalResponse.data.personalPhone, '13800000028');
  assert.equal(normalResponse.data.workPhone, '010-00000000');
  assert.equal(normalResponse.data.phonePlan, '移动');
  assert.equal(mock.state.audits.length, 0);
});

test('employee update persists regularizationDate and rejects invalid employment dates', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-regularization' },
    accounts: [{ _id: 'account-regularization', authUid: 'server-user-regularization', username: 'regularization-user', displayName: '转正日期管理员', status: 'active' }],
    employees: [{ _id: 'employee-regularization', name: '员工', department: '演示支持组', status: 'active', hireDate: '2026-01-02', regularizationDate: '' }],
  });

  const saved = await handlerWith(mock)({
    route: 'employees/update',
    input: { employeeId: 'employee-regularization', regularizationDate: '2026-04-02' },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.data.regularizationDate, '2026-04-02');
  assert.equal(mock.state.employees[0].regularizationDate, '2026-04-02');
  assert.equal(mock.state.updatePayloads[0].payload.regularizationDate, '2026-04-02');

  const invalid = await handlerWith(mock)({
    route: 'employees/update',
    input: { employeeId: 'employee-regularization', regularizationDate: '2025-01-01' },
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'VALIDATION_ERROR');
  assert.equal(mock.state.employees[0].regularizationDate, '2026-04-02');
});

test('employee contract create, update, and re-read preserve existing employee records', async () => {
  const existingEmployee = {
    _id: 'employee-existing-contract',
    name: '虚构既有员工',
    department: '虚构历史组',
    status: 'active',
    contract: {
      id: 'existing-contract-id',
      type: '既有合同',
      startDate: '2025-01-01',
      endDate: '2026-12-31',
      notes: '虚构既有员工合同，保留原样',
    },
    notes: '虚构既有员工备注',
  };
  const existingFlatContractEmployee = {
    _id: 'employee-existing-flat-contract',
    name: '虚构历史格式员工',
    department: '虚构历史组',
    status: 'former',
    contractType: '历史格式合同',
    contractStartDate: '2024-01-01',
    contractEndDate: '2024-12-31',
    contractNotes: '只在虚构旧记录中存在的扁平合同字段',
  };
  const existingEmployeeSnapshot = structuredClone(existingEmployee);
  const existingFlatContractSnapshot = structuredClone(existingFlatContractEmployee);
  const mock = createMockCloudBase({
    identity: { uid: 'fictional-contract-operator' },
    accounts: [{ _id: 'fictional-contract-account', authUid: 'fictional-contract-operator', username: 'fictional-contract-admin', status: 'active' }],
    employees: [existingEmployee, existingFlatContractEmployee],
  });
  const handler = handlerWith(mock);

  const created = await handler({
    route: 'employees/create',
    input: {
      name: '虚构新员工',
      department: '虚构合同测试组',
      contract: {
        type: '固定期限合同',
        startDate: '2026-02-01',
        endDate: '2027-01-31',
        notes: '虚构新增合同',
      },
    },
  });
  assert.equal(created.ok, true);
  assert.equal(created.data.contract.type, '固定期限合同');
  assert.ok(created.data.contract.id);
  assert.deepEqual(
    mock.state.employees.find((employee) => employee._id === created.data.id).contract,
    created.data.contract,
  );

  const createdRead = await handler({ route: 'employees/get', input: { employeeId: created.data.id } });
  assert.equal(createdRead.ok, true);
  assert.deepEqual(createdRead.data.contract, created.data.contract);

  const updated = await handler({
    route: 'employees/update',
    input: {
      employeeId: created.data.id,
      expectedVersion: 1,
      contract: {
        type: '续签合同',
        startDate: '2027-02-01',
        endDate: '2028-01-31',
        notes: '虚构修改后的合同',
      },
    },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.version, 2);
  assert.equal(updated.data.contract.id, created.data.contract.id);
  assert.deepEqual(updated.data.contract, {
    id: created.data.contract.id,
    type: '续签合同',
    startDate: '2027-02-01',
    endDate: '2028-01-31',
    notes: '虚构修改后的合同',
  });

  const updatedRead = await handler({ route: 'employees/get', input: { employeeId: created.data.id } });
  assert.equal(updatedRead.ok, true);
  assert.deepEqual(updatedRead.data.contract, updated.data.contract);
  const flatContractRead = await handler({ route: 'employees/get', input: { employeeId: existingFlatContractEmployee._id } });
  assert.deepEqual(flatContractRead.data.contract, {
    id: `${existingFlatContractEmployee._id}-contract`,
    type: '历史格式合同',
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    notes: '只在虚构旧记录中存在的扁平合同字段',
  });

  assert.deepEqual(
    mock.state.employees.find((employee) => employee._id === existingEmployee._id),
    existingEmployeeSnapshot,
  );
  assert.deepEqual(
    mock.state.employees.find((employee) => employee._id === existingFlatContractEmployee._id),
    existingFlatContractSnapshot,
  );
});

async function assertLegacyFlatContractFirstSaveKeepsId({ employee, expectedContractId }) {
  const mock = createMockCloudBase({
    identity: { uid: 'fictional-legacy-contract-operator' },
    accounts: [{ _id: 'fictional-legacy-contract-account', authUid: 'fictional-legacy-contract-operator', username: 'fictional-legacy-contract-admin', status: 'active' }],
    employees: [employee],
  });
  const handler = handlerWith(mock);

  const readBefore = await handler({ route: 'employees/get', input: { employeeId: employee._id } });
  assert.equal(readBefore.ok, true);
  assert.equal(readBefore.data.contract.id, expectedContractId);

  const modifiedContract = {
    type: '虚构修改后的旧合同',
    startDate: '2026-03-01',
    endDate: '2027-02-28',
    notes: '旧扁平合同首次修改保存',
  };
  const saved = await handler({
    route: 'employees/update',
    input: { employeeId: employee._id, expectedVersion: 1, contract: modifiedContract },
  });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.data.contract, { id: expectedContractId, ...modifiedContract });

  const stored = mock.state.employees.find((row) => row._id === employee._id);
  assert.deepEqual(stored.contract, { id: expectedContractId, ...modifiedContract });

  const readAfter = await handler({ route: 'employees/get', input: { employeeId: employee._id } });
  assert.equal(readAfter.ok, true);
  assert.deepEqual(readAfter.data.contract, { id: expectedContractId, ...modifiedContract });
}

test('legacy flat contract first save preserves an existing contractId', async () => {
  const employee = {
    _id: 'employee-legacy-contract-explicit-id',
    name: '虚构旧合同编号员工',
    department: '虚构合同测试组',
    status: 'active',
    version: 1,
    contractId: 'legacy-contract-explicit-id',
    contractType: '虚构历史合同',
    contractStartDate: '2025-01-01',
    contractEndDate: '2025-12-31',
    contractNotes: '虚构旧格式数据',
  };
  await assertLegacyFlatContractFirstSaveKeepsId({ employee, expectedContractId: employee.contractId });
});

test('legacy flat contract first save preserves its deterministic contractId fallback', async () => {
  const employee = {
    _id: 'employee-legacy-contract-deterministic-id',
    name: '虚构旧合同无编号员工',
    department: '虚构合同测试组',
    status: 'active',
    version: 1,
    contractType: '虚构历史合同',
    contractStartDate: '2025-01-01',
    contractEndDate: '2025-12-31',
    contractNotes: '虚构旧格式数据',
  };
  await assertLegacyFlatContractFirstSaveKeepsId({
    employee,
    expectedContractId: `${employee._id}-contract`,
  });
});

test('audit summary omits storage keys and auth identifiers', () => {
  const summary = auditSummary({
    name: '示例员工丙',
    personalPhone: '13800001234',
    storageKey: 'private/secret',
    authUid: 'uid-secret',
  });
  assert.deepEqual(summary, { name: '示例员工丙', personalPhone: '138****1234' });
});

test('audit list projection keeps business details but hides actor auth and account ids', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-audit' },
    accounts: [
      { _id: 'account-audit', authUid: 'server-user-audit', username: 'leader-audit', displayName: '审计领导', status: 'active' },
    ],
    audits: [
      {
        _id: 'audit-001',
        actorAuthUid: 'server-user-audit',
        actorAccountId: 'account-audit',
        actorUsername: 'leader-audit',
        actorDisplayName: '审计领导',
        action: 'update_employee',
        targetNameSnapshot: '示例员工乙',
        changedFields: ['department'],
        before: { name: '示例员工乙', department: '演示支持组' },
        after: { name: '示例员工乙', department: '演示综合组' },
        result: 'success',
        detail: '网页编辑员工档案。',
        requestId: 'request-audit-001',
        createdAt: '2026-09-15T08:00:00.000Z',
      },
    ],
  });

  const response = await handlerWith(mock)({ route: 'audit/list' });
  assert.equal(response.ok, true);
  assert.deepEqual(response.data.items[0], {
    id: 'audit-001',
    actorNameSnapshot: '审计领导',
    actorUsername: 'leader-audit',
    action: 'update_employee',
    targetNameSnapshot: '示例员工乙',
    changedFields: ['department'],
    before: { name: '示例员工乙', department: '演示支持组' },
    after: { name: '示例员工乙', department: '演示综合组' },
    result: 'success',
    detail: '网页编辑员工档案。',
    requestId: 'request-audit-001',
    createdAt: '2026-09-15T08:00:00.000Z',
  });
  assert.equal(response.data.items[0].actorAuthUid, undefined);
  assert.equal(response.data.items[0].actorAccountId, undefined);
});

test('audit list gives historical governance rows stable distinct public IDs without leaking internal keys', async () => {
  const internalHash = 'a'.repeat(64);
  const audits = ['promote', 'demote'].map((suffix) => ({
    _id: `governance-audit:${internalHash}:${suffix}`,
    action: 'transfer_super_admin', result: 'success', createdAt: '2026-09-15T12:00:00.000Z',
  }));
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-audit-public' },
    accounts: [{ _id: 'account-audit-public', authUid: 'server-user-audit-public', username: 'audit-manager', status: 'active' }],
    audits,
  });
  const first = await handlerWith(mock)({ route: 'audit/list' });
  const second = await handlerWith(mock)({ route: 'audit/list' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const ids = first.data.items.map((row) => row.id);
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) assert.match(id, /^audit-public:[a-f0-9]{64}$/);
  assert.deepEqual(second.data.items.map((row) => row.id), ids);
  const serialized = JSON.stringify(first.data);
  assert.equal(serialized.includes(internalHash), false);
  assert.equal(serialized.includes('governance-audit:'), false);
  assert.deepEqual(mock.state.audits, audits);
  assert.equal(mock.state.transactionWrites.length, 0);
});

test('audit list excludes historical student detail views before filtering, counting, and pagination', async () => {
  const historicalAudits = [
    { _id: 'audit-old-student-view-newest', targetId: 'student-a', targetNameSnapshot: '测试学员', action: 'view_student_detail', result: 'success', createdAt: '2026-09-15T13:00:00.000Z' },
    { _id: 'audit-allowed-student-update', targetId: 'student-a', targetNameSnapshot: '测试学员', action: 'update_student', result: 'success', createdAt: '2026-09-15T12:00:00.000Z' },
    { _id: 'audit-old-student-view-failure', targetId: 'student-a', targetNameSnapshot: '测试学员', action: ' view_student_detail ', result: 'failure', createdAt: '2026-09-15T11:00:00.000Z' },
    { _id: 'audit-allowed-employee-update', targetId: 'employee-a', targetNameSnapshot: '测试员工', action: 'update_employee', result: 'success', createdAt: '2026-09-15T10:00:00.000Z' },
  ];
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-audit-retired-student-view' },
    accounts: [{ _id: 'account-retired-student-view', authUid: 'server-user-audit-retired-student-view', username: 'audit-manager', status: 'active' }],
    audits: historicalAudits,
  });
  const handler = handlerWith(mock);
  const firstPage = await handler({ route: 'audit/list', input: { page: 1, pageSize: 1 } });
  const secondPage = await handler({ route: 'audit/list', input: { page: 2, pageSize: 1 } });
  for (const response of [firstPage, secondPage]) {
    assert.equal(response.ok, true);
    assert.equal(response.data.total, 2);
    assert.equal(response.data.items.length, 1);
  }
  assert.deepEqual(firstPage.data.items.map((row) => row.id), ['audit-allowed-student-update']);
  assert.deepEqual(secondPage.data.items.map((row) => row.id), ['audit-allowed-employee-update']);
  const scoped = await handler({ route: 'audit/list', input: { targetId: 'student-a' } });
  assert.equal(scoped.ok, true);
  assert.equal(scoped.data.total, 1);
  assert.deepEqual(scoped.data.items.map((row) => row.id), ['audit-allowed-student-update']);
  const retiredAction = await handler({ route: 'audit/list', input: { action: 'view_student_detail' } });
  assert.equal(retiredAction.ok, true);
  assert.equal(retiredAction.data.total, 0);
  assert.deepEqual(retiredAction.data.items, []);
  assert.deepEqual(mock.state.audits, historicalAudits, 'historical audit documents must stay intact');
  assert.equal(mock.state.transactionWrites.length, 0);
});

test('audit list can scope records to one employee without exposing the target id', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-audit-scope' },
    accounts: [
      { _id: 'account-audit-scope', authUid: 'server-user-audit-scope', username: 'leader-scope', displayName: '审计范围领导', status: 'active' },
    ],
    audits: [
      { _id: 'audit-scope-1', targetId: 'employee-a', targetNameSnapshot: '甲', action: 'update_employee', result: 'success', createdAt: '2026-09-15T08:00:00.000Z' },
      { _id: 'audit-scope-2', targetId: 'employee-b', targetNameSnapshot: '乙', action: 'update_employee', result: 'success', createdAt: '2026-09-15T09:00:00.000Z' },
    ],
  });

  const response = await handlerWith(mock)({ route: 'audit/list', input: { targetId: 'employee-a' } });
  assert.equal(response.ok, true);
  assert.deepEqual(response.data.items.map((item) => item.id), ['audit-scope-1']);
  assert.equal(response.data.items[0].targetId, undefined);
});

test('audit list filters top-level name, action and result parameters and restores all when cleared', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-audit-filters' },
    accounts: [
      { _id: 'account-audit-filters', authUid: 'server-user-audit-filters', username: 'leader-filters', displayName: '筛选领导', status: 'active' },
    ],
    audits: [
      { _id: 'audit-filter-create', targetNameSnapshot: '示例员工甲', action: 'create_employee', result: 'success', createdAt: '2026-09-15T12:00:00.000Z' },
      { _id: 'audit-filter-update', targetNameSnapshot: '示例员工乙', action: 'update_employee', result: 'failure', createdAt: '2026-09-15T11:00:00.000Z' },
      { _id: 'audit-filter-attachment', targetNameSnapshot: '示例员工甲', action: 'view_attachment', result: 'success', detail: '查看员工附件“工作证.png”。', createdAt: '2026-09-15T09:00:00.000Z' },
    ],
  });
  const handler = handlerWith(mock);

  const byName = await handler({ route: 'audit/list', employeeName: ' 示例员工乙 ' });
  assert.equal(byName.ok, true);
  assert.deepEqual(byName.data.items.map((item) => item.id), ['audit-filter-update']);

  const byAction = await handler({ route: 'audit/list', action: 'update_employee' });
  assert.equal(byAction.ok, true);
  assert.deepEqual(byAction.data.items.map((item) => item.id), ['audit-filter-update']);

  const byResult = await handler({ route: 'audit/list', result: 'failure' });
  assert.equal(byResult.ok, true);
  assert.deepEqual(byResult.data.items.map((item) => item.id), ['audit-filter-update']);

  const cleared = await handler({ route: 'audit/list', employeeName: '', action: 'all', result: 'all' });
  assert.equal(cleared.ok, true);
  assert.deepEqual(cleared.data.items.map((item) => item.id), [
    'audit-filter-create',
    'audit-filter-update',
    'audit-filter-attachment',
  ]);
});

test('courses/create appends a server-attributed course record and writes a clear audit', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-course' },
    accounts: [
      { _id: 'account-course', authUid: 'server-user-course', username: 'leader-course', displayName: '课程领导', status: 'active' },
    ],
    employees: [
      {
        _id: 'employee-course',
        name: '示例员工乙',
        department: '演示支持组',
        status: 'active',
        courseRecords: [],
      },
    ],
  });

  const response = await handlerWith(mock)({
    route: 'courses/create',
    input: {
      employeeId: 'employee-course',
      courseName: '消防安全培训',
      status: 'completed',
      attendedDate: '2026-09-15',
      note: '线下完成。',
      authUid: 'client-must-not-control-this',
      storageKey: 'client-secret-storage-key',
    },
  });

  assert.equal(response.ok, true);
  assert.equal(mock.state.updatePayloads.length, 1);
  assert.deepEqual(Object.keys(mock.state.updatePayloads[0].payload), ['courseRecords', 'version']);

  const storedRecord = mock.state.employees[0].courseRecords[0];
  assert.match(storedRecord.id, /^course-/);
  assert.equal(storedRecord.courseName, '消防安全培训');
  assert.equal(storedRecord.status, 'completed');
  assert.equal(storedRecord.attendedDate, '2026-09-15');
  assert.equal(storedRecord.createdAt, '2026-09-15T08:00:00.000Z');
  assert.equal(storedRecord.createdByAuthUid, 'server-user-course');
  assert.equal(storedRecord.authUid, undefined);
  assert.equal(storedRecord.storageKey, undefined);

  const returnedRecord = response.data.courseRecords[0];
  assert.equal(returnedRecord.courseName, '消防安全培训');
  assert.equal(returnedRecord.createdAt, '2026-09-15T08:00:00.000Z');
  assert.equal(returnedRecord.createdByAuthUid, undefined);
  assert.equal(returnedRecord.authUid, undefined);
  assert.equal(returnedRecord.storageKey, undefined);
  assert.equal(mock.state.audits.length, 1);
  assert.equal(mock.state.audits[0].action, 'add_course');
  assert.equal(mock.state.audits[0].result, 'success');
  assert.equal(mock.state.audits[0].targetId, 'employee-course');
  assert.equal(mock.state.audits[0].detail, '新增课程记录“消防安全培训”。');
});

test('courses/create rejects invalid status or date without updating the employee', async () => {
  for (const invalidInput of [
    { status: 'finished', attendedDate: '2026-09-15' },
    { status: 'completed', attendedDate: '2026-02-30' },
  ]) {
    const mock = createMockCloudBase({
      identity: { uid: 'server-user-course-invalid' },
      accounts: [
        { _id: 'account-course-invalid', authUid: 'server-user-course-invalid', username: 'leader-course-invalid', displayName: '课程校验领导', status: 'active' },
      ],
      employees: [
        {
          _id: 'employee-course-invalid',
          name: '示例员工乙',
          department: '演示支持组',
          status: 'active',
          courseRecords: [],
        },
      ],
    });

    const response = await handlerWith(mock)({
      route: 'courses/create',
      input: {
        employeeId: 'employee-course-invalid',
        courseName: '不应写入的课程',
        ...invalidInput,
      },
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'VALIDATION_ERROR');
    assert.equal(mock.state.updatePayloads.length, 0);
    assert.deepEqual(mock.state.employees[0].courseRecords, []);
    assert.equal(mock.state.audits.length, 1);
    assert.equal(mock.state.audits[0].action, 'add_course');
    assert.equal(mock.state.audits[0].result, 'failure');
  }
});

test('events/create stores one validated image attachment but never returns its storage key', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-event' },
    accounts: [
      { _id: 'account-event', authUid: 'server-user-event', username: 'leader-event', displayName: '事件领导', status: 'active' },
    ],
    employees: [{ _id: 'employee-event', name: '示例员工乙', department: '演示支持组', status: 'active', events: [] }],
    storage: {
      async getTempFileURL(params) {
        assert.deepEqual(params, { fileList: [{ fileID: storageKey, maxAge: 3600 }] });
        return { fileList: [{ fileID: storageKey, tempFileURL: 'https://temporary.example/event.png' }] };
      },
    },
  });

  const storageKey = `cloud://${TEST_STORAGE_AUTHORITY}/employee-archive/events/employee-event/unique-image.png`;
  const response = await handlerWith(mock)({
    route: 'events/create',
    input: {
      employeeId: 'employee-event',
      eventDate: '2026-04-30',
      eventType: '检视会迟到',
      summary: '检视会迟到',
      detail: '已记录相关情况。',
      attachment: {
        storageKey,
        fileName: '现场照片.png',
        mimeType: 'image/png',
        size: 2048,
      },
    },
  });

  assert.equal(response.ok, true);
  assert.equal(mock.state.employees[0].events.length, 1);
  assert.equal(mock.state.employees[0].events[0].attachments[0].storageKey, storageKey);
  assert.equal(response.data.events[0].attachments[0].storageKey, undefined);
  assert.deepEqual(response.data.events[0].attachments[0], {
    id: response.data.events[0].attachments[0].id,
    fileName: '现场照片.png',
    mimeType: 'image/png',
    size: 2048,
    visibility: 'sensitive',
    uploadedAt: '2026-09-15T08:00:00.000Z',
    sourceRef: response.data.events[0].id,
  });
  assert.equal(mock.state.audits.length, 1);
  assert.equal(mock.state.audits[0].action, 'add_event');
  assert.equal(mock.state.audits[0].detail, '新增特殊事件“检视会迟到”；图片：“现场照片.png”。');
});

test('events/create rejects an attachment outside the employee private path without changing the employee', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-event-invalid' },
    accounts: [
      { _id: 'account-event-invalid', authUid: 'server-user-event-invalid', username: 'leader-event-invalid', displayName: '事件校验领导', status: 'active' },
    ],
    employees: [{ _id: 'employee-event-invalid', name: '示例员工乙', department: '演示支持组', status: 'active', events: [] }],
  });

  const response = await handlerWith(mock)({
    route: 'events/create',
    input: {
      employeeId: 'employee-event-invalid',
      summary: '不应写入',
      attachment: {
        storageKey: `cloud://${TEST_STORAGE_AUTHORITY}/employee-archive/events/another-employee/escape.png`,
        fileName: 'escape.png',
        mimeType: 'image/png',
        size: 1024,
      },
    },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(mock.state.employees[0].events, []);
  assert.equal(mock.state.audits.length, 1);
  assert.equal(mock.state.audits[0].result, 'failure');
});

test('events/create rejects a similar environment authority even when the employee path matches', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-event-similar-env' },
    accounts: [
      { _id: 'account-event-similar-env', authUid: 'server-user-event-similar-env', username: 'leader-event-similar-env', displayName: '相似环境校验领导', status: 'active' },
    ],
    employees: [{ _id: 'employee-event-similar-env', name: '示例员工乙', department: '演示支持组', status: 'active', events: [] }],
  });

  const response = await handlerWith(mock)({
    route: 'events/create',
    input: {
      employeeId: 'employee-event-similar-env',
      summary: '不应写入',
      attachment: {
        storageKey: `cloud://${SIMILAR_ENV_STORAGE_AUTHORITY}/employee-archive/events/employee-event-similar-env/escape.png`,
        fileName: 'escape.png',
        mimeType: 'image/png',
        size: 1024,
      },
    },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(mock.state.employees[0].events, []);
  assert.equal(mock.state.audits.length, 1);
  assert.equal(mock.state.audits[0].result, 'failure');
});

test('attachments/view returns a temporary URL and records a specific attachment audit', async () => {
  const storageKey = ACTUAL_EVENT_STORAGE_KEY;
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-attachment' },
    accounts: [
      { _id: 'account-attachment', authUid: 'server-user-attachment', username: 'leader-attachment', displayName: '附件领导', status: 'active' },
    ],
    employees: [
      {
        _id: ACTUAL_EVENT_EMPLOYEE_ID,
        name: '虚构人员1',
        department: '演示支持组',
        status: 'active',
        events: [
          {
            id: ACTUAL_EVENT_ID,
            eventDate: '2026-04-30',
            eventType: '特殊事件',
            summary: '检视会迟到',
            detail: '来源工作表：虚构人员1',
            attachments: [
              {
                id: ACTUAL_EVENT_ATTACHMENT_ID,
                fileName: 'image1.jpeg',
                mimeType: 'image/jpeg',
                size: 231623,
                storageKey,
              },
            ],
          },
        ],
      },
    ],
    storage: {
      async getTempFileURL(params) {
        assert.deepEqual(params, { fileList: [{ fileID: storageKey, maxAge: 3600 }] });
        return { fileList: [{ fileID: storageKey, tempFileURL: 'https://temporary.example/image.jpg' }] };
      },
    },
  });

  const response = await handlerWith(mock)({
    route: 'attachments/view',
    input: {
      employeeId: ACTUAL_EVENT_EMPLOYEE_ID,
      eventId: ACTUAL_EVENT_ID,
      attachmentId: ACTUAL_EVENT_ATTACHMENT_ID,
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(response.data, {
    url: 'https://temporary.example/image.jpg',
    fileName: 'image1.jpeg',
    mimeType: 'image/jpeg',
  });
  assert.equal(response.data.storageKey, undefined);
  assert.equal(mock.state.audits.length, 1);
  assert.equal(mock.state.audits[0].action, 'view_attachment');
  assert.equal(mock.state.audits[0].detail, '查看员工“虚构人员1”的特殊事件“检视会迟到”图片“image1.jpeg”。');
});

test('attachments/view keeps a clear failure audit when the storage authority is invalid', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-attachment-failure' },
    accounts: [
      { _id: 'account-attachment-failure', authUid: 'server-user-attachment-failure', username: 'leader-attachment-failure', displayName: '附件失败领导', status: 'active' },
    ],
    employees: [{
      _id: 'employee-attachment-failure',
      name: '虚构人员1',
      department: '演示支持组',
      status: 'active',
      events: [{
        id: 'event-attachment-failure-001',
        summary: '检视会迟到',
        attachments: [{
          id: 'attachment-failure-001',
          fileName: 'image1.jpeg',
          mimeType: 'image/jpeg',
          size: 231623,
          storageKey: `cloud://${SIMILAR_ENV_STORAGE_AUTHORITY}/employee-archive/events/employee-attachment-failure/invalid.jpeg`,
        }],
      }],
    }],
  });

  const response = await handlerWith(mock)({
    route: 'attachments/view',
    input: {
      employeeId: 'employee-attachment-failure',
      eventId: 'event-attachment-failure-001',
      attachmentId: 'attachment-failure-001',
    },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'ATTACHMENT_NOT_FOUND');
  assert.equal(mock.state.audits.length, 1);
  assert.equal(mock.state.audits[0].action, 'view_attachment');
  assert.equal(mock.state.audits[0].result, 'failure');
  assert.equal(mock.state.audits[0].detail, '查看员工“虚构人员1”的特殊事件“检视会迟到”图片“image1.jpeg”失败：ATTACHMENT_NOT_FOUND。');
});

test('attachments/upload registers a general employee image without exposing its storage key', async () => {
  const storageKey = `cloud://${TEST_STORAGE_AUTHORITY}/employee-archive/attachments/employee-general/工作证.png`;
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-general-attachment' },
    accounts: [
      { _id: 'account-general-attachment', authUid: 'server-user-general-attachment', username: 'leader-general', displayName: '通用附件领导', status: 'active' },
    ],
    employees: [{ _id: 'employee-general', name: '虚构人员1', department: '演示研发组', status: 'active', attachments: [] }],
    storage: {
      async getTempFileURL(params) {
        assert.deepEqual(params, { fileList: [{ fileID: storageKey, maxAge: 3600 }] });
        return { fileList: [{ fileID: storageKey, tempFileURL: 'https://temporary.example/general.png' }] };
      },
    },
  });

  const response = await handlerWith(mock)({
    route: 'attachments/upload',
    input: {
      employeeId: 'employee-general',
      attachment: {
        storageKey,
        fileName: '工作证.png',
        mimeType: 'image/png',
        size: 4096,
      },
    },
  });

  assert.equal(response.ok, true);
  assert.equal(mock.state.employees[0].attachments.length, 1);
  assert.equal(mock.state.employees[0].attachments[0].storageKey, storageKey);
  assert.deepEqual(response.data.attachments[0], {
    id: response.data.attachments[0].id,
    fileName: '工作证.png',
    mimeType: 'image/png',
    size: 4096,
    visibility: 'normal',
    uploadedAt: '2026-09-15T08:00:00.000Z',
    sourceRef: 'employee-attachment',
  });
  assert.equal(response.data.attachments[0].storageKey, undefined);
  assert.equal(mock.state.audits.length, 1);
  assert.equal(mock.state.audits[0].action, 'add_attachment');
  assert.equal(mock.state.audits[0].detail, '为员工“虚构人员1”上传员工附件“工作证.png”。');
});

test('attachments/upload validates employee path and image metadata before updating the employee', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-general-invalid' },
    accounts: [
      { _id: 'account-general-invalid', authUid: 'server-user-general-invalid', username: 'leader-general-invalid', displayName: '附件校验领导', status: 'active' },
    ],
    employees: [{ _id: 'employee-general-invalid', name: '示例员工', department: '演示综合组', status: 'active', attachments: [] }],
  });

  for (const attachment of [
    {
      storageKey: `cloud://${TEST_STORAGE_AUTHORITY}/employee-archive/attachments/another-employee/escape.png`,
      fileName: 'escape.png',
      mimeType: 'image/png',
      size: 1024,
    },
    {
      storageKey: `cloud://${TEST_STORAGE_AUTHORITY}/employee-archive/attachments/employee-general-invalid/document.pdf`,
      fileName: 'document.pdf',
      mimeType: 'application/pdf',
      size: 1024,
    },
    {
      storageKey: `cloud://${TEST_STORAGE_AUTHORITY}/employee-archive/attachments/employee-general-invalid/too-large.png`,
      fileName: 'too-large.png',
      mimeType: 'image/png',
      size: 10 * 1024 * 1024 + 1,
    },
  ]) {
    const response = await handlerWith(mock)({
      route: 'attachments/upload',
      input: { employeeId: 'employee-general-invalid', attachment },
    });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'VALIDATION_ERROR');
  }

  assert.deepEqual(mock.state.employees[0].attachments, []);
  assert.equal(mock.state.updatePayloads.length, 0);
  assert.equal(mock.state.audits.length, 3);
  assert.ok(mock.state.audits.every((log) => log.action === 'add_attachment' && log.result === 'failure'));
});

test('attachments/download returns a temporary URL and logs the concrete file name', async () => {
  const storageKey = `cloud://${TEST_STORAGE_AUTHORITY}/employee-archive/attachments/employee-download/现场照片.jpg`;
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-general-download' },
    accounts: [
      { _id: 'account-general-download', authUid: 'server-user-general-download', username: 'leader-download', displayName: '附件查看领导', status: 'active' },
    ],
    employees: [{
      _id: 'employee-download',
      name: '虚构人员1',
      department: '演示研发组',
      status: 'active',
      attachments: [{
        id: 'attachment-download-001',
        fileName: '现场照片.jpg',
        mimeType: 'image/jpeg',
        size: 8192,
        visibility: 'normal',
        storageKey,
      }],
    }],
    storage: {
      async getTempFileURL(params) {
        assert.deepEqual(params, { fileList: [{ fileID: storageKey, maxAge: 3600 }] });
        return { fileList: [{ fileID: storageKey, tempFileURL: 'https://temporary.example/download.jpg' }] };
      },
    },
  });

  const response = await handlerWith(mock)({
    route: 'attachments/download',
    input: { employeeId: 'employee-download', attachmentId: 'attachment-download-001' },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(response.data, {
    url: 'https://temporary.example/download.jpg',
    fileName: '现场照片.jpg',
    mimeType: 'image/jpeg',
  });
  assert.equal(response.data.storageKey, undefined);
  assert.equal(mock.state.audits.length, 1);
  assert.equal(mock.state.audits[0].detail, '查看员工附件“现场照片.jpg”。');
});

test('failed attachment registration retains the uploaded object and leaves no employee record', async () => {
  const storageKey = `cloud://${TEST_STORAGE_AUTHORITY}/employee-archive/attachments/employee-rollback/rollback.png`;
  const deletedKeys = [];
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-general-rollback' },
    accounts: [
      { _id: 'account-general-rollback', authUid: 'server-user-general-rollback', username: 'leader-rollback', displayName: '附件回滚领导', status: 'active' },
    ],
    employees: [{ _id: 'employee-rollback', name: '示例员工', department: '演示综合组', status: 'active', attachments: [] }],
    updateError: 'employee write failed',
    storage: {
      async getTempFileURL() {
        return { fileList: [{ fileID: storageKey, tempFileURL: 'https://temporary.example/rollback.png' }] };
      },
      async deleteFile(params) {
        deletedKeys.push(...params.fileList);
        return { code: 'SUCCESS', fileList: params.fileList.map((fileID) => ({ fileID, code: 'SUCCESS' })) };
      },
    },
  });

  const response = await handlerWith(mock)({
    route: 'attachments/upload',
    input: {
      employeeId: 'employee-rollback',
      attachment: { storageKey, fileName: '回滚图片.png', mimeType: 'image/png', size: 2048 },
    },
  });

  assert.equal(response.ok, false);
  assert.deepEqual(deletedKeys, []);
  assert.deepEqual(mock.state.employees[0].attachments, []);
  assert.equal(mock.state.audits.length, 1);
  assert.equal(mock.state.audits[0].result, 'failure');
  assert.match(mock.state.audits[0].detail, /回滚图片\.png/);
});

test('future account creation and import routes return explicit NOT_IMPLEMENTED', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-004' },
    accounts: [
      { _id: 'account-004', authUid: 'server-user-004', username: 'leader-d', displayName: '领导丁', status: 'active' },
    ],
  });
  for (const route of ['accounts/create', 'import/excel']) {
    const response = await handlerWith(mock)({ route });
    assert.equal(response.ok, false, route);
    assert.equal(response.error.code, 'NOT_IMPLEMENTED', route);
  }
});

function makePasswordResetFixture({ actorRole = 'super_admin', actorStatus = 'active', targetStatus = 'active', rosterIds = ['password-reset-actor'], revision = 4, failAuditWrites = false, updateError = '' } = {}) {
  return createMockCloudBase({
    identity: { uid: 'password-reset-actor-auth' },
    accounts: [
      { _id: 'password-reset-actor', authUid: 'password-reset-actor-auth', username: 'reset-root', displayName: '重置总管理员', status: actorStatus, role: actorRole },
      { _id: 'password-reset-target', authUid: 'server-owned-target-auth', username: 'reset-target', displayName: '目标账号', status: targetStatus, role: 'user' },
    ],
    governanceRoster: {
      schemaVersion: 1,
      state: 'ready',
      limit: 5,
      activeSuperAdminAccountIds: rosterIds,
      revision,
    },
    failAuditWrites,
    updateError,
  });
}

function passwordResetInput(newPassword = 'ResetOnlyPass1!', extra = {}) {
  return {
    accountId: 'password-reset-target',
    newPassword,
    expectedGovernanceRevision: 4,
    ...extra,
  };
}

test('password reset requires the active super administrator and current governance revision', async () => {
  let unauthorizedManagerCalls = 0;
  const unauthorized = makePasswordResetFixture({ actorRole: 'admin' });
  const unauthorizedResponse = await handlerWith(unauthorized, undefined, {
    managerFactory: () => { unauthorizedManagerCalls += 1; return { user: { modifyUser: async () => ({ Data: { Success: true } }) } }; },
  })({ route: 'accounts/reset-password', input: passwordResetInput() });
  assert.equal(unauthorizedResponse.ok, false);
  assert.equal(unauthorizedResponse.error.code, 'PERMISSION_DENIED');
  assert.equal(unauthorizedManagerCalls, 0);

  let demotedManagerCalls = 0;
  let demotedMock;
  let demotedOnce = false;
  demotedMock = createMockCloudBase({
    identity: { uid: 'password-reset-actor-auth' },
    accounts: [
      { _id: 'password-reset-actor', authUid: 'password-reset-actor-auth', username: 'reset-root', status: 'active', role: 'super_admin' },
      { _id: 'password-reset-target', authUid: 'server-owned-target-auth', username: 'reset-target', status: 'active', role: 'user' },
    ],
    governanceRoster: {
      schemaVersion: 1,
      state: 'ready',
      limit: 5,
      activeSuperAdminAccountIds: ['password-reset-actor'],
      revision: 4,
    },
    failDocumentRead: ({ collectionName, id }) => {
      if (!demotedOnce && collectionName === COLLECTIONS.adminAccounts && id === 'password-reset-actor') {
        demotedOnce = true;
        demotedMock.state.accounts[0].role = 'admin';
      }
      return false;
    },
  });
  const demotedResponse = await handlerWith(demotedMock, undefined, {
    managerFactory: () => { demotedManagerCalls += 1; return { user: { modifyUser: async () => ({ Data: { Success: true } }) } }; },
  })({ route: 'accounts/reset-password', input: passwordResetInput() });
  assert.equal(demotedResponse.ok, false);
  assert.equal(demotedResponse.error.code, 'PERMISSION_DENIED');
  assert.equal(demotedManagerCalls, 0);

  let staleManagerCalls = 0;
  const stale = makePasswordResetFixture({ revision: 5 });
  const staleResponse = await handlerWith(stale, undefined, {
    managerFactory: () => { staleManagerCalls += 1; return { user: { modifyUser: async () => ({ Data: { Success: true } }) } }; },
  })({ route: 'accounts/reset-password', input: passwordResetInput() });
  assert.equal(staleResponse.ok, false);
  assert.equal(staleResponse.error.code, 'SUPER_ADMIN_REVISION_CONFLICT');
  assert.equal(staleManagerCalls, 0);
  assert.equal(stale.state.documentReads.some((read) => read.collectionName === COLLECTIONS.adminAccounts && read.id === 'password-reset-target'), false);
});

test('password reset validates its strict input and records no password in failures', async () => {
  const secret = 'ResetOnlyPass1!';
  const mock = makePasswordResetFixture();
  let managerCalls = 0;
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => { managerCalls += 1; return { user: { modifyUser: async () => ({ Data: { Success: true } }) } }; },
  })({ route: 'accounts/reset-password', input: passwordResetInput('weak-password') });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'VALIDATION_ERROR');
  assert.equal(managerCalls, 0);
  assert.equal(JSON.stringify(response).includes('weak-password'), false);
  assert.equal(JSON.stringify(mock.state.audits).includes('weak-password'), false);

  const forgedUid = makePasswordResetFixture();
  const forgedResponse = await handlerWith(forgedUid)({
    route: 'accounts/reset-password',
    input: passwordResetInput(secret, { authUid: 'attacker-chosen-auth-uid' }),
  });
  assert.equal(forgedResponse.ok, false);
  assert.equal(forgedResponse.error.code, 'VALIDATION_ERROR');
  assert.equal(JSON.stringify(forgedResponse).includes(secret), false);
});

test('password reset hides missing and disabled targets behind the same response', async () => {
  const missing = makePasswordResetFixture();
  missing.state.accounts = missing.state.accounts.filter((account) => account._id !== 'password-reset-target');
  const disabled = makePasswordResetFixture({ targetStatus: 'disabled' });
  const noAuthUid = makePasswordResetFixture();
  noAuthUid.state.accounts[1].authUid = '';
  const calls = { missing: 0, disabled: 0, noAuthUid: 0 };
  const managerFactory = (key) => () => {
    calls[key] += 1;
    return { user: { modifyUser: async () => ({ Data: { Success: true } }) } };
  };
  const missingResponse = await handlerWith(missing, undefined, { managerFactory: managerFactory('missing') })(
    { route: 'accounts/reset-password', input: passwordResetInput() },
  );
  const disabledResponse = await handlerWith(disabled, undefined, { managerFactory: managerFactory('disabled') })(
    { route: 'accounts/reset-password', input: passwordResetInput() },
  );
  const noAuthUidResponse = await handlerWith(noAuthUid, undefined, { managerFactory: managerFactory('noAuthUid') })(
    { route: 'accounts/reset-password', input: passwordResetInput() },
  );
  assert.equal(missingResponse.error.code, 'ACCOUNT_NOT_FOUND');
  assert.equal(disabledResponse.error.code, 'ACCOUNT_NOT_FOUND');
  assert.equal(noAuthUidResponse.error.code, 'ACCOUNT_NOT_FOUND');
  assert.equal(missingResponse.error.message, disabledResponse.error.message);
  assert.equal(noAuthUidResponse.error.message, disabledResponse.error.message);
  assert.deepEqual(calls, { missing: 0, disabled: 0, noAuthUid: 0 });
});

test('password reset uses the server account authUid and records only safe audit fields', async () => {
  const secret = 'ResetOnlyPass1!';
  const mock = makePasswordResetFixture();
  const beforeAccounts = structuredClone(mock.state.accounts);
  const providerCalls = [];
  const capturedLogs = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  console.log = (...args) => capturedLogs.push(args);
  console.error = (...args) => capturedLogs.push(args);
  console.warn = (...args) => capturedLogs.push(args);
  let response;
  try {
    response = await handlerWith(mock, undefined, {
      managerFactory: () => ({ user: {
        async modifyUser(input) {
          providerCalls.push(input);
          return { Data: { Success: true } };
        },
      } }),
    })({ route: 'accounts/reset-password', input: passwordResetInput(secret) });
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  assert.equal(response.ok, true);
  assert.deepEqual(response.data, { reset: true });
  assert.deepEqual(providerCalls, [{ uid: 'server-owned-target-auth', password: secret }]);
  assert.equal(mock.state.adminGovernanceOperations.length, 0);
  assert.equal(mock.state.audits.length, 1);
  assert.equal(mock.state.audits[0].action, 'reset_account_password');
  assert.equal(mock.state.audits[0].actorAccountId, 'password-reset-actor');
  assert.equal(mock.state.audits[0].targetId, 'password-reset-target');
  assert.equal(mock.state.audits[0].targetNameSnapshot, 'reset-target');
  assert.equal(mock.state.audits[0].targetType, 'account');
  assert.equal(mock.state.audits[0].result, 'success');
  assert.equal(mock.state.audits[0].createdAt, '2026-09-15T08:00:00.000Z');
  assert.equal(mock.state.audits[0].before, null);
  assert.equal(mock.state.audits[0].after, null);
  assert.deepEqual(mock.state.accounts, beforeAccounts);
  assert.equal(JSON.stringify([response, mock.state, capturedLogs]).includes(secret), false);
  assert.equal(Object.hasOwn(mock.state.accounts[1], 'password'), false);
});

test('password reset provider rejection and uncertain errors never expose provider details or the password', async () => {
  const secret = 'ResetOnlyPass1!';
  const captured = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args) => captured.push(args);
  console.warn = (...args) => captured.push(args);
  try {
    const rejected = makePasswordResetFixture();
    const rejectedResponse = await handlerWith(rejected, undefined, {
      managerFactory: () => ({ user: { modifyUser: async () => ({ Data: { Success: false, Message: `provider echoed ${secret}` } }) } }),
    })({ route: 'accounts/reset-password', input: passwordResetInput(secret) });
    assert.equal(rejectedResponse.ok, false);
    assert.equal(rejectedResponse.error.code, 'PASSWORD_RESET_FAILED');
    assert.equal(rejected.state.audits[0].result, 'failure');

    const uncertain = makePasswordResetFixture();
    const uncertainResponse = await handlerWith(uncertain, undefined, {
      managerFactory: () => ({ user: { modifyUser: async () => { throw new Error(`provider detail ${secret}`); } } }),
    })({ route: 'accounts/reset-password', input: passwordResetInput(secret) });
    assert.equal(uncertainResponse.ok, false);
    assert.equal(uncertainResponse.error.code, 'PASSWORD_RESET_RESULT_UNKNOWN');
    assert.equal(uncertain.state.audits[0].result, 'unknown');
    assert.equal(JSON.stringify([rejectedResponse, uncertainResponse, rejected.state, uncertain.state, captured]).includes(secret), false);
    assert.equal(JSON.stringify([rejectedResponse, uncertainResponse, rejected.state, uncertain.state, captured]).includes('provider detail'), false);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
});

test('password reset refuses to call CloudBase when the initial audit cannot be written', async () => {
  const mock = makePasswordResetFixture({ failAuditWrites: true });
  let managerCalls = 0;
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => { managerCalls += 1; return { user: { modifyUser: async () => ({ Data: { Success: true } }) } }; },
  })({ route: 'accounts/reset-password', input: passwordResetInput() });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'AUDIT_WRITE_FAILED');
  assert.equal(managerCalls, 0);
  assert.equal(mock.state.audits.length, 0);
});

test('password reset reports unknown when the final audit update cannot be confirmed', async () => {
  const mock = makePasswordResetFixture({ updateError: 'audit update unavailable' });
  let managerCalls = 0;
  const response = await handlerWith(mock, undefined, {
    managerFactory: () => ({ user: {
      async modifyUser() {
        managerCalls += 1;
        return { Data: { Success: true } };
      },
    } }),
  })({ route: 'accounts/reset-password', input: passwordResetInput() });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'PASSWORD_RESET_RESULT_UNKNOWN');
  assert.equal(managerCalls, 1);
  assert.equal(mock.state.audits[0].result, 'unknown');
});

test('audit listing preserves the unconfirmed outcome for password reset', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'password-reset-actor-auth' },
    accounts: [
      { _id: 'password-reset-actor', authUid: 'password-reset-actor-auth', username: 'reset-root', status: 'active', role: 'super_admin' },
    ],
    audits: [{
      _id: 'password-reset-audit-unknown',
      actorAccountId: 'password-reset-actor',
      actorUsername: 'reset-root',
      actorDisplayName: '重置总管理员',
      action: 'reset_account_password',
      targetType: 'account',
      targetId: 'stable-target-id',
      targetNameSnapshot: 'reset-target',
      result: 'unknown',
      detail: '管理员重置账号密码的结果暂不可确认。',
      createdAt: '2026-09-15T08:00:00.000Z',
    }],
  });
  const response = await handlerWith(mock)({ route: 'audit/list', input: {} });
  assert.equal(response.ok, true);
  assert.equal(response.data.items[0].action, 'reset_account_password');
  assert.equal(response.data.items[0].result, 'unknown');
  assert.equal(response.data.items[0].targetNameSnapshot, 'reset-target');
});

test('account/update-display-name always rejects without updating the account or writing a success audit', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-display-name' },
    accounts: [
      { _id: 'account-display-name', authUid: 'server-user-display-name', username: 'leader-name', displayName: '旧名称', status: 'active' },
    ],
  });
  const attemptedDisplayName = '机密名称-不要写入日志';

  const response = await handlerWith(mock)({
    route: 'account/update-display-name',
    input: { displayName: attemptedDisplayName, accountId: 'client-account', authUid: 'client-auth' },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'DISPLAY_NAME_IMMUTABLE');
  assert.equal(response.error.message, '显示名称注册后不可修改。');
  assert.equal(response.error.status, 409);
  assert.equal(mock.state.accounts[0].displayName, '旧名称');
  assert.deepEqual(mock.state.updatePayloads, []);
  assert.equal(mock.state.audits.length, 1);
  assert.equal(mock.state.audits[0].action, 'update_account_display_name');
  assert.equal(mock.state.audits[0].result, 'failure');
  assert.equal(mock.state.audits[0].detail, '拒绝修改显示名称：注册后不可修改。');
  assert.equal(mock.state.audits.some((audit) => audit.result === 'success'), false);
  assert.doesNotMatch(JSON.stringify(mock.state.audits), new RegExp(attemptedDisplayName));
});

test('versioned employee writes default legacy documents to version 1 and reject stale updates without writing', async () => {
  const mock = createMockCloudBase({
    identity: { uid: 'server-user-version' },
    accounts: [{ _id: 'account-version', authUid: 'server-user-version', username: 'version-user', status: 'active' }],
    employees: [{ _id: 'employee-version', name: '旧员工', department: '演示支持组', status: 'active' }],
  });
  const stale = await handlerWith(mock)({ route: 'employees/update', input: { employeeId: 'employee-version', department: '演示综合组', expectedVersion: 2 } });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'EMPLOYEE_CONFLICT');
  assert.equal(stale.error.message, '该员工档案已被其他账号更新，请刷新后再保存。');
  assert.equal(mock.state.employees[0].department, '演示支持组');
  assert.equal(mock.state.employees[0].version, undefined);

  const created = await handlerWith(mock)({ route: 'employees/create', input: { name: '新员工', department: '演示研发组' } });
  assert.equal(created.ok, true);
  assert.equal(created.data.version, 1);
});

test('array write routes require expectedVersion', async () => {
  for (const route of ['courses/create', 'events/create', 'attachments/upload']) {
    const mock = createMockCloudBase({
      identity: { uid: `server-user-required-${route}` },
      accounts: [{ _id: `account-required-${route}`, authUid: `server-user-required-${route}`, username: 'required-user', status: 'active' }],
      employees: [{ _id: `employee-required-${route}`, name: '员工', department: '演示支持组', status: 'active' }],
    });
    const response = await createHandler({ sdkFactory: () => mock.sdk, env: { TCB_ENV_ID: TEST_ENV_ID }, requestIdFactory: () => 'request-required' })({
      route,
      input: { employeeId: `employee-required-${route}` },
    });
    assert.equal(response.ok, false, route);
    assert.equal(response.error.code, 'VALIDATION_ERROR', route);
  }
});
