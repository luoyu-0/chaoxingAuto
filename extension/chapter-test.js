/* 独立章节测验：只操作当前页面控件，不直接调用平台交卷接口。 */
(() => {
  'use strict';
  const text = node => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  function visible(node) {
    if (!node || !node.getClientRects().length) return false;
    const s = node.ownerDocument.defaultView.getComputedStyle(node);
    return s.display !== 'none' && s.visibility !== 'hidden';
  }
  function documents(frame) {
    const list = [], queue = [frame];
    while (queue.length && list.length < 20) {
      let doc; try { doc = queue.shift()?.contentDocument; } catch { continue; }
      if (!doc || list.includes(doc)) continue;
      list.push(doc); queue.push(...doc.querySelectorAll('iframe'));
    }
    return list;
  }
  function selected(option) {
    const node = option.node;
    return node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-pressed') === 'true' ||
      !!node.querySelector('.check_answer,.check_answer_dx,input:checked') || node.checked === true;
  }
  function extract(frame) {
    const docs = documents(frame);
    const doc = docs.find(d => /\/work\/doHomeWorkNew/.test(d.location.pathname));
    if (!doc) throw new Error('等待测验答题页面加载');
    const rows = [...doc.querySelectorAll('.TiMu')].filter(n => !n.querySelector('.TiMu'));
    // "0"、"undefined" 等非空占位值不能遮蔽页面可见的题量。
    // 有些课程把题量标题放在外层阅读器，故同时检查当前任务内的文档。
    const positiveCount = value => {
      const number = Number(value);
      return Number.isInteger(number) && number > 0 ? number : 0;
    };
    const counts = new Set();
    for (const reader of docs) {
      const heading = text(reader.body).normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '');
      const number = positiveCount(heading.match(/题\s*量\s*[:：]\s*(\d+)/)?.[1]);
      if (number) counts.add(number);
    }
    if (counts.size > 1) throw new Error('测验题量标注不一致，请手动检查');
    const count = [...counts][0] || positiveCount(doc.querySelector('#totalQuestionNum')?.value);
    if (!rows.length || !count || rows.length !== count) throw new Error(`题目未完整加载：读取 ${rows.length} 题，页面总题数 ${count || '未知'}；分页或其他结构需适配`);
    const items = rows.map((row, index) => {
      const controls = [...row.querySelectorAll('[qid][qtype]')].filter(n => n.querySelector('.num_option,.num_option_dx') || n.matches('input[type="radio"],input[type="checkbox"]'));
      const qid = controls[0]?.getAttribute('qid');
      const code = doc.getElementById('answertype' + qid)?.value || controls[0]?.getAttribute('qtype');
      const type = { '0': 'single_choice', '1': 'multiple_choice', '3': 'true_false' }[code];
      if (!qid || !type || controls.length < 2) throw new Error(`第 ${index + 1} 题的题型或选项结构暂不支持`);
      const heading = row.cloneNode(true);
      heading.querySelectorAll('[qid][qtype],input,textarea,script,style,.workAttach,.attachNew').forEach(n => n.remove());
      if (row.querySelector('img,svg,math,canvas,audio,video')) throw new Error(`第 ${index + 1} 题包含图片、公式或媒体，请手动处理`);
      const stem = text(heading).replace(/^\d+\s*/, '').replace(/^[【\[][^】\]]+[】\]]\s*/, '');
      const options = controls.map((node, i) => {
        const marker = node.querySelector('.num_option,.num_option_dx');
        const copy = node.cloneNode(true);
        copy.querySelectorAll('.num_option,.num_option_dx,input').forEach(n => n.remove());
        const value = marker?.getAttribute('data') || node.value;
        if (value === undefined || value === null || value === '') throw new Error('无法识别选项值');
        return { id: `o${i + 1}`, text: text(copy), value, node };
      });
      const answerInput = doc.getElementById('answer' + qid);
      if (!answerInput) throw new Error('缺少页面答案控件');
      return { id: `q${index + 1}`, type, stem, options, answerInput };
    });
    const questions = CourseModel.questions(items.map(q => ({ ...q, options: q.options.map(o => ({ id: o.id, text: o.text })) })));
    return { doc, items, questions };
  }
  function chosen(item) { return item.options.filter(selected).map(o => o.id).sort(); }
  function equal(a, b) { return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()); }
  function verify(item, answer) {
    if (!equal(chosen(item), answer.selected_option_ids)) return false;
    const expected = item.options.filter(o => answer.selected_option_ids.includes(o.id)).map(o => String(o.value)).sort().join('');
    return String(item.answerInput.value).split('').sort().join('') === expected.split('').sort().join('');
  }
  function fill(item, answer) {
    const existing = chosen(item);
    if (existing.length && !equal(existing, answer.selected_option_ids)) throw new Error(`${item.id} 的已有作答与模型答案不同，请手动处理`);
    if (!existing.length && item.answerInput.value) throw new Error(`${item.id} 的页面选中状态与答案字段不一致`);
    for (const option of item.options) if (answer.selected_option_ids.includes(option.id) && !selected(option)) option.node.click();
    if (!verify(item, answer)) throw new Error(`${item.id} 填写后校验失败，已暂停`);
  }
  function submitButton(doc) {
    const buttons = [...doc.querySelectorAll('button,a,input[type="button"],[role="button"]')]
      .filter(n => visible(n) && (text(n) || n.value) === '提交' && !n.closest('#workpop,#confirmSubWin'));
    if (buttons.length !== 1) throw new Error('无法唯一识别测验提交按钮');
    return buttons[0];
  }
  function confirmButton(docs) {
    for (const doc of docs) {
      const dialog = doc.querySelector('#workpop');
      if (!visible(dialog)) continue;
      if (text(dialog.querySelector('#popcontent')) !== '确认提交？') throw new Error('交卷确认内容与预期不符，请手动检查');
      const button = dialog.querySelector('#popok');
      if (!visible(button) || text(button) !== '提交') throw new Error('无法识别交卷确认按钮');
      return button;
    }
    return null;
  }
  async function fingerprint(qs) {
    const bytes = new TextEncoder().encode(JSON.stringify(qs));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  function create({ send, show, pause, allowed, allDocs, storage = sessionStorage, read = extract, hashQuestions = fingerprint }) {
    let current = null, generation = 0;
    function save() { if (current) storage.setItem(current.key, JSON.stringify(current.state)); }
    function cancel() { generation++; if (current) { current.pending = false; current.approved = false; } void send('cancelModel').catch(() => {}); }
    function approve() { if (current?.state.stage === 'awaiting-confirm') { current.approved = true; return true; } return false; }
    function waiting() { return current?.state.stage === 'awaiting-confirm'; }
    async function step(frame, key, mode, completed) {
      if (!allowed()) return;
      const cacheKey = 'courseAssistantTest:' + key;
      if (completed) { if (current?.key === cacheKey) { current.state.stage = 'done'; save(); } return 'done'; }
      if (current?.key === cacheKey && ['submitting', 'submitted'].includes(current.state.stage)) {
        const s = current.state;
        if (Date.now() - s.submittedAt > 45000) throw new Error('提交结果未确认，请手动核对；不会重复提交');
        if (s.stage === 'submitting') {
          const button = confirmButton(allDocs());
          if (button) {
            const latest = read(frame);
            const hash = await hashQuestions(latest.questions);
            if (!allowed()) return;
            if (latest.doc !== current.submitDoc || hash !== s.hash) throw new Error('交卷确认前题目或页面发生变化，请手动核对');
            const answers = CourseModel.answers({ answers: s.answers }, latest.questions);
            if (latest.items.some((item, i) => !verify(item, answers[i]))) throw new Error('交卷确认前答案发生变化，请手动核对');
            s.stage = 'submitted'; save(); button.click();
          }
        }
        show('等待平台确认测验提交结果…'); return;
      }
      const snapshot = read(frame);
      const hash = await hashQuestions(snapshot.questions);
      if (!allowed()) return;
      if (!current || current.key !== cacheKey || current.hash !== hash) {
        generation++;
        let state; try { state = JSON.parse(storage.getItem(cacheKey)); } catch {}
        if (!state || state.hash !== hash) state = { hash, stage: 'reading', answers: [], filled: 0 };
        if (['submitting', 'submitted'].includes(state.stage)) throw new Error('上次交卷结果尚未确认，请手动核对；不会重复提交');
        if (state.stage === 'done') throw new Error('已记录交卷，但页面尚未显示完成，请手动核对');
        current = { key: cacheKey, hash, state, pending: false, approved: false };
      }
      const c = current, s = c.state;
      // 缓存也必须逐题校验，不能让旧答案或被修改的缓存进入提交阶段。
      const existing = new Map();
      for (const a of s.answers || []) {
        const q = snapshot.questions.find(q => q.id === a.question_id);
        if (!q || existing.has(q.id)) throw new Error('答案缓存不一致，请清除当前测验缓存');
        existing.set(q.id, CourseModel.answers({ answers: [a] }, [q])[0]);
      }
      const remaining = snapshot.questions.filter(q => !existing.has(q.id));
      if (remaining.length) {
        show(`模型正在答题：已完成 ${existing.size} / ${snapshot.questions.length} 题`);
        if (c.pending) return;
        const batch = CourseModel.batches(remaining)[0], token = generation;
        c.pending = true; s.stage = 'requesting'; save();
        send('solveQuestions', { questions: batch }).then(async result => {
          if (token !== generation || current !== c || !allowed()) return;
          const latest = read(frame);
          if (latest.doc !== snapshot.doc || await hashQuestions(latest.questions) !== hash) throw new Error('等待模型期间测验页面已变化，已丢弃结果');
          if (token !== generation || current !== c || !allowed()) return;
          s.answers.push(...CourseModel.answers(result, batch)); s.stage = 'reading'; save();
        }).catch(error => { if (token === generation && allowed()) void pause(error.message); })
          .finally(() => { if (current === c && token === generation) c.pending = false; });
        return;
      }
      const answers = CourseModel.answers({ answers: s.answers }, snapshot.questions);
      for (let i = 0; i < snapshot.items.length; i++) {
        const item = snapshot.items[i];
        if (!verify(item, answers[i])) {
          if (s.stage === 'awaiting-confirm') throw new Error('等待确认期间答案发生变化，请手动核对');
          fill(item, answers[i]); s.stage = 'filling'; s.filled = i + 1; save();
          show(`已填写并校验 ${i + 1} / ${answers.length} 题`); return;
        }
      }
      if (mode === 'manual' && !c.approved) {
        s.stage = 'awaiting-confirm'; save(); show('全部答案已填写，请检查后点击“确认提交并继续”。'); return;
      }
      if (!allowed()) return;
      const button = submitButton(snapshot.doc);
      c.submitDoc = snapshot.doc;
      s.stage = 'submitting'; s.submittedAt = Date.now(); save();
      button.click(); show('已点击提交，等待交卷确认…');
    }
    return { step, cancel, approve, waiting };
  }
  globalThis.CourseChapterTest = { extract, fill, verify, submitButton, confirmButton, fingerprint, create };
  if (typeof module !== 'undefined') module.exports = globalThis.CourseChapterTest;
})();
