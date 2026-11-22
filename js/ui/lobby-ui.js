// 大厅 UI：左上作战传送、右上活动传送、藏品墙、榜单、公告、对局结算。
// 只负责 DOM 与交互，不持有游戏状态。

import { GAME_MODES } from '../config/modes.js';
import { ACTIVITIES, LEADERBOARD, TIERS, tierById } from '../config/lobby.js';
import { skinsFor, SKIN_MAP, RARITIES, defaultVariant, nextVariant, variantKey, wearLabel, entryId, entryVariant } from '../config/skins.js';
import { skinPreviewCss } from '../render/skin-material.js';

function $(id) { return document.getElementById(id); }

const PANELS = ['modes', 'activities', 'skins', 'board', 'hero', 'news'];

const SILHOUETTES = {
  ak: 'M2,25 L9,21 L22,21 L22,17 L58,17 L58,19 L64,19 L64,16 L70,16 L70,19 L86,19 L86,22 L114,22 L114,26 L86,26 L86,28 L70,28 L70,31 L64,31 L64,34 L56,34 L52,49 L40,49 L38,34 L34,34 L30,31 L26,31 L25,37 L12,37 L6,31 L2,31 Z',
  glock: 'M8,10 L52,10 L52,20 L44,23 L42,30 L32,30 L26,52 L12,52 L16,30 L10,28 L8,18 Z M52,13 L62,13 L62,20 L52,20 Z',
  knife: 'M6,34 C24,10 46,6 72,9 C91,11 104,18 116,30 C100,27 84,26 70,28 C50,31 30,36 18,40 L6,38 Z M4,34 L14,30 L18,40 L10,44 Z'
};

function maskUrl(weapon) {
  const d = SILHOUETTES[weapon] || SILHOUETTES.ak;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 56"><path d="' + d + '" fill="#000"/></svg>';
  return "url('data:image/svg+xml;utf8," + encodeURIComponent(svg) + "')";
}

export class LobbyUI {
  constructor(opts) {
    this.opts = opts || {};
    this.panel = null;
    this.profile = null;
    this.weaponTab = 'ak';
    this.selectedSkin = null;
    this.selectedVariant = null;
    this.hero = null;
    this.range = null;

    this.el = {
      root: $('lobby-ui'),
      boot: $('boot'),
      bootText: $('boot-text'),
      online: $('hall-online'),
      feed: $('lobby-feed'),
      quickTp: $('quick-tp'),
      name: $('pc-name'),
      tier: $('pc-tier'),
      collection: $('pc-collection'),
      badge: $('pc-badge'),
      interact: $('interact-prompt'),
      interactText: $('interact-text'),
      range: $('range-hud'),
      rangeLane: $('rh-lane'),
      rangeDist: $('rh-dist'),
      rangeScore: $('rh-score'),
      rangeAcc: $('rh-acc'),
      rangeStreak: $('rh-streak'),
      rangeBtn: $('btn-range-challenge'),
      modeGrid: $('mode-grid'),
      actGrid: $('activity-grid'),
      skinTabs: $('skin-tabs'),
      skinGrid: $('skin-grid'),
      skinDetail: $('skin-detail'),
      sdPreview: $('sd-preview'),
      sdRarity: $('sd-rarity'),
      sdName: $('sd-name'),
      sdDesc: $('sd-desc'),
      sdVariant: $('sd-variant'),
      variantBtn: $('btn-variant'),
      inspectBtn: $('btn-inspect'),
      equipBtn: $('btn-equip'),
      boardList: $('board-list'),
      heroName: $('hero-name'),
      heroTier: $('hero-tier'),
      heroDesc: $('hero-desc'),
      heroStats: $('hero-stats'),
      heroEquip: $('btn-hero-equip'),
      heroPreview: $('hero-preview'),
      matchEnd: $('match-end'),
      meTitle: $('me-title'),
      meSub: $('me-sub'),
      meStats: $('me-stats'),
      meKicker: $('me-kicker')
    };

    this._bind();
    this._bindMapPick();
    this._buildModes();
    this._buildActivities();
    this._buildBoard();
  }

