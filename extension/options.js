'use strict';
const $ = id => document.getElementById(id);
async function send(type, data = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...data });
  if (!result?.ok) throw new Error(result?.error || '扩展后台未响应');
  return result.data;
}
function display(data) {
  for (const name of ['baseUrl', 'model', 'mode']) $(name).value = data.config[name];
  for (const name of ['skipTests', 'jsonMode']) $(name).checked = data.config[name];
  $('rememberKey').checked = !!data.config.rememberKey;
  $('preset').value = data.config.baseUrl === 'https://api.deepseek.com' ? 'deepseek' : 'custom';
  $('keyStatus').textContent = data.hasKey ? '已配置密钥；留空可保留。' : '尚未配置密钥。';
}
async function save(clearKey = false) {
  const baseUrl = CourseModel.endpoint($('baseUrl').value).replace(/\/chat\/completions$/, '');
  // 在用户点击事件中申请单个目标域名权限，不授予全部站点访问。
  if (!await chrome.permissions.request({ origins: [new URL(baseUrl).origin + '/*'] })) throw new Error('未授予 API 地址访问权限');
  const data = await send('saveConfig', {
    config: { baseUrl, model: $('model').value, mode: $('mode').value, skipTests: $('skipTests').checked, jsonMode: $('jsonMode').checked },
    key: $('key').value, clearKey, rememberKey: $('rememberKey').checked,
  });
  $('key').value = ''; display(data);
}
async function action(fn) {
  $('status').textContent = '处理中…';
  const buttons = [...document.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true);
  try { await fn(); } catch (error) { $('status').textContent = error.message; }
  finally { buttons.forEach(b => b.disabled = false); }
}
$('preset').addEventListener('change', () => { if ($('preset').value === 'deepseek') { $('baseUrl').value = 'https://api.deepseek.com'; $('jsonMode').checked = true; } });
$('showKey').addEventListener('change', () => { $('key').type = $('showKey').checked ? 'text' : 'password'; });
$('mode').addEventListener('change', () => { if ($('mode').value !== 'pause') $('skipTests').checked = false; });
$('skipTests').addEventListener('change', () => { if ($('skipTests').checked) $('mode').value = 'pause'; });
$('settings').addEventListener('submit', e => { e.preventDefault(); void action(async () => { await save(); $('status').textContent = '已保存。课程助手下次开始处理测验时使用新设置。'; }); });
$('test').addEventListener('click', () => void action(async () => { await save(); $('status').textContent = '正在测试，将产生一次小额 API 调用…'; const result = await send('testConnection'); $('status').textContent = result.message; }));
$('clearKey').addEventListener('click', () => void action(async () => { await save(true); $('status').textContent = '密钥已清除。'; }));
send('getConfig').then(display).catch(e => { $('status').textContent = e.message; });
