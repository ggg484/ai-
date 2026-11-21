// HUD：纯 DOM，渲染层只管 3D。
// 这样排版、刘海适配、触屏点击都比在 canvas 里自绘省事，也更容易做多语言。

import { BUY_ITEMS } from '../config/weapons.js';

function $(id) { return document.getElementById(id); }

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'),
      scoreT: $('score-t'), scoreCT: $('score-ct'),
      timer: $('timer'), phase: $('phase'), roundNo: $('round-no'), fps: $('fps'),
      hp: $('hp'), hpFill: $('hp-fill'), armor: $('armor'), armorFill: $('armor-fill'),
      money: $('money'), wname: $('wname'), ammo: $('ammo'), reserve: $('reserve'),
      slots: document.querySelectorAll('.slots span'),
      killfeed: $('killfeed'), objective: $('objective'),
      crosshair: $('crosshair'), hitmarker: $('hitmarker'), vignette: $('vignette'),
      plantBar: $('plant-bar'), plantFill: $('plant-fill'), plantText: $('plant-text'),
      bombStatus: $('bomb-status'), bombTimer: $('bomb-timer'),
      radar: $('radar'),
      roster: $('roster'), scoreboard: $('scoreboard'), sbCols: $('sb-cols'),
      start: $('start'), buy: $('buy'), settings: $('settings'), pause: $('pause'),
      roundEnd: $('round-end'), endTitle: $('end-title'), endSub: $('end-sub'),
      buyList: $('buy-list'), buyMoney: $('buy-money'),
      setSens: $('set-sens'), setFov: $('set-fov'), setQuality: $('set-quality'),
      hostStatus: $('host-status'), btnSettings: $('btn-settings')
    };
    this.rctx = this.el.radar ? this.el.radar.getContext('2d') : null;
    this.onBuy = null;
    this.onSettings = null;
    this._vignetteT = null;
    this._endT = null;
    this._buildBuyList();
    this._bindSettings();
  }

  _buildBuyList() {
    const box = this.el.buyList;
    if (!box) return;
    box.innerHTML = '';
    BUY_ITEMS.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'buy-item';
      row.dataset.id = it.id;
      row.innerHTML = '<div><div class="bi-name"></div><div class="bi-desc"></div></div><div class="bi-price"></div>';
      row.querySelector('.bi-name').textContent = it.name;
      row.querySelector('.bi-desc').textContent = it.desc;
      row.querySelector('.bi-price').textContent = '$' + it.price;
      row.addEventListener('click', () => {
        if (row.classList.contains('disabled')) return;
        if (this.onBuy) this.onBuy(it);
      });
      box.appendChild(row);
    });
  }

  _bindSettings() {
    if (this.el.setSens) this.el.setSens.addEventListener('input', () => this._emitSettings());
    if (this.el.setFov) this.el.setFov.addEventListener('input', () => this._emitSettings());
    if (this.el.setQuality) this.el.setQuality.addEventListener('change', () => this._emitSettings());
  }

  _emitSettings() {
    if (!this.onSettings) return;
    this.onSettings({
      sensitivity: parseFloat(this.el.setSens.value),
      fov: parseInt(this.el.setFov.value, 10),
      quality: this.el.setQuality.value
    });
  }

  applySettings(s) {
    if (!s) return;
    if (this.el.setSens) this.el.setSens.value = s.sensitivity;
    if (this.el.setFov) this.el.setFov.value = s.fov;
    if (this.el.setQuality) this.el.setQuality.value = s.quality;
  }

  showStart(on) { this.el.start.classList.toggle('hidden', !on); }
  showPause(on) { this.el.pause.classList.toggle('hidden', !on); }
  showBuy(on) {
    this.el.buy.classList.toggle('hidden', !on);
    if (on) this.renderBuy(this.money || 0, true);
  }
  showSettings(on) { this.el.settings.classList.toggle('hidden', !on); }
  showHud(on) { this.el.hud.classList.toggle('hidden', !on); }

  setHostStatus(text) { if (this.el.hostStatus) this.el.hostStatus.textContent = text; }

  setVitals(hp, armor) {
    const h = Math.max(0, Math.round(hp));
    const a = Math.max(0, Math.round(armor));
    this.el.hp.textContent = h;
    this.el.armor.textContent = a;
    this.el.hpFill.style.width = h + '%';
    this.el.armorFill.style.width = Math.min(100, a) + '%';
  }

  setMoney(n) {
    this.money = n;
    this.el.money.textContent = '$ ' + n.toLocaleString('en-US');
    this.el.buyMoney.textContent = '$ ' + n.toLocaleString('en-US');
  }

  setWeapon(name, ammo, reserve, slot) {
    this.el.wname.textContent = name;
    this.el.ammo.textContent = ammo;
    this.el.reserve.textContent = (reserve == null || reserve === '') ? '' : '/ ' + reserve;
    this.el.slots.forEach((s) => {
      const n = parseInt(s.getAttribute('data-slot'), 10);
      s.classList.toggle('on', n === slot);
    });
  }

  setAmmo(ammo, reserve) {
    this.el.ammo.textContent = ammo;
    this.el.reserve.textContent = '/ ' + reserve;
  }

  setScore(t, ct) {
    this.el.scoreT.textContent = t;
    this.el.scoreCT.textContent = ct;
  }

  setRound(n) { this.el.roundNo.textContent = '回合 ' + n; }

  setTimer(sec) {
    const s = Math.max(0, Math.ceil(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    this.el.timer.textContent = m + ':' + (r < 10 ? '0' : '') + r;
  }

  setPhase(text) { this.el.phase.textContent = text; }
  setObjective(text) { this.el.objective.textContent = text; }

  setPlant(p, visible) {
    this.el.plantBar.classList.toggle('hidden', !visible);
    this.el.plantFill.style.width = Math.round(p * 100) + '%';
    this.el.plantText.textContent = '安放中 ' + Math.round(p * 100) + '%';
  }

  setBomb(on) { this.el.bombStatus.classList.toggle('hidden', !on); }
  setBombTimer(t) { this.el.bombTimer.textContent = Math.max(0, t).toFixed(1); }

  setCrosshairGap(px) {
    this.el.crosshair.style.setProperty('--gap', Math.max(3, Math.min(26, px)) + 'px');
  }

  hitmarker(kill) {
    const h = this.el.hitmarker;
    h.classList.add('show');
    h.classList.toggle('kill', !!kill);
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => h.classList.remove('show'), 90);
  }

  flashDamage(strength) {
    this.el.vignette.style.opacity = String(Math.min(0.9, 0.35 + strength * 0.5));
    clearTimeout(this._vignetteT);
    this._vignetteT = setTimeout(() => { this.el.vignette.style.opacity = '0'; }, 180);
  }

  killfeed(text) {
    const d = document.createElement('div');
    d.className = 'kf';
    d.textContent = text;
    this.el.killfeed.appendChild(d);
    while (this.el.killfeed.children.length > 4) this.el.killfeed.removeChild(this.el.killfeed.firstChild);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 4000);
  }

  setFps(v) { this.el.fps.textContent = v + ' fps'; }

  toast(text) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    document.body.appendChild(d);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 1700);
  }

  hideRoundEnd() { this.el.roundEnd.classList.add('hidden'); }

  showRoundEnd(win, reason) {
    this.el.endTitle.textContent = win ? '回合胜利' : '回合失败';
    this.el.endSub.textContent = reason;
    this.el.roundEnd.classList.remove('hidden');
    clearTimeout(this._endT);
    this._endT = setTimeout(() => this.el.roundEnd.classList.add('hidden'), 3400);
  }

  renderBuy(money, canBuy) {
    this.el.buyList.querySelectorAll('.buy-item').forEach((row) => {
      const id = row.dataset.id;
      const item = BUY_ITEMS.find((i) => i.id === id);
      const ok = canBuy && item.enabled !== false && money >= item.price;
      row.classList.toggle('disabled', !ok);
    });
    this.el.buyMoney.textContent = '$ ' + money.toLocaleString('en-US');
  }

  /** 顶部 5v5 存活条：每 0.1s 由 game 调用。 */
  setRoster(tRows, ctRows) {
    if (!this.el.roster) return;
    const key = tRows.map((r) => r.alive ? 1 : 0).join('') + '|' + ctRows.map((r) => r.alive ? 1 : 0).join('');
    if (key === this._rosterKey) return;
    this._rosterKey = key;
    const side = (rows, cls) => '<div class="rs-side ' + cls + '">' + rows.map((r) =>
      '<i class="' + (r.alive ? 'on' : 'off') + '" title="' + r.name + '"></i>').join('') + '</div>';
    this.el.roster.innerHTML =
      '<span class="rs-tag t">T ' + tRows.filter((r) => r.alive).length + '</span>' +
      side(tRows, 't') +
      '<span class="rs-vs">VS</span>' +
      side(ctRows, 'ct') +
      '<span class="rs-tag ct">' + ctRows.filter((r) => r.alive).length + ' CT</span>';
  }

  /** 按住 Tab 的战术战报。 */
  showScoreboard(on, data) {
    const el = this.el.scoreboard;
    if (!el) return;
    el.classList.toggle('hidden', !on);
    if (!on || !data || !this.el.sbCols) return;
    const col = (title, rows, cls) => {
      const sorted = rows.slice().sort((a, b) => (b.kills - a.kills) || (a.deaths - b.deaths));
      return '<div class="sb-col ' + cls + '"><div class="sb-col-head"><b>' + title + '</b><span>' +
        rows.filter((r) => r.alive).length + ' 存活</span></div>' +
        sorted.map((r) =>
          '<div class="sb-row' + (r.you ? ' you' : '') + (r.alive ? '' : ' dead') + '">' +
          '<span class="sb-name">' + r.name + '</span>' +
          '<span class="sb-k">' + r.kills + '</span>' +
          '<span class="sb-d">' + r.deaths + '</span>' +
          '<span class="sb-st">' + (r.alive ? '●' : '✕') + '</span>' +
          '</div>').join('') + '</div>';
    };
    this.el.sbCols.innerHTML = col('T · 进攻方', data.t, 't') + col('CT · 防守方', data.ct, 'ct');
  }

  drawRadar(map, player, bots, bomb) {
    const ctx = this.rctx;
    if (!ctx || !map) return;
    const W = this.el.radar.width, H = this.el.radar.height;
    const b = map.bounds;
    const pad = 9;
    const sx = (W - pad * 2) / (b.maxX - b.minX);
    const sz = (H - pad * 2) / (b.maxZ - b.minZ);
    const s = Math.min(sx, sz);
    const ox = (W - (b.maxX - b.minX) * s) / 2;
    const oz = (H - (b.maxZ - b.minZ) * s) / 2;
    const px = (x) => ox + (x - b.minX) * s;
    const pz = (z) => H - (oz + (z - b.minZ) * s);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,12,9,.62)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(217,180,122,.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, H - oz - (b.maxZ - b.minZ) * s, (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s);

    // 包点
    Object.keys(map.sites).forEach((k) => {
      const st = map.sites[k];
      ctx.beginPath();
      ctx.arc(px(st.x), pz(st.z), st.r * s, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(224,106,53,.18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(224,106,53,.7)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,180,140,.9)';
      ctx.font = '600 9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(k, px(st.x), pz(st.z) + 3);
    });

    // 炸弹
    if (bomb) {
      ctx.beginPath();
      ctx.arc(px(bomb.x), pz(bomb.z), 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4020';
      ctx.fill();
    }

    // 队友始终显示，敌人只显示 30m 内的（骨架版没有共享视野）
    bots.forEach((bt) => {
      if (!bt.alive) return;
      const ally = bt.team === 't';
      const d = Math.hypot(bt.pos.x - player.position.x, bt.pos.z - player.position.z);
      if (!ally && d > 30) return;
      if (ally && d > 46) return;
      ctx.beginPath();
      ctx.arc(px(bt.pos.x), pz(bt.pos.z), ally ? 2.8 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = ally ? '#69c6a8' : '#e05a3a';
      ctx.fill();
      if (ally) {
        ctx.strokeStyle = 'rgba(105,198,168,.45)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });

    // 玩家三角
    const x = px(player.position.x), y = pz(player.position.z);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(player.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.6, 5);
    ctx.lineTo(0, 2.8);
    ctx.lineTo(-4.6, 5);
    ctx.closePath();
    ctx.fillStyle = '#e9e2cf';
    ctx.fill();
    ctx.restore();
  }
}