  /* ---------------- 基础 ---------------- */

  _bindMapPick() {
    const current = new URLSearchParams(location.search).get('map') || 'sandline';
    document.querySelectorAll('#map-pick button').forEach((btn) => {
      const id = btn.getAttribute('data-map');
      btn.classList.toggle('on', id === current);
      btn.addEventListener('click', () => {
        const url = new URL(location.href);
        url.searchParams.set('map', id);
        location.href = url.toString();
      });
    });
  }

  _bind() {
    const btnModes = $('btn-modes');
    const btnActs = $('btn-activities');
    if (btnModes) btnModes.addEventListener('click', () => this.showModes());
    if (btnActs) btnActs.addEventListener('click', () => this.showActivities());

    PANELS.forEach((id) => {
      const panel = $('panel-' + id);
      if (!panel) return;
      const close = panel.querySelector('[data-close="' + id + '"]');
      if (close) close.addEventListener('click', () => this.closePanels());
      panel.addEventListener('click', (e) => {
        if (e.target === panel) this.closePanels();
      });
    });

    if (this.el.skinTabs) {
      this.el.skinTabs.querySelectorAll('.skin-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          this.el.skinTabs.querySelectorAll('.skin-tab').forEach((t) => t.classList.remove('on'));
          tab.classList.add('on');
          this.weaponTab = tab.getAttribute('data-weapon');
          this.selectedSkin = null;
          this.selectedVariant = null;
          this._renderSkins();
        });
      });
    }
    if (this.el.equipBtn) {
      this.el.equipBtn.addEventListener('click', () => this._equip());
    }
    if (this.el.quickTp) {
      this.el.quickTp.querySelectorAll('[data-tp]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (this.opts.onTeleport) this.opts.onTeleport(btn.getAttribute('data-tp'));
        });
      });
    }
    if (this.el.variantBtn) {
      this.el.variantBtn.addEventListener('click', () => {
        const skin = SKIN_MAP[this.selectedSkin];
        if (!skin) return;
        this.selectedVariant = nextVariant(skin, this.selectedVariant);
        this._renderSkins();
      });
    }
    if (this.el.inspectBtn) {
      this.el.inspectBtn.addEventListener('click', () => {
        const skin = SKIN_MAP[this.selectedSkin];
        if (skin && this.opts.onInspect) {
          this.opts.onInspect(skin.weapon, skin.id, this.selectedVariant || defaultVariant(skin));
        }
      });
    }
    if (this.el.heroEquip) {
      this.el.heroEquip.addEventListener('click', () => {
        if (!this.hero) return;
        const skin = SKIN_MAP[this.hero.cfg.skin];
        if (!skin) return;
        const hv = this.hero.cfg.variant || defaultVariant(skin, 3);
        this.selectedSkin = skin.id;
        this.selectedVariant = Object.assign({}, hv);
        this.weaponTab = skin.weapon;
        this._syncTabs();
        this.showSkins(skin.weapon, skin.id, hv);
        if (this.opts.onEquip) this.opts.onEquip(skin.weapon, skin.id, hv);
      });
    }
    if (this.el.rangeBtn) {
      this.el.rangeBtn.addEventListener('click', () => {
        if (this.opts.onChallenge) this.opts.onChallenge();
      });
    }
    const settings = $('btn-lobby-settings');
    if (settings) settings.addEventListener('click', () => {
      if (this.opts.onSettings) this.opts.onSettings();
    });
    const ret = $('btn-lobby-return');
    if (ret) ret.addEventListener('click', () => {
      if (this.opts.onReturnLobby) this.opts.onReturnLobby();
    });
    const rematch = $('btn-rematch');
    if (rematch) rematch.addEventListener('click', () => {
      if (this.opts.onRematch) this.opts.onRematch();
    });
    const back = $('btn-back-lobby');
    if (back) back.addEventListener('click', () => {
      if (this.opts.onReturnLobby) this.opts.onReturnLobby();
    });
  }

  showBoot(on) {
    if (this.el.boot) this.el.boot.classList.toggle('hidden', !on);
  }

  setBootText(text) {
    if (this.el.bootText) this.el.bootText.textContent = text;
  }

  show(on) {
    if (this.el.root) this.el.root.classList.toggle('hidden', !on);
  }

  setOnline(n) {
    if (this.el.online) this.el.online.textContent = String(n);
  }

  setProfile(p) {
    this.profile = p;
    if (!p) return;
    const tier = tierById(p.tier);
    if (this.el.name) this.el.name.textContent = p.name;
    if (this.el.tier) {
      this.el.tier.textContent = tier.name;
      this.el.tier.style.color = tier.color;
    }
    if (this.el.collection) this.el.collection.textContent = '收藏 ' + p.collection + ' 件';
    if (this.el.badge) {
      this.el.badge.textContent = tier.name.slice(0, 1);
      this.el.badge.style.color = tier.color;
      this.el.badge.style.borderColor = tier.color;
    }
  }

  setInteract(text) {
    if (!this.el.interact) return;
    if (this._interactText === (text || null)) return;
    this._interactText = text || null;
    if (!text) {
      this.el.interact.classList.add('hidden');
      return;
    }
    this.el.interact.classList.remove('hidden');
    if (this.el.interactText) this.el.interactText.textContent = text;
  }

  feed(text, tier) {
    if (!this.el.feed) return;
    const d = document.createElement('div');
    d.className = 'lf' + (tier >= 3 ? ' tier3' : tier === 2 ? ' tier2' : '');
    d.textContent = text;
    this.el.feed.appendChild(d);
    while (this.el.feed.children.length > 4) this.el.feed.removeChild(this.el.feed.firstChild);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 9000);
  }

  /* ---------------- 面板 ---------------- */

  _open(name) {
    PANELS.forEach((id) => {
      const p = $('panel-' + id);
      if (p) p.classList.toggle('hidden', id !== name);
    });
    this.panel = name;
    if (this.opts.onPanelChange) this.opts.onPanelChange(true);
  }

  closePanels() {
    PANELS.forEach((id) => {
      const p = $('panel-' + id);
      if (p) p.classList.add('hidden');
    });
    this.panel = null;
    if (this.opts.onPanelChange) this.opts.onPanelChange(false);
  }

  isOpen() { return !!this.panel; }

  showModes() {
    this._open('modes');
  }

  showActivities() {
    this._open('activities');
  }

  showBoard() {
    this._open('board');
  }

  showNews() {
    this._open('news');
  }

  showSkins(weapon, skinId, variant) {
    if (weapon) this.weaponTab = weapon;
    this._syncTabs();
    if (skinId) {
      const skin = SKIN_MAP[skinId];
      this.selectedSkin = skinId;
      if (variant) this.selectedVariant = Object.assign({}, variant);
      else {
        const eq = this.profile && this.profile.equipped ? this.profile.equipped[this.weaponTab] : null;
        this.selectedVariant = entryId(eq) === skinId ? entryVariant(eq, skin) : defaultVariant(skin);
      }
    } else if (!this.selectedSkin && this.profile) {
      const eq = this.profile.equipped[this.weaponTab];
      this.selectedSkin = entryId(eq);
      this.selectedVariant = entryVariant(eq, SKIN_MAP[this.selectedSkin]);
    }
    this._open('skins');
    this._renderSkins();
  }

  _syncTabs() {
    if (!this.el.skinTabs) return;
    this.el.skinTabs.querySelectorAll('.skin-tab').forEach((t) => {
      t.classList.toggle('on', t.getAttribute('data-weapon') === this.weaponTab);
    });
  }

  showHero(hero) {
    this.hero = hero;
    const tier = tierById(hero.cfg.tier);
    const skin = SKIN_MAP[hero.cfg.skin];
    const hv = hero.cfg.variant || (skin ? defaultVariant(skin, 3) : null);
    const wl = hv ? wearLabel(hv.wear) : null;
    if (this.el.heroName) this.el.heroName.textContent = hero.cfg.name;
    if (this.el.heroTier) {
      this.el.heroTier.textContent = hero.cfg.title;
      this.el.heroTier.style.color = tier.color;
      this.el.heroTier.style.borderColor = tier.color;
    }
    if (this.el.heroDesc) this.el.heroDesc.textContent = '展位藏品：' + hero.cfg.subtitle + '。走近即可试穿，不产生任何费用。';
    if (this.el.heroStats) {
      this.el.heroStats.innerHTML =
        '藏品数量：' + hero.cfg.collection + ' 件<br>' +
        '展位编号：SECTOR 01 / ' + hero.cfg.id.toUpperCase() + '<br>' +
        (hv ? '品相：<span style="color:' + wl.color + '">' + wl.name + ' · ' + hv.wear.toFixed(4) + '</span><br>' +
          '图案：' + hv.seed + ' · 偏移 ' + hv.offset.toFixed(2) + '<br>' : '') +
        '展位状态：<span style="color:' + tier.color + '">' + hero.cfg.title + ' · 永久陈列</span>';
    }
    if (this.el.heroPreview && skin && hv) {
      const m = maskUrl(skin.weapon);
      this.el.heroPreview.innerHTML = '<i class="sd-skin" style="background:' + skinPreviewCss(skin, hv) +
        ';-webkit-mask:' + m + ' center/contain no-repeat;mask:' + m + ' center/contain no-repeat"></i>';
    }
    if (this.el.heroEquip) {
      const eq = this.profile && this.profile.equipped ? this.profile.equipped[hero.cfg.weapon] : null;
      const owned = entryId(eq) === hero.cfg.skin && hv && variantKey(entryVariant(eq, skin)) === variantKey(hv);
      this.el.heroEquip.textContent = owned ? '已装备 · 收起' : '试穿这件藏品';
    }
    this._open('hero');
  }

  /* ---------------- 内容构建 ---------------- */

  _buildModes() {
    const box = this.el.modeGrid;
    if (!box) return;
    box.innerHTML = '';
    GAME_MODES.forEach((m) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mode-card' + (m.type === 'range' ? ' range' : '');
      card.style.setProperty('--mc', m.accent);
      card.innerHTML =
        '<div class="mc-tag">' + m.tag + '</div>' +
        '<h3>' + m.name + '</h3>' +
        '<div class="mc-sub">' + m.sub + '</div>' +
        '<p>' + m.desc + '</p>' +
        '<span class="mc-go">进入 →</span>';
      card.addEventListener('click', () => {
        this.closePanels();
        if (this.opts.onMode) this.opts.onMode(m.id);
      });
      box.appendChild(card);
    });
  }

  _buildActivities() {
    const box = this.el.actGrid;
    if (!box) return;
    box.innerHTML = '';
    ACTIVITIES.forEach((a) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'act-card' + (a.locked ? ' locked' : '');
      card.style.setProperty('--ac', a.accent);
      card.innerHTML =
        '<div class="ac-tag">' + a.tag + '</div>' +
        '<h3>' + a.name + '</h3>' +
        '<div class="ac-sub">' + a.sub + '</div>' +
        '<p>' + a.desc + '</p>' +
        '<span class="ac-go">' + (a.locked ? '待开放' : '查看 →') + '</span>';
      card.addEventListener('click', () => {
        if (a.locked) {
          this.feed('每日军需与充值系统将在付费方案裁定后开放', 0);
          return;
        }
        this.closePanels();
        if (a.action === 'leaderboard') this.showBoard();
        else if (a.action === 'news') this.showNews();
        else if (this.opts.onActivity) this.opts.onActivity(a.action);
      });
      box.appendChild(card);
    });
  }

  _buildBoard() {
    const box = this.el.boardList;
    if (!box) return;
    box.innerHTML = '';
    LEADERBOARD.forEach((row) => {
      const tier = tierById(row.tier);
      const d = document.createElement('div');
      d.className = 'board-row';
      d.innerHTML =
        '<span class="br-rank">' + (row.rank < 10 ? '0' + row.rank : row.rank) + '</span>' +
        '<span class="br-name">' + row.name + '</span>' +
        '<span class="br-tier" style="color:' + tier.color + '">' + tier.name + '</span>' +
        '<span class="br-highlight">' + row.highlight + '</span>' +
        '<span class="br-value">' + row.value + '</span>';
      box.appendChild(d);
    });
  }

  _renderSkins() {
    const box = this.el.skinGrid;
    if (!box) return;
    const list = skinsFor(this.weaponTab);
    const eqEntry = this.profile && this.profile.equipped ? this.profile.equipped[this.weaponTab] : null;
    const eqId = entryId(eqEntry);
    const eqSkin = SKIN_MAP[eqId];
    const eqVar = entryVariant(eqEntry, eqSkin);

    if (!this.selectedSkin && list.length) this.selectedSkin = eqId || list[0].id;
    if (!this.selectedVariant && this.selectedSkin) {
      const s = SKIN_MAP[this.selectedSkin];
      this.selectedVariant = (eqId === this.selectedSkin && eqVar) ? eqVar : defaultVariant(s);
    }

    box.innerHTML = '';
    list.forEach((skin) => {
      const rar = RARITIES[skin.rarity] || RARITIES.milspec;
      const isEq = skin.id === eqId;
      const v = (isEq && eqVar) ? eqVar : defaultVariant(skin);
      const wl = wearLabel(v.wear);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'skin-card' + (skin.id === this.selectedSkin ? ' on' : '');
      card.dataset.skin = skin.id;
      card.innerHTML =
        '<span class="skin-swatch" style="background:' + skinPreviewCss(skin, v) + '"></span>' +
        '<span class="sc-copy"><b>' + skin.name + '</b>' +
        '<span style="color:' + rar.color + '">' + rar.name + '</span>' +
        '<small style="color:' + wl.color + '">' + (isEq ? '已装备 · ' : '') + wl.name + ' · ' + v.wear.toFixed(3) + '</small></span>';
      card.addEventListener('click', () => {
        this.selectedSkin = skin.id;
        this.selectedVariant = (isEq && eqVar)
          ? Object.assign({}, eqVar)
          : defaultVariant(skin);
        this._renderSkins();
      });
      box.appendChild(card);
    });

    const sel = SKIN_MAP[this.selectedSkin];
    if (!sel) return;
    const v = this.selectedVariant || defaultVariant(sel);
    const wl = wearLabel(v.wear);
    const rar = RARITIES[sel.rarity] || RARITIES.milspec;
    if (this.el.sdPreview) {
      const m = maskUrl(sel.weapon);
      this.el.sdPreview.innerHTML = '<i class="sd-skin" style="background:' + skinPreviewCss(sel, v) +
        ';-webkit-mask:' + m + ' center/contain no-repeat;mask:' + m + ' center/contain no-repeat"></i>';
    }
    if (this.el.sdRarity) {
      this.el.sdRarity.textContent = rar.name + ' · ' + (sel.weapon === 'ak' ? 'AK-47' : sel.weapon === 'glock' ? 'GLOCK-18' : '爪刀');
      this.el.sdRarity.style.color = rar.color;
    }
    if (this.el.sdName) this.el.sdName.textContent = sel.name;
    if (this.el.sdDesc) this.el.sdDesc.textContent = sel.desc;
    if (this.el.sdVariant) {
      this.el.sdVariant.innerHTML =
        '<b style="color:' + wl.color + '">' + wl.name + ' · ' + v.wear.toFixed(4) + '</b>' +
        '<span>图案 ' + v.seed + ' · 偏移 ' + v.offset.toFixed(2) + '</span>';
    }
    if (this.el.variantBtn) {
      this.el.variantBtn.textContent = '换一个品相' + (v.preset != null ? ' ' + (v.preset + 1) + '/5' : '');
    }
    if (this.el.equipBtn) {
      const same = eqId === sel.id && eqVar && variantKey(eqVar) === variantKey(v);
      this.el.equipBtn.textContent = same ? '已装备' : '装备到大厅';
      this.el.equipBtn.disabled = !!same;
    }
    if (this.el.inspectBtn) this.el.inspectBtn.textContent = '3D 检视 · ' + sel.name;
  }

  _equip() {
    if (!this.selectedSkin) return;
    const skin = SKIN_MAP[this.selectedSkin];
    if (!skin) return;
    const v = this.selectedVariant || defaultVariant(skin);
    if (this.opts.onEquip) this.opts.onEquip(skin.weapon, skin.id, v);
    if (this.profile && this.profile.equipped) {
      this.profile.equipped[skin.weapon] = { id: skin.id, variant: Object.assign({}, v) };
    }
    this._renderSkins();
    this.feed('已装备 ' + skin.name + ' · ' + wearLabel(v.wear).name + ' ' + v.wear.toFixed(4), 1);
  }

  /* ---------------- 靶场 ---------------- */

  updateRange(state) {
    if (!this.el.range) return;
    const show = !!state.active;
    if (this.el.root) this.el.root.classList.toggle('range', show);
    this.el.range.classList.toggle('hidden', !show);
    if (!show) return;
    this.range = state;
    const lane = state.lane;
    if (this.el.rangeLane) this.el.rangeLane.textContent = lane ? '0' + lane.id + ' · ' + lane.name : '靶道';
    if (this.el.rangeDist) this.el.rangeDist.textContent = lane ? lane.dist : '';
    if (this.el.rangeScore) this.el.rangeScore.textContent = String(state.score);
    if (this.el.rangeAcc) {
      const acc = state.shots ? Math.round(state.hits / state.shots * 100) : 0;
      this.el.rangeAcc.textContent = '命中 ' + state.hits + ' / ' + state.shots + ' · ' + acc + '%';
    }
    if (this.el.rangeStreak) this.el.rangeStreak.textContent = '连中 ' + state.streak + (state.bestStreak ? ' · 最佳 ' + state.bestStreak : '');
    if (this.el.rangeBtn) {
      if (state.challenge.active) {
        this.el.rangeBtn.textContent = '挑战中 ' + Math.ceil(state.challenge.time) + 's';
        this.el.rangeBtn.disabled = true;
      } else {
        this.el.rangeBtn.textContent = '30 秒挑战';
        this.el.rangeBtn.disabled = false;
      }
    }
  }

  /* ---------------- 对局结算 ---------------- */

  popScore(text) {
    const d = document.createElement('div');
    d.className = 'score-pop';
    d.textContent = text;
    document.body.appendChild(d);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 700);
  }

  showMatchEnd(data) {
    if (!this.el.matchEnd) return;
    this.el.meTitle.textContent = data.win ? '胜利' : '失败';
    this.el.meTitle.style.color = data.win ? '#d9b47a' : '#c94f45';
    if (this.el.meKicker) this.el.meKicker.textContent = data.win ? 'MISSION COMPLETE' : 'MISSION FAILED';
    if (this.el.meSub) this.el.meSub.textContent = data.scoreT + ' : ' + data.scoreCT + ' · ' + data.reason;
    if (this.el.meStats) {
      this.el.meStats.innerHTML =
        '<div><b>' + data.kills + '</b><span>击杀</span></div>' +
        '<div><b>' + data.deaths + '</b><span>死亡</span></div>' +
        '<div><b>' + data.rounds + '</b><span>回合</span></div>';
    }
    this.el.matchEnd.classList.remove('hidden');
  }

  hideMatchEnd() {
    if (this.el.matchEnd) this.el.matchEnd.classList.add('hidden');
  }
}
