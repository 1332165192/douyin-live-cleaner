// ==UserScript==
// @name         抖音直播间净化助手（弹幕/礼物提示默认关闭）
// @namespace    https://github.com/douyin-live-cleaner
// @version      1.2.0
// @description  进入抖音直播间自动关闭弹幕和礼物提示（可手动开启），可选自动隐藏心愿单弹窗（默认不隐藏）。设置入口为播放器控制栏"画质"按钮左侧的"净化"按钮。弹幕=视频上方滚动弹幕层；礼物提示=礼物全屏特效、礼物连击托盘/横幅、聊天区送礼消息、礼物声音。基于对 live.douyin.com 播放器逆向分析：#DanmakuLayout(CanvasDanmakuPlugin)、#GiftEffectLayout(GiftEffectPlugin)、#GiftTrayLayout(GiftTrayPlugin)、webcast-chatroom___gift-message、june_danmaku_switch / june_effect_switch / danmakuConfig / disable_gift_audio / GiftGuideDateMark(心愿单当日关闭) 等官方存储键。
// @author       reverse-analysis
// @match        *://live.douyin.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';
  if (window.__dyLiveCleanerLoaded) return;
  window.__dyLiveCleanerLoaded = true;

  /* ================= 状态存储 =================
   * 默认值均为 '0'（关闭）：
   *   dyc_danmaku = 0 → 隐藏弹幕层（默认）
   *   dyc_gift    = 0 → 隐藏礼物提示（默认）
   * 使用页面 localStorage 持久化（@grant none 运行在页面上下文） */
  const LS_DANMAKU = 'dyc_danmaku';
  const LS_GIFT = 'dyc_gift';
  const LS_WISH = 'dyc_wishlist'; // '1' = 自动隐藏心愿单（默认 '0' 不隐藏）
  const STYLE_ID = 'dyc-cleaner-style';

  const isOn = k => localStorage.getItem(k) === '1';
  const setKey = (k, v) => {
    try { v ? localStorage.setItem(k, '1') : localStorage.setItem(k, '0'); } catch (e) {}
  };

  /* ================= 逆向得到的官方锚点 ================= */
  // 1) 弹幕层：#DanmakuLayout > .CanvasDanmakuPlugin（canvas 渲染）
  //    官方开关：快捷键 B / 设置面板 [data-e2e="danmaku-switch"]
  //    官方持久化：localStorage["june_danmaku_switch"]（受 AB 门控 liveJuneStorageOpt，门控未开时无效，故叠加 CSS 保证）
  // 2) 礼物特效：#GiftEffectLayout > .GiftEffectPlugin（全屏特效动画）
  //    礼物连击托盘/横幅：#GiftTrayLayout > .GiftTrayPlugin
  //    官方开关：礼物设置面板 [data-e2e="gift-setting"] → [data-e2e="effect-switch"]
  //    官方持久化：localStorage["june_effect_switch"]
  // 3) 聊天区送礼消息：.webcast-chatroom___gift-message（BEM 类名，见 island_*.css）
  //    官方开关：弹幕设置面板"送礼信息"（giftOn），持久化于
  //    localStorage["DanmaSetting_GiftAndPackage"]["${wid}_${roomId}"] 或全局 localStorage["danmakuConfig"]
  // 4) 礼物声音：cookie "disable_gift_audio"（1=禁用，官方 setGiftAudioEnable 写入）
  //    运行时事件：CustomEvent "live-gift-audio-setting-change"（detail=是否启用）

  const CSS_RULES = [
    /* 弹幕层（canvas 弹幕） */
    '#DanmakuLayout, #DanmakuLayout > * { display: none !important; }',
    /* 礼物全屏特效 + 礼物连击托盘/横幅 */
    '#GiftEffectLayout, #GiftTrayLayout { display: none !important; }',
    /* 聊天区送礼消息（含包裹行，:has 为现代 Chrome 特性） */
    '.webcast-chatroom___gift-message { display: none !important; }',
    '.webcast-chatroom___item-wrapper:has(.webcast-chatroom___gift-message) { display: none !important; }'
  ];

  function applyCss(onDanmakuOff, onGiftOff) {
    ensureStyle(onDanmakuOff, onGiftOff);
  }

  /* ================= 官方持久化同步（尽力而为） =================
   * 同步写入抖音官方使用的存储键：即使 AB 实验未开启导致官方读取被跳过，
   * 也不产生副作用；一旦 AB 开启即可获得与官方设置面板一致的效果。 */
  function seedOfficial(danmakuOff, giftOff, wishHide) {
    try {
      // 弹幕开关（JSON 布尔字符串，与官方 setSwitchStatus 写法一致）
      localStorage.setItem('june_danmaku_switch', JSON.stringify(!danmakuOff));
      // 礼物特效开关
      localStorage.setItem('june_effect_switch', JSON.stringify(!giftOff));
      // 心愿单：官方"当日关闭"标记
      seedWishDateMark(wishHide);
      if (giftOff) {
        // 全局弹幕配置：送礼信息 / 福袋口令（官方 getter：Number(value)）
        let cfg = {};
        try { cfg = JSON.parse(localStorage.getItem('danmakuConfig')) || {}; } catch (e) {}
        cfg.giftOn = false;
        cfg.packageOn = false;
        localStorage.setItem('danmakuConfig', JSON.stringify(cfg));
        // 礼物声音：cookie 1=禁用（官方 disable_gift_audio）
        document.cookie = 'disable_gift_audio=1; domain=.douyin.com; path=/; max-age=31536000';
        window.dispatchEvent(new CustomEvent('live-gift-audio-setting-change', { detail: false }));
      } else {
        // 恢复官方默认（礼物提示开启 → 声音开启）
        let cfg = {};
        try { cfg = JSON.parse(localStorage.getItem('danmakuConfig')) || {}; } catch (e) {}
        if ('giftOn' in cfg || 'packageOn' in cfg) {
          cfg.giftOn = true;
          cfg.packageOn = true;
          localStorage.setItem('danmakuConfig', JSON.stringify(cfg));
        }
        document.cookie = 'disable_gift_audio=0; domain=.douyin.com; path=/; max-age=31536000';
        window.dispatchEvent(new CustomEvent('live-gift-audio-setting-change', { detail: true }));
      }
    } catch (e) { /* 存储不可用时忽略 */ }
  }

  function applyAll() {
    const danmakuOff = !isOn(LS_DANMAKU);
    const giftOff = !isOn(LS_GIFT);
    const wishHide = isOn(LS_WISH);
    applyCss(danmakuOff, giftOff);
    seedOfficial(danmakuOff, giftOff, wishHide);
    renderPanel();
  }

  /* ================= 心愿单隐藏 =================
   * 逆向结论（RoomInfoBar  chunk / client-entry store）：
   * - 心愿单以礼物引导弹窗形式出现（标题"帮主播完成心愿吧"，Tooltip overlay）
   * - 官方点关闭时写入 localStorage["GiftGuideDateMark"]["wish_list"] = "YYYY-M-D"
   *   （月份为 0 索引，见模块 836033），当日不再自动弹出 → 直接复用该机制
   * - 已渲染的弹窗由 hideWishOverlays() 兜底隐藏 */
  function todayMark() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function seedWishDateMark(hide) {
    try {
      let mark = {};
      try { mark = JSON.parse(localStorage.getItem('GiftGuideDateMark')) || {}; } catch (e) {}
      if (hide) {
        if (mark.wish_list !== todayMark()) {
          mark.wish_list = todayMark();
          localStorage.setItem('GiftGuideDateMark', JSON.stringify(mark));
        }
      } else if ('wish_list' in mark) {
        delete mark.wish_list;
        localStorage.setItem('GiftGuideDateMark', JSON.stringify(mark));
      }
    } catch (e) {}
  }

  // 隐藏已渲染的心愿单弹窗：按标题文本定位，向上找到 overlay 容器隐藏
  function hideWishOverlays() {
    const titles = document.querySelectorAll('div');
    for (const el of titles) {
      const t = (el.textContent || '').trim();
      if (t !== '帮主播完成心愿吧' && t !== '心愿单') continue;
      if (el.childElementCount > 1) continue; // 只匹配叶子标题节点
      let node = el;
      for (let i = 0; i < 8 && node; i++) {
        const cs = getComputedStyle(node);
        const r = node.getBoundingClientRect();
        if ((cs.position === 'absolute' || cs.position === 'fixed') && r.width > 140 && r.height > 50) break;
        node = node.parentElement;
      }
      if (node && node.style.display !== 'none') node.style.display = 'none';
    }
  }

  /* ================= 启动期节点守护 =================
   * 抖音应用在启动/hydration 阶段会清除 <html> 下的外来节点，
   * 因此 document-start 时先挂到 documentElement，body 就绪后迁移到
   * document.body（安全区），并由看门狗在节点丢失时自动重建。 */
  function ensureStyle(danmakuOff, giftOff) {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
    }
    const parts = [];
    if (danmakuOff) parts.push(CSS_RULES[0]);
    if (giftOff) parts.push(CSS_RULES[1], CSS_RULES[2], CSS_RULES[3]);
    const css = parts.join('\n');
    if (style.textContent !== css) style.textContent = css;
    const preferred = document.head || document.documentElement;
    if (style.parentNode !== preferred) preferred.appendChild(style);
  }

  function ensureButton() {
    if (!document.getElementById(BTN_ID)) buildButton();
    return document.getElementById(BTN_ID);
  }

  function watchdog() {
    const danmakuOff = !isOn(LS_DANMAKU);
    const giftOff = !isOn(LS_GIFT);
    const wishHide = isOn(LS_WISH);
    ensureStyle(danmakuOff, giftOff);
    const btn = ensureButton();
    if (btn) renderPanel();
    // 礼物提示关闭时守护静音 cookie（官方可能在启动时重置）
    if (giftOff && !/disable_gift_audio=1/.test(document.cookie)) {
      document.cookie = 'disable_gift_audio=1; domain=.douyin.com; path=/; max-age=31536000';
      window.dispatchEvent(new CustomEvent('live-gift-audio-setting-change', { detail: false }));
    }
    // 心愿单：日期标记 + 隐藏已渲染弹窗
    if (wishHide) {
      seedWishDateMark(true);
      hideWishOverlays();
    }
  }

  /* ================= SPA 导航感知 =================
   * 站内切换直播间（pushState）不会重载页面，监听 URL 变化重新应用。 */
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      applyAll();
    }
  }, 800);
  window.addEventListener('popstate', applyAll);

  /* ================= 播放器控制栏按钮 =================
   * 将"净化"按钮插入播放器控制栏右侧、画质按钮(QualitySwitchNewPlugin)左边，
   * 点击弹出设置气泡（含弹幕/礼物提示/心愿单三个开关）。
   * 按钮作为画质按钮的同级兄弟插入，随控制栏一起显隐。 */
  const BTN_ID = 'dyc-ctrl-btn';

  function findQualityBtn() {
    const q = document.querySelector('[class*="QualitySwitchNewPlugin"]');
    if (q) return q;
    // 兜底：控制栏右侧文本为画质名称的按钮
    const right = document.querySelector('[class*="douyin-player-controls-right"]');
    if (!right) return null;
    return [...right.querySelectorAll('div')].find(e => /^(原画|蓝光|超清|高清|标清|流畅)$/.test((e.innerText || '').trim()));
  }

  function buildButton() {
    const quality = findQualityBtn();
    if (!quality || !quality.parentElement) return null;
    const wrap = document.createElement('div');
    wrap.id = BTN_ID;
    wrap.innerHTML = `
      <style>
        #dyc-ctrl-btn {
          position: relative; height: 32px; display: flex; align-items: center;
          font: 14px/32px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
          color: #fff; user-select: none;
        }
        #dyc-ctrl-btn * { box-sizing: border-box; }
        #dyc-ctrl-btn .dyc-btn {
          cursor: pointer; padding: 0 8px; height: 32px; line-height: 32px;
          border-radius: 4px; white-space: nowrap;
        }
        #dyc-ctrl-btn .dyc-btn:hover { background: rgba(255,255,255,.15); }
        #dyc-ctrl-btn .dyc-pop {
          display: none; position: absolute; bottom: 32px; right: 0; width: 150px;
          background: rgba(20,20,28,.95); border-radius: 10px; padding: 8px 12px 10px;
          box-shadow: 0 4px 16px rgba(0,0,0,.4); backdrop-filter: blur(6px);
          font-size: 12px; line-height: 1.6; z-index: 2147483647; cursor: default;
        }
        #dyc-ctrl-btn .dyc-pop.dyc-open { display: block; }
        #dyc-ctrl-btn .dyc-pop-title {
          font-weight: 600; letter-spacing: .5px; padding-bottom: 4px;
          border-bottom: 1px solid rgba(255,255,255,.12);
        }
        #dyc-ctrl-btn .dyc-row {
          display: flex; align-items: center; justify-content: space-between;
          margin-top: 8px; min-height: 22px;
        }
        #dyc-ctrl-btn .dyc-label { color: rgba(255,255,255,.85); }
        #dyc-ctrl-btn .dyc-switch {
          position: relative; width: 34px; height: 18px; border-radius: 9px;
          background: rgba(255,255,255,.25); cursor: pointer; transition: background .2s;
          flex: none;
        }
        #dyc-ctrl-btn .dyc-switch::after {
          content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
          border-radius: 50%; background: #fff; transition: left .2s;
        }
        #dyc-ctrl-btn .dyc-switch.dyc-on { background: #fe2c55; }
        #dyc-ctrl-btn .dyc-switch.dyc-on::after { left: 18px; }
        #dyc-ctrl-btn .dyc-state { font-size: 11px; margin-right: 6px; color: rgba(255,255,255,.6); }
      </style>
      <div class="dyc-btn" title="直播间净化设置">净化</div>
      <div class="dyc-pop">
        <div class="dyc-pop-title">直播间净化</div>
        <div class="dyc-row">
          <span class="dyc-label">弹幕</span>
          <span style="display:flex;align-items:center">
            <span class="dyc-state" id="dyc-danmaku-state"></span>
            <div class="dyc-switch" id="dyc-danmaku-switch" title="开启/关闭弹幕（默认关闭）"></div>
          </span>
        </div>
        <div class="dyc-row">
          <span class="dyc-label">礼物提示</span>
          <span style="display:flex;align-items:center">
            <span class="dyc-state" id="dyc-gift-state"></span>
            <div class="dyc-switch" id="dyc-gift-switch" title="开启/关闭礼物提示（默认关闭）"></div>
          </span>
        </div>
        <div class="dyc-row">
          <span class="dyc-label">心愿单</span>
          <span style="display:flex;align-items:center">
            <span class="dyc-state" id="dyc-wish-state"></span>
            <div class="dyc-switch" id="dyc-wish-switch" title="自动隐藏心愿单弹窗（默认不隐藏）"></div>
          </span>
        </div>
      </div>`;
    // 控制栏为 row-reverse 布局（DOM 顺序与视觉顺序相反）：
    // 要在视觉上位于画质按钮左边，需在 DOM 中插到它后面
    quality.parentElement.insertBefore(wrap, quality.nextSibling);

    const btn = wrap.querySelector('.dyc-btn');
    const pop = wrap.querySelector('.dyc-pop');
    // 鼠标移入显示菜单，移出隐藏（气泡是 wrap 子节点，移入气泡不触发移出）
    let hideTimer = null;
    wrap.addEventListener('mouseenter', () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      pop.classList.add('dyc-open');
    });
    wrap.addEventListener('mouseleave', () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => pop.classList.remove('dyc-open'), 200);
    });
    // 气泡内点击不冒泡（避免触发播放器点击暂停等）
    pop.addEventListener('click', e => e.stopPropagation());

    // 切换事件
    pop.querySelector('#dyc-danmaku-switch').addEventListener('click', () => {
      setKey(LS_DANMAKU, !isOn(LS_DANMAKU));
      applyAll();
    });
    pop.querySelector('#dyc-gift-switch').addEventListener('click', () => {
      setKey(LS_GIFT, !isOn(LS_GIFT));
      applyAll();
    });
    pop.querySelector('#dyc-wish-switch').addEventListener('click', () => {
      setKey(LS_WISH, !isOn(LS_WISH));
      applyAll();
    });

    return wrap;
  }

  function renderPanel() {
    const p = document.getElementById(BTN_ID);
    if (!p) return;
    const dOn = isOn(LS_DANMAKU), gOn = isOn(LS_GIFT), wOn = isOn(LS_WISH);
    const dSw = p.querySelector('#dyc-danmaku-switch');
    const gSw = p.querySelector('#dyc-gift-switch');
    const wSw = p.querySelector('#dyc-wish-switch');
    if (!dSw || !gSw || !wSw) return;
    dSw.classList.toggle('dyc-on', dOn);
    gSw.classList.toggle('dyc-on', gOn);
    wSw.classList.toggle('dyc-on', wOn);
    p.querySelector('#dyc-danmaku-state').textContent = dOn ? '开启' : '关闭';
    p.querySelector('#dyc-gift-state').textContent = gOn ? '开启' : '关闭';
    p.querySelector('#dyc-wish-state').textContent = wOn ? '隐藏' : '显示';
    dSw.title = dOn ? '点击关闭弹幕' : '点击开启弹幕';
    gSw.title = gOn ? '点击开启礼物提示' : '点击关闭礼物提示';
    wSw.title = wOn ? '点击恢复显示心愿单' : '点击自动隐藏心愿单';
  }

  /* ================= 启动 ================= */
  // document-start 极早期 documentElement 可能为 null（html 尚未解析），延迟重试直至可用
  function tryInit() {
    if (!document.documentElement) {
      setTimeout(tryInit, 0);
      return;
    }
    applyAll();    // style 立即生效（此时 document.head 可能未就绪，挂 documentElement）
    setInterval(watchdog, 1000);
    watchdog();
  }
  tryInit();
})();
