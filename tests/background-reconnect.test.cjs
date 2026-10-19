const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function fixture() {
  let handler = async () => ({ ok: true, data: null });
  let wakeHandler, visibilityHandler;
  const control = { addEventListener() {} };
  const box = { style: {}, querySelector: () => control };
  const window = { setInterval() {}, setTimeout(fn) { fn(); } }; window.top = window;
  const context = {
    window, document: { visibilityState: 'hidden', createElement: () => box, documentElement: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [],
      addEventListener(type, fn) { if (type === 'visibilitychange') visibilityHandler = fn; } },
    location: { pathname: '/mycourse/studentstudy', search: '?courseId=1' },
    sessionStorage: { getItem: () => 'tab', setItem() {} }, URLSearchParams,
    chrome: { runtime: { id: 'test', sendMessage: message => handler(message), onMessage: { addListener: fn => { wakeHandler = fn; } } }, storage: { onChanged: { addListener() {} } } },
  };
  const source = fs.readFileSync(path.join(__dirname, '../extension/course.js'), 'utf8')
    .replace(/\n\}\)\(\);\s*$/, '\n globalThis.test = { send, start: () => { running = true; } };\n})();');
  vm.runInNewContext(source, context); await new Promise(resolve => setImmediate(resolve));
  return { send: context.test.send, start: context.test.start, wake: (message, sender = { id: 'test' }) => wakeHandler?.(message, sender),
    visible: () => { context.document.visibilityState = 'visible'; visibilityHandler?.(); }, setHandler: fn => { handler = fn; } };
}

test('后台唤醒仅驱动当前运行标签页，返回可见时立即检查', async () => {
  const f = await fixture(); let reads = 0;
  f.setHandler(async message => {
    if (message.type === 'getOwner') { reads++; return { ok: true, data: { courseId: '1', tabId: 'tab' } }; }
    if (message.type === 'getConfig') return { ok: true, data: { mode: 'pause', skipTests: true } };
    return { ok: true, data: null };
  });
  f.start();
  f.wake({ type: 'wakeCourse', tabId: 'other' });
  f.wake({ type: 'wakeCourse', tabId: 'tab' }, { id: 'other-extension' });
  assert.equal(reads, 0);
  f.wake({ type: 'wakeCourse', tabId: 'tab' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
  f.visible();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 2);
});
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
