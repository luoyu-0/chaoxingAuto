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
    .replace(/\n\}\)\(\);\s*$/, '\n globalThis.test = { taskFinished, handleDocument, current: () => currentTask };\n})();');
  vm.runInNewContext(source, context);
  await Promise.resolve();
  const completedParent = { classList: { contains: name => name === 'ans-job-finished' } };
  const nested = { classList: { contains: () => false }, querySelector: s => s === 'iframe[jobid]' ? { parentElement: completedParent } : null };
  assert.equal(context.test.taskFinished(nested), true, '应识别当前课件直接父节点的完成标记');
  const textMarker = { getAttribute: () => '任务点未完成', textContent: ' 任务点已完成 ', parentElement: { classList: { contains: () => false } } };
  const textContainer = { classList: { contains: () => false }, querySelector: s => s === '.ans-job-icon' ? textMarker : null };
  assert.equal(context.test.taskFinished(textContainer), true, '完成文字应兼容未同步的 aria-label');
  textMarker.textContent = '任务点';
  assert.equal(context.test.taskFinished(textContainer), false, '未完成任务不能因文档到底就放行');
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
