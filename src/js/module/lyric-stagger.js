// ============================================================
// Lyric Stagger Scroll Animation Module
// ============================================================

(function (global) {
  'use strict';

  const BOYOYON_SPRING = 'linear(0 0%, 0.053 2.5%, 0.185 5.0%, 0.359 7.5%, 0.546 10.0%, 0.724 12.5%, 0.876 15.0%, 0.996 17.5%, 1.081 20.0%, 1.132 22.5%, 1.156 25.0%, 1.156 27.5%, 1.141 30.0%, 1.117 32.5%, 1.087 35.0%, 1.058 37.5%, 1.032 40.0%, 1.01 42.5%, 0.994 45.0%, 0.983 47.5%, 0.977 50.0%, 0.975 52.5%, 0.976 55.0%, 0.979 57.5%, 0.984 60.0%, 0.988 62.5%, 0.993 65.0%, 0.997 67.5%, 1.0 70.0%, 1.002 72.5%, 1.003 75.0%, 1.004 77.5%, 1.004 80.0%, 1.004 82.5%, 1.003 85.0%, 1.002 87.5%, 1.001 90.0%, 1.001 92.5%, 1.0 95.0%, 1.0 97.5%, 1 100%)';
  const NORMAL_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  const STAGGER_STEP_SEC = 0.03;
  const MAX_STAGGER_ROWS = 40;
  const MIN_SCROLL_DIFF = 1;
  const MAX_SCROLL_DIFF = 850;

  /**
   * Applies a staggered scroll animation to the lyrics container using FLIP-style translations.
   *
   * @param {HTMLElement} container - The lyrics scroll container
   * @param {number} targetScroll - The target scrollTop value
   * @param {number} targetIndex - The index of the newly active lyric line
   * @param {Object} [options] - Additional options
   * @param {boolean} [options.instant] - If true, jump instantly without animation
   * @param {boolean} [options.isUserScrolling] - If true, do not interrupt user scrolling
   * @returns {boolean} Whether stagger animation was executed
   */
  const performStaggerScroll = (container, targetScroll, targetIndex, options = {}) => {
    if (!container) return false;

    const { instant = false, isUserScrolling = false } = options;

    if (instant || isUserScrolling || container._instantNextScroll) {
      container.scrollTop = targetScroll;
      container._scrollPos = targetScroll;
      container._scrollLastWritten = targetScroll;
      container._scrollTarget = undefined;
      container._scrollVel = 0;
      return false;
    }

    const currentScroll = container.scrollTop;
    const scrollDiff = targetScroll - currentScroll;

    // Skip stagger for very tiny micro-adjustments or huge jumps (like clicking far away)
    if (Math.abs(scrollDiff) < MIN_SCROLL_DIFF || Math.abs(scrollDiff) > MAX_SCROLL_DIFF) {
      return false;
    }

    const rows = container.children;
    if (!rows || rows.length === 0) {
      return false;
    }

    const originIndex = Math.max(0, targetIndex ?? 0);
    const windowStart = Math.max(0, originIndex - MAX_STAGGER_ROWS);
    const windowEnd = Math.min(rows.length, originIndex + MAX_STAGGER_ROWS);

    const baseTransitions = 'color 0.3s ease, font-size 0.3s ease, transform 0.3s ease, opacity 0.3s ease, filter 0.3s ease';

    // 1. Invert: shift rows visually to match their pre-scroll position with no transition
    for (let i = windowStart; i < windowEnd; i++) {
      const r = rows[i];
      if (!r || r.nodeType !== 1) continue;
      r.style.transition = `translate 0s, ${baseTransitions}`;
      r.style.translate = `0 ${scrollDiff}px`;
    }

    // 2. Update the container scrollTop immediately to the target
    container.scrollTop = targetScroll;
    container._scrollPos = targetScroll;
    container._scrollLastWritten = targetScroll;
    container._scrollTarget = undefined;
    container._scrollVel = 0;
    container._suppressUserScrollUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 500;
    if (typeof global.suppressUserScrollDetection === 'function') {
      global.suppressUserScrollDetection(500);
    }

    // Force reflow
    void container.offsetHeight;

    // 3. Play: smoothly animate rows back to translate 0 with distance-based delay
    const isBounce = (typeof global.isStaggerBounceEnabled !== 'undefined')
      ? !!global.isStaggerBounceEnabled
      : false;
    const currentEasing = isBounce ? BOYOYON_SPRING : NORMAL_EASING;
    const currentDuration = isBounce ? '0.95s' : '0.65s';

    for (let i = windowStart; i < windowEnd; i++) {
      const r = rows[i];
      if (!r || r.nodeType !== 1) continue;
      const dist = Math.abs(i - originIndex);
      const delay = dist * STAGGER_STEP_SEC;
      r.style.transition = `translate ${currentDuration} ${currentEasing} ${delay.toFixed(3)}s, ${baseTransitions}`;
      r.style.translate = '0 0';
    }

    return true;
  };

  const LyricStagger = {
    performStaggerScroll,
    BOYOYON_SPRING,
    NORMAL_EASING,
  };

  if (typeof window !== 'undefined') {
    window.LyricStagger = LyricStagger;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.LyricStagger = LyricStagger;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LyricStagger;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
