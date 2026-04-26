// Service worker (MV3)
// - キーボードショートカット / 拡張アイコンクリックを受けてアクティブタブに TOGGLE を送る
// - content script からの GET_TABS / ACTIVATE_TAB / CLOSE_TAB を仲介する

const sendToggle = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE' });
  } catch {
    // content script が居ないページ (chrome:// 等) では無視
  }
};

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-tab-list') sendToggle();
});

chrome.action.onClicked.addListener(sendToggle);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_TABS') {
    chrome.tabs.query({ currentWindow: true }).then((tabs) => {
      sendResponse({
        tabs: tabs.map((t) => ({
          id: t.id,
          title: t.title,
          url: t.url,
          favIconUrl: t.favIconUrl,
          active: t.active,
          index: t.index,
          pinned: t.pinned,
        })),
      });
    });
    return true; // 非同期応答
  }
  if (msg?.type === 'ACTIVATE_TAB') {
    chrome.tabs.update(msg.tabId, { active: true }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'CLOSE_TAB') {
    chrome.tabs.remove(msg.tabId).then(() => sendResponse({ ok: true }));
    return true;
  }
});
