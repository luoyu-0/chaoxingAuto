const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

(async () => {
  let confirmed = 0;
  let opened = false;
  const controls = new Map();
  const box = { style: {}, querySelector(s) {
    if (!controls.has(s)) controls.set(s, { addEventListener() {} });
    return controls.get(s);
  } };
  const doc = {
    createElement: () => box, documentElement: { appendChild() {} }, addEventListener() {},
    defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
    querySelector: s => s === '#prevNextFocusNext' ? next : null,
    querySelectorAll: () => opened ? [confirm] : [],
  };
  const next = { ownerDocument: doc, getClientRects: () => [1], getAttribute: () => null, click() { opened = true; } };
  const dialog = { innerText: '提示 当前章节还有任务点未完成，是否去完成？ 去学习 下一节', parentElement: null };
  const confirm = { ...next, innerText: '下一节', parentElement: dialog, click() { confirmed++; } };
  const window = { setInterval() {} }; window.top = window;
  const context = { window, document: doc, location: { pathname: '/mycourse/studentstudy', href: 'https://example.test/study', search: '' },
    URLSearchParams, sessionStorage: { getItem: () => 'tab', setItem() {} },
    chrome: { storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } } } };
  const source = fs.readFileSync(path.join(__dirname, '../extension/course.js'), 'utf8')
    .replace(/\n\}\)\(\);\s*$/, '\n globalThis.test = { advance };\n})();');
  vm.runInNewContext(source, context);
  await Promise.resolve();
  await context.test.advance(true);
  await context.test.advance(true);
  assert.equal(confirmed, 1, '跳过测验后应确认弹窗中的下一节');
  await context.test.advance(true);
  assert.equal(confirmed, 1, '同一弹窗不重复确认');
})().catch(error => { console.error(error); process.exitCode = 1; });
