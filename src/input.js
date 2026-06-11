// Pointer/touch input for the canvas.
//
// Recognises four gestures and reports them through a handlers object:
//   onTap(x, y)                      — quick press with little movement
//   onDoubleTap(x, y)                — two taps close in time & space
//   onLongPressStart(x, y)           — press held past `longPressMs`
//   onLongPressMove(x, y)            — movement while a long-press is active
//   onLongPressEnd(x, y)             — release that ends a long-press
//   onSwipe(dir, x0, y0, x1, y1)     — directional drag ("left"/"right"/"up"/"down")
// Optional: shouldDeferTap() -> bool — when true, a tap is held back briefly so
//   a double-tap can be detected first (keeps normal taps instant otherwise).
//
// All positions are in canvas pixel space.

export function vibrate(ms) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(ms);
    } catch (e) {
      /* ignore */
    }
  }
}

// Pure helper: classify a displacement into a swipe direction, or null if the
// movement is too small to count as a swipe.
export function classifySwipe(dx, dy, opts = {}) {
  const minDist = opts.minDist ?? 40;
  if (Math.hypot(dx, dy) < minDist) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

export class Input {
  constructor(canvas, handlers) {
    this.canvas = canvas;
    // Back-compat: a bare function is treated as an onTap handler.
    this.h = typeof handlers === "function" ? { onTap: handlers } : handlers || {};
    this.enabled = true;

    this._down = null;
    this._longActive = false;
    this._longTimer = null;
    this._pendingTap = null;
    this._pendingTapTimer = null;
    this._lastTapTime = 0;
    this._lastTapPos = null;

    // Tunables.
    this.longPressMs = 350;
    this.tapMoveThreshold = 24; // px before a press stops being a tap
    this.doubleTapMs = 280;
    this.swipeMinDist = 40;

    this._onStart = this._onStart.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onEnd = this._onEnd.bind(this);
    this._onCancel = this._onCancel.bind(this);

    canvas.addEventListener("pointerdown", this._onStart, { passive: false });
    canvas.addEventListener("pointermove", this._onMove, { passive: false });
    canvas.addEventListener("pointerup", this._onEnd, { passive: false });
    canvas.addEventListener("pointercancel", this._onCancel);
  }

  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas._dpr || 1;
    return {
      x: ((e.clientX - rect.left) * (this.canvas.width / rect.width)) / dpr,
      y: ((e.clientY - rect.top) * (this.canvas.height / rect.height)) / dpr,
    };
  }

  _onStart(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const p = this._pos(e);
    this._down = { x: p.x, y: p.y, t: performance.now() };
    this._longActive = false;
    clearTimeout(this._longTimer);
    if (this.h.onLongPressStart) {
      this._longTimer = setTimeout(() => {
        if (!this._down) return;
        this._longActive = true;
        this.h.onLongPressStart(this._down.x, this._down.y);
      }, this.longPressMs);
    }
  }

  _onMove(e) {
    if (!this.enabled || !this._down) return;
    const p = this._pos(e);
    if (this._longActive) {
      if (this.h.onLongPressMove) this.h.onLongPressMove(p.x, p.y);
      return;
    }
    const moved = Math.hypot(p.x - this._down.x, p.y - this._down.y);
    // Moving past the tap threshold means it is a drag/swipe, not a long-press.
    if (moved > this.tapMoveThreshold) clearTimeout(this._longTimer);
  }

  _onEnd(e) {
    if (!this.enabled || !this._down) return;
    e.preventDefault();
    clearTimeout(this._longTimer);
    const p = this._pos(e);
    const down = this._down;
    this._down = null;

    if (this._longActive) {
      this._longActive = false;
      if (this.h.onLongPressEnd) this.h.onLongPressEnd(p.x, p.y);
      return;
    }

    const dx = p.x - down.x;
    const dy = p.y - down.y;
    const dt = performance.now() - down.t;
    const moved = Math.hypot(dx, dy);

    // Swipe takes priority over tap when the finger travelled far enough.
    const dir = classifySwipe(dx, dy, { minDist: this.swipeMinDist });
    if (dir && this.h.onSwipe) {
      this.h.onSwipe(dir, down.x, down.y, p.x, p.y);
      return;
    }

    // Tap: small movement, quick.
    if (moved < this.tapMoveThreshold && dt < 600) {
      this._resolveTap(p.x, p.y);
    }
  }

  _onCancel() {
    clearTimeout(this._longTimer);
    this._down = null;
    this._longActive = false;
  }

  _resolveTap(x, y) {
    const now = performance.now();
    const canDouble = !!this.h.onDoubleTap;

    // A second tap close in time & space is a double-tap.
    if (
      canDouble &&
      this._pendingTap &&
      now - this._lastTapTime < this.doubleTapMs &&
      Math.hypot(x - this._lastTapPos.x, y - this._lastTapPos.y) <
        this.tapMoveThreshold
    ) {
      clearTimeout(this._pendingTapTimer);
      this._pendingTap = null;
      this._lastTapPos = null;
      this.h.onDoubleTap(x, y);
      return;
    }

    // Only delay single taps when asked (e.g. a charged blast is available);
    // otherwise fire immediately so normal popping stays snappy.
    const defer = canDouble && this.h.shouldDeferTap && this.h.shouldDeferTap();
    this._lastTapTime = now;
    this._lastTapPos = { x, y };
    if (defer) {
      this._pendingTap = { x, y };
      clearTimeout(this._pendingTapTimer);
      this._pendingTapTimer = setTimeout(() => {
        const pt = this._pendingTap;
        this._pendingTap = null;
        if (pt && this.h.onTap) this.h.onTap(pt.x, pt.y);
      }, this.doubleTapMs);
    } else if (this.h.onTap) {
      this.h.onTap(x, y);
    }
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) {
      clearTimeout(this._longTimer);
      clearTimeout(this._pendingTapTimer);
      this._down = null;
      this._longActive = false;
      this._pendingTap = null;
    }
  }
}
