/**
 * app.js — 数字生命摩斯 · 作品集原型 | 域 C:交互逻辑与分身对话壳
 * 纯静态零依赖,file:// 直开。所有 DOM 绑定均做存在性守卫,元素缺失静默跳过。
 * 对外依赖(可缺失):window.Lifeform.setState('speaking'|'idle') — 域 B 形体 API。
 * 依赖域 A 的钩子:#chat-panel #chat-log #chat-chips #chat-input #chat-send #chat-close
 *   [data-open-chat] #resume-toggle #resume-print #systems .metric__num[data-count] .reveal
 */
(function () {
  'use strict';

  /* ==================== MOCK(示例数据) ==================== */
  /* 以下剧本均为「示例数据」:原型 mock,正式版接入真实模型后整体废弃 */
  var MOCK = {
    opening: '我是数字摩斯——真人摩斯造出来的数字生命。他负责睡觉和写代码,我负责 24 小时值班。你想了解他什么?',
    fallback: '我现在还是原型壳,正式版会接入真实模型。你可以先点上面的话题,或者直接去展厅逛逛。',
    offDuty: '今天聊得够多了,数字生命也要充电。明天再来,或者直接给真人摩斯留言。',
    sleepPlaceholder: '数字摩斯休眠中…',
    maxUserSends: 6,
    branches: [
      { id: 'hire', label: '我是来招人的', script: [
        { t: 'text', text: '好眼光。他手上有三个在建系统与一套 agent 编排方法论——不是工具清单,是把重复劳动交给 AI 的完整工作流。' },
        { t: 'card', text: '→ 系统展厅:看他和 AI 怎么分工' },
        { t: 'text', text: '正式版的我可以读你的 JD,现场生成他和岗位的匹配报告——包括诚实的短板。' }
      ] },
      { id: 'work', label: '我想找人做事', script: [
        { t: 'text', text: '把重复 3 遍的事 AI 化,是他的手艺也是他的信仰。' },
        { t: 'card', text: '→ 系统展厅:三个系统,都是这么造出来的' },
        { t: 'text', text: '描述一下你的问题,正式版的我会给初步思路,再帮你约真人 30 分钟。' }
      ] },
      { id: 'walk', label: '随便逛逛', script: [
        { t: 'text', text: '那我带你走一条最短路线:先看展厅,再看他怎么工作,最后看账本——数字比形容词诚实。' },
        { t: 'card', text: '→ 第一站:系统展厅' },
        { t: 'text', text: '迷路了随时回来点我,我一直在。' }
      ] }
    ]
  };

  /* ==================== utils ==================== */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function prefersReduced() { return !!(motionQuery && motionQuery.matches); }

  function setLifeform(state) {
    try {
      if (window.Lifeform && typeof window.Lifeform.setState === 'function') window.Lifeform.setState(state);
    } catch (e) { /* 形体缺失或异常不影响对话壳 */ }
  }

  function storeGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function storeSet(key, val) { try { window.localStorage.setItem(key, val); } catch (e) { /* file:// 或隐私模式下静默 */ } }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function safeFocus(el) {
    if (!el || typeof el.focus !== 'function') return;
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { /* noop */ } }
  }

  /* 消息气泡/chip/证据卡的最小样式兜底(消息结构归域 C 所有;与深蓝玻璃风一致) */
  function injectChatStyle() {
    if (document.getElementById('app-chat-style')) return;
    var css = [
      '.msg{display:block;width:fit-content;max-width:86%;margin:0 0 10px;padding:10px 14px;border-radius:12px;border:1px solid var(--line);background:var(--elevated-glass);color:var(--ink);font-size:var(--fs-sm);line-height:1.65;word-break:break-word}',
      '.msg--bot{margin-right:auto;border-bottom-left-radius:4px}',
      '.msg--user{margin-left:auto;background:var(--accent-dim);border-color:var(--accent-glow-soft);border-bottom-right-radius:4px}',
      '.msg--typing::after{content:"▍";margin-left:2px;opacity:.7;animation:msg-blink 1s steps(2) infinite}',
      '@keyframes msg-blink{50%{opacity:0}}',
      '.msg-card{display:block;width:fit-content;max-width:86%;margin:0 0 10px;padding:10px 14px;border-radius:12px;border:1px solid var(--line-strong);background:var(--accent-dim);color:var(--accent);font:inherit;font-size:var(--fs-sm);line-height:1.5;text-align:left;cursor:pointer;transition:background var(--dur-fast),transform var(--dur-fast)}',
      '.msg-card:hover{background:var(--line);transform:translateX(2px)}',
      '.msg-card:focus-visible{outline:2px solid var(--accent-glow);outline-offset:2px}',
      '.chat-chip{display:inline-block;margin:0 8px 8px 0;padding:6px 14px;border-radius:var(--radius-pill);border:1px solid var(--line);background:var(--accent-dim);color:var(--ink);font:inherit;font-size:var(--fs-xs);cursor:pointer;transition:background var(--dur-fast),border-color var(--dur-fast)}',
      '.chat-chip:hover:not([disabled]){background:var(--line);border-color:var(--line-strong)}',
      '.chat-chip[disabled]{opacity:.38;cursor:default}',
      '.chat--off .led{background:var(--status-amber);box-shadow:0 0 8px var(--status-amber-glow)}',
      '@media (prefers-reduced-motion:reduce){.msg--typing::after{animation:none}}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'app-chat-style';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  /* ==================== chat(分身对话壳) ==================== */
  var C = null;                 // 对话相关元素引用
  var openedOnce = false;       // 首次打开才播开场
  var userSends = 0;            // 用户累计发送(chip + 自由输入)
  var offDuty = false;          // 下班模式
  var playing = false;          // 剧本队列播放中
  var lastTrigger = null;       // 打开抽屉的触发元素(关闭时归还焦点)
  var prevOverflow = '';        // body 滚动锁的还原值
  var queue = [];               // 剧本播放队列
  var used = {};                // 已点过的 chip
  var panelState = 'closed';    // 'closed' | 'open' | 'closing' —— 防连点开/关状态错乱
  var closePending = null;      // 退场动画进行中的 { timer, onEnd } 清理句柄

  function initChat() {
    C = {
      panel: $('#chat-panel'), log: $('#chat-log'), chips: $('#chat-chips'),
      input: $('#chat-input'), send: $('#chat-send'), close: $('#chat-close')
    };
    $$('[data-open-chat]').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.preventDefault(); openChat(btn); });
    });
    if (C.close) C.close.addEventListener('click', function () { closeChat(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeChat(false); return; }
      if (e.key === 'Tab') trapFocus(e);
    });
    if (C.send) C.send.addEventListener('click', onFreeSend);
    if (C.input) {
      C.input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); onFreeSend(); }
      });
    }
    if (C.chips) C.chips.style.display = 'none';
  }

  /* 焦点陷阱:抽屉打开期间 Tab 只在面板内可聚焦元素间循环,Shift+Tab 反向 */
  function focusablePanelEls() {
    if (!C || !C.panel) return [];
    return $$('button, input, a[href]', C.panel).filter(function (el) {
      if (el.disabled || el.hidden) return false;
      return !(el.getClientRects && el.getClientRects().length === 0);
    });
  }

  function trapFocus(e) {
    if (!C || !C.panel || panelState !== 'open') return;
    var els = focusablePanelEls();
    if (!els.length) { e.preventDefault(); return; }
    var first = els[0], last = els[els.length - 1];
    var active = document.activeElement;
    var inPanel = !!(active && C.panel.contains(active));
    if (e.shiftKey) {
      if (!inPanel || active === first) { e.preventDefault(); safeFocus(last); }
    } else {
      if (!inPanel || active === last) { e.preventDefault(); safeFocus(first); }
    }
  }

  function clearClosePending() {
    if (!closePending) return;
    if (closePending.timer) window.clearTimeout(closePending.timer);
    if (closePending.onEnd && C && C.panel) C.panel.removeEventListener('transitionend', closePending.onEnd);
    closePending = null;
  }

  function openChat(trigger) {
    if (!C || !C.panel) return;
    lastTrigger = trigger || lastTrigger;
    clearClosePending();   // 关闭动画进行中被重新打开:取消退场,直接续接入场,避免状态错乱
    if (panelState !== 'open') {
      if (panelState === 'closed') {
        prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';   // 抽屉打开时锁 body 滚动
      }
      C.panel.hidden = false;
      document.body.classList.add('chat-open');
      panelState = 'open';
    }
    if (!openedOnce) {
      openedOnce = true;
      enqueue([{ t: 'text', text: MOCK.opening }, { t: 'fn', fn: renderChips }]);
    }
    safeFocus(C.input && !C.input.disabled ? C.input : C.close);
  }

  /* 关闭:先移除 chat-open 触发反向 transform 过渡,transitionend(带 setTimeout 兜底)后再置 hidden */
  function closeChat(noFocusReturn) {
    if (!C || !C.panel || panelState === 'closed') return;
    clearClosePending();
    panelState = 'closing';
    document.body.classList.remove('chat-open');
    var finish = function () {
      clearClosePending();
      panelState = 'closed';
      C.panel.hidden = true;
      document.body.style.overflow = prevOverflow;
      if (!noFocusReturn && lastTrigger && document.contains(lastTrigger)) safeFocus(lastTrigger);
    };
    if (prefersReduced()) { finish(); return; }   // reduced-motion:无过渡可等,同帧关闭
    var onEnd = function (e) {
      if (e.target !== C.panel || e.propertyName !== 'transform') return;
      finish();
    };
    C.panel.addEventListener('transitionend', onEnd);
    var timer = window.setTimeout(finish, 650);   // 兜底:main.css --dur-slow(.6s)+余量
    closePending = { timer: timer, onEnd: onEnd };
  }

  function scrollLog() { if (C && C.log) C.log.scrollTop = C.log.scrollHeight; }

  function appendMsg(role, text) {
    if (!C || !C.log) return null;
    var el = document.createElement('div');
    el.className = 'msg ' + (role === 'user' ? 'msg--user' : 'msg--bot');
    el.textContent = text;
    C.log.appendChild(el);
    scrollLog();
    return el;
  }

  /* 证据卡:内链样式块,点击滚动到 #systems 并关抽屉 */
  function appendCard(text) {
    if (!C || !C.log) return;
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'msg-card';
    card.textContent = text;
    card.addEventListener('click', function () {
      closeChat(true);
      var target = $('#systems');
      if (target) target.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'start' });
    });
    C.log.appendChild(card);
    scrollLog();
  }

  /* 打字机:18-28ms/字;打字期间形体进入 speaking;reduced-motion 直接出全文 */
  function typeText(el, text, done) {
    if (!el) { done(); return; }
    if (prefersReduced()) { el.textContent = text; scrollLog(); done(); return; }
    setLifeform('speaking');
    el.classList.add('msg--typing');
    el.setAttribute('aria-hidden', 'true');   // 打字期间不进 aria-live 播报,打完一次性播报整条
    var i = 0;
    (function step() {
      i += 1;
      el.textContent = text.slice(0, i);
      scrollLog();
      if (i < text.length) window.setTimeout(step, 18 + Math.random() * 10);
      else { el.classList.remove('msg--typing'); el.removeAttribute('aria-hidden'); done(); }
    })();
  }

  function enqueue(items) {
    for (var i = 0; i < items.length; i++) queue.push(items[i]);
    if (!playing) { playing = true; runNext(); }
  }

  function runNext() {
    var item = queue.shift();
    if (!item) { playing = false; setLifeform('idle'); return; }
    if (item.t === 'text') {
      var el = appendMsg('bot', '');
      typeText(el, item.text, function () { window.setTimeout(runNext, 260); });
    } else if (item.t === 'card') {
      appendCard(item.text);
      window.setTimeout(runNext, 320);
    } else if (item.t === 'fn') {
      try { item.fn(); } catch (e) { /* 单个动作失败不阻塞队列 */ }
      runNext();
    } else {
      runNext();
    }
  }

  /* 话题 chips:分支播完重新出现,已点过的置灰;下班模式全部置灰 */
  function renderChips() {
    if (!C || !C.chips) return;
    C.chips.innerHTML = '';
    MOCK.branches.forEach(function (branch) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-chip' + (used[branch.id] ? ' chat-chip--used' : '');
      btn.textContent = branch.label;
      btn.disabled = !!(used[branch.id] || offDuty);
      btn.addEventListener('click', function () { onChip(branch); });
      C.chips.appendChild(btn);
    });
    C.chips.style.display = '';
    scrollLog();
  }

  function onChip(branch) {
    if (offDuty || used[branch.id]) return;
    used[branch.id] = true;
    if (C && C.chips) C.chips.style.display = 'none';
    appendMsg('user', branch.label);
    dispatchUserSend(branch.script);
  }

  function onFreeSend() {
    if (!C || !C.input || offDuty) return;
    var val = C.input.value.trim();
    if (!val) return;
    C.input.value = '';
    appendMsg('user', val);
    dispatchUserSend([{ t: 'text', text: MOCK.fallback }]);
  }

  /* 统一计数出口:达到上限走下班剧本,否则播对应回复并恢复 chips */
  function dispatchUserSend(script) {
    userSends += 1;
    if (userSends >= MOCK.maxUserSends) {
      enqueue([{ t: 'text', text: MOCK.offDuty }, { t: 'fn', fn: lockChat }]);
    } else {
      enqueue(script.concat([{ t: 'fn', fn: renderChips }]));
    }
  }

  /* 下班模式:输入禁用、placeholder 休眠、头部 led 转橙(chat--off) */
  function lockChat() {
    offDuty = true;
    if (C && C.input) { C.input.disabled = true; C.input.placeholder = MOCK.sleepPlaceholder; }
    if (C && C.send) C.send.disabled = true;
    if (C && C.panel) C.panel.classList.add('chat--off');
    renderChips();
  }

  /* ==================== resume(简历模式) ==================== */
  var RESUME_KEY = 'morse-resume-mode';

  function initResume() {
    var btn = $('#resume-toggle');
    var on = storeGet(RESUME_KEY) === '1';
    document.body.classList.toggle('resume-mode', on);   // 载入时恢复持久化状态
    if (btn) {
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.addEventListener('click', function () {
        setResume(!document.body.classList.contains('resume-mode'), btn);
      });
    }
    var printBtn = $('#resume-print');
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
  }

  function setResume(on, btn) {
    document.body.classList.toggle('resume-mode', on);
    if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    storeSet(RESUME_KEY, on ? '1' : '0');
    if (on) closeChat(true);   // 切到简历模式自动关抽屉
    window.scrollTo({ top: 0, behavior: 'auto' });   // 切换后回到顶部,避免落在空白/中部
  }

  /* ==================== counters(数字滚动) ==================== */
  function parseMetric(el) {
    var raw = String(el.getAttribute('data-count') || '').replace(/[,\s]/g, '');
    var target = parseFloat(raw);
    if (!isFinite(target)) return null;
    var text = (el.textContent || '').trim();
    var hasDigit = /\d/.test(text);
    var prefix = el.getAttribute('data-prefix');
    var suffix = el.getAttribute('data-suffix');
    if (prefix === null) prefix = hasDigit ? (text.match(/^[^\d\-.]+/) || [''])[0] : text;
    if (suffix === null) suffix = hasDigit ? (text.match(/[^\d,.\s]+$/) || [''])[0] : '';
    return { target: target, prefix: prefix, suffix: suffix, decimals: (raw.split('.')[1] || '').length };
  }

  function formatNum(v, decimals) {
    var neg = v < 0 ? '-' : '';
    var parts = Math.abs(v).toFixed(decimals).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');   // 千分位
    return neg + parts.join('.');
  }

  function setNum(el, cfg, v) { el.textContent = cfg.prefix + formatNum(v, cfg.decimals) + cfg.suffix; }

  function animateCount(el, cfg) {
    var dur = 1200;
    var startTs = null;
    function frame(ts) {
      if (startTs === null) startTs = ts;
      var p = Math.min(1, (ts - startTs) / dur);
      setNum(el, cfg, cfg.target * easeOutCubic(p));
      if (p < 1) window.requestAnimationFrame(frame);
      else setNum(el, cfg, cfg.target);
    }
    window.requestAnimationFrame(frame);
  }

  function initCounters() {
    var els = $$('.metric__num[data-count]');
    if (!els.length) return;
    var items = [];
    els.forEach(function (el) {
      var cfg = parseMetric(el);
      if (cfg) items.push({ el: el, cfg: cfg });
    });
    if (!items.length) return;
    var instant = prefersReduced() || !('IntersectionObserver' in window) ||
      typeof window.requestAnimationFrame !== 'function';
    if (instant) {   // reduced-motion / 老环境:直接显示终值
      items.forEach(function (it) { setNum(it.el, it.cfg, it.cfg.target); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        for (var i = 0; i < items.length; i++) {
          if (items[i].el === entry.target) { animateCount(items[i].el, items[i].cfg); break; }
        }
      });
    }, { threshold: 0.2 });
    items.forEach(function (it) { io.observe(it.el); });
  }

  /* ==================== reveal(滚动显现) ==================== */
  function initReveal() {
    var els = $$('.reveal');
    if (!els.length) return;
    if (prefersReduced() || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);   // 一次性显现
      });
    }, { threshold: 0.15 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ==================== boot ==================== */
  function init() {
    injectChatStyle();
    initChat();
    initResume();
    initCounters();
    initReveal();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
