const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function runScenario(stage) {
  const errors = [];
  const onError = error => errors.push(error.message);
  process.on('unhandledRejection', onError);

  const status = { textContent: '' };
  const toggle = { textContent: '', addEventListener(_name, handler) { this.click = handler; } };
  const box = {
    style: {},
    querySelector(selector) {
      return selector === '#course-assistant-status' ? status : toggle;
    },
  };
  const session = new Map();
  const browserWindow = { setInterval() { return 1; }, clearInterval() {} };
  browserWindow.top = browserWindow;
  const context = {
    window: browserWindow,
    location: { pathname: '/mycourse/studentstudy', search: '?courseId=1' },
    document: { createElement() { return box; }, documentElement: { appendChild() {} }, querySelectorAll() { return []; }, addEventListener() {} },
    sessionStorage: {
      getItem(key) { return session.get(key) ?? null; },
      setItem(key, value) { session.set(key, value); },
    },
    crypto: { randomUUID() { return 'test-tab'; } },
    chrome: {
      runtime: { id: 'test-extension' },
      storage: {
        local: {
          get: async () => {
            if (stage === '初始化') throw new Error('Extension context invalidated.');
            return {};
          },
          set: async () => { throw new Error('Extension context invalidated.'); },
        },
        onChanged: { addListener() {} },
      },
    },
    URLSearchParams,
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'course.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'course.js' });
  if (stage === '开始按钮') {
    await new Promise(resolve => setTimeout(resolve, 0));
    await toggle.click();
  }
  await new Promise(resolve => setTimeout(resolve, 20));
  process.off('unhandledRejection', onError);
  assert.deepEqual(errors, [], `${stage}产生未处理异常：${errors.join('; ')}`);
  assert.match(status.textContent, /刷新/);
}

async function main() {
  await runScenario('初始化');
  await runScenario('开始按钮');
  const errors = [];
  const onError = error => errors.push(error.message);
  process.on('unhandledRejection', onError);
  const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'guard.js'), 'utf8');
  const browserWindow = {};
  browserWindow.top = browserWindow;
  for (const set of [
    () => { throw new Error('Extension context invalidated.'); },
    async () => { throw new Error('Extension context invalidated.'); },
  ]) {
    vm.runInNewContext(source, {
      window: browserWindow,
      location: { hostname: 'mooc2-ans.chaoxing.com', pathname: '/' },
      chrome: { storage: { local: { set } } },
    }, { filename: 'guard.js' });
  }
  await new Promise(resolve => setTimeout(resolve, 20));
  process.off('unhandledRejection', onError);
  assert.deepEqual(errors, [], `辅助脚本产生未处理异常：${errors.join('; ')}`);
}

main().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
