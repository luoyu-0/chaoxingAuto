/* 密钥与网络请求仅在扩展后台处理。 */
importScripts('model-api.js');
const CONFIG = 'modelConfig';
const SECRET = 'modelSecret';
const active = new Map();
const LOG_KEY = 'diagnosticLogs';
let logQueue = Promise.resolve();
function logOperation(operation) {
  const result = logQueue.then(operation);
  logQueue = result.catch(() => {});
  return result;
}
function cleanLogText(value) {
  return String(value || '').replace(/https?:\/\/\S+/gi, '[地址已隐藏]').replace(/\b(?:sk-[\w-]+|Bearer\s+\S+)/gi, '[密钥已隐藏]').slice(0, 400);
}
function appendLog(entry) {
  return logOperation(async () => {
    const stored = (await chrome.storage.local.get(LOG_KEY))[LOG_KEY];
    const logs = Array.isArray(stored) ? stored : [];
    const safe = { time: new Date().toISOString(), event: cleanLogText(entry.event), version: '0.4.5' };
    for (const key of ['reason', 'attempt', 'questionCount', 'status', 'contentLength', 'reasoningLength', 'completionTokens']) {
      if (entry[key] !== undefined) safe[key] = typeof entry[key] === 'number' ? entry[key] : cleanLogText(entry[key]);
    }
    await chrome.storage.local.set({ [LOG_KEY]: [...logs, safe].slice(-500) });
  });
}
const ready = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);

