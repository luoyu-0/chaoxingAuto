const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../extension/model-api.js');
const { extract } = require('../extension/chapter-test.js');

function fixture(hiddenCount, header = '题量: 48 满分: 100.0', size = 48) {
  const copy = value => ({ textContent: value, querySelectorAll: () => [] });
  const rows = Array.from({ length: size }, (_, i) => {
    const controls = ['A', 'B'].map(value => ({
      getAttribute: name => name === 'qid' ? String(i + 1) : '0',
      querySelector: () => ({ getAttribute: () => value }),
      cloneNode: () => copy('选项' + value),
    }));
    return { querySelector: () => null, querySelectorAll: () => controls, cloneNode: () => copy(`【单选题】题目${i + 1}`) };
  });
  const doc = {
    location: { pathname: '/mooc-ans/work/doHomeWorkNew' },
    body: { innerText: header },
    querySelectorAll: selector => selector === '.TiMu' ? rows : [],
    querySelector: selector => selector === '#totalQuestionNum' ? { value: hiddenCount } : null,
    getElementById: id => ({ value: id.startsWith('answertype') ? '0' : '' }),
  };
  return { contentDocument: doc };
}
test('隐藏总题数为零时应读取可见题量，完整48题可继续', () => {
  assert.equal(extract(fixture('0')).questions.length, 48);
});
test('无效隐藏字段不能遮蔽可见题量', () => {
  assert.equal(extract(fixture('undefined')).questions.length, 48);
});
test('少加载一道题仍须暂停', () => {
  assert.throws(() => extract(fixture('0', '题量: 48', 47)), /读取 47 题/);
});
test('没有可靠总题数仍须暂停，不能仅按已读行数放行', () => {
  assert.throws(() => extract(fixture('0', '章节测验')), /总题数 未知/);
});
test('题量位于外层 iframe 时仍能确认完整性', () => {
  const inner = fixture('0', '章节测验');
  const outer = { contentDocument: {
    location: { pathname: '/ananas/modules/work/index.html' },
    body: { innerText: '题量：48 满分：100' },
    querySelectorAll: selector => selector === 'iframe' ? [inner] : [],
  } };
  assert.equal(extract(outer).questions.length, 48);
});
test('兼容全角数字、拆开的标签与零宽字符', () => {
  assert.equal(extract(fixture('0', '题 量\u200b：４８')).questions.length, 48);
});
