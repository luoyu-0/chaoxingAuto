const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../extension/model-api.js');
const chapter = require('../extension/chapter-test.js');
function fixture() {
  let submitted = 0, confirmed = 0, chosen = '', modal = false, enabled = true;
  const saved = new Map(), statuses = [], errors = [];
  const doc = { defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) }, querySelectorAll: () => [submit] };
  const submit = { ownerDocument: doc, getClientRects: () => [1], innerText: '提交', closest: () => null, click() { submitted++; modal = true; } };
  const confirm = { ...submit, click() { confirmed++; modal = false; } };
  const dialog = { ...submit, querySelector: s => s === '#popcontent' ? { innerText: '确认提交？' } : confirm };
  const topDoc = { querySelector: () => modal ? dialog : null };
  const answerInput = { value: '' };
  const options = ['A', 'B'].map((value, i) => ({ id: `o${i + 1}`, text: value, value,
    node: { getAttribute: () => chosen === value ? 'true' : 'false', querySelector: () => null, click() { chosen = value; answerInput.value = value; } },
  }));
  const item = { id: 'q1', type: 'single_choice', stem: '题目', options, answerInput };
  const questions = CourseModel.questions([item]);
  let snapshot = { doc, items: [item], questions };
  const result = { answers: [{ question_id: 'q1', selected_option_ids: ['o2'] }] };
  let calls = 0;
  const deps = { show: s => statuses.push(s), pause: e => errors.push(e), allowed: () => enabled, allDocs: () => [topDoc],
    storage: { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) },
    read: () => snapshot, hashQuestions: async q => JSON.stringify(q),
    send: async type => { if (type === 'solveQuestions') { calls++; return result; } return {}; },
  };
  return { deps, saved, errors, statuses, item, result, snapshot,
    counts: () => ({ submitted, confirmed, calls }), select: value => { chosen = value; answerInput.value = value; },
    disable: () => { enabled = false; }, replace: () => { snapshot = { ...snapshot, doc: {} }; },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('手动模式填写后必须等待确认；确认后只交卷一次', async () => {
  const f = fixture(), engine = chapter.create(f.deps);
  await engine.step({}, 'test', 'manual', false); await flush();
  await engine.step({}, 'test', 'manual', false);
  await engine.step({}, 'test', 'manual', false);
  assert.equal(engine.waiting(), true);
  assert.equal(f.counts().submitted, 0);
  engine.approve();
  await engine.step({}, 'test', 'manual', false);
  await engine.step({}, 'test', 'manual', false);
  await engine.step({}, 'test', 'manual', false);
  assert.deepEqual(f.counts(), { submitted: 1, confirmed: 1, calls: 1 });
  assert.equal(await engine.step({}, 'test', 'manual', true), 'done');
});
test('自动模式填写、校验、确认提交，并阻止刷新后重复提交', async () => {
  const f = fixture(), engine = chapter.create(f.deps);
  await engine.step({}, 'test', 'auto', false); await flush();
  await engine.step({}, 'test', 'auto', false);
  await engine.step({}, 'test', 'auto', false);
  await engine.step({}, 'test', 'auto', false);
  assert.equal(f.counts().confirmed, 1);
  const resumed = chapter.create(f.deps);
  await assert.rejects(resumed.step({}, 'test', 'auto', false), /不会重复提交/);
  assert.equal(f.counts().submitted, 1);
});
test('已有不同作答不得覆盖；同答案可以继续校验', async () => {
  const f = fixture(), engine = chapter.create(f.deps);
  f.select('A');
  await engine.step({}, 'test', 'auto', false); await flush();
  await assert.rejects(engine.step({}, 'test', 'auto', false), /已有作答/);
  assert.equal(f.item.answerInput.value, 'A');
  f.select('B');
  await engine.step({}, 'test', 'auto', false);
  assert.equal(f.counts().submitted, 1);
});
test('请求期间暂停，迟到答案不能写入缓存或填写', async () => {
  const f = fixture(); let deliver;
  f.deps.send = type => type === 'solveQuestions' ? new Promise(resolve => { deliver = resolve; }) : Promise.resolve({});
  const engine = chapter.create(f.deps);
  await engine.step({}, 'test', 'auto', false);
  f.disable(); engine.cancel(); deliver(f.result); await flush();
  assert.equal(JSON.parse([...f.saved.values()][0]).answers.length, 0);
  assert.equal(f.item.answerInput.value, '');
  assert.equal(f.counts().submitted, 0);
});
test('等待模型期间更换文档，丢弃旧页面答案', async () => {
  const f = fixture(); let deliver;
  f.deps.send = () => new Promise(resolve => { deliver = resolve; });
  const engine = chapter.create(f.deps);
  await engine.step({}, 'test', 'auto', false);
  f.replace(); deliver(f.result); await flush();
  assert.match(f.errors[0], /测验页面已变化/);
  assert.equal(JSON.parse([...f.saved.values()][0]).answers.length, 0);
});
test('交卷确认出现后若答案变化，不能确认提交', async () => {
  const f = fixture(), engine = chapter.create(f.deps);
  await engine.step({}, 'test', 'auto', false); await flush();
  await engine.step({}, 'test', 'auto', false);
  await engine.step({}, 'test', 'auto', false);
  f.select('A');
  await assert.rejects(engine.step({}, 'test', 'auto', false), /答案.*变化|答案.*校验/);
  assert.equal(f.counts().confirmed, 0);
});
