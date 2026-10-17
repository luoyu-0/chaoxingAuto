const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  let exitHandler;
  let clickHandler;
  let risk = false;
  const status = {};
  const toggle = { addEventListener(_type, callback) { clickHandler = callback; } };
  const box = { style: {}, querySelector: selector => selector.includes('status') ? status : toggle };
  const video = { paused: false, ended: false, pause() { this.paused = true; } };
  const doc = {
    title: '',
    get body() { return risk ? { innerText: '风险验证' } : null; },
    createElement: () => box,
    documentElement: { appendChild() {} },
    querySelector: () => null,
    querySelectorAll: selector => selector === 'video' ? [video] : [],
    addEventListener(type, handler) { if (type === 'mouseout') exitHandler = handler; },
  };
  const browserWindow = { setInterval() { return 1; }, clearInterval() {} };
  browserWindow.top = browserWindow;
  const context = {
    window: browserWindow, document: doc,
    location: { pathname: '/mycourse/studentstudy', search: '?courseId=1' },
    sessionStorage: { getItem: () => 'test-tab', setItem() {} },
    crypto: { randomUUID: () => 'test-tab' },
    URLSearchParams,
    chrome: {
      runtime: { id: 'test-extension' },
      storage: {
        local: { get: async () => ({ courseAssistantRunning: { courseId: '1', tabId: 'test-tab' } }), set: async () => {} },
        onChanged: { addListener() {} },
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'course.js'), 'utf8'), context);
  await new Promise(resolve => setTimeout(resolve, 0));
  function blocked(relatedTarget = null) {
    let stopped = false;
    exitHandler({ relatedTarget, stopPropagation() { stopped = true; } });
    return stopped;
  }
  assert.equal(blocked(), true, '运行且播放时应拦截离开页面事件');
  assert.equal(blocked({}), false, '页面内部的鼠标移动应正常传播');
  video.paused = true;
  assert.equal(blocked(), false, '视频已经暂停时不能拦截或强制续播');
  video.paused = false;
  risk = true;
  assert.equal(blocked(), false, '验证提示出现时不能干预页面事件');
  risk = false;
  await clickHandler();
  video.paused = false;
  assert.equal(blocked(), false, '手动停止助手后必须恢复事件传播');
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
