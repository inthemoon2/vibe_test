// Google Apps Script 서비스를 메모리로 흉내 내는 테스트용 도구.
// Code.gs + V2.gs 를 Node vm 안에서 실행해 doPost 를 직접 부른다. (배포에는 쓰이지 않음)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function toSigned(buf) { return Array.from(buf).map(b => (b > 127 ? b - 256 : b)); }
function toBuf(x) { return Buffer.isBuffer(x) ? x : Array.isArray(x) ? Buffer.from(x.map(b => b & 0xff)) : Buffer.from(String(x), 'utf8'); }

function makeSheet(name) {
  const sh = {
    name, rows: [], maxCols: 26, maxRows: 1000,
    getName() { return this.name; },
    setName(n) { this.name = n; return this; },
    getLastRow() { let i = this.rows.length; while (i > 0 && this.rows[i - 1].every(c => c === '' || c == null)) i--; return i; },
    getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); },
    getMaxColumns() { return this.maxCols; }, getMaxRows() { return this.maxRows; },
    insertColumnsAfter(a, n) { this.maxCols += n; }, insertRowsAfter(a, n) { this.maxRows += n; },
    setFrozenRows() {},
    appendRow(vals) { const r = this.getLastRow(); this.rows[r] = vals.slice(); return this; },
    getRange(r, c, nr, nc) {
      const self = this; nr = nr || 1; nc = nc || 1;
      const rng = {
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = self.rows[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
        setValues(v) { for (let i = 0; i < nr; i++) { const row = self.rows[r - 1 + i] = self.rows[r - 1 + i] || []; for (let j = 0; j < nc; j++) row[c - 1 + j] = v[i][j]; } return rng; },
        clearContent() { for (let i = 0; i < nr; i++) { const row = self.rows[r - 1 + i]; if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = ''; } return rng; },
        setFontWeight() { return rng; }, setBackground() { return rng; }, setFontColor() { return rng; }, setNumberFormat() { return rng; },
      };
      return rng;
    },
  };
  return sh;
}

function createGas(opts) {
  opts = opts || {};
  const sheets = {};
  const props = Object.assign({}, opts.props || {});
  const cache = {};
  const fetchLog = [];
  const ss = {
    getSheetByName(n) { return sheets[n] || null; },
    insertSheet(n) { sheets[n] = makeSheet(n); return sheets[n]; },
  };
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: k => { delete cache[k]; }, getAll: ks => { const o = {}; ks.forEach(k => { if (k in cache) o[k] = cache[k]; }); return o; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ text: s, setMimeType() { return this; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, s) => toSigned(crypto.createHash('sha256').update(String(s), 'utf8').digest()),
      computeHmacSha256Signature: (t, k) => toSigned(crypto.createHmac('sha256', String(k)).update(String(t), 'utf8').digest()),
      base64EncodeWebSafe: x => toBuf(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => toSigned(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      base64Decode: s => toSigned(Buffer.from(String(s), 'base64')),
      newBlob: (bytes) => ({ getDataAsString: () => toBuf(bytes).toString('utf8') }),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => {
        const k = new Date(d.getTime() + 9 * 3600 * 1000), p = n => String(n).padStart(2, '0');
        return fmt.replace('yyyy', k.getUTCFullYear()).replace('MM', p(k.getUTCMonth() + 1)).replace('dd', p(k.getUTCDate())).replace('HH', p(k.getUTCHours())).replace('mm', p(k.getUTCMinutes())).replace('ss', p(k.getUTCSeconds()));
      },
    },
    UrlFetchApp: {
      fetch: (url, o) => {
        const body = JSON.parse(o.payload);
        fetchLog.push({ url, headers: o.headers, body });
        const r = opts.onFetch ? opts.onFetch(body) : { code: 500, json: {} };
        return { getResponseCode: () => r.code, getContentText: () => JSON.stringify(r.json) };
      },
    },
    DriveApp: {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'apps-script');
  ['Code.gs', 'V2.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  function call(action, payload, token) {
    const out = ctx.doPost({ postData: { contents: JSON.stringify({ action, payload: payload || {}, token }) } });
    return JSON.parse(out.text);
  }
  return { ctx, call, sheets, props, cache, fetchLog };
}

module.exports = { createGas };
