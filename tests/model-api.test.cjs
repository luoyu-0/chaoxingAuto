const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../extension/model-api.js');
const qs = [{ id: 'q1', type: 'single_choice', stem: '题目', options: [{ id: 'o1', text: '一' }, { id: 'o2', text: '二' }] }];
const good = { answers: [{ question_id: 'q1', selected_option_ids: ['o2'] }] };
const result = value => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }) });
test('规范化官方、自定义地址，拒绝明文远程凭据', () => {
  assert.equal(api.endpoint('https://api.deepseek.com/'), 'https://api.deepseek.com/chat/completions');
  assert.equal(api.endpoint('https://example.test/v1/chat/completions'), 'https://example.test/v1/chat/completions');
  assert.throws(() => api.endpoint('http://example.test'));
  assert.throws(() => api.endpoint('https://key@example.test'));
  assert.throws(() => api.endpoint('https://example.test?key=secret'));
});
test('仅保留题目数据，不包含调用方附加的课程凭据', () => {
  const cleaned = api.questions(qs.map(q => ({ ...q, cookie: 'private', url: 'private' })));
  assert.deepEqual(cleaned, qs);
});
test('拒绝缺题、重复、非法选项和多选的单选答案', () => {
  assert.deepEqual(api.answers(good, qs), good.answers);
  assert.throws(() => api.answers({ answers: [] }, qs));
  assert.throws(() => api.answers({ answers: [good.answers[0], good.answers[0]] }, qs));
  assert.throws(() => api.answers({ answers: [{ question_id: 'q1', selected_option_ids: ['o3'] }] }, qs));
  assert.throws(() => api.answers({ answers: [{ question_id: 'q1', selected_option_ids: ['o1', 'o2'] }] }, qs));
});
test('官方 JSON 请求只返回结构化答案，并修复一次格式错误', async () => {
  let calls = 0;
  const actual = await api.request({ baseUrl: 'https://api.deepseek.com', model: 'custom-model' }, 'test-secret', qs, {
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      assert.equal(init.redirect, 'error');
      assert.equal(init.credentials, 'omit');
      assert.equal(JSON.parse(init.body).response_format.type, 'json_object');
      return result(calls === 1 ? { answers: [] } : good);
    },
  });
  assert.deepEqual(actual, good.answers); assert.equal(calls, 2);
});
test('认证错误不重试、不泄露服务端错误体或密钥', async () => {
  let calls = 0;
  await assert.rejects(api.request({ baseUrl: 'https://api.deepseek.com', model: 'x' }, 'secret', qs, {
    fetcher: async () => { calls++; return { ok: false, status: 401 }; },
  }), /API Key 无效/);
  assert.equal(calls, 1);
});
test('限流退避后可恢复，已取消的请求不发出', async () => {
  const waits = []; let calls = 0;
  await api.request({ baseUrl: 'https://api.deepseek.com', model: 'x' }, 'secret', qs, {
    fetcher: async () => ++calls < 3 ? { ok: false, status: 429 } : result(good), wait: async ms => waits.push(ms),
  });
  assert.deepEqual(waits, [1000, 2000]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.request({ baseUrl: 'https://api.deepseek.com', model: 'x' }, 'secret', qs, { signal: controller.signal, fetcher: async () => assert.fail('不能发送') }));
});
