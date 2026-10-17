const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const status = {};
  const box = { style: {}, querySelector: selector => selector.includes('status') ? status : { addEventListener() {} } };
  const window = { setInterval() {}, clearInterval() {} };
  window.top = window;
  const context = {
    window,
    document: { createElement: () => box, documentElement: { appendChild() {} }, addEventListener() {} },
    location: { pathname: '/mycourse/studentstudy', search: '?courseId=1' },
    sessionStorage: { getItem: () => 'tab', setItem() {} },
    URLSearchParams,
    chrome: { storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } } },
  };
  const source = fs.readFileSync(path.join(__dirname, '../extension/course.js'), 'utf8')
    .replace(/\n\}\)\(\);\s*$/, '\n globalThis.test = { handleDocument, current: () => currentTask };\n})();');
  vm.runInNewContext(source, context);
  await Promise.resolve();
  let finished = false;
  let scrolls = 0;
  const viewport = {
    clientHeight: 600, scrollHeight: 3000, scrollTop: 0,
    scrollTo({ top }) { this.scrollTop = top; scrolls++; },
  };
  const hidden = { clientHeight: 0, scrollHeight: 9999 };
  const reader = {
    defaultView: { getComputedStyle: () => ({ overflowY: 'auto' }) },
    querySelectorAll: selector => selector === '*' ? [viewport, hidden] : [],
  };
  const wrapper = { querySelectorAll: selector => selector === 'iframe' ? [{ contentDocument: reader }] : [] };
  const frame = { contentDocument: wrapper };
  const container = { classList: { contains: () => finished }, querySelector: () => null };
  await context.test.handleDocument(container, frame, 'pdf');
  assert.equal(viewport.scrollTop, 2400, '应滚动嵌套阅读区域，而非顶层课程页');
  await context.test.handleDocument(container, frame, 'pdf');
  assert.equal(scrolls, 1, '已到底部时不重复滚动');
  viewport.scrollHeight = 4200;
  await context.test.handleDocument(container, frame, 'pdf');
  assert.equal(viewport.scrollTop, 3600, '应继续滚动延迟加载新增的页面');
  assert.equal(context.test.current(), 'pdf', '滚动到底不能当作平台已确认完成');
  finished = true;
  await context.test.handleDocument(container, frame, 'pdf');
  assert.equal(context.test.current(), '', '平台确认完成后应释放当前任务，允许继续');
  assert.equal(scrolls, 2, '完成后不再滚动');
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
