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
    (async () => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const windowId = tabs[0]?.windowId;
      const groups = windowId != null ? await chrome.tabGroups.query({ windowId }) : [];
      sendResponse({
        tabs: tabs.map((t) => ({
          id: t.id,
          title: t.title,
          url: t.url,
          favIconUrl: t.favIconUrl,
          active: t.active,
          index: t.index,
          pinned: t.pinned,
          groupId: t.groupId, // -1 = ungrouped
        })),
        groups: groups.map((g) => ({
          id: g.id,
          title: g.title,
          color: g.color,
          collapsed: g.collapsed,
        })),
      });
    })();
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
  if (msg?.type === 'TOGGLE_GROUP') {
    chrome.tabGroups
      .update(msg.groupId, { collapsed: msg.collapsed })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});
