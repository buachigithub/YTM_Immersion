// ============================================================
// Lyric Stagger Scroll Animation Module
// ============================================================

const STAGGER_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const STAGGER_DURATION = '0.65s';
const STAGGER_STEP_SEC = 0.025;
const MAX_STAGGER_ROWS = 35;
const MIN_SCROLL_DIFF = 2;
const MAX_SCROLL_DIFF = 900;

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
export const performStaggerScroll = (container, targetScroll, targetIndex, options = {}) => {
  if (!container) return false;

  const { instant = false, isUserScrolling = false } = options;

  if (instant || isUserScrolling || container._instantNextScroll) {
    container.scrollTop = targetScroll;
    container._scrollPos = targetScroll;
    container._scrollLastWritten = targetScroll;
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

  // 1. Invert: shift rows visually to match their pre-scroll position with no transition
  for (let i = windowStart; i < windowEnd; i++) {
    const r = rows[i];
    if (r.nodeType !== 1) continue;
    r.style.transition = 'translate 0s, opacity 0.3s ease, filter 0.3s ease, color 0.3s ease';
    r.style.translate = `0 ${scrollDiff}px`;
  }

  // 2. Update the container scrollTop immediately to the target
  container.scrollTop = targetScroll;
  container._scrollPos = targetScroll;
  container._scrollLastWritten = targetScroll;

  // 3. Force reflow to register the inverted translate before transitioning
  void container.offsetHeight;

  // 4. Play: animate back to (0, 0) with distance-based stagger delays
  for (let i = windowStart; i < windowEnd; i++) {
    const r = rows[i];
    if (r.nodeType !== 1) continue;
    const dist = Math.abs(i - originIndex);
    const delay = (dist * STAGGER_STEP_SEC).toFixed(3);
    r.style.transition = `translate ${STAGGER_DURATION} ${STAGGER_EASING} ${delay}s, opacity 0.3s ease, filter 0.3s ease, color 0.3s ease`;
    r.style.translate = '0 0';
  }

  return true;
};

if (typeof window !== 'undefined') {
  window.LyricStagger = { performStaggerScroll };
}
