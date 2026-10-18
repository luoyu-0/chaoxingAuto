const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../extension/model-api.js');
function setup() {
  const stores = { local: {}, session: {} }, levels = [];
  const area = name => ({
    setAccessLevel: async v => levels.push([name, v.accessLevel]),
    get: async key => ({ [key]: stores[name][key] }),
    set: async data => Object.assign(stores[name], data), remove: async key => { delete stores[name][key]; },
  });
  let listener, requests = 0;
  const chrome = { storage: { local: area('local'), session: area('session') },
    runtime: { id: 'extension', getURL: p => 'chrome-extension://extension/' + p, openOptionsPage: async () => {}, onMessage: { addListener: fn => { listener = fn; } } },
    permissions: { contains: async () => true }, tabs: { onRemoved: { addListener() {} } },
  };
  const context = { chrome, URL, AbortController, setTimeout, clearTimeout, importScripts() {}, CourseModel: { ...api, request: async () => { requests++; return []; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), context);
  const settings = { id: 'extension', url: 'chrome-extension://extension/options.html' };
  const course = { id: 'extension', tab: { id: 12 }, frameId: 0, url: 'https://mooc1.chaoxing.com/mycourse/studentstudy' };
  const send = (type, data = {}, sender = settings) => new Promise(resolve => listener({ type, ...data }, sender, resolve));
  return { send, stores, levels, course, requests: () => requests };
}
test('默认会话密钥不落盘，课程页无法取得密钥或修改 API 配置', async () => {
  const f = setup();
  const result = await f.send('saveConfig', { config: { baseUrl: 'https://api.deepseek.com', model: 'model', mode: 'auto', skipTests: false }, key: 'private-key', rememberKey: false });
  assert.equal(result.ok, true);
  assert.equal(f.stores.local.modelSecret, undefined);
  assert.equal(f.stores.session.modelSecret.key, 'private-key');
  const publicData = await f.send('getConfig', {}, f.course);
  assert.deepEqual(JSON.parse(JSON.stringify(publicData.data)), { mode: 'auto', skipTests: false });
  assert.equal((await f.send('saveConfig', {}, f.course)).ok, false);
  assert.equal(f.levels.length, 2);
  assert.equal(f.levels.every(x => x[1] === 'TRUSTED_CONTEXTS'), true);
});
test('持久化密钥绑定服务地址，换域名不沿用旧密钥', async () => {
  const f = setup();
  const config = { baseUrl: 'https://api.deepseek.com', model: 'x', mode: 'pause', skipTests: true };
  await f.send('saveConfig', { config, key: 'private-key', rememberKey: true });
  assert.equal(f.stores.local.modelSecret.key, 'private-key');
  await f.send('saveConfig', { config: { ...config, baseUrl: 'https://other.test/v1' }, rememberKey: true });
  assert.equal(f.stores.local.modelSecret, undefined);
  assert.equal(f.stores.session.modelSecret, undefined);
});
test('未启动助手或第三方网页不能发起付费模型调用', async () => {
  const f = setup();
  await f.send('saveConfig', { config: { baseUrl: 'https://api.deepseek.com', model: 'x', mode: 'auto', skipTests: false }, key: 'private-key' });
  assert.equal((await f.send('solveQuestions', { questions: [] }, f.course)).ok, false);
  assert.equal((await f.send('getConfig', {}, { ...f.course, url: 'https://other.test' })).ok, false);
  assert.equal(f.requests(), 0);
});

test('日志持久保存、并发不丢失、容量有限且只允许设置页读取清理', async () => {
  const f = setup();
  await Promise.all(Array.from({ length: 505 }, (_, i) => f.send('recordPause', { reason: `暂停 ${i} https://example.test/?token=private sk-test-secret` }, f.course)));
  const result = await f.send('getLogs');
  assert.equal(result.data.logs.length, 500);
  assert.equal(f.stores.local.diagnosticLogs.length, 500);
  assert.match(result.data.logs[0].reason, /暂停 5 /);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('sk-test-secret'), false);
  assert.equal((await f.send('getLogs', {}, f.course)).ok, false);
  assert.equal((await f.send('clearLogs', {}, f.course)).ok, false);
  await f.send('clearLogs');
  assert.equal((await f.send('getLogs')).data.logs.length, 0);
});
