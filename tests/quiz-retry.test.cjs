const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  let now = 1000;
  let submissions = 0;
  const timerDelays = [];
  const status = { textContent: '' };
  const toggle = { textContent: '', addEventListener() {} };
  const box = { style: {}, querySelector: selector => selector.includes('status') ? status : toggle };
  const session = new Map();
  const browserWindow = { setInterval() { return 1; }, clearInterval() {}, setTimeout(_callback, delay) { timerDelays.push(delay); } };
  browserWindow.top = browserWindow;
  const fakeDocument = {
    defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
    createElement: () => box,
    documentElement: { appendChild() {} },
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const context = {
    window: browserWindow,
    document: fakeDocument,
    location: { pathname: '/mycourse/studentstudy', search: '?courseId=1' },
    sessionStorage: {
      getItem: key => session.get(key) ?? null,
      setItem: (key, value) => session.set(key, value),
    },
    crypto: { randomUUID: () => 'test-tab' },
    chrome: {
      runtime: { id: 'test-extension' },
      storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
    },
    URLSearchParams,
    Date: { now: () => now },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'course.js'), 'utf8')
    .replace(/\n\}\)\(\);\s*$/, '\n  globalThis.__quizTest = { handleQuiz };\n})();');
  vm.runInNewContext(source, context, { filename: 'course.js' });
  await new Promise(resolve => setTimeout(resolve, 0));

  const shown = extra => ({
    ownerDocument: fakeDocument,
    getClientRects: () => [{}],
    ...extra,
  });
  const options = ['A', 'B'].map(letter => {
    const input = { checked: false };
    const label = { click() { input.checked = !input.checked; } };
    return {
      textContent: letter,
      querySelector: selector => selector === 'label' ? label : input,
    };
  });
  const submit = shown({ click() { submissions++; } });
  const quiz = {
    querySelector(selector) {
      if (selector === '.tkTopic_title') return { textContent: '多选题' };
      if (selector === '#videoquiz-submit') return submit;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.tkItem') return [{}];
      if (selector === '.ans-videoquiz-opt') return options;
      return [];
    },
  };
  const frame = { getAttribute: () => 'job-1' };
  const video = { paused: true, currentTime: 30 };
  const answer = () => context.__quizTest.handleQuiz(quiz, frame, video);

  await answer();
  assert.equal(submissions, 1);
  assert.equal(timerDelays.at(-1), 500, '提交后应在 0.5 秒检查，而非等待常规定时轮询');
  now = 1499;
  await answer();
  assert.equal(submissions, 1, '未到 0.5 秒不能重试');
  now = 1500;
  await answer();
  assert.equal(submissions, 2, '视频未恢复且间隔已到，应提交下一组');
  now = 2000;
  await answer();
  assert.equal(submissions, 3);
  now = 2500;
  await answer();
  assert.match(status.textContent, /手动/);
}

main().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
