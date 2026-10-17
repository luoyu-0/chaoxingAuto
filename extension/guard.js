(() => {
  'use strict';
  if (window.top !== window) return;
  if (location.hostname === 'mooc1.chaoxing.com' &&
      location.pathname.startsWith('/mycourse/studentstudy')) return;
  try {
    void chrome.storage.local.set({ courseAssistantRunning: null }).catch(() => {});
  } catch {
    // 扩展重新加载后，旧页面中的脚本可能失去存储权限。
  }
})();