async function config() {
  const data = await chrome.storage.local.get(CONFIG);
  return { ...CourseModel.defaults, ...data[CONFIG] };
}
async function secret(c) {
  const data = await chrome.storage.session.get(SECRET);
  const saved = data[SECRET] || (await chrome.storage.local.get(SECRET))[SECRET];
  if (!saved || saved.baseUrl !== c.baseUrl) return '';
  return saved.key;
}
function settingsSender(sender) {
  return sender.url === chrome.runtime.getURL('options.html') && sender.id === chrome.runtime.id;
}
function courseSender(sender) {
  try {
    const url = new URL(sender.url);
    return sender.id === chrome.runtime.id && sender.tab?.id !== undefined && sender.frameId === 0 && url.origin === 'https://mooc1.chaoxing.com' && url.pathname === '/mycourse/studentstudy';
  } catch { return false; }
}
async function dispatch(message, sender) {
  await ready;
  const fromSettings = settingsSender(sender);
  if (message.type === 'clearOwner' && sender.id === chrome.runtime.id && sender.tab) {
    const owner = (await chrome.storage.local.get('courseAssistantRunning')).courseAssistantRunning;
    if (owner?.browserTabId === sender.tab.id) await chrome.storage.local.set({ courseAssistantRunning: null });
    return {};
  }
  if (!fromSettings && !courseSender(sender)) throw new Error('不支持的调用页面');
  if (['getLogs', 'clearLogs'].includes(message.type)) {
    if (!fromSettings) throw new Error('只有设置页可以读取或清理日志');
    return logOperation(async () => {
      if (message.type === 'clearLogs') { await chrome.storage.local.remove(LOG_KEY); return {}; }
      return { logs: (await chrome.storage.local.get(LOG_KEY))[LOG_KEY] || [] };
    });
  }
  if (message.type === 'recordPause') {
    await appendLog({ event: 'assistant_paused', reason: message.reason });
    return {};
  }
  if (message.type === 'openSettings') { await chrome.runtime.openOptionsPage(); return {}; }
  if (message.type === 'getConfig') {
    const c = await config();
    return fromSettings ? { config: c, hasKey: !!await secret(c) } : { mode: c.mode, skipTests: c.skipTests };
  }
  if (message.type === 'setBehavior') {
    if (!['pause', 'manual', 'auto'].includes(message.mode)) throw new Error('无效的测验模式');
    for (const request of active.values()) request.controller.abort();
    const c = { ...await config(), mode: message.mode, skipTests: !!message.skipTests };
    await chrome.storage.local.set({ [CONFIG]: c });
    return { mode: c.mode, skipTests: c.skipTests };
  }
  if (message.type === 'saveConfig') {
    if (!fromSettings) throw new Error('只有设置页可以修改 API 配置');
    for (const request of active.values()) request.controller.abort();
    const next = message.config || {};
    const baseUrl = CourseModel.endpoint(next.baseUrl).replace(/\/chat\/completions$/, '');
    if (!['pause', 'manual', 'auto'].includes(next.mode)) throw new Error('无效的测验模式');
    if (typeof next.model !== 'string' || next.model.length > 150) throw new Error('模型名称无效');
    const c = { baseUrl, model: next.model.trim(), mode: next.mode, skipTests: !!next.skipTests, jsonMode: next.jsonMode !== false, rememberKey: !!message.rememberKey };
    const old = await config();
    const key = message.clearKey ? '' : (message.key?.trim() || (old.baseUrl === c.baseUrl ? await secret(old) : ''));
    if (key.length > 4096) throw new Error('密钥长度异常');
    await chrome.storage.session.remove(SECRET);
    await chrome.storage.local.remove(SECRET);
    if (key) await (message.rememberKey ? chrome.storage.local : chrome.storage.session).set({ [SECRET]: { baseUrl, key } });
    await chrome.storage.local.set({ [CONFIG]: c });
    return { config: c, hasKey: !!key };
  }
  if (message.type === 'testConnection') {
    if (!fromSettings) throw new Error('只有设置页可以测试连接');
    const c = await config();
    await call(c, [{ id: 'test', type: 'single_choice', stem: '请选择数字一。', options: [{ id: 'one', text: '一' }, { id: 'two', text: '二' }] }]);
    return { message: '连接和结构化输出校验成功' };
  }
  if (message.type === 'cancelModel') {
    active.get(sender.tab.id)?.controller.abort();
    return {};
  }
  if (message.type === 'solveQuestions') {
    if (fromSettings) throw new Error('请从课程页发起答题');
    const c = await config();
    if (c.skipTests || c.mode === 'pause') throw new Error('当前设置未开启模型答题');
    const owner = (await chrome.storage.local.get('courseAssistantRunning')).courseAssistantRunning;
    if (owner?.browserTabId !== sender.tab.id) throw new Error('当前标签页未运行课程助手');
    const qs = CourseModel.questions(message.questions);
    if (qs.length > 10 || JSON.stringify(qs).length > 100000) throw new Error('单批题目过多');
    const identity = JSON.stringify(qs);
    const old = active.get(sender.tab.id);
    if (old && old.identity === identity) return old.promise;
    if (old) throw new Error('当前标签页仍有模型请求，请先暂停');
    const controller = new AbortController();
    const promise = call(c, qs, controller).then(answers => ({ answers })).finally(() => active.delete(sender.tab.id));
    active.set(sender.tab.id, { identity, controller, promise });
    return promise;
  }
  // 课程运行状态通过后台代理，避免内容脚本直接访问含密钥的存储区。
  if (message.type === 'getOwner') return (await chrome.storage.local.get('courseAssistantRunning')).courseAssistantRunning || null;
  if (message.type === 'setOwner') {
    await chrome.storage.local.set({ courseAssistantRunning: message.owner ? { ...message.owner, browserTabId: sender.tab.id } : null });
    return {};
  }
  throw new Error('未知扩展请求');
}
async function call(c, qs, controller = new AbortController()) {
  const origin = new URL(CourseModel.endpoint(c.baseUrl)).origin + '/*';
  if (!await chrome.permissions.contains({ origins: [origin] })) throw new Error('请在设置页授权 API 地址的访问权限');
  const key = await secret(c);
  const timeout = setTimeout(() => controller.abort(), 120000);
  try { return await CourseModel.request(c, key, qs, { signal: controller.signal, onEvent: appendLog }); }
  catch (error) {
    await appendLog({ event: 'request_failed', reason: error.message, questionCount: qs.length }).catch(() => {});
    throw error;
  }
  finally { clearTimeout(timeout); }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  dispatch(message, sender).then(data => reply({ ok: true, data }), error => reply({ ok: false, error: error.message || '扩展请求失败' }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => active.get(tabId)?.controller.abort());
