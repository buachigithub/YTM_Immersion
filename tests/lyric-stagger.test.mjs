import assert from 'node:assert/strict';
import test from 'node:test';
import LyricStagger from '../src/js/module/lyric-stagger.js';
const { performStaggerScroll } = LyricStagger;

test('performStaggerScroll performs FLIP translate animation on lyric rows', () => {
  const rows = [];
  for (let i = 0; i < 20; i++) {
    const el = {
      nodeType: 1,
      style: { transition: '', translate: '' },
    };
    rows.push(el);
  }

  const container = {
    scrollTop: 100,
    children: rows,
    _scrollPos: 100,
    _scrollLastWritten: 100,
    offsetHeight: 400,
  };

  const executed = performStaggerScroll(container, 180, 5);
  assert.equal(executed, true, 'must execute stagger when scrollDiff is within range');
  assert.equal(container.scrollTop, 180, 'scrollTop must jump to target');

  // Check that rows got transition and translate reset to 0 0
  assert.equal(rows[5].style.translate, '0 0');
  assert.match(rows[5].style.transition, /translate/);
});

test('performStaggerScroll skips stagger on small diff or user scrolling', () => {
  const container = {
    scrollTop: 100,
    children: [],
  };

  // Tiny diff
  const executedSmall = performStaggerScroll(container, 100.5, 0);
  assert.equal(executedSmall, false);

  // User scrolling
  const executedUser = performStaggerScroll(container, 200, 0, { isUserScrolling: true });
  assert.equal(executedUser, false);
});
