/* ============================================================================
 * lifeform.js — 数字生命形体 · 首屏主视觉(域 B)
 * 深空蓝色域中一团会呼吸、随鼠标缓慢流动的发光有机体。零依赖,file:// 直开。
 *
 * 渲染降级链(内置自检,全程静默):
 *   [GL] WebGL 全屏三角 + fbm 噪声发光体:需上下文创建成功(拒绝软件渲染)
 *        + shader 编译链接通过 + 首帧无 GL 错误
 *   [2D] Canvas2D 三层径向渐变弥散光场(30fps 上限):GL 初始化任一环节失败 /
 *        运行期 webglcontextlost / 滚动 60 帧平均 fps < 30 时进入
 *   [静] prefers-reduced-motion → 当前渲染器绘制 1 帧静态画面后停止 rAF
 *   [无] canvas 不存在或两路渲染器均不可用 → 静默退出,不抛错不打日志
 *
 * 公共 API:window.Lifeform = { init(), setState('idle' | 'speaking'), params }
 * 域 A 契约提醒:运行期降级会原位重建同名 canvas(属性保留、监听器不保留),
 * canvas 交互请做父级事件委托,或监听 document 'lifeform:canvas-replaced' 重绑。
 * window.Lifeform.params 是原型调试接口(见下方「可调参数区」尾部),用于 CEO 用
 * CDP 实时读写位置/尺寸/亮度/噪声等核心参数,直接改字段或整体赋值合并均在下一帧生效。
 * ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------ 可调参数区 */
  const CANVAS_ID = 'lifeform-canvas';

  // 配色(0-255 RGB;GLSL 与 Canvas2D 共用同一来源)
  const BG_RGB   = [10, 14, 26];    // 背景深空蓝 #0A0E1A,与页面底色一致保证无缝
  const MID_RGB  = [46, 91, 255];   // 中层深蓝 #2E5BFF
  const CORE_RGB = [94, 230, 208];  // 核心亮青 #5EE6D0

  const BREATH_IDLE_S  = 6.0;       // 呼吸周期 · idle(秒)
  const BREATH_SPEAK_S = 2.4;       // 呼吸周期 · speaking(秒)
  const BREATH_AMP     = 0.06;      // 呼吸幅度(半径比例,6%)
  const SPEAK_GAIN     = 0.15;      // speaking 亮度增益(比例,+15%)
  const SPEAK_RAMP_S   = 1.0;       // idle <-> speaking 线性过渡时长(秒)

  const MOUSE_MAX_FRAC = 0.04;      // 质心最大偏移(屏宽比例,4%)
  const MOUSE_LERP     = 0.02;      // 鼠标惰性跟随系数(每帧 lerp)

  const DPR_CAP     = 1.5;          // devicePixelRatio 上限
  const FPS_WINDOW  = 60;           // fps 滚动采样窗口(帧)
  const FPS_FLOOR   = 30;           // 窗口平均 fps 低于此值 → 降级(fps)
  const FPS_2D_CAP  = 30;           // Canvas2D 帧率上限(fps)
  const TIME_WRAP_S = 3600;         // shader 时钟回绕周期(秒;能被两个呼吸周期整除,跨回绕相位连续)
  const STATIC_T    = 6.0;          // reduced-motion 静态帧采样时刻(秒,呼吸相位为 0)

  /* --------------------------------------------------- 原型调试接口·默认值
   * 以下两组预设是 window.Lifeform.params 的初始值(init() 时按设备类型注入)。
   * 字段含义:
   *   centerX/centerY — 质心位置,屏幕比例(0-1),x 右 y 下(CSS 坐标系)
   *   sizeCore        — 核心亮区直径,屏幕短边(min(w,h))比例
   *   sizeHalo        — 可见发光区直径,屏幕短边比例
   *   peak            — 峰值亮度倍率(1.0 = 未调整前基准)
   *   noiseAmt        — 边缘 fbm 形变强度(越大越不规则)
   *   noisePow        — 边缘脊状噪声锐度(越大丝缕/撕裂感越强,越接近平滑云团)
   *   fadeX0/fadeX1   — 左侧衰减区间(uv.x,屏宽比例),[fadeX0,fadeX1] 内光晕平滑衰减到 0
   * 这是原型调试接口,供验收阶段实时调参用;正式站按需保留或收敛为固定值。
   * ------------------------------------------------------------------- */
  const DESKTOP_PARAMS = {             // CEO 真实浏览器逐组调参验收后的终版预设
    centerX: 0.68, centerY: 0.42,
    sizeCore: 0.28, sizeHalo: 1.6,
    peak: 1.0,
    noiseAmt: 1.0, noisePow: 1.2,
    fadeX0: 0.0, fadeX1: 0.48
  };
  const MOBILE_PARAMS = {              // CEO 真实浏览器逐组调参验收后的终版预设(pointer:coarse)
    centerX: 0.72, centerY: 0.26,
    sizeCore: 0.30, sizeHalo: 2.2,
    peak: 0.8,
    noiseAmt: 1.1, noisePow: 1.1,
    fadeX0: 0.0, fadeX1: 0.48
  };

  const TAU = Math.PI * 2;

  /* ---------------------------------------------------------------- 工具 */
  function lerp(a, b, k) { return a + (b - a) * k; }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')'; }
  function glv3(c) {                // [r,g,b] 0-255 → GLSL vec3 字面量
    return 'vec3(' + (c[0] / 255).toFixed(4) + ',' + (c[1] / 255).toFixed(4) + ',' + (c[2] / 255).toFixed(4) + ')';
  }
  function dpr() { return Math.min(window.devicePixelRatio || 1, DPR_CAP); }
  function sizeCanvas(canvas) {     // 物理像素 = CSS 像素 × dpr(封顶)
    const d = dpr();
    const w = canvas.clientWidth  || window.innerWidth  || 1;
    const h = canvas.clientHeight || window.innerHeight || 1;
    canvas.width  = Math.max(1, Math.round(w * d));
    canvas.height = Math.max(1, Math.round(h * d));
  }

  /* ------------------------------------------------------------ 全局状态 */
  const S = {
    inited: false, canvas: null,
    renderer: null,                   // { kind:'gl'|'2d', render(t), resize(), destroy(), lost?() }
    running: false,                   // 连续动画模式(reduced-motion 时为 false)
    reduced: false, mobile: false,
    raf: 0, startMs: 0, lastMs: 0,
    speak: 0, speakTarget: 0,         // u_speak 当前值 / 目标值(0..1 连续)
    moX: 0, moY: 0, moTX: 0, moTY: 0, // 质心偏移当前 / 目标(屏宽比例,y 向下为正)
    dts: [],                          // fps 采样环(仅 GL 模式)
    acc: 0,                           // 2D 限帧时间累加器(秒)
    params: Object.assign({}, DESKTOP_PARAMS) // 当前生效参数(init() 按设备类型覆盖;见 window.Lifeform.params)
  };

  /* --------------------------------------------------------- WebGL 渲染器 */
  const VERT = 'attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }';

  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float u_time;   // 秒(已回绕)
