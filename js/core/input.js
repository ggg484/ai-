// 输入：桌面键鼠 + 触屏摇杆/拖动 + 按钮。
// 对外只暴露动作，不暴露具体按键，方便后续做自定义布局。

const KEYMAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
  ControlLeft: 'crouch', ControlRight: 'crouch', KeyC: 'crouch',
  ShiftLeft: 'walk', ShiftRight: 'walk',
  KeyR: 'reload',
  KeyB: 'buy',
  KeyE: 'use',
  Digit1: 'slot1',
  Digit2: 'slot2',
  Digit3: 'slot3',
  Tab: 'scoreboard'
};

const ONESHOT = new Set(['jump', 'reload', 'buy', 'switch', 'slot1', 'slot2', 'slot3', 'use']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.held = Object.create(null);
    this.pressed = new Set();
    this.lookDX = 0;
    this.lookDY = 0;
    this.sensitivity = 1;
    this.invertY = false;
    this.enabled = false;
    this.isTouch = (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) || ('ontouchstart' in window);
    this.pointerLocked = false;
    this.stick = { id: null, x: 0, y: 0 };
    this.lookId = null;
    this.lastLook = { x: 0, y: 0 };
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab') e.preventDefault();
      if (e.code === 'Escape') return;
      const a = KEYMAP[e.code];
      if (!a) return;
      if (!this.keys.has(a)) {
        this.keys.add(a);
        if (ONESHOT.has(a)) this.pressed.add(a);
      }
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.keys.delete(a);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.held = Object.create(null);
      this.stick = { id: null, x: 0, y: 0 };
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) { this.held.fire = true; this.pressed.add('fire'); }
      if (e.button === 2) this.held.aim = true;
      if (!this.isTouch && !this.pointerLocked) this.requestLock();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.held.fire = false;
      if (e.button === 2) this.held.aim = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || !this.pointerLocked) return;
      this.lookDX += (e.movementX || 0) * 0.0018 * this.sensitivity;
      this.lookDY += (e.movementY || 0) * 0.0018 * this.sensitivity * (this.invertY ? -1 : 1);
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    this.canvas.addEventListener('click', () => {
      if (this.enabled && !this.isTouch && !this.pointerLocked) this.requestLock();
    });

    this._bindTouch();
  }

  _bindTouch() {
    const zone = document.getElementById('stick-zone');
    const knob = document.getElementById('stick-knob');
    const base = zone ? zone.querySelector('.stick-base') : null;
    if (zone && knob) {
      // 浮动摇杆：按住左半屏任意位置，摇杆基座出现在手指下，半径 58px。
      const R = 58;
      const origin = { x: 0, y: 0 };
      const start = (e) => {
        if (!this.enabled) return;
        this.stick.id = e.pointerId;
        zone.setPointerCapture(e.pointerId);
        const rect = zone.getBoundingClientRect();
        origin.x = e.clientX;
        origin.y = e.clientY;
        if (base) {
          base.style.left = (e.clientX - rect.left - 75) + 'px';
          base.style.top = (e.clientY - rect.top - 75) + 'px';
          base.style.bottom = 'auto';
          base.classList.add('on');
        }
        this.stick.x = 0;
        this.stick.y = 0;
        knob.style.transform = 'translate(-50%,-50%)';
        e.preventDefault();
      };
      const move = (e) => {
        if (this.stick.id !== e.pointerId) return;
        this._moveStick(e, knob, R, origin);
        e.preventDefault();
      };
      const end = (e) => {
        if (this.stick.id !== e.pointerId) return;
        this.stick.id = null;
        this.stick.x = 0;
        this.stick.y = 0;
        knob.style.transform = 'translate(-50%,-50%)';
        if (base) {
          base.classList.remove('on');
          base.style.left = '';
          base.style.top = '';
          base.style.bottom = '';
        }
        e.preventDefault();
      };
      zone.addEventListener('pointerdown', start);
      zone.addEventListener('pointermove', move);
      zone.addEventListener('pointerup', end);
      zone.addEventListener('pointercancel', end);
      zone.addEventListener('lostpointercapture', end);
    }

    const look = document.getElementById('look-zone');
    if (look) {
      look.addEventListener('pointerdown', (e) => {
        if (!this.enabled) return;
        this.lookId = e.pointerId;
        this.lastLook.x = e.clientX;
        this.lastLook.y = e.clientY;
        look.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      look.addEventListener('pointermove', (e) => {
        if (this.lookId !== e.pointerId) return;
        const dx = e.clientX - this.lastLook.x;
        const dy = e.clientY - this.lastLook.y;
        this.lastLook.x = e.clientX;
        this.lastLook.y = e.clientY;
        this.lookDX += dx * 0.0034 * this.sensitivity;
        this.lookDY += dy * 0.0034 * this.sensitivity * (this.invertY ? -1 : 1);
        e.preventDefault();
      });
      const end = (e) => {
        if (this.lookId === e.pointerId) this.lookId = null;
      };
      look.addEventListener('pointerup', end);
      look.addEventListener('pointercancel', end);
      look.addEventListener('lostpointercapture', end);
    }

    document.querySelectorAll('[data-act]').forEach((btn) => {
      const act = btn.getAttribute('data-act');
      const down = (e) => {
        if (!this.enabled) return;
        this.held[act] = true;
        if (ONESHOT.has(act) || act === 'switch' || act === 'use' || act === 'fire') this.pressed.add(act);
        btn.classList.add('down');
        e.preventDefault();
      };
      const up = (e) => {
        this.held[act] = false;
        btn.classList.remove('down');
        e.preventDefault();
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    });
  }

  _moveStick(e, knob, R, origin) {
    let dx = e.clientX - origin.x;
    let dy = e.clientY - origin.y;
    const len = Math.hypot(dx, dy) || 1;
    if (len > R) { dx = dx / len * R; dy = dy / len * R; }
    let nx = dx / R;
    let ny = dy / R;
    // 8% 死区，避免松手时角色自己走；死区外重新映射到 0–1，保证推杆立刻响应。
    const mag = Math.hypot(nx, ny);
    if (mag < 0.08) { nx = 0; ny = 0; }
    else {
      const k = (mag - 0.08) / 0.92 / mag;
      nx *= k;
      ny *= k;
    }
    this.stick.x = nx;
    this.stick.y = ny;
    knob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
  }

  requestLock() {
    if (!this.canvas.requestPointerLock) return;
    try {
      // Chrome 新版本返回 Promise，没有用户手势时会 reject，必须吃掉这个 rejection。
      const p = this.canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {}
  }

  exitLock() {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this.keys.clear();
      this.held = Object.create(null);
      this.pressed.clear();
      this.exitLock();
    }
  }

  consumeLook() {
    const dx = this.lookDX;
    const dy = this.lookDY;
    this.lookDX = 0;
    this.lookDY = 0;
    return { dx, dy };
  }

  consumePressed(act) {
    if (this.pressed.has(act)) { this.pressed.delete(act); return true; }
    return false;
  }

  axis() {
    let x = 0, y = 0;
    if (this.keys.has('forward')) y += 1;
    if (this.keys.has('back')) y -= 1;
    if (this.keys.has('right')) x += 1;
    if (this.keys.has('left')) x -= 1;
    x += this.stick.x;
    y += -this.stick.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  isDown(act) {
    return !!this.held[act] || this.keys.has(act);
  }
}
