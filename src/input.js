// Pointer/touch input for the canvas. Reports taps in canvas pixel space.

export function vibrate(ms) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(ms);
    } catch (e) {
      /* ignore */
    }
  }
}

export class Input {
  constructor(canvas, onTap) {
    this.canvas = canvas;
    this.onTap = onTap;
    this.enabled = true;
    this._down = null;

    this._onStart = this._onStart.bind(this);
    this._onEnd = this._onEnd.bind(this);

    canvas.addEventListener("pointerdown", this._onStart, { passive: false });
    canvas.addEventListener("pointerup", this._onEnd, { passive: false });
    canvas.addEventListener("pointercancel", () => (this._down = null));
  }

  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas._dpr || 1;
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width) / dpr,
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height) / dpr,
    };
  }

  _onStart(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this._down = { ...this._pos(e), t: performance.now() };
  }

  _onEnd(e) {
    if (!this.enabled || !this._down) return;
    e.preventDefault();
    const p = this._pos(e);
    const dx = p.x - this._down.x;
    const dy = p.y - this._down.y;
    const moved = Math.hypot(dx, dy);
    const dt = performance.now() - this._down.t;
    this._down = null;
    // Treat as a tap only if the pointer barely moved and was quick.
    if (moved < 24 && dt < 600 && this.onTap) {
      this.onTap(p.x, p.y);
    }
  }

  setEnabled(v) {
    this.enabled = v;
  }
}