uniform vec2  u_res;    // 画布物理像素
uniform vec2  u_mouse;  // 质心偏移(min(res) 归一坐标,y 向上为正;鼠标惰性跟随)
uniform float u_speak;  // 0..1 连续值
uniform vec2  u_center; // 质心基准偏移(min(res) 归一坐标,来自 params.centerX/centerY)
uniform float u_peak;   // 峰值亮度倍率(来自 params.peak)
uniform float u_sizeK;  // 核心体致密度系数(来自 params.sizeCore,越大核心越小)
uniform float u_haloK;  // 外晕/丝缕衰减系数(来自 params.sizeHalo,越大可见区越小)
uniform float u_noiseAmt; // 边缘形变强度(来自 params.noiseAmt)
uniform float u_noisePow; // 边缘脊状噪声锐度(来自 params.noisePow)
uniform float u_fade0;  // 左侧衰减起点(uv.x,来自 params.fadeX0)
uniform float u_fade1;  // 左侧衰减终点(uv.x,来自 params.fadeX1)

const float TAU = 6.28318530718;
float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 q) {              // value noise,双线性 + smooth 插值
  vec2 i = floor(q);
  vec2 f = fract(q);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i),                  hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 q) {                 // 4 octaves,值域约 [0, 0.94],无更深循环
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(q);
    q = r * q * 2.02 + 19.19;
    a *= 0.5;
  }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;                       // 绝对屏幕比例坐标,不随质心/鼠标偏移
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  p -= u_center;                                           // 质心基准偏移(右偏上)
  p -= u_mouse;                                            // 质心随鼠标惰性偏移

  // 呼吸:idle/speaking 两条正弦按 u_speak 交叉淡化,过渡期无相位跳变
  float breath = mix(sin(TAU * u_time / ${BREATH_IDLE_S.toFixed(2)}),
                     sin(TAU * u_time / ${BREATH_SPEAK_S.toFixed(2)}), u_speak);
  float scale = 1.0 + ${BREATH_AMP.toFixed(3)} * breath;

  float ft = u_time * 0.045;                               // 噪声场缓慢流动
  vec2  q  = p * (2.6 / scale);
  float n1 = fbm(q + vec2(ft, -0.7 * ft));                 // 基础有机场
  float n2 = fbm(q * 1.9 - vec2(0.6 * ft, ft) + n1 * 1.4); // 域扭曲细节(丝缕)
  // 脊状噪声(ridged):n1=0.5 处取峰值、两端归零,再以 u_noisePow 锐化,
  // 产生分叉丝缕/撕裂边缘,替代原先平滑高斯云团的观感
  float ridge = pow(clamp(1.0 - abs(2.0 * n1 - 1.0), 0.0, 1.0), u_noisePow);

  float r = length(p) / scale;
  float d = r + (ridge - 0.5) * u_noiseAmt * smoothstep(0.04, 0.60, r); // 边缘撕裂强、核心稳定

  float body = exp(-d * d * u_sizeK);                      // 致密发光核心(尺寸由 u_sizeK 控制)
  float halo = 0.20 * exp(-d * u_haloK);                    // 外晕(可见区尺寸由 u_haloK 控制)
  float wisp = 0.85 * pow(smoothstep(0.35, 0.95, n2), 1.0 + u_noisePow * 0.5) * exp(-d * (u_haloK + 1.2)); // 丝缕向外消散,幂次锐化避免糊成一片
  float lum  = (body + halo + wisp) * u_peak * (1.0 + ${SPEAK_GAIN.toFixed(2)} * u_speak);

  float leftFade = smoothstep(u_fade0, u_fade1, uv.x);      // 左侧文字区(uv.x < fade1)平滑衰减到 0
  lum *= leftFade;

  vec3 col = ${glv3(BG_RGB)};                              // 大部分画面停留在纯背景
  col = mix(col, ${glv3(MID_RGB)},  smoothstep(0.02, 0.55, lum) * 0.90);
  col = mix(col, ${glv3(CORE_RGB)}, smoothstep(0.50, 1.20, lum));
  col += (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) * 0.006; // 微抖动压暗部色带

  gl_FragColor = vec4(col, 1.0);
}`;

  function createRendererGL(canvas) {
    // 软件渲染(SwiftShader 等)直接拒绝走 2D,不硬撑
    const opts = { alpha: false, depth: false, stencil: false, antialias: false, failIfMajorPerformanceCaveat: true };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('webgl unavailable');

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader compile failed');
      return sh;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('program link failed');
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());     // 全屏三角(覆盖视口)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    ['time', 'res', 'mouse', 'speak', 'center', 'peak', 'sizeK', 'haloK', 'noiseAmt', 'noisePow', 'fade0', 'fade1']
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, 'u_' + n); });
    let contextLost = false;
    const onLost = function (e) {
      e.preventDefault();
      contextLost = true;            // 运行中由主循环兜底;静态模式当场降级重绘
      if (!S.running) { degradeTo2D(); if (S.reduced && S.renderer) renderStatic(); }
    };
    canvas.addEventListener('webglcontextlost', onLost, false);

    const renderer = {
      kind: 'gl',
      lost: function () { return contextLost; },
      resize: function () {
        sizeCanvas(canvas);
        gl.viewport(0, 0, canvas.width, canvas.height);
      },
      render: function (t) {
        const w = canvas.width, h = canvas.height;
        const m = Math.min(w, h) || 1;
        const p = S.params;
        const coreR  = Math.max(0.001, p.sizeCore * 0.5);        // 核心半径(min(w,h) 归一)
        const sizeK  = Math.LN2 / (coreR * coreR);                // body 半衰亮度处半径 = coreR
        const haloK  = (2 * Math.LN10) / Math.max(0.001, p.sizeHalo); // halo 降到 10% 处半径 = sizeHalo/2
        const offX   = (p.centerX - 0.5) * w / m;                  // 质心基准偏移,x(屏宽计)
        const offY   = -(p.centerY - 0.5) * w / m;                 // 质心基准偏移,y(CSS 下正 → GL 上正,翻转)
        gl.uniform1f(U.time, t % TIME_WRAP_S);
        gl.uniform2f(U.res, w, h);
        gl.uniform2f(U.mouse, S.moX * w / m, -S.moY * w / m); // 偏移以屏宽计,y 翻到 GL 坐标
        gl.uniform1f(U.speak, S.speak);
        gl.uniform2f(U.center, offX, offY);
        gl.uniform1f(U.peak, p.peak);
        gl.uniform1f(U.sizeK, sizeK);
        gl.uniform1f(U.haloK, haloK);
        gl.uniform1f(U.noiseAmt, p.noiseAmt);
        gl.uniform1f(U.noisePow, p.noisePow);
        gl.uniform1f(U.fade0, p.fadeX0);
        gl.uniform1f(U.fade1, p.fadeX1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      destroy: function () {
        canvas.removeEventListener('webglcontextlost', onLost, false);
        try {
          const ext = gl.getExtension('WEBGL_lose_context');
          if (ext) ext.loseContext();
        } catch (e) { /* 静默 */ }
      }
    };
    renderer.resize();
    renderer.render(STATIC_T);                             // 首帧自检
    if (gl.getError() !== gl.NO_ERROR) {
      renderer.destroy();
      throw new Error('gl first-frame error');
    }
    return renderer;
  }

  /* ------------------------------------------------------- Canvas2D 渲染器 */
  function createRenderer2D(canvas) {
    let ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) {
      // canvas 已绑定过 WebGL 上下文,取不到 2d:原位克隆重建(属性原样保留)
      if (!canvas.parentNode) return null;
      const fresh = canvas.cloneNode(false);
      canvas.parentNode.replaceChild(fresh, canvas);
      canvas = fresh;
      S.canvas = fresh;
      try {
        document.dispatchEvent(new CustomEvent('lifeform:canvas-replaced', { detail: { canvas: fresh } }));
      } catch (e) { /* 静默 */ }
      try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
      if (!ctx) return null;
    }
    function glow(w, h, x, y, rad, c, a) {                 // 单层径向渐变光斑
      const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, rad));
      g.addColorStop(0.0, rgba(c, a)); g.addColorStop(0.55, rgba(c, a * 0.35)); g.addColorStop(1.0, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    return {
      kind: '2d',
      resize: function () { sizeCanvas(canvas); },
      render: function (t) {
        const w = canvas.width, h = canvas.height;
        const m = Math.min(w, h);
        const p = S.params;
        const breath = lerp(Math.sin(TAU * t / BREATH_IDLE_S),
                            Math.sin(TAU * t / BREATH_SPEAK_S), S.speak);
        const scale = 1 + BREATH_AMP * breath;
        const gain  = (1 + SPEAK_GAIN * S.speak) * p.peak;  // peak 倍率与 GL 路径一致
        const cx = w * p.centerX + S.moX * w;               // 质心基准位置(屏幕比例)+ 鼠标偏移
        const cy = h * p.centerY + S.moY * w;                // 偏移以屏宽为基准,与 GL 一致
        const outerRad = m * p.sizeHalo * 0.5 * scale;       // 可见发光区半径
        const coreRad  = m * p.sizeCore * 0.5 * scale;       // 核心亮区半径
        const driftK   = (p.sizeHalo * 0.5) / 0.85;          // 漂移幅度随光体尺寸等比例缩放

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = rgba(BG_RGB, 1);
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';          // 加法混合成弥散光场
        // 三层光斑:低频正弦漂移(振幅为 min 边比例,角频率 rad/s)+ 同步呼吸
        glow(w, h, cx + 0.034 * m * driftK * Math.sin(0.19 * t + 1.7), cy + 0.028 * m * driftK * Math.cos(0.23 * t), outerRad, MID_RGB, 0.10 * gain);
        glow(w, h, cx + 0.026 * m * driftK * Math.sin(0.29 * t + 4.1), cy + 0.030 * m * driftK * Math.sin(0.17 * t + 0.6), outerRad * 0.55, MID_RGB, 0.16 * gain);
        glow(w, h, cx + 0.020 * m * driftK * Math.sin(0.26 * t + 2.9), cy + 0.018 * m * driftK * Math.cos(0.31 * t + 5.2), coreRad, CORE_RGB, 0.30 * gain);

        // 左侧文字区(0 - fadeX1 屏宽)淡回纯背景色,避免光晕洗字(与 GL 路径 leftFade 同一约束)
        const fx1 = Math.max(1, w * p.fadeX1);
        const fx0 = Math.min(fx1 - 1, w * p.fadeX0);
        const mask = ctx.createLinearGradient(fx0, 0, fx1, 0);
        mask.addColorStop(0, rgba(BG_RGB, 1));
        mask.addColorStop(1, rgba(BG_RGB, 0));
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = mask;
        ctx.fillRect(0, 0, fx1, h);
      },
      destroy: function () { /* 无需清理 */ }
    };
  }

  /* -------------------------------------------------------------- 主循环 */
  function frame(nowMs) {
    S.raf = 0;
    if (!S.running || !S.renderer || document.hidden) return;
    const dt = Math.min(0.1, Math.max(0.0001, (nowMs - S.lastMs) / 1000));
    S.lastMs = nowMs;
    const t = (nowMs - S.startMs) / 1000;
    // speaking 过渡:SPEAK_RAMP_S 秒线性 ramp,不突变
    const dv = S.speakTarget - S.speak;
    const step = dt / SPEAK_RAMP_S;
    S.speak = Math.abs(dv) <= step ? S.speakTarget : S.speak + (dv > 0 ? step : -step);
    // 鼠标惰性跟随(每帧 lerp)
    S.moX = lerp(S.moX, S.moTX, MOUSE_LERP);
    S.moY = lerp(S.moY, S.moTY, MOUSE_LERP);

    if (S.renderer.kind === '2d') {                        // 2D 路径限 30fps
      S.acc += dt;
      if (S.acc >= 1 / FPS_2D_CAP) {
        S.acc %= 1 / FPS_2D_CAP;
        S.renderer.render(t);
      }
    } else {
      S.renderer.render(t);
      if (S.renderer.lost()) {
        degradeTo2D();
      } else {                                             // fps 看门狗:滚动 60 帧均值
        S.dts.push(dt);
        if (S.dts.length > FPS_WINDOW) S.dts.shift();
        if (S.dts.length === FPS_WINDOW) {
          let sum = 0;
          for (let i = 0; i < FPS_WINDOW; i++) sum += S.dts[i];
          if (FPS_WINDOW / sum < FPS_FLOOR) degradeTo2D();
        }
      }
    }
    if (S.running) S.raf = requestAnimationFrame(frame);
  }
  function degradeTo2D() {
    if (!S.renderer || S.renderer.kind !== 'gl') return;
    try { S.renderer.destroy(); } catch (e) { /* 静默 */ }
    S.renderer = createRenderer2D(S.canvas);
    S.dts.length = 0;
    S.acc = 1;                                             // 切换后立即绘制一帧
    if (S.renderer) S.renderer.resize();
    else { S.running = false; cancelRaf(); }               // 双路皆失败:静默停止
  }
  function scheduleRaf() {
    if (S.raf || !S.running || document.hidden) return;
    S.lastMs = performance.now();
    S.dts.length = 0;                                      // 恢复后重新采样,避免误判
    S.raf = requestAnimationFrame(frame);
  }
  function cancelRaf() { if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; } }
  function renderStatic() {                                // reduced-motion:单帧静态画面
    if (!S.renderer) return;
    S.speak = S.speakTarget;
    S.renderer.render(STATIC_T);
  }

  /* ---------------------------------------------------------------- 事件 */
  const motionMq = (typeof window.matchMedia === 'function')
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function detectMobile() {                                // 触屏/无悬停设备忽略鼠标
    try { return window.matchMedia('(hover: none), (pointer: coarse)').matches; }
    catch (e) { return false; }
  }
  function onResize() {
    if (!S.renderer) return;
    S.renderer.resize();
    S.dts.length = 0;                                      // resize 抖动不计入 fps 采样
    if (S.reduced) renderStatic();
  }
  function onVisibility() { document.hidden ? cancelRaf() : scheduleRaf(); } // 不可见暂停
  function onMouseMove(e) {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    S.moTX = (e.clientX / w * 2 - 1) * MOUSE_MAX_FRAC;     // 全幅映射到 ±4% 屏宽
    S.moTY = (e.clientY / h * 2 - 1) * MOUSE_MAX_FRAC;
  }
  function onMouseLeave() { S.moTX = 0; S.moTY = 0; }      // 鼠标离开视口,缓慢回中
  function onMotionPref() {                                // 动效偏好运行期切换
    S.reduced = !!(motionMq && motionMq.matches);
    if (S.reduced) {
      S.running = false;
      cancelRaf();
      S.moX = S.moY = S.moTX = S.moTY = 0;
      renderStatic();
    } else if (S.renderer && !S.running) {
      S.running = true;
      S.startMs = performance.now();
      scheduleRaf();
    }
  }
  function bindEvents() {
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    if (!S.mobile) {
      window.addEventListener('mousemove', onMouseMove, { passive: true });
      document.addEventListener('mouseleave', onMouseLeave);
    }
    if (motionMq && typeof motionMq.addEventListener === 'function') {
      motionMq.addEventListener('change', onMotionPref);
    }
  }

  /* ------------------------------------------------------------ 公共 API */
  function init() {
    if (S.inited) return;
    const canvas = document.getElementById(CANVAS_ID);
    if (!canvas) return;                                   // 无 canvas:静默退出
    S.canvas = canvas;
    S.reduced = !!(motionMq && motionMq.matches);
    S.mobile = detectMobile();
    Object.assign(S.params, S.mobile ? MOBILE_PARAMS : DESKTOP_PARAMS); // 按设备类型注入调参默认值

    let renderer = null;
    try { renderer = createRendererGL(canvas); }           // 任何异常 → 走 2D
    catch (e) { renderer = null; }
    if (!renderer) renderer = createRenderer2D(S.canvas);
    if (!renderer) return;                                 // 双路皆失败:静默退出
    S.renderer = renderer;
    renderer.resize();
    S.inited = true;
    bindEvents();

    if (S.reduced) {
      renderStatic();                                      // 一帧静态画面,不进 rAF
    } else {
      S.running = true;
      S.startMs = performance.now();
      scheduleRaf();
    }
  }

  function setState(state) {
    if (state !== 'idle' && state !== 'speaking') return;  // 非法值忽略
    S.speakTarget = state === 'speaking' ? 1 : 0;
    if (S.inited && S.reduced) renderStatic();             // 静态模式直接重绘一帧
  }

  window.Lifeform = { init: init, setState: setState };
  // 原型调试接口:window.Lifeform.params 读出的是当前生效对象(S.params 的引用),
  // 直接改字段(params.peak = 0.8)或整体赋值(params = {...})合并写入均在下一帧生效。
  Object.defineProperty(window.Lifeform, 'params', {
    get: function () { return S.params; },
    set: function (v) {
      if (!v || typeof v !== 'object') return;
      for (const k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) S.params[k] = v[k]; }
    },
    enumerable: true,
    configurable: true
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();                                             // 脚本在 DOM 之后加载时直接初始化
})();
