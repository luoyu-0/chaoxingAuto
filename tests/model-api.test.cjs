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

test('校验失败保留具体原因，且日志不包含模型原文', async () => {
  const events = [];
  await assert.rejects(api.request({ baseUrl: 'https://api.deepseek.com', model: 'x' }, 'secret', qs, {
    fetcher: async () => result({ answers: [] }), onEvent: event => events.push(event),
  }), /答案题数不符/);
  assert.equal(events.filter(e => e.event === 'validation_failed').length, 2);
});
test('兼容完整 JSON 代码围栏，但仍拒绝非法选项', () => {
  assert.deepEqual(api.answers('```json\n' + JSON.stringify(good) + '\n```', qs), good.answers);
});

test('输出截断时明确提示，不将不完整答案视为成功', async () => {
  await assert.rejects(api.request({ baseUrl: 'https://api.deepseek.com', model: 'x' }, 'secret', qs, {
    fetcher: async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(good) } }] }) }),
  }), /token 上限被截断/);
});

test('DeepSeek 空正文截断后关闭思考重试，恢复完整答案', async () => {
  const bodies = [];
  const actual = await api.request({ baseUrl: 'https://api.deepseek.com', model: 'user-model' }, 'secret', qs, {
    fetcher: async (_, init) => {
      const body = JSON.parse(init.body); bodies.push(body);
      if (body.thinking?.type === 'disabled') return result(good);
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'private reasoning' } }], usage: { completion_tokens: 8192 } }) };
    },
  });
  assert.deepEqual(actual, good.answers);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].model, 'user-model');
});
test('自定义接口截断不发送 DeepSeek 专有参数，也不原样重试', async () => {
  let count = 0;
  await assert.rejects(api.request({ baseUrl: 'https://other.test', model: 'x' }, 'secret', qs, {
    fetcher: async (_, init) => {
      count++; assert.equal(JSON.parse(init.body).thinking, undefined);
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '' } }] }) };
    },
  }), /token 上限被截断/);
  assert.equal(count, 1);
});
