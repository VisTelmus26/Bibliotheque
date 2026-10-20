/* Bibliotheque — the 3D inspiration space.
   A small 3D engine: every piece has a world position (x, y, z). The camera has a position and a
   direction (yaw, pitch); you fly through the space, orbit around what's in front of you, and pieces
   pass by at their own depths. Titles, captions and line labels stay a constant size on screen. */
(() => {
  'use strict';

  const F = 900;                       // focal length (px)
  const LC = { artist: '#ff8fb1', tool: '#3dd9c5', style: '#e5484d' };
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const NS = 'http://www.w3.org/2000/svg';

  const $ = (s) => document.querySelector(s);
  const stage = $('#stage'), world = $('#world'), labels = $('#labels'), svg = $('#links');

  const S = {
    index: null, weekIdx: 0, week: null, cache: new Map(),
    items: [], clusters: [], links: [], filter: 'all',
    cam: { x: 0, y: 0, z: 3000, yaw: 0, pitch: 0 }, home: null, tween: null,
    w: 0, h: 0, top: 50, bottom: 84, focus: 1500,
    pointers: new Map(), dragging: false, moved: false, mode: 'pan', last: null, vel: { x: 0, y: 0 }, pinch: null,
    dirty: true
  };

  const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rand01 = (str) => (hash(str) % 10007) / 10007;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  async function getJSON(u) {
    const r = await fetch(u, { cache: 'no-cache' });
    if (!r.ok) throw new Error(u + ' ' + r.status);
    return r.json();
  }

  /* ---------- dates ---------- */
  const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const wkLabel = (w) => 'W' + w.id.split('-W')[1];
  function rangeLabel(w) {
    const a = parseDay(w.start), b = parseDay(w.end);
    return a.getUTCMonth() === b.getUTCMonth()
      ? a.getUTCDate() + '–' + b.getUTCDate() + ' ' + MONTHS[b.getUTCMonth()]
      : a.getUTCDate() + ' ' + MONTHS[a.getUTCMonth()] + '–' + b.getUTCDate() + ' ' + MONTHS[b.getUTCMonth()];
  }
  function startLabel(w) {
    const a = parseDay(w.start), m = MONTHS[a.getUTCMonth()];
    return DAYS[a.getUTCDay()] + ' ' + a.getUTCDate() + ' ' + m[0] + m.slice(1).toLowerCase();
  }

  /* ---------- boot ---------- */
  async function init() {
    measure();
    const loading = el('div', null, 'LOADING THE INDEX…');
    loading.id = 'loading';
    document.body.appendChild(loading);
    try { S.index = await getJSON('data/index.json'); }
    catch (e) { loading.textContent = 'COULD NOT LOAD THE INDEX. RELOAD THE PAGE TO TRY AGAIN.'; return; }
    S.index.weeks.sort((a, b) => (a.id < b.id ? -1 : 1));
    S.weekIdx = S.index.weeks.length - 1;
    bind();
    await loadWeek(S.weekIdx, false);
    loading.remove();
    requestAnimationFrame(frame);
  }

  function measure() {
    S.w = innerWidth; S.h = innerHeight;
    S.top = $('#bar').offsetHeight;
    document.documentElement.style.setProperty('--bar-h', S.top + 'px');
    S.bottom = $('#timeline').offsetHeight;
  }

  /* ---------- weeks ---------- */
  async function loadWeek(i, animate = true) {
    const meta = S.index.weeks[i];
    let wk = S.cache.get(meta.id);
    if (!wk) {
      try { wk = await getJSON('data/weeks/' + meta.id + '.json'); }
      catch (e) { $('#tbCount').textContent = 'Could not load this week'; return; }
      S.cache.set(meta.id, wk);
    }
    if (S.index.weeks[S.weekIdx].id !== meta.id) return;
    S.week = wk;
    buildTopics();
    layout(wk.pieces);
    buildLinks();
    buildDOM();
    applyFilter();
    $('#tbWeek').textContent = startLabel(meta);
    $('#tbCount').textContent = wk.pieces.length + ' · ' + (wk.sources || 16) + ' sites';
    $('#sampleNote').hidden = !wk.sample;
    renderTimeline();
    fit(S.items.filter((it) => !it.dim), animate);
  }

  function selectWeek(i) {
    i = clamp(i, 0, S.index.weeks.length - 1);
    if (i === S.weekIdx) { renderTimeline(); return; }
    S.weekIdx = i;
    renderTimeline();
    loadWeek(i, true);
  }

  /* ---------- menu ---------- */
  function matches(p, key) {
    if (key === 'all') return true;
    if (key === 'ai') return p.ai === true;
    return p.group === key || (p.tags || []).includes(key);
  }

  function buildTopics() {
    const nav = $('#topics');
    nav.textContent = '';
    const cur = S.index.weeks[S.weekIdx].id;
    const list = [{ key: 'all', label: 'All' }].concat(S.index.tags || []);
    for (const t of list) {
      const b = el('button');
      b.type = 'button';
      b.dataset.key = t.key;
      b.append(document.createTextNode(t.label));
      if (t.since && t.since === cur) b.append(el('span', 'new', 'NEW'));
      b.setAttribute('aria-pressed', String(S.filter === t.key));
      const n = t.key === 'all' ? 1 : S.week.pieces.filter((p) => matches(p, t.key)).length;
      if (!n) { b.style.opacity = '0.35'; b.title = 'Nothing this week'; }
      b.addEventListener('click', () => setFilter(t.key, t.label));
      nav.append(b);
    }
    requestAnimationFrame(() => { measure(); S.dirty = true; });
  }

  function setFilter(key, label) {
    S.filter = key;
    for (const b of $('#topics').children) b.setAttribute('aria-pressed', String(b.dataset.key === key));
    $('#tbView').textContent = key === 'all' ? 'All topics' : label;
    applyFilter();
    const vis = S.items.filter((it) => !it.dim);
    if (vis.length) fit(vis, true);
  }

  function applyFilter() {
    for (const it of S.items) it.dim = !matches(it.p, S.filter);
    for (const c of S.clusters) c.dim = c.items.every((it) => it.dim);
    S.dirty = true;
  }

  /* ---------- layout: groups packed into one loose oval, each group a 3D cloud ---------- */
  function layout(pieces) {
    const groups = new Map();
    for (const p of pieces) {
      const g = p.ai === true ? 'ai' : p.group;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }
    const label = (k) => (k === 'ai' ? 'AI-generated' : ((S.index.groups || []).find((g) => g.key === k) || { label: k }).label);
    const radius = (n) => 92 * Math.sqrt(n) + 70;
    const keys = [...groups.keys()].filter((k) => k !== 'ai').sort((a, b) => groups.get(b).length - groups.get(a).length);
    const clusters = [];
    const GAP = 150, EX = 1.45;               // gap between groups; horizontal stretch of the overall oval
    const fits = (x, y, R, gap) => clusters.every((c) => Math.hypot(c.x - x, c.y - y) >= c.R + R + gap);
    const place = (key, n, gap, bias) => {
      const R = radius(n);
      let best = null;
      if (!clusters.length) best = { x: 0, y: 0 };
      else {
        for (let ring = 0; ring < 60 && !best; ring++) {
          let cand = null;
          for (let a = 0; a < 72; a++) {
            const ang = (a / 72) * Math.PI * 2;
            const d = 40 + ring * 40;
            const x = Math.cos(ang) * d * EX, y = Math.sin(ang) * d;
            if (!fits(x, y, R, gap)) continue;
            const score = Math.hypot(x / EX, y) - (bias ? bias(x, y) : 0);
            if (!cand || score < cand.s) cand = { x, y, s: score };
          }
          best = cand;
        }
      }
      clusters.push({ key, label: label(key), n, R, x: best.x, y: best.y, ps: groups.get(key), ai: key === 'ai' });
    };
    for (const k of keys) place(k, groups.get(k).length, GAP);
    if (groups.has('ai')) place('ai', groups.get('ai').length, GAP * 2.2, (x) => x * 0.6); // AI: kept apart, on the right
    let mx = 0, my = 0;
    for (const c of clusters) { mx += c.x; my += c.y; }
    mx /= clusters.length; my /= clusters.length;
    const span = Math.max(...clusters.map((c) => Math.hypot((c.x - mx) / EX, c.y - my) + c.R), 1);

    const items = [];
    for (const c of clusters) {
      c.x -= mx; c.y -= my;
      // the overall oval bows away from you: outer groups sit closer, the middle sits deeper
      const rr = Math.min(1, Math.hypot(c.x / EX, c.y) / span);
      c.z = -380 * (1 - rr * rr) + (rand01(c.key) - 0.5) * 160;
      c.items = [];
      const ps = c.ps.slice().sort((a, b) => (hash(a.id) % 97) - (hash(b.id) % 97));
      ps.forEach((p, i) => {
        const f = Math.sqrt((i + 0.5) / ps.length);
        const a = i * 2.39996 + rand01(c.key) * 6.28;
        const r = f * (c.R - 50);
        const asp = clamp(p.aspect || 0.8, 0.5, 2);
        const w = 120 * Math.sqrt(asp), h = w / asp;
        const depth = Math.sqrt(Math.max(0, c.R * c.R - r * r)) * 0.54;     // a cloud, not a disc
        const it = { p, c, x: c.x + Math.cos(a) * r * 1.08, y: c.y + Math.sin(a) * r * 0.92, z: c.z + (rand01(p.id) * 2 - 1) * depth, w, h };
        c.items.push(it);
        items.push(it);
      });
    }
    S.clusters = clusters;
    S.items = items;
  }

  /* ---------- connections ---------- */
  function buildLinks() {
    const groups = new Map();
    const add = (type, key, label, it) => {
      const k = type + '|' + key.toLowerCase().trim();
      if (!groups.has(k)) groups.set(k, { type, label, members: [] });
      groups.get(k).members.push(it);
    };
    for (const it of S.items) {
      const p = it.p;
      if (p.artist) add('artist', p.artist, 'SAME ARTIST', it);
      for (const t of p.tools || []) add('tool', t, t.toUpperCase(), it);
      for (const s of p.styles || []) add('style', s, s.toUpperCase(), it);
    }
    const links = [];
    for (const g of groups.values()) {
      if (g.members.length < 2) continue;
      const m = g.members.slice().sort((a, b) => (a.c.x - b.c.x) || (a.y - b.y));
      for (let i = 0; i < m.length - 1; i++) links.push({ a: m[i], b: m[i + 1], type: g.type, label: g.label });
    }
    S.links = links;
    for (const it of S.items) it.ring = null;
    for (const l of links) { l.a.ring = l.a.ring || LC[l.type]; l.b.ring = l.b.ring || LC[l.type]; }
  }

  /* ---------- DOM ---------- */
  function placeholder(p) {
    const h = hash(p.id), h1 = h % 360, h2 = (h1 + 140 + (h >> 9) % 80) % 360;
    const ph = el('span', 'ph');
    ph.style.background = 'hsl(' + h1 + ' 28% 20%)';
    const shape = el('span');
    const round = (h >> 4) % 3;
    shape.style.cssText = 'position:absolute;left:' + (15 + (h >> 3) % 30) + '%;top:' + (15 + (h >> 6) % 30) + '%;width:' + (35 + (h >> 2) % 30) + '%;height:' + (35 + (h >> 5) % 30) + '%;background:hsl(' + h2 + ' 62% 58%);border-radius:' + (round === 0 ? '50%' : round === 1 ? '4%' : '50% 50% 0 0');
    ph.append(shape);
    return ph;
  }

  function buildDOM() {
    world.textContent = '';
    labels.textContent = '';
    svg.textContent = '';
    for (const it of S.items) {
      const p = it.p;
      const node = el('div', 'thumb');
      const art = el('button', 'art');
      art.type = 'button';
      art.setAttribute('aria-label', (p.title || 'Untitled') + ' by ' + (p.artist || 'unknown artist'));
      if (p.thumb) {
        const img = new Image();
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.draggable = false;
        img.src = p.thumb;
        img.onerror = () => img.replaceWith(placeholder(p));
        art.append(img);
      } else art.append(placeholder(p));
      if (p.kind === 'video') art.append(el('span', 'play'));
      art.addEventListener('click', (e) => { if (e.detail === 0) flyToItem(it); }); // keyboard; pointer clicks are handled on release

      const cap = el('div', 'cap');
      const a = el('a', null, p.artist || 'Unknown artist');
      a.href = p.artistUrl || p.url || '#';
      a.target = '_blank';
      a.rel = 'noopener';
      const top = el('div');
      top.append(a);
      if (p.ai === true) top.append(el('span', 'badge ai', 'AI'));
      else if (p.ai === 'unconfirmed') top.append(el('span', 'badge', 'AI?'));
      else top.append(el('span', 'badge', 'ORIGINAL'));
      cap.append(top, el('div', 'meta', [p.source, p.region].filter(Boolean).join(' · ').toUpperCase()));

      if (it.ring) { node.classList.add('linked'); node.style.setProperty('--ring', it.ring); }
      node.append(art, cap);
      world.append(node);
      it.node = node; it.vis = true; it.near = false; it.op = 1;
    }
    for (const l of S.links) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('stroke', LC[l.type]);
      svg.append(path);
      l.path = path;
      const lab = el('div', 'llabel', l.label);
      lab.style.color = LC[l.type];
      lab.style.borderColor = LC[l.type] + '66';
      labels.append(lab);
      l.lab = lab;
    }
    for (const c of S.clusters) {
      const t = el('div', 'ctitle' + (c.ai ? ' ai' : ''));
      t.append(el('div', 'n', c.label), el('div', 'c', c.n + (c.n === 1 ? ' PIECE' : ' PIECES')));
      labels.append(t);
      c.title = t;
    }
    S.dirty = true;
  }

  /* ---------- camera ---------- */
  const center = () => ({ x: S.w / 2, y: S.top + (S.h - S.top - S.bottom) / 2 });
  function basis() {
    const cy = Math.cos(S.cam.yaw), sy = Math.sin(S.cam.yaw), cp = Math.cos(S.cam.pitch), sp = Math.sin(S.cam.pitch);
    return {
      cy, sy, cp, sp,
      r: { x: cy, y: 0, z: -sy },                       // screen right
      u: { x: -sy * sp, y: cp, z: -cy * sp },           // screen down
      f: { x: -sy * cp, y: -sp, z: -cy * cp }           // forward (into the screen)
    };
  }

  function fit(items, animate) {
    if (!items.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, zMax = -Infinity, zMin = Infinity;
    for (const it of items) {
      x0 = Math.min(x0, it.x - it.w / 2); x1 = Math.max(x1, it.x + it.w / 2);
      y0 = Math.min(y0, it.y - it.h / 2); y1 = Math.max(y1, it.y + it.h / 2);
      zMax = Math.max(zMax, it.z); zMin = Math.min(zMin, it.z);
    }
    const aw = Math.max(200, S.w - 120), ah = Math.max(160, S.h - S.top - S.bottom - 150);
    const s = Math.min(aw / (x1 - x0), ah / (y1 - y0), 2.2);
    const zMid = (zMax + zMin) / 2;
    const to = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - 24 / s, z: zMid + F / s, yaw: 0, pitch: 0 };
    if (S.filter === 'all') S.home = { ...to };
    moveTo(to, animate);
  }

  function moveTo(to, animate) {
    S.vel = { x: 0, y: 0 };
    if (!animate || REDUCE) { S.cam = { ...to }; S.tween = null; S.dirty = true; return; }
    S.tween = { from: { ...S.cam }, to, t0: performance.now(), d: 900 };
  }

  function flyToItem(it) {
    const target = Math.min(440, S.w * 0.42, (S.h - S.top - S.bottom) * 0.6);
    const dist = F * it.w / target;
    const B = basis();
    // keep the current viewing direction; arrive in front of the piece
    moveTo({ x: it.x - B.f.x * dist, y: it.y - B.f.y * dist + it.h * 0.1, z: it.z - B.f.z * dist, yaw: S.cam.yaw, pitch: S.cam.pitch }, true);
  }

  function limitCam() {
    if (!S.home) return;
    const lim = S.home.z - Math.min(...S.items.map((i) => i.z)) + 2000;
    S.cam.x = clamp(S.cam.x, S.home.x - lim * 1.5, S.home.x + lim * 1.5);
    S.cam.y = clamp(S.cam.y, S.home.y - lim, S.home.y + lim);
    S.cam.z = clamp(S.cam.z, -lim, S.home.z + lim * 0.6);
  }

  // fly along the ray under the pointer
  function flyAt(mx, my, amount) {
    const c = center(), B = basis();
    const rx = (mx - c.x) / F, ry = (my - c.y) / F;
    let d = { x: B.f.x + B.r.x * rx + B.u.x * ry, y: B.f.y + B.r.y * rx + B.u.y * ry, z: B.f.z + B.r.z * rx + B.u.z * ry };
    const n = Math.hypot(d.x, d.y, d.z);
    const step = amount * Math.max(160, S.focus);
    S.cam.x += d.x / n * step; S.cam.y += d.y / n * step; S.cam.z += d.z / n * step;
    S.tween = null;
    limitCam();
    S.dirty = true;
  }

  function pan(dx, dy) {
    const B = basis(), k = Math.max(120, S.focus) / F;
    S.cam.x -= (B.r.x * dx + B.u.x * dy) * k;
    S.cam.y -= (B.r.y * dx + B.u.y * dy) * k;
    S.cam.z -= (B.r.z * dx + B.u.z * dy) * k;
    limitCam();
    S.dirty = true;
  }

  // orbit around the point in front of you, like 3D software
  function orbit(dx, dy) {
    const B = basis(), d = Math.max(300, S.focus);
    const pivot = { x: S.cam.x + B.f.x * d, y: S.cam.y + B.f.y * d, z: S.cam.z + B.f.z * d };
    S.cam.yaw -= dx * 0.0025;
    S.cam.pitch = clamp(S.cam.pitch - dy * 0.0025, -1.1, 1.1);
    const N = basis();
    S.cam.x = pivot.x - N.f.x * d; S.cam.y = pivot.y - N.f.y * d; S.cam.z = pivot.z - N.f.z * d;
    S.tween = null;
    S.dirty = true;
  }

  /* ---------- render loop ---------- */
  function frame(t) {
    requestAnimationFrame(frame);
    if (S.tween) {
      const k = Math.min(1, (t - S.tween.t0) / S.tween.d);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      for (const a of ['x', 'y', 'z', 'yaw', 'pitch']) S.cam[a] = S.tween.from[a] + (S.tween.to[a] - S.tween.from[a]) * e;
      if (k >= 1) S.tween = null;
      S.dirty = true;
    }
    if (!S.dragging && (Math.abs(S.vel.x) > 0.05 || Math.abs(S.vel.y) > 0.05)) {
      if (S.mode === 'orbit') orbit(S.vel.x, S.vel.y); else pan(S.vel.x, S.vel.y);
      S.vel.x *= 0.9; S.vel.y *= 0.9;
    }
    if (S.dirty) { S.dirty = false; render(); }
  }

  function hullPath(pts) {
    if (pts.length < 3) return '';
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    const h = lo.slice(0, -1).concat(up.slice(0, -1));
    if (h.length < 3) return '';
    let cx = 0, cy = 0;
    for (const p of h) { cx += p[0]; cy += p[1]; }
    cx /= h.length; cy /= h.length;
    const q = h.map((p) => { const dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy) || 1; return [p[0] + dx / d * 26, p[1] + dy / d * 26]; });
    const n = q.length;
    let d = 'M' + q[0][0].toFixed(1) + ' ' + q[0][1].toFixed(1);
    for (let i = 0; i < n; i++) {
      const p0 = q[(i - 1 + n) % n], p1 = q[i], p2 = q[(i + 1) % n], p3 = q[(i + 2) % n];
      d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) +
        ' ' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) +
        ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    return d + 'Z';
  }

  function render() {
    const c = center(), B = basis();
    const depths = [];
    for (const cl of S.clusters) { cl.b = null; cl.pts = []; }
    for (const it of S.items) {
      const dx = it.x - S.cam.x, dy = it.y - S.cam.y, dz = it.z - S.cam.z;
      const x1 = dx * B.cy - dz * B.sy;
      const z1 = dx * B.sy + dz * B.cy;
      const y2 = dy * B.cp - z1 * B.sp;
      const depth = -(dy * B.sp + z1 * B.cp);
      let show = depth > 40;
      let px, py, W, H, s;
      if (show) {
        s = F / depth;
        px = c.x + x1 * s; py = c.y + y2 * s;
        W = it.w * s; H = it.h * s;
        show = !(px + W / 2 < -200 || px - W / 2 > S.w + 200 || py + H / 2 < -200 || py - H / 2 > S.h + 200) && W < S.w * 3;
      }
      if (show !== it.vis) { it.node.style.visibility = show ? '' : 'hidden'; it.vis = show; }
      if (!show) { it.sx = null; continue; }
      if (!it.dim) depths.push(depth);
      // tilt towards the viewer at the edges: the space wraps around you
      const tiltY = clamp((px - c.x) / S.w, -0.6, 0.6) * -26, tiltX = clamp((py - c.y) / S.h, -0.6, 0.6) * 18;
      it.node.style.width = W.toFixed(1) + 'px';
      it.node.style.height = H.toFixed(1) + 'px';
      it.node.style.transform = 'translate3d(' + (px - W / 2).toFixed(1) + 'px,' + (py - H / 2).toFixed(1) + 'px,0) perspective(' + (900 + W).toFixed(0) + 'px) rotateY(' + tiltY.toFixed(1) + 'deg) rotateX(' + tiltX.toFixed(1) + 'deg)';
      it.node.style.zIndex = String(Math.round(100000 - depth));
      // atmosphere: far pieces fade, pieces you fly through fade out of the way
      const far = clamp(1 - (depth - S.focus * 1.3) / (S.focus * 2.2), 0.28, 1);
      const nearFade = clamp((depth - 40) / 180, 0, 1);
      const op = it.dim ? 0.07 : Math.round(far * nearFade * 20) / 20;
      if (op !== it.op) { it.node.style.opacity = String(op); it.op = op; }
      it.node.style.pointerEvents = it.dim ? 'none' : '';
      const near = W > 110 && !it.dim;
      if (near !== it.near) { it.node.classList.toggle('near', near); it.near = near; }
      it.sx = px; it.sy = py; it.sw = W; it.sh = H;
      if (!it.dim) {
        const b = it.c.b || (it.c.b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
        b.x0 = Math.min(b.x0, px - W / 2); b.y0 = Math.min(b.y0, py - H / 2);
        b.x1 = Math.max(b.x1, px + W / 2); b.y1 = Math.max(b.y1, py + H / 2);
        it.c.pts.push([px - W / 2, py - H / 2], [px + W / 2, py - H / 2], [px - W / 2, py + H / 2], [px + W / 2, py + H / 2]);
      }
    }
    if (depths.length) { depths.sort((a, b) => a - b); S.focus = depths[Math.floor(depths.length / 2)]; }
    const close = S.home && S.cam.z < S.home.z * 0.6;
    for (const cl of S.clusters) {
      const b = cl.b;
      if (!b) { cl.title.style.visibility = 'hidden'; continue; }
      const onScreen = b.x1 > 120 && b.x0 < S.w - 120 && b.y1 > S.top + 80 && b.y0 < S.h - S.bottom;
      cl.title.style.visibility = onScreen ? '' : 'hidden';
      const x = clamp(b.x0, 16, S.w - 260), y = Math.max(b.y0 - 6, S.top + 58);
      cl.title.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) translateY(-100%)';
    }
    for (const l of S.links) {
      const A = l.a, Bt = l.b;
      if (A.sx == null || Bt.sx == null || A.dim || Bt.dim) {
        if (l.on !== false) { l.path.setAttribute('d', ''); l.lab.style.visibility = 'hidden'; l.on = false; }
        continue;
      }
      l.on = true;
      const dx = Bt.sx - A.sx, dy = Bt.sy - A.sy, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len, kk = Math.min(90, len * 0.22);
      l.path.setAttribute('d', 'M' + A.sx.toFixed(1) + ' ' + A.sy.toFixed(1) +
        ' C' + (A.sx + dx / 3 + nx * kk).toFixed(1) + ' ' + (A.sy + dy / 3 + ny * kk).toFixed(1) +
        ' ' + (A.sx + 2 * dx / 3 - nx * kk).toFixed(1) + ' ' + (A.sy + 2 * dy / 3 - ny * kk).toFixed(1) +
        ' ' + Bt.sx.toFixed(1) + ' ' + Bt.sy.toFixed(1));
      l.path.setAttribute('stroke-opacity', String(Math.min(A.op, Bt.op) * 0.8));
      const showLab = len > 170 && close;
      l.lab.style.visibility = showLab ? '' : 'hidden';
      if (showLab) l.lab.style.transform = 'translate3d(' + ((A.sx + Bt.sx) / 2).toFixed(1) + 'px,' + ((A.sy + Bt.sy) / 2).toFixed(1) + 'px,0) translate(-50%,-50%)';
    }
  }

  /* ---------- timeline: weeks spread wide near the current week and bunch up with distance ---------- */
  function renderTimeline() {
    const weeks = S.index.weeks, n = weeks.length, sel = S.weekIdx;
    const track = $('#track');
    for (const e of [...track.children]) if (e.id !== 'line') e.remove();
    const W = track.clientWidth, pad = 50;
    const xs = [];
    if (n === 1) xs.push(W / 2);
    else {
      const gaps = [];
      for (let j = 0; j < n - 1; j++) {
        const d = Math.min(Math.abs(j - sel), Math.abs(j + 1 - sel));
        gaps.push(1 / Math.pow(1 + d, 1.6));
      }
      const tot = gaps.reduce((a, b) => a + b, 0);
      const span = Math.min(W - pad * 2, (n - 1) * 150);
      const start = (W - span) / 2;
      xs.push(start);
      for (const g of gaps) xs.push(xs[xs.length - 1] + g / tot * span);
    }
    S.tlx = xs;
    const labelled = xs.map((x, i) => i !== sel && (i === 0 || x - xs[i - 1] >= 46) && (i === n - 1 || xs[i + 1] - x >= 46) && Math.abs(x - xs[sel]) > 70);
    weeks.forEach((w, i) => {
      const b = el('button', 'wk');
      b.type = 'button';
      b.style.left = xs[i] + 'px';
      b.setAttribute('aria-label', 'Week ' + wkLabel(w).slice(1) + ', ' + rangeLabel(w));
      b.title = wkLabel(w) + ' · ' + rangeLabel(w);
      b.addEventListener('click', () => selectWeek(i));
      track.append(b);
      if (labelled[i]) { const l = el('div', 'wk-l', wkLabel(w)); l.style.left = xs[i] + 'px'; track.append(l); }
    });
    const runs = (from, to) => {
      const idx = [];
      for (let i = from; i <= to; i++) if (i !== sel && !labelled[i]) idx.push(i);
      if (!idx.length) return;
      const mid = (xs[idx[0]] + xs[idx[idx.length - 1]]) / 2;
      if (Math.abs(mid - xs[sel]) < 80) return;
      const l = el('div', 'wk-l', idx.length === 1 ? wkLabel(weeks[idx[0]]) : wkLabel(weeks[idx[0]]) + '–' + wkLabel(weeks[idx[idx.length - 1]]));
      l.style.left = mid + 'px';
      track.append(l);
    };
    runs(0, sel - 1);
    runs(sel + 1, n - 1);
    const cur = el('div', 'wk-cur');
    cur.append(el('div', 'w', wkLabel(weeks[sel])), el('div', 'd', rangeLabel(weeks[sel]) + (sel === n - 1 ? ' · THIS WEEK' : '')));
    cur.style.left = clamp(xs[sel], 70, W - 70) + 'px';
    track.append(cur);
    const h = el('button');
    h.id = 'handle';
    h.type = 'button';
    h.setAttribute('aria-label', 'Drag to choose a week. Current: ' + wkLabel(weeks[sel]));
    h.style.left = xs[sel] + 'px';
    track.append(h);
    bindHandle(h);
  }

  function bindHandle(h) {
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      h.setPointerCapture(e.pointerId);
      const rect = $('#track').getBoundingClientRect();
      let near = S.weekIdx;
      const move = (ev) => {
        const x = clamp(ev.clientX - rect.left, S.tlx[0], S.tlx[S.tlx.length - 1]);
        h.style.left = x + 'px';
        let best = 0;
        S.tlx.forEach((tx, i) => { if (Math.abs(tx - x) < Math.abs(S.tlx[best] - x)) best = i; });
        near = best;
      };
      const up = () => {
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        h.removeEventListener('pointercancel', up);
        selectWeek(near);
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
    });
  }

  /* ---------- input ---------- */
  function bind() {
    // press anywhere in the space (empty or on a piece) and drag
    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest('#bar, #timeline, .cap a')) return;
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (S.pointers.size === 2) {
        const [p1, p2] = [...S.pointers.values()];
        S.pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2 };
      }
      S.mode = (e.button === 2 || e.shiftKey || e.altKey) ? 'orbit' : 'pan';
      S.dragging = true;
      S.moved = false;
      S.down = { x: e.clientX, y: e.clientY };
      S.last = { x: e.clientX, y: e.clientY };
      S.vel = { x: 0, y: 0 };
      S.tween = null;
      $('#hint').classList.add('gone');
    });
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('pointermove', (e) => {
      if (!S.dragging || !S.pointers.has(e.pointerId)) return;
      S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (S.pointers.size === 2 && S.pinch) {
        const [p1, p2] = [...S.pointers.values()];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        flyAt(mx, my, (d - S.pinch.d) * 0.004);
        pan(mx - S.pinch.mx, my - S.pinch.my);
        S.pinch = { d, mx, my };
        S.moved = true;
        return;
      }
      const dx = e.clientX - S.last.x, dy = e.clientY - S.last.y;
      S.last = { x: e.clientX, y: e.clientY };
      if (!S.moved && Math.hypot(e.clientX - S.down.x, e.clientY - S.down.y) > 4) { S.moved = true; stage.classList.add('dragging'); }
      if (!S.moved) return;
      if (S.mode === 'orbit') orbit(dx, dy); else pan(dx, dy);
      S.vel = { x: dx, y: dy };
    });
    const end = (e) => {
      if (!S.pointers.has(e.pointerId)) return;
      S.pointers.delete(e.pointerId);
      if (S.pointers.size < 2) S.pinch = null;
      if (S.pointers.size === 0) {
        S.dragging = false;
        stage.classList.remove('dragging');
        if (!S.moved) {
          const art = document.elementFromPoint(e.clientX, e.clientY);
          const node = art && art.closest('.thumb');
          if (node) { const it = S.items.find((i) => i.node === node); if (it) flyToItem(it); }
        }
        setTimeout(() => { S.moved = false; }, 0);
      }
    };
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);

    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      $('#hint').classList.add('gone');
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      flyAt(e.clientX, e.clientY, clamp(-dy * (e.ctrlKey ? 0.006 : 0.0012), -0.5, 0.5));
    }, { passive: false });

    stage.addEventListener('dblclick', (e) => {
      if (e.target.closest('.thumb')) return;
      flyAt(e.clientX, e.clientY, 0.5);
    });

    addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input, textarea')) return;
      const c = center();
      switch (e.key) {
        case 'ArrowLeft': pan(90, 0); break;
        case 'ArrowRight': pan(-90, 0); break;
        case 'ArrowUp': pan(0, 90); break;
        case 'ArrowDown': pan(0, -90); break;
        case 'w': case 'W': case '+': case '=': flyAt(c.x, c.y, 0.25); break;
        case 's': case 'S': case '-': case '_': flyAt(c.x, c.y, -0.25); break;
        case 'a': case 'A': orbit(-40, 0); break;
        case 'd': case 'D': orbit(40, 0); break;
        case 'Escape': if (S.home) moveTo({ ...S.home }, true); break;
        case 'PageUp': case '[': selectWeek(S.weekIdx - 1); break;
        case 'PageDown': case ']': selectWeek(S.weekIdx + 1); break;
        default: return;
      }
      e.preventDefault();
    });

    let rt;
    addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => { measure(); renderTimeline(); S.dirty = true; }, 80);
    });
  }

  init();
})();
