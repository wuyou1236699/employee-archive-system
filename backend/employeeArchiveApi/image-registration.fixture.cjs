/* global require, module, Buffer, structuredClone */
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// Local-only fixture: every SDK operation is injected, and file storage is a
// disposable directory. No CloudBase client, network, or credentials are used.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHandler, COLLECTIONS, getStorageAuthority } = require('./index.js');

function createImageBackend() {
  // Reuse the existing application's authority validator, never contact it.
  const envId = 'archive-demo-environment';
  const authority = getStorageAuthority(envId);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'employee-upload-fiction-'));
  const files = new Map();
  const deleted = [];
  const state = {
    [COLLECTIONS.adminAccounts]: [{ _id: 'fixture-account', authUid: 'fixture-operator', role: 'super_admin', username: 'fixture', status: 'active' }],
    [COLLECTIONS.employees]: [{ _id: 'fixture-employee', name: '虚构员工', department: '虚构测试组', status: 'active', version: 1, events: [], attachments: [], courseRecords: [], contract: null, vehicle: null }],
    [COLLECTIONS.auditLogs]: [],
  };
  const faults = { audit: false, commitReply: false, rollbackReply: false };
  let sequence = 0;
  function collection(source, name) {
    if (!(name in source)) throw new Error('unexpected fixture collection');
    return {
      where(filter) {
        let count = Infinity;
        return {
          limit(value) { count = value; return this; },
          async get() { return { data: structuredClone(source[name].filter(row => Object.entries(filter).every(([key, value]) => row[key] === value)).slice(0, count)) }; },
        };
      },
      doc(id) {
        return {
          async get() { return { data: structuredClone(source[name].find(row => row._id === id) || null) }; },
          async update(data) { Object.assign(source[name].find(row => row._id === id), structuredClone(data)); return { updated: 1 }; },
        };
      },
      async add(data) {
        if (name === COLLECTIONS.auditLogs && faults.audit) throw new Error('fixture audit failure');
        const id = `fixture-record-${++sequence}`;
        source[name].push({ ...structuredClone(data), _id: id });
        return { id };
      },
    };
  }
  const storage = {
    async getTempFileURL({ fileList }) {
      return { fileList: fileList.map(item => {
        const fileID = typeof item === 'string' ? item : item.fileID;
        return { fileID, tempFileURL: files.has(fileID) && fs.existsSync(files.get(fileID)) ? 'https://example.invalid/fixture.png' : '' };
      }) };
    },
    async deleteFile({ fileList }) {
      deleted.push(...fileList);
      for (const id of fileList) if (files.has(id)) fs.unlinkSync(files.get(id));
      return { code: 'SUCCESS' };
    },
  };
  const db = {
    collection: name => collection(state, name),
    async startTransaction() {
      const staged = structuredClone(state);
      return {
        collection: name => {
          const result = collection(staged, name);
          return { ...result, where() { throw new Error('transaction queries are forbidden'); } };
        },
        async commit() {
          for (const key of Object.keys(state)) state[key] = staged[key];
          if (faults.commitReply) { faults.commitReply = false; throw new Error('fixture COMMIT reply lost'); }
          return { ok: 1 };
        },
        async rollback() { if (faults.rollbackReply) throw new Error('fixture rollback reply lost'); return { ok: 1 }; },
      };
    },
  };
  const handler = createHandler({
    env: { TCB_ENV_ID: envId },
    sdkFactory: () => ({ init: () => ({ auth: () => ({ getUserInfo: () => ({ uid: 'fixture-operator' }) }), database: () => db, ...storage }) }),
    now: () => '2026-01-01T00:00:00.000Z', requestIdFactory: () => `fixture-request-${++sequence}`,
  });
  return {
    state, faults, deleted, handler,
    async upload({ cloudPath, fileContent }) {
      const fileID = `cloud://${authority}/${cloudPath}`;
      const filename = path.join(directory, `fixture-${++sequence}.png`);
      fs.writeFileSync(filename, Buffer.from(await fileContent.arrayBuffer()));
      files.set(fileID, filename);
      return { fileID };
    },
    deleteFile: storage.deleteFile,
    fileBytes: id => fs.readFileSync(files.get(id)),
    fileExists: id => files.has(id) && fs.existsSync(files.get(id)),
    employee: () => structuredClone(state[COLLECTIONS.employees][0]),
    successAudits: () => state[COLLECTIONS.auditLogs].filter(row => row.result === 'success'),
    dispose: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

module.exports = { createImageBackend };
