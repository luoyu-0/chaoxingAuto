const fs = require('node:fs');
const vm = require('node:vm');
const text = fs.readFileSync(__dirname + '/source-82.js', 'utf8');
// 只解析已采集的字符串字面量数组，不执行网站业务代码。
const start = text.indexOf('function _0x2ae2(){var _0x2db635=') + 'function _0x2ae2(){var _0x2db635='.length;
const literal = text.slice(start).match(/^\[(?:'(?:\\.|[^'\\])*'(?:,|(?=\])))+\]/)?.[0];
if (!literal) throw new Error('字符串表格式不匹配');
const table = vm.runInNewContext(literal, {}, { timeout: 1000 });
const read = n => table[n - 0xc5];
const num = n => parseInt(read(n));
let found = false;
for (let i = 0; i < table.length; i++) {
  const value = -num(0x133) * (-num(0x130) / 2) + -num(0x29a) / 3 * (-num(0x332) / 4)
    + -num(0x1bc) / 5 + num(0x11f) / 6 * (num(0x271) / 7) + num(0x53d) / 8
    + -num(0x3f8) / 9 + num(0x2f1) / 10 * (-num(0x512) / 11);
  if (value === 0x787c0) { found = true; break; }
  table.push(table.shift());
}
if (!found) throw new Error('字符串表校验失败');
const aliases = new Set(['_0x19ef']);
let changed;
do {
  changed = false;
  for (const match of text.matchAll(/(_0x[\da-f]+)\s*=\s*(_0x[\da-f]+)(?=[,;])/g)) {
    if (aliases.has(match[2]) && !aliases.has(match[1])) { aliases.add(match[1]); changed = true; }
  }
} while (changed);
const decoded = text.replace(/(_0x[\da-f]+)\((0x[\da-f]+)\)/g, (all, fn, value) =>
  aliases.has(fn) ? JSON.stringify(read(Number(value))) : all);
fs.writeFileSync(__dirname + '/videojs-ext-readable.js', decoded);
const from = decoded.indexOf("'constructor':function(_0x309755");
const to = decoded.indexOf('(function()', from);
console.log(decoded.slice(from, to).replaceAll('),', '),\n'));
