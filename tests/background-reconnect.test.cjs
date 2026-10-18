const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function fixture() {
  let handler = async () => ({ ok: true, data: null });
  const control = { addEventListener() {} };
  const box = { style: {}, querySelector: () => control };
  const window = { setInterval() {}, setTimeout(fn) { fn(); } }; window.top = window;
  const context = {
    window, document: { createElement: () => box, documentElement: { appendChild() {} }, addEventListener() {} },
    location: { pathname: '/mycourse/studentstudy', search: '?courseId=1' },
    sessionStorage: { getItem: () => 'tab', setItem() {} }, URLSearchParams,
    chrome: { runtime: { id: 'test', sendMessage: message => handler(message) }, storage: { onChanged: { addListener() {} } } },
  };
  const source = fs.readFileSync(path.join(__dirname, '../extension/course.js'), 'utf8')
    .replace(/\n\}\)\(\);\s*$/, '\n globalThis.test = { send };\n})();');
  vm.runInNewContext(source, context); await new Promise(resolve => setImmediate(resolve));
  return { send: context.test.send, setHandler: fn => { handler = fn; } };
}
test('后台读取遇到一次通道中断后能恢复，不直接暂停课程', async () => {
  const f = await fixture(); let calls = 0;
  f.setHandler(async () => {
    if (++calls === 1) throw new Error('The message port closed before a response was received.');
    return { ok: true, data: { mode: 'auto', skipTests: false } };
  });
  const result = await f.send('getConfig');
  assert.equal(result.mode, 'auto'); assert.equal(calls, 2);
});
test('后台持续不可用时重试有上限', async () => {
  const f = await fixture(); let calls = 0;
  f.setHandler(async () => { calls++; throw new Error('Could not establish connection. Receiving end does not exist.'); });
  await assert.rejects(f.send('getOwner'), /connection/);
  assert.equal(calls, 3);
});
test('不重试模型、写操作、业务错误或失效扩展上下文', async () => {
  for (const [type, error] of [['solveQuestions', 'The message port closed'], ['setOwner', 'The message port closed'], ['getConfig', 'Extension context invalidated.'], ['getConfig', 'API Key 无效']]) {
    const f = await fixture(); let calls = 0;
    f.setHandler(async () => { calls++; throw new Error(error); });
    await assert.rejects(f.send(type)); assert.equal(calls, 1);
  }
});
