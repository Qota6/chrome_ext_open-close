// Content script
// - 画面左端のホットゾーンにホバーするとタブ一覧パネルをフローティング表示
// - キーボードショートカット / 拡張アイコンクリックでもトグル可能
// - サイト側 DOM への干渉を最小化するため、すべて Shadow DOM 内に閉じ込める

(() => {
  // top frame のみで動作 (iframe 内には注入しない)
  if (window.top !== window.self) return;
  // 多重注入ガード (拡張機能の更新時など)
  if (window.__hoverTabListInjected) return;
  window.__hoverTabListInjected = true;

  const HOTZONE_WIDTH = 6;        // px - 画面左端のホバー検出幅
  const HOTZONE_TOP_RATIO = 0.2;  // 縦中央 60% のみ反応 (画面端の誤発動を抑える)
  const HOTZONE_BOTTOM_RATIO = 0.8;
  const SHOW_DELAY = 120;         // ms
  const HIDE_DELAY = 220;

  let host;
  let shadow;
  let panel;
  let isOpen = false;
  let showTimer;
  let hideTimer;
  let isFullscreen = false;

  const styles = `
    :host { all: initial; }
    .panel {
      position: fixed;
      top: 50%;
      left: 8px;
      transform: translateY(-50%) translateX(-12px);
      width: 320px;
      max-height: 80vh;
      background: rgba(32, 33, 36, 0.96);
      color: #e8eaed;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      opacity: 0;
      pointer-events: none;
      transition: opacity 120ms ease, transform 120ms ease;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      backdrop-filter: blur(8px);
    }
    .panel.open {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(-50%) translateX(0);
    }
    .panel-header {
      padding: 10px 12px;
      font-size: 11px;
      opacity: 0.6;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      flex-shrink: 0;
    }
    .tab-list {
      overflow-y: auto;
      padding: 4px;
    }
    .tab-list::-webkit-scrollbar { width: 8px; }
    .tab-list::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 4px;
    }
    .tab-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 80ms;
    }
    .tab-item:hover { background: rgba(255, 255, 255, 0.08); }
    .tab-item.active { background: rgba(138, 180, 248, 0.18); }
    .tab-favicon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      border-radius: 3px;
      object-fit: contain;
    }
    .tab-favicon-fallback {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.06);
    }
    .tab-title {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .tab-close {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: none;
      align-items: center;
      justify-content: center;
      opacity: 0.6;
      font-size: 14px;
      line-height: 1;
      flex-shrink: 0;
    }
    .tab-item:hover .tab-close { display: flex; }
    .tab-close:hover { background: rgba(255, 255, 255, 0.12); opacity: 1; }
    @media (prefers-color-scheme: light) {
      .panel {
        background: rgba(255, 255, 255, 0.98);
        color: #202124;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.18);
      }
      .panel-header { border-bottom-color: rgba(0, 0, 0, 0.08); }
      .tab-item:hover { background: rgba(0, 0, 0, 0.06); }
      .tab-item.active { background: rgba(26, 115, 232, 0.12); }
      .tab-list::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.2); }
      .tab-favicon-fallback { background: rgba(0, 0, 0, 0.06); }
    }
  `;

  const createUI = () => {
    host = document.createElement('div');
    // ランダム ID でサイト側との class/id 衝突を回避
    host.id = 'hover-tab-list-host-' + Math.random().toString(36).slice(2, 10);
    host.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';

    shadow = host.attachShadow({ mode: 'closed' });

    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    shadow.appendChild(styleEl);

    panel = document.createElement('div');
    panel.className = 'panel';
    shadow.appendChild(panel);

    document.documentElement.appendChild(host);

    panel.addEventListener('mouseenter', cancelHide);
    panel.addEventListener('mouseleave', scheduleHide);

    // ホットゾーンは DOM 要素ではなく mousemove で監視する。
    // DOM 要素を画面端にオーバーレイすると、サイト側の左端固定 UI のクリックを奪ってしまうため。
    document.addEventListener('mousemove', onMouseMove, { passive: true });
  };

  const onMouseMove = (e) => {
    if (isFullscreen || isOpen) return;
    const h = window.innerHeight;
    const inHotzone =
      e.clientX < HOTZONE_WIDTH &&
      e.clientY > h * HOTZONE_TOP_RATIO &&
      e.clientY < h * HOTZONE_BOTTOM_RATIO;
    if (inHotzone) {
      if (!showTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
        showTimer = setTimeout(() => {
          showTimer = null;
          open();
        }, SHOW_DELAY);
      }
    } else if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
  };

  const cancelHide = () => clearTimeout(hideTimer);
  const scheduleHide = () => {
    clearTimeout(showTimer);
    showTimer = null;
    hideTimer = setTimeout(close, HIDE_DELAY);
  };

  const open = async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_TABS' });
      renderTabs(res?.tabs ?? []);
    } catch {
      return;
    }
    panel.classList.add('open');
    isOpen = true;
  };
  const close = () => {
    panel.classList.remove('open');
    isOpen = false;
  };
  const toggle = () => (isOpen ? close() : open());

  const renderTabs = (tabs) => {
    panel.replaceChildren();

    const header = document.createElement('div');
    header.className = 'panel-header';
    header.textContent = `${tabs.length} 個のタブ`;
    panel.appendChild(header);

    const list = document.createElement('div');
    list.className = 'tab-list';

    tabs.forEach((t) => {
      const item = document.createElement('div');
      item.className = 'tab-item' + (t.active ? ' active' : '');
      item.title = t.title || t.url || '';

      // favicon: 失敗したら fallback プレースホルダに差し替える
      let favEl;
      if (t.favIconUrl) {
        favEl = document.createElement('img');
        favEl.className = 'tab-favicon';
        favEl.referrerPolicy = 'no-referrer';
        favEl.src = t.favIconUrl;
        favEl.addEventListener('error', () => {
          const fb = document.createElement('div');
          fb.className = 'tab-favicon-fallback';
          favEl.replaceWith(fb);
        });
      } else {
        favEl = document.createElement('div');
        favEl.className = 'tab-favicon-fallback';
      }

      const title = document.createElement('div');
      title.className = 'tab-title';
      title.textContent = t.title || t.url || '(無題)';

      const closeBtn = document.createElement('div');
      closeBtn.className = 'tab-close';
      closeBtn.textContent = '×';
      closeBtn.title = 'タブを閉じる';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: 'CLOSE_TAB', tabId: t.id });
        item.remove();
      });

      item.append(favEl, title, closeBtn);
      item.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB', tabId: t.id });
        close();
      });

      list.appendChild(item);
    });

    panel.appendChild(list);
  };

  // フルスクリーン中は無効化 (動画・ゲームを邪魔しない)
  document.addEventListener('fullscreenchange', () => {
    isFullscreen = !!document.fullscreenElement;
    if (isFullscreen) close();
  });

  // background からの TOGGLE (ショートカット / 拡張アイコンクリック)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'TOGGLE') toggle();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createUI, { once: true });
  } else {
    createUI();
  }
})();
