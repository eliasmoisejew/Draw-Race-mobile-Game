'use strict';

const TRACK_WIDTH   = 50;
const RESAMPLE_DIST = 7;
const CATMULL_STEPS = 7;
const SPEED_MAX     = 5.0;
const SPEED_MIN     = 1.4;
const ACCEL_RATE    = 0.07;

class DrawRaceGame {
  constructor() {
    this.canvas = document.getElementById('canvas');
    this.ctx    = this.canvas.getContext('2d');

    this.phase   = 'idle'; // idle | drawing | ready | countdown | racing | done
    this.rawPts  = [];
    this.trackPts = [];
    this.curvature = [];
    this.car     = null;
    this.particles = [];
    this.isDown  = false;

    this.startMs  = 0;
    this.elapsed  = 0;
    this.bestMs   = +localStorage.getItem('dr_best') || 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    this.bindUI();
    this.startLoop();
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  startLoop() {
    let prev = performance.now();
    const loop = (now) => {
      const dt = Math.min(now - prev, 50);
      prev = now;
      this.tick(dt);
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  bindInput() {
    const c = this.canvas;

    const xy = (e) => {
      const r   = c.getBoundingClientRect();
      const src = e.changedTouches ? e.changedTouches[0] : e;
      return { x: src.clientX - r.left, y: src.clientY - r.top };
    };

    const down = (e) => {
      if (!['idle', 'drawing'].includes(this.phase)) return;
      e.preventDefault();
      this.isDown = true;
      this.phase  = 'drawing';
      this.rawPts = [xy(e)];
      document.getElementById('hint').style.display = 'none';
    };

    const move = (e) => {
      if (!this.isDown || this.phase !== 'drawing') return;
      e.preventDefault();
      const p    = xy(e);
      const last = this.rawPts.at(-1);
      if (Math.hypot(p.x - last.x, p.y - last.y) >= RESAMPLE_DIST) {
        this.rawPts.push(p);
      }
    };

    const up = (e) => {
      if (!this.isDown) return;
      e.preventDefault();
      this.isDown = false;
      if (this.phase === 'drawing') this.finishDraw();
    };

    c.addEventListener('touchstart',  down, { passive: false });
    c.addEventListener('touchmove',   move, { passive: false });
    c.addEventListener('touchend',    up,   { passive: false });
    c.addEventListener('touchcancel', up,   { passive: false });

    c.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') down(e); });
    c.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') move(e); });
    c.addEventListener('pointerup',   (e) => { if (e.pointerType !== 'touch') up(e); });
  }

  finishDraw() {
    if (this.rawPts.length < 18) {
      this.phase  = 'idle';
      this.rawPts = [];
      document.getElementById('hint').style.display = '';
      return;
    }

    this.trackPts  = this.buildTrack(this.rawPts);
    this.curvature = this.calcCurvature(this.trackPts);
    this.phase     = 'ready';

    document.getElementById('panel-ready').style.display = 'flex';
    navigator.vibrate?.([15, 40, 25]);
  }

  // ── Path maths ───────────────────────────────────────────────────────────

  buildTrack(pts) {
    return this.catmullRom(this.resample(pts, RESAMPLE_DIST), CATMULL_STEPS);
  }

  resample(pts, spacing) {
    const out = [{ ...pts[0] }];
    let carry  = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i-1].x;
      const dy = pts[i].y - pts[i-1].y;
      const len = Math.hypot(dx, dy);
      let t = carry;
      while (t < len) {
        const f = t / len;
        out.push({ x: pts[i-1].x + dx*f, y: pts[i-1].y + dy*f });
        t += spacing;
      }
      carry = t - len;
    }
    return out;
  }

  catmullRom(pts, steps) {
    const out = [];
    const n   = pts.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[Math.max(0, i-1)];
      const p1 = pts[i];
      const p2 = pts[Math.min(n-1, i+1)];
      const p3 = pts[Math.min(n-1, i+2)];
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t*t, t3 = t2*t;
        out.push({
          x: .5*( (2*p1.x) + (-p0.x+p2.x)*t + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3 ),
          y: .5*( (2*p1.y) + (-p0.y+p2.y)*t + (2*p0.y-5*p1.y+4*p2.y-p3.y)*t2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*t3 )
        });
      }
    }
    out.push({ ...pts[n-1] });
    return out;
  }

  calcCurvature(pts) {
    return pts.map((p, i) => {
      if (i === 0 || i === pts.length - 1) return 0;
      const a  = pts[i-1], b = p, c = pts[i+1];
      const d1x = b.x-a.x, d1y = b.y-a.y;
      const d2x = c.x-b.x, d2y = c.y-b.y;
      const cross = Math.abs(d1x*d2y - d1y*d2x);
      const denom = Math.hypot(d1x,d1y) * Math.hypot(d2x,d2y);
      return denom > 0 ? cross / denom : 0;
    });
  }

  // ── Race logic ────────────────────────────────────────────────────────────

  startCountdown() {
    const pts = this.trackPts;
    const tip = pts[Math.min(5, pts.length-1)];
    this.car  = {
      x: pts[0].x, y: pts[0].y,
      angle: Math.atan2(tip.y - pts[0].y, tip.x - pts[0].x),
      speed: 0, idx: 0,
    };

    document.getElementById('panel-ready').style.display = 'none';
    document.getElementById('panel-hud').style.display   = 'flex';

    this.phase = 'countdown';
    let n = 3;
    const el = document.getElementById('countdown');
    el.style.display = 'flex';

    const tick = () => {
      el.textContent  = n > 0 ? String(n) : 'GO!';
      el.className    = 'count-pop';
      navigator.vibrate?.([25]);

      if (n-- > 0) {
        setTimeout(tick, 850);
      } else {
        setTimeout(() => {
          el.style.display = 'none';
          this.phase   = 'racing';
          this.startMs = performance.now();
        }, 550);
      }
    };
    tick();
    navigator.vibrate?.([30, 50, 30, 50, 80]);
  }

  tick(dt) {
    if (this.phase === 'racing') {
      this.moveCar(dt);
      this.elapsed = performance.now() - this.startMs;
      document.getElementById('timer').textContent = this.fmtTime(this.elapsed);
    }

    // Update particles
    this.particles = this.particles.filter(p => p.life > 0);
    for (const p of this.particles) {
      p.x    += p.vx * (dt / 16);
      p.y    += p.vy * (dt / 16);
      p.life -= dt / 16;
      p.r    *= 0.965;
    }
  }

  moveCar(dt) {
    const car  = this.car;
    const pts  = this.trackPts;
    const curv = this.curvature[Math.min(Math.floor(car.idx), this.curvature.length-1)] || 0;

    // Speed target depends on curvature — tight curves = slow
    const target = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * Math.pow(1 - Math.min(curv * 14, 1), 1.4);
    car.speed   += (target - car.speed) * ACCEL_RATE;

    let dist = car.speed * (dt / 16);

    while (dist > 0) {
      const i0 = Math.floor(car.idx);
      const i1 = i0 + 1;
      if (i1 >= pts.length) { this.finishRace(); return; }

      const seg   = Math.hypot(pts[i1].x - pts[i0].x, pts[i1].y - pts[i0].y);
      const frac  = car.idx - i0;
      const toEnd = (1 - frac) * seg;

      if (dist >= toEnd) {
        dist   -= toEnd;
        car.idx = i1;
        if (car.idx >= pts.length - 1) { this.finishRace(); return; }
      } else {
        car.idx += dist / (seg || 1);
        dist     = 0;
      }
    }

    // Interpolate position
    const i0 = Math.floor(car.idx);
    const i1 = Math.min(i0 + 1, pts.length - 1);
    const f  = car.idx - i0;
    car.x    = pts[i0].x + (pts[i1].x - pts[i0].x) * f;
    car.y    = pts[i0].y + (pts[i1].y - pts[i0].y) * f;

    // Smooth angle
    if (i1 > i0) {
      const ta   = Math.atan2(pts[i1].y - pts[i0].y, pts[i1].x - pts[i0].x);
      let diff   = ta - car.angle;
      while (diff >  Math.PI) diff -= 2*Math.PI;
      while (diff < -Math.PI) diff += 2*Math.PI;
      car.angle += diff * 0.28;
    }

    // Exhaust particles
    if (Math.random() < 0.55) this.spawnParticle(car);

    // Speedometer
    document.querySelector('.speed-val').textContent = Math.round(car.speed * 54);
  }

  spawnParticle(car) {
    const ba = car.angle + Math.PI;
    const sp = car.speed * 0.6 + 0.3;
    this.particles.push({
      x: car.x + Math.cos(ba)*17, y: car.y + Math.sin(ba)*17,
      vx: Math.cos(ba + (Math.random()-.5)*0.9) * sp,
      vy: Math.sin(ba + (Math.random()-.5)*0.9) * sp,
      r:  2.5 + Math.random()*3.5,
      life: 22 + Math.random()*18,
      hue: 15 + Math.random()*35
    });
  }

  finishRace() {
    this.phase   = 'done';
    const last   = this.trackPts.at(-1);
    this.car.x   = last.x;
    this.car.y   = last.y;
    this.elapsed = performance.now() - this.startMs;

    const isNew = !this.bestMs || this.elapsed < this.bestMs;
    if (isNew) {
      this.bestMs = this.elapsed;
      localStorage.setItem('dr_best', this.bestMs);
    }

    navigator.vibrate?.([50, 30, 100, 30, 200]);
    setTimeout(() => this.showResult(this.elapsed, isNew), 750);
  }

  showResult(ms, isNew) {
    document.getElementById('res-time').textContent = this.fmtTime(ms);
    const bestEl  = document.getElementById('res-best');
    bestEl.textContent  = isNew ? '🏆 New Record!' : `Best: ${this.fmtTime(this.bestMs)}`;
    bestEl.style.color  = isNew ? '#ffd700' : '#777';

    const perSec = ms / Math.max(this.trackPts.length, 1) / 10;
    document.getElementById('res-stars').textContent = perSec < 1.8 ? '⭐⭐⭐' : perSec < 3.5 ? '⭐⭐' : '⭐';

    this.showScreen('screen-result');
  }

  fmtTime(ms) {
    const m  = Math.floor(ms / 60000);
    const s  = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, W, H);
    this.drawGrid(W, H);

    // Live drawing
    if (this.phase === 'drawing' && this.rawPts.length > 1) {
      this.drawRawPath(this.rawPts);
    }

    // Finished track
    if (this.trackPts.length > 1 && this.phase !== 'drawing') {
      this.drawTrack(this.trackPts);
      this.drawMarkers(this.trackPts);
    }

    this.drawParticles();

    if (this.car && ['countdown','racing','done'].includes(this.phase)) {
      this.drawCar(this.car);
    }
  }

  drawGrid(W, H) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,255,255,0.021)';
    for (let x = 25; x < W; x += 52) {
      for (let y = 25; y < H; y += 52) {
        ctx.beginPath();
        ctx.arc(x, y, 1.4, 0, Math.PI*2);
        ctx.fill();
      }
    }
  }

  drawRawPath(pts) {
    const ctx = this.ctx;
    ctx.save();
    // Glow
    ctx.strokeStyle = 'rgba(255,200,50,0.3)';
    ctx.lineWidth   = 34;
    ctx.lineCap = ctx.lineJoin = 'round';
    this.tracePath(ctx, pts);
    ctx.stroke();
    // Core
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth   = 22;
    this.tracePath(ctx, pts);
    ctx.stroke();
    ctx.restore();
  }

  drawTrack(pts) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';

    // Outer glow
    ctx.strokeStyle = 'rgba(255,140,0,0.055)';
    ctx.lineWidth   = TRACK_WIDTH + 28;
    this.tracePath(ctx, pts); ctx.stroke();

    // Road surface
    ctx.strokeStyle = '#181826';
    ctx.lineWidth   = TRACK_WIDTH;
    this.tracePath(ctx, pts); ctx.stroke();

    // White border stroke → then refill narrower to create edge lines
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth   = TRACK_WIDTH;
    this.tracePath(ctx, pts); ctx.stroke();

    ctx.strokeStyle = '#181826';
    ctx.lineWidth   = TRACK_WIDTH - 6;
    this.tracePath(ctx, pts); ctx.stroke();

    // Dashed centre line
    ctx.strokeStyle = 'rgba(255,255,255,0.17)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([13, 14]);
    this.tracePath(ctx, pts); ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }

  drawMarkers(pts) {
    const start = pts[0];
    const end   = pts.at(-1);
    this.drawMarker(start, '#00ff88', 'S');
    this.drawMarker(end,   '#ff3355', 'F');
  }

  drawMarker(pt, color, label) {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur  = 22;
    ctx.fillStyle   = color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 18, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = '#000';
    ctx.font        = 'bold 13px system-ui';
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    ctx.fillText(label, pt.x, pt.y);
    ctx.restore();
  }

  drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life / 18) * 0.82;
      ctx.fillStyle   = `hsl(${p.hue},88%,62%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawCar(car) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);

    // Drop shadow
    ctx.shadowColor   = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur    = 12;
    ctx.shadowOffsetY = 5;

    // Body
    ctx.fillStyle = '#e83030';
    ctx.shadowColor = '#ff6030';
    ctx.shadowBlur  = 20;
    this.rr(ctx, -20, -9.5, 40, 19, 5.5);
    ctx.fill();

    // Stripe
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = 'rgba(255,255,255,0.11)';
    ctx.fillRect(-19, -3, 38, 6);

    // Cockpit
    ctx.fillStyle = 'rgba(130,215,255,0.9)';
    this.rr(ctx, -2, -6.5, 16, 13, 3.5);
    ctx.fill();

    // Wheels
    ctx.fillStyle   = '#0d0d0d';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur  = 5;
    [[-13,-12],[13,-12],[-13,12],[13,12]].forEach(([wx,wy]) => {
      ctx.save();
      ctx.translate(wx, wy);
      this.rr(ctx, -5.5, -3.5, 11, 7, 2);
      ctx.fill();
      ctx.fillStyle = '#2a2a2a';
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    });

    // Headlights
    ctx.shadowColor = '#ffff55';
    ctx.shadowBlur  = 22;
    ctx.fillStyle   = '#ffffaa';
    [[-7.5],[7.5]].forEach(([wy]) => {
      ctx.beginPath();
      ctx.arc(20, wy, 2.8, 0, Math.PI*2);
      ctx.fill();
    });

    ctx.restore();
  }

  tracePath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }

  rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y);
    ctx.arcTo(x+w, y,   x+w, y+r,   r);
    ctx.lineTo(x+w, y+h-r);
    ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
    ctx.lineTo(x+r, y+h);
    ctx.arcTo(x,   y+h, x,   y+h-r, r);
    ctx.lineTo(x,   y+r);
    ctx.arcTo(x,   y,   x+r, y,     r);
    ctx.closePath();
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  bindUI() {
    const $ = id => document.getElementById(id);

    $('btn-play').onclick = () => {
      this.showScreen('screen-game');
      this.resetToIdle();
    };

    $('btn-howto').onclick = () => this.showScreen('screen-howto');

    $('btn-back-howto').onclick = () => this.showScreen('screen-start');

    $('btn-back').onclick = () => {
      this.phase = 'idle';
      this.car   = null;
      this.showScreen('screen-start');
    };

    $('btn-race').onclick   = () => this.startCountdown();
    $('btn-redraw').onclick = () => this.resetToIdle();

    $('btn-replay').onclick = () => {
      this.showScreen('screen-game');
      this.phase = 'ready';
      this.car   = null;
      this.particles = [];
      $('hint').style.display       = 'none';
      $('panel-ready').style.display = 'flex';
      $('panel-hud').style.display   = 'none';
      $('countdown').style.display   = 'none';
      $('timer').textContent         = '00:00.00';
    };

    $('btn-newtrack').onclick = () => {
      this.showScreen('screen-game');
      this.resetToIdle();
    };
  }

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    document.getElementById(id).style.display = 'flex';
    if (id === 'screen-game') setTimeout(() => this.resize(), 30);
  }

  resetToIdle() {
    this.phase     = 'idle';
    this.rawPts    = [];
    this.trackPts  = [];
    this.car       = null;
    this.particles = [];
    this.curvature = [];

    const $ = id => document.getElementById(id);
    $('hint').style.display        = 'flex';
    $('panel-ready').style.display = 'none';
    $('panel-hud').style.display   = 'none';
    $('countdown').style.display   = 'none';
    $('timer').textContent         = '00:00.00';
  }
}

new DrawRaceGame();
