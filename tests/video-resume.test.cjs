const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function fixture() {
  let plays = 0, popup = false, now = 1000;
  const listeners = {}, status = {}, control = { addEventListener() {} };
  const box = { style: {}, querySelector: s => s.includes('status') ? status : control };
  const video = { paused: false, ended: false, currentTime: 10, duration: 1000, playbackRate: 1,
    play: async () => { plays++; video.paused = false; }, pause: () => { video.paused = true; } };
  const doc = { title: '', body: null, visibilityState: 'hidden', hasFocus: () => false,
    createElement: () => box, documentElement: { appendChild() {} }, addEventListener() {}, querySelector: () => null,
    defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
    querySelectorAll: s => popup && s.includes('.vjs-modal-dialog') ? [{ ownerDocument: doc, getClientRects: () => [1] }] : [],
  };
  const playerDoc = { querySelector: s => s === 'video' ? video : null, querySelectorAll: () => [], addEventListener: (type, fn) => { listeners[type] = fn; } };
  const frame = { contentDocument: playerDoc, scrollIntoView() {} };
  const window = { setInterval() {}, setTimeout, clearTimeout }; window.top = window;
  const context = { Date: class extends Date { static now() { return now; } }, window, document: doc, location: { pathname: '/mycourse/studentstudy', search: '?courseId=1' },
    sessionStorage: { getItem: () => 'tab', setItem() {} }, URLSearchParams,
    chrome: { runtime: { id: 'test' }, storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } } },
  };
  const source = fs.readFileSync(path.join(__dirname, '../extension/course.js'), 'utf8')
    .replace(/\n\}\)\(\);\s*$/, '\n globalThis.test = { handleVideo, start: () => { running = true; }, running: () => running };\n})();');
  vm.runInNewContext(source, context); await new Promise(resolve => setImmediate(resolve));
  context.test.start();
  const step = () => context.test.handleVideo({}, frame, 'video');
  await step();
  return { advance: ms => { now += ms; }, step, video, doc, status, listeners, running: context.test.running, plays: () => plays, popup: () => { popup = true; } };
}
test('后台意外暂停会正常续播，但每个视频最多恢复两次', async () => {
  const f = await fixture();
  for (let i = 0; i < 2; i++) {
    f.video.paused = true; await f.step();
    assert.equal(f.running(), true); assert.equal(f.video.paused, false);
  }
  f.video.paused = true; await f.step();
  assert.equal(f.plays(), 2); assert.equal(f.running(), false);
});
test('用户手动暂停不能被自动续播覆盖', async () => {
  const f = await fixture();
  f.listeners.pointerdown({ isTrusted: true, target: { closest: s => s.startsWith('video') ? {} : null } });
  f.video.paused = true; await f.step();
  assert.equal(f.plays(), 0); assert.equal(f.running(), false);
});
test('前台暂停、弹窗和媒体错误不强制续播', async () => {
  for (const scenario of ['foreground', 'popup', 'error']) {
    const f = await fixture();
    if (scenario === 'foreground') { f.doc.visibilityState = 'visible'; f.doc.hasFocus = () => true; }
    if (scenario === 'popup') f.popup();
    if (scenario === 'error') f.video.error = { code: 2 };
    f.video.paused = true; await f.step();
    assert.equal(f.plays(), 0); assert.equal(f.running(), false);
  }
});
test('浏览器拒绝续播时暂停，不无限重试', async () => {
  const f = await fixture(); let rejected = 0;
  f.video.play = async () => { rejected++; throw new Error('NotAllowedError'); };
  f.video.paused = true; await f.step();
  assert.equal(rejected, 1); assert.equal(f.running(), false);
});


test('播放中停滞先尝试一次原速续播，仍无进度才停止', async () => {
  const f = await fixture();
  f.video.playbackRate = 2;
  f.advance(91000); await f.step();
  assert.equal(f.running(), true);
  assert.equal(f.plays(), 1);
  assert.equal(f.video.currentTime, 10);
  assert.equal(f.video.playbackRate, 1);
  f.advance(91000); await f.step();
  assert.equal(f.running(), false);
  assert.equal(f.plays(), 1);
});
test('停滞遇到弹窗或媒体错误不执行恢复', async () => {
  for (const scenario of ['popup', 'error']) {
    const f = await fixture();
    if (scenario === 'popup') f.popup();
    else f.video.error = { code: 2 };
    f.advance(91000); await f.step();
    assert.equal(f.plays(), 0);
    assert.equal(f.running(), false);
  }
});

test('停滞恢复后进度增长可继续运行', async () => {
  const f = await fixture();
  f.advance(91000); await f.step();
  f.video.currentTime = 15; f.advance(3000); await f.step();
  assert.equal(f.running(), true);
  assert.match(f.status.textContent, /正在以 1.0 倍速/);
});
test('停滞续播被拒绝时停止', async () => {
  const f = await fixture();
  f.video.play = async () => { throw new Error('NotAllowedError'); };
  f.advance(91000); await f.step();
  assert.equal(f.running(), false);
  assert.match(f.status.textContent, /续播失败/);
});
