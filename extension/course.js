(() => {
  'use strict';

  if (window.top !== window || !location.pathname.startsWith('/mycourse/studentstudy')) return;

  const STORAGE_KEY = 'courseAssistantRunning';
  const courseId = new URLSearchParams(location.search).get('courseId');
  const TAB_KEY = 'courseAssistantTabId';
  const tabId = sessionStorage.getItem(TAB_KEY) || crypto.randomUUID();
  sessionStorage.setItem(TAB_KEY, tabId);
  const INTERVAL_MS = 3000;
  const LOAD_TIMEOUT_MS = 45000;
  const DOCUMENT_TIMEOUT_MS = 90000;
  const COMPLETE_TIMEOUT_MS = 60000;
  const STALL_TIMEOUT_MS = 90000;
  const QUIZ_TIMEOUT_MS = 30000;
  const QUIZ_FEEDBACK_MS = 500;
  const QUIZ_RETRY_DELAY_MS = 500;
  const QUIZ_MAX_OPTIONS = 5;
  const RISK_TEXT = /操作过于频繁|访问过于频繁|行为异常|账号异常|存在异常操作|风险验证|人机验证|滑动验证|请完成验证|请进行验证|访问受限|禁止访问|账号被封|请先登录|登录已失效/;
  const RISK_FRAME = /captcha|verify|challenge|geetest|yidun/i;

  let running = false;
  let busy = false;
  let currentTask = '';
  let taskSince = 0;
  let lastProgress = 0;
  let lastProgressAt = 0;
  let playRequestedAt = 0;
  let hasPlayed = false;
  let endedAt = 0;
  let rateAttemptedAt = 0;
  let rateChecked = false;
  let quizActive = false;
  let quizPending = '';
  let quizSubmittedAt = 0;
  let quizSubmittedProgress = 0;
  let quizContinued = false;
  let navigationSince = 0;
  let navigationSignature = '';
  let cardSignature = '';
  let cardReadyAt = 0;
  let intervalId = 0;

  const box = document.createElement('div');
  box.id = 'course-assistant-panel';
  box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:260px;padding:12px 14px;background:#fff;color:#172033;border:1px solid #b7c7da;border-radius:10px;box-shadow:0 4px 18px #0003;font:14px/1.5 sans-serif';
  box.innerHTML = '<strong>课程顺序播放助手</strong><div id="course-assistant-status" style="margin:8px 0;word-break:break-word"></div><button id="course-assistant-toggle" type="button" style="border:0;border-radius:6px;padding:6px 14px;background:#2878d0;color:white;cursor:pointer">开始</button>';
  document.documentElement.appendChild(box);
  const status = box.querySelector('#course-assistant-status');
  const toggle = box.querySelector('#course-assistant-toggle');

  function show(message) {
    status.textContent = message;
    toggle.textContent = running ? '暂停' : '开始';
  }

  function frameDocument(frame) {
    try {
      return frame?.contentDocument || null;
    } catch {
      return null;
    }
  }

  function visible(element) {
    if (!element) return false;
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  function riskIn(doc) {
    if (!doc) return false;
    const title = doc.title || '';
    const body = doc.body;
    if (RISK_TEXT.test(title)) return true;
    if (body && body.innerText.length < 1400 && RISK_TEXT.test(body.innerText)) return true;
    for (const node of doc.querySelectorAll('[role="dialog"],.layui-layer,.modal,.popup,.verify,.captcha')) {
      if (visible(node) && RISK_TEXT.test(node.innerText || '')) return true;
    }
    return [...doc.querySelectorAll('iframe[src]')].some(frame => RISK_FRAME.test(frame.getAttribute('src') || ''));
  }

  function allDocuments() {
    const result = [document];
    const queue = [document];
    while (queue.length && result.length < 20) {
      const doc = queue.shift();
      for (const frame of doc.querySelectorAll('iframe')) {
        const child = frameDocument(frame);
        if (child && !result.includes(child)) {
          result.push(child);
          queue.push(child);
        }
      }
    }
    return result;
  }

  function pauseVideos() {
    for (const doc of allDocuments()) {
      for (const video of doc.querySelectorAll('video')) video.pause();
    }
  }

  // 网站 studyControl 在顶层窗口的冒泡阶段处理 mouseout。
  // 仅拦截离开文档的冒泡，保留元素及文档自身的事件处理。
  function protectPageExit(event) {
    if (!running || event.relatedTarget || event.toElement) return;
    const docs = allDocuments();
    if (docs.some(riskIn)) return;
    const playing = docs.some(doc => [...doc.querySelectorAll('video')]
      .some(video => !video.paused && !video.ended));
    if (playing) event.stopPropagation();
  }

  document.addEventListener('mouseout', protectPageExit);

  function storageFailed(error) {
    running = false;
    if (intervalId) window.clearInterval(intervalId);
    pauseVideos();
    show(/Extension context invalidated/i.test(error?.message || '')
      ? '扩展已重新加载，请刷新课程页面。'
      : `扩展存储不可用，请刷新课程页面：${error?.message || String(error)}`);
  }

  async function stop(message, pause = true) {
    running = false;
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      if (data[STORAGE_KEY]?.tabId === tabId) {
        await chrome.storage.local.set({ [STORAGE_KEY]: null });
      }
    } catch (error) {
      storageFailed(error);
      return;
    }
    if (pause) pauseVideos();
    show(message);
  }

  function resetTask(key) {
    if (currentTask === key) return;
    currentTask = key;
    taskSince = Date.now();
    lastProgress = 0;
    lastProgressAt = Date.now();
    playRequestedAt = 0;
    hasPlayed = false;
    endedAt = 0;
    rateAttemptedAt = 0;
    rateChecked = false;
    quizActive = false;
    quizPending = '';
    quizSubmittedAt = 0;
    quizSubmittedProgress = 0;
    quizContinued = false;
  }

  function taskFinished(container) {
    return container.classList.contains('ans-job-finished') ||
      container.querySelector('.ans-job-icon')?.getAttribute('aria-label') === '任务点已完成';
  }

  function questionKey(quiz, frame) {
    const title = quiz.querySelector('.tkItem_title')?.textContent?.trim() || '';
    const options = [...quiz.querySelectorAll('.ans-videoquiz-opt')]
      .map(option => option.textContent.trim()).join('|');
    const source = `${courseId}|${frame.getAttribute('jobid')}|${title}|${options}`;
    let hash = 2166136261;
    for (const character of source) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(36);
  }

  function combinations(count, multiple) {
    const masks = [];
    for (let mask = 1; mask < 2 ** count; mask++) {
      if (multiple || (mask & (mask - 1)) === 0) masks.push(mask);
    }
    return masks.sort((a, b) => {
      const bits = value => value.toString(2).replaceAll('0', '').length;
      return bits(a) - bits(b) || a - b;
    });
  }

  function quizAttempts() {
    try {
      return JSON.parse(sessionStorage.getItem(`courseAssistantQuiz:${courseId}`) || '{}');
    } catch {
      return {};
    }
  }

  function saveQuizAttempts(attempts) {
    sessionStorage.setItem(`courseAssistantQuiz:${courseId}`, JSON.stringify(attempts));
  }

  function visibleQuiz(playerDoc) {
    return [...playerDoc.querySelectorAll('.ans-videoquiz')].find(visible) || null;
  }

  async function handleQuiz(quiz, frame, video) {
    quizActive = true;
    const key = questionKey(quiz, frame);
    const correct = quiz.querySelector('#spanHas');
    const wrong = [...quiz.querySelectorAll('#spanNot,#spanNotBack')].some(visible);
    const next = quiz.querySelector('#videoquiz-continue');
    const submit = quiz.querySelector('#videoquiz-submit');

    if ((visible(correct) || wrong) && visible(next)) {
      if (!quizContinued) {
        quizContinued = true;
        next.click();
      }
      show(visible(correct) ? '回答正确，等待视频继续…' : '回答错误，等待平台回退后继续播放…');
      return;
    }
    if (visible(correct)) {
      if (Date.now() - quizSubmittedAt > QUIZ_TIMEOUT_MS) {
        await stop('题目显示回答正确，但视频未继续；请手动处理。');
      } else {
        show('回答正确，等待视频继续…');
      }
      return;
    }
    if (quizPending === key || wrong) {
      if (!quizSubmittedAt) quizSubmittedAt = Date.now();
      const elapsed = Date.now() - quizSubmittedAt;
      if (quizPending === key && elapsed < QUIZ_FEEDBACK_MS) {
        show('已提交答案，检查视频是否继续播放…');
        return;
      }
      if (!video.paused && Math.abs(video.currentTime - quizSubmittedProgress) > 0.1) {
        show('视频已恢复，等待题目界面关闭…');
        return;
      }
      if (!visible(submit)) {
        if (elapsed > QUIZ_TIMEOUT_MS) await stop('题目无法继续提交，请手动处理。');
        else show('等待题目界面更新…');
        return;
      }
      if (Date.now() - quizSubmittedAt < QUIZ_RETRY_DELAY_MS) {
        show('视频未恢复，等待后再尝试下一组答案…');
        return;
      }
      quizPending = '';
    }

    const title = quiz.querySelector('.tkTopic_title')?.textContent?.trim() || '';
    const items = quiz.querySelectorAll('.tkItem');
    const multiple = title.includes('多选');
    if ((!multiple && !title.includes('单选')) || items.length !== 1) {
      await stop('遇到尚未支持的视频题目，已暂停。');
      return;
    }
    const options = [...quiz.querySelectorAll('.ans-videoquiz-opt')];
    if (options.length < 2 || options.length > QUIZ_MAX_OPTIONS ||
        options.some(option => !option.querySelector('input[type="radio"],input[type="checkbox"]'))) {
      await stop('题目选项数量或结构异常，已暂停。');
      return;
    }
    if (!visible(submit)) {
      await stop('题目没有可用的提交按钮，已暂停。');
      return;
    }

    const attempts = quizAttempts();
    const masks = combinations(options.length, multiple);
    const index = attempts[key] || 0;
    if (index >= masks.length) {
      await stop('此题的候选组合都已尝试，请手动处理。');
      return;
    }
    const mask = masks[index];
    for (let i = 0; i < options.length; i++) {
      const input = options[i].querySelector('input');
      const wanted = !!(mask & (1 << i));
      if (input.checked !== wanted) (options[i].querySelector('label') || input).click();
      if (input.checked !== wanted) {
        await stop('无法确认选项已选中，已暂停。');
        return;
      }
    }
    attempts[key] = index + 1;
    saveQuizAttempts(attempts);
    quizPending = key;
    quizSubmittedAt = Date.now();
    quizSubmittedProgress = video.currentTime;
    quizContinued = false;
    submit.click();
    window.setTimeout(() => void tick(), QUIZ_FEEDBACK_MS);
    show(`已提交第 ${index + 1}/${masks.length} 个答案组合，检查视频状态…`);
  }

  function preferDoubleSpeed(playerDoc, video) {
    if (rateChecked) return;
    if (rateAttemptedAt) {
      if (Date.now() - rateAttemptedAt < 2500) return;
      if (video.playbackRate < 1.9) video.playbackRate = 1;
      rateChecked = true;
      return;
    }
    const menu = playerDoc.querySelector('button.vjs-playback-rate');
    const option = [...playerDoc.querySelectorAll('.vjs-playback-rate .vjs-menu-item')]
      .find(item => item.querySelector('.vjs-menu-item-text')?.textContent.trim() === '2x');
    if (!menu || menu.getAttribute('aria-disabled') === 'true' ||
        !option || option.getAttribute('aria-disabled') === 'true') {
      video.playbackRate = 1;
      rateChecked = true;
      return;
    }
    menu.click();
    option.click();
    rateAttemptedAt = Date.now();
  }

  async function handleVideo(container, frame, key) {
    resetTask(key);
    const playerDoc = frameDocument(frame);
    const video = playerDoc?.querySelector('video');
    if (!video) {
      if (Date.now() - taskSince > LOAD_TIMEOUT_MS) await stop('视频播放器加载超时，已暂停。');
      else show('等待视频播放器加载…');
      return;
    }

    frame.scrollIntoView({ block: 'center' });
    const quiz = visibleQuiz(playerDoc);
    if (quiz) {
      await handleQuiz(quiz, frame, video);
      return;
    }
    if (quizActive) {
      quizActive = false;
      quizPending = '';
      quizSubmittedAt = 0;
      quizSubmittedProgress = 0;
      quizContinued = false;
      hasPlayed = false;
      playRequestedAt = 0;
      lastProgress = video.currentTime;
      lastProgressAt = Date.now();
    }
    if (video.ended) {
      endedAt ||= Date.now();
      if (taskFinished(container)) {
        currentTask = '';
        return;
      }
      if (Date.now() - endedAt > COMPLETE_TIMEOUT_MS) await stop('视频已结束，但任务点仍未显示完成；请检查页面。');
      else show('视频已结束，等待平台确认任务点…');
      return;
    }

    if (video.paused) {
      if (hasPlayed) {
        const away = document.visibilityState === 'hidden' || !document.hasFocus();
        await stop(away
          ? '视频已暂停，当前页面处于隐藏或失焦状态。请返回课程页，手动播放后点击“开始”。'
          : '视频在结束前暂停，当前页面仍有焦点。请检查播放器提示，手动播放后点击“开始”。');
        return;
      }
      if (playRequestedAt) {
        if (Date.now() - playRequestedAt > 12000) await stop('视频未能继续播放，可能需要你处理播放器提示。');
        else show('等待视频开始播放…');
        return;
      }
      playRequestedAt = Date.now();
      try {
        const button = playerDoc.querySelector('.vjs-big-play-button,.vjs-play-control');
        if (button && visible(button)) button.click();
        if (video.paused) await video.play();
      } catch {
        await stop('浏览器阻止自动播放；请手动播放当前视频后重新开始。', false);
      }
      return;
    }

    playRequestedAt = 0;
    hasPlayed = true;
    preferDoubleSpeed(playerDoc, video);
    if (video.currentTime + 2 < lastProgress) {
      lastProgress = video.currentTime;
      lastProgressAt = Date.now();
    } else if (video.currentTime > lastProgress + 0.2) {
      lastProgress = video.currentTime;
      lastProgressAt = Date.now();
    } else if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
      await stop('视频长时间没有进度，已暂停。');
      return;
    }
    const duration = Number.isFinite(video.duration) ? ` / ${Math.round(video.duration)} 秒` : '';
    show(`正在以 ${video.playbackRate.toFixed(1)} 倍速播放视频：${Math.round(video.currentTime)}${duration}`);
  }

  async function handleDocument(container, frame, key) {
    resetTask(key);
    if (!frameDocument(frame)) {
      if (Date.now() - taskSince > LOAD_TIMEOUT_MS) await stop('文档加载超时，已暂停。');
      else show('等待文档加载…');
      return;
    }
    if (Date.now() - taskSince > DOCUMENT_TIMEOUT_MS) {
      await stop('文档尚未显示完成，需检查该文档的阅读要求。');
      return;
    }
    show('文档已打开，等待平台确认任务点…');
  }

  async function advance() {
    const next = document.querySelector('#prevNextFocusNext');
    if (!next || !visible(next) || next.getAttribute('aria-disabled') === 'true') {
      await stop('已到最后一节；请核对课程总进度。', false);
      return;
    }
    const frame = document.querySelector('#iframe');
    const signature = `${location.href}|${frame?.getAttribute('src') || ''}|${document.querySelector('li[id^="dct"].active')?.id || ''}`;
    if (navigationSignature === signature) {
      if (Date.now() - navigationSince > LOAD_TIMEOUT_MS) await stop('切换后页面没有变化，已暂停。');
      return;
    }
    navigationSignature = signature;
    navigationSince = Date.now();
    show('当前内容已完成，进入下一项…');
    next.click();
  }

  async function tick() {
    if (!running || busy) return;
    try {
      if (!chrome.runtime?.id) {
        storageFailed(new Error('Extension context invalidated.'));
        return;
      }
    } catch (error) {
      storageFailed(error);
      return;
    }
    busy = true;
    try {
      const docs = allDocuments();
      if (docs.some(riskIn)) {
        await stop('检测到登录或风控验证提示，已立即停止。');
        return;
      }
      const frame = document.querySelector('#iframe');
      const card = frameDocument(frame);
      if (!card || !card.body) {
        resetTask('card-loading');
        if (Date.now() - taskSince > LOAD_TIMEOUT_MS) await stop('章节内容加载超时，已暂停。');
        else show('等待章节内容加载…');
        return;
      }
      const loadedCard = frame.getAttribute('src') || '';
      if (cardSignature !== loadedCard) {
        cardSignature = loadedCard;
        cardReadyAt = Date.now();
      }
      if (!card.location.pathname.includes('/mooc-ans/knowledge/cards') || !card.querySelector('#cardFocus')) {
        if (Date.now() - cardReadyAt > LOAD_TIMEOUT_MS) await stop('章节卡片加载超时，已暂停。');
        else show('等待章节卡片加载…');
        return;
      }

      const containers = [...card.querySelectorAll('.ans-attach-ct')]
        .filter(node => node.querySelector('iframe[jobid]') &&
          (node.classList.contains('ans-job-finished') || node.querySelector('.ans-job-icon')));
      if (!containers.length && Date.now() - cardReadyAt < 15000) {
        show('等待当前内容加载完成…');
        return;
      }
      for (const container of containers) {
        const attachment = container.querySelector('iframe[jobid]');
        const key = `${location.pathname}|${frame.getAttribute('src')}|${attachment.getAttribute('jobid')}`;
        if (taskFinished(container) && currentTask !== key) continue;
        if (attachment.matches('.ans-insertvideo-online')) {
          await handleVideo(container, attachment, key);
          return;
        }
        if (attachment.matches('.insertdoc-online-pdf')) {
          await handleDocument(container, attachment, key);
          return;
        }
        await stop('遇到尚未支持的任务类型，已暂停。');
        return;
      }
      if (card.querySelector('.ans-job-icon[aria-label="任务点未完成"]')) {
        await stop('当前内容还有未识别的任务点，已暂停。');
        return;
      }
      currentTask = '';
      await advance();
    } catch (error) {
      await stop(`运行出错，已暂停：${error?.message || String(error)}`);
    } finally {
      busy = false;
    }
  }

  toggle.addEventListener('click', async () => {
    if (running) {
      await stop('已手动暂停。');
      return;
    }
    running = true;
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: { courseId, tabId } });
    } catch (error) {
      storageFailed(error);
      return;
    }
    show('正在检查当前章节…');
    void tick();
  });

  intervalId = window.setInterval(() => void tick(), INTERVAL_MS);
  try {
    chrome.storage.onChanged.addListener(changes => {
      if (!running || !changes[STORAGE_KEY]) return;
      const owner = changes[STORAGE_KEY].newValue;
      if (owner?.tabId !== tabId || owner?.courseId !== courseId) {
        running = false;
        pauseVideos();
        show('已在另一个标签页启动，本页已暂停。');
      }
    });
    chrome.storage.local.get(STORAGE_KEY).then(data => {
      running = !!courseId && data[STORAGE_KEY]?.courseId === courseId && data[STORAGE_KEY]?.tabId === tabId;
      show(running ? '已恢复，正在检查当前章节…' : '已暂停；从当前章节开始。');
      if (running) void tick();
    }).catch(storageFailed);
  } catch (error) {
    storageFailed(error);
  }
})();
