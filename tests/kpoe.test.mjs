import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_KPOE_BASE_URL,
  normalizeKpoeBaseUrl,
  buildKpoeRequestUrl,
  convertKpoeResponse,
  fetchKpoeLyrics,
} from '../src/js/module/kpoe.js';

const withMockFetch = async (mock, run) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test('normalizes the KPoe base URL', () => {
  assert.equal(normalizeKpoeBaseUrl(''), DEFAULT_KPOE_BASE_URL);
  assert.equal(normalizeKpoeBaseUrl('   '), DEFAULT_KPOE_BASE_URL);
  assert.equal(normalizeKpoeBaseUrl('localhost:3946'), 'http://localhost:3946');
  assert.equal(normalizeKpoeBaseUrl('http://localhost:3946/'), 'http://localhost:3946');
  assert.equal(normalizeKpoeBaseUrl('https://lyrics.example:3946/'), 'https://lyrics.example:3946');
  assert.equal(normalizeKpoeBaseUrl('ftp://example.com'), '');
});

test('builds the /v2/lyrics/get request URL with matching parameters', () => {
  const url = buildKpoeRequestUrl({
    baseUrl: 'http://localhost:3946',
    title: '青と夏',
    artist: 'Mrs. GREEN APPLE',
    duration: 220.5,
    album: '青と夏',
    videoId: 'oRdx1f5rF2M',
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'http://localhost:3946');
  assert.equal(parsed.pathname, '/v2/lyrics/get');
  assert.equal(parsed.searchParams.get('title'), '青と夏');
  assert.equal(parsed.searchParams.get('artist'), 'Mrs. GREEN APPLE');
  assert.equal(parsed.searchParams.get('duration'), '221');
  assert.equal(parsed.searchParams.get('album'), '青と夏');
  assert.equal(parsed.searchParams.get('id'), 'oRdx1f5rF2M');
});

test('accepts a full endpoint URL without duplicating the path', () => {
  const url = buildKpoeRequestUrl({
    baseUrl: 'https://lyrics.example/v2/lyrics/get',
    title: 'Turing Love',
  });
  assert.equal(new URL(url).pathname, '/v2/lyrics/get');
});

test('converts Word responses into syllable-timed dynamic lines', () => {
  const payload = convertKpoeResponse({
    type: 'Word',
    status: 'success',
    metadata: { source: 'BuaaaBot', language: 'ja' },
    lyrics: [
      {
        time: 795,
        duration: 968,
        text: 'さぁ行こう!',
        syllabus: [
          { time: 795, duration: 520, text: 'さぁ' },
          { time: 1315, duration: 154, text: '行こ' },
          { time: 1469, duration: 294, text: 'う!' },
        ],
        element: { singer: 'v1' },
      },
    ],
  });

  assert.ok(payload);
  assert.equal(payload.lyricsSource, 'kpoe');
  assert.equal(payload.lyrics, '[00:00.79] さぁ行こう!');
  assert.equal(payload.lyricsQuality, 4);
  assert.equal(payload.dynamicLines.length, 1);
  assert.equal(payload.dynamicLines[0].startTimeMs, 795);
  assert.equal(payload.dynamicLines[0].endTimeMs, 795 + 968);
  assert.deepEqual(payload.dynamicLines[0].chars, [
    { t: 795, c: 'さぁ' },
    { t: 1315, c: '行こ' },
    { t: 1469, c: 'う!' },
  ]);
  assert.equal(payload.kpoe.type, 'word');
});

test('keeps Line responses line-synced without fabricated word timing', () => {
  const payload = convertKpoeResponse({
    type: 'Line',
    lyrics: [{ time: 1000, duration: 2000, text: 'hello world' }],
  });

  assert.ok(payload);
  assert.equal(payload.dynamicLines, null);
  assert.equal(payload.lyricsQuality, 2);
  assert.equal(payload.lyrics, '[00:01.00] hello world');
});

test('splits v2 (duet) lines into subLyrics', () => {
  const payload = convertKpoeResponse({
    type: 'Word',
    lyrics: [
      { time: 0, duration: 1000, text: 'main', element: { singer: 'v1' }, syllabus: [{ time: 0, duration: 1000, text: 'main' }] },
      { time: 1000, duration: 1000, text: 'echo', element: { singer: 'v2' }, syllabus: [{ time: 1000, duration: 1000, text: 'echo' }] },
    ],
  });

  assert.ok(payload);
  assert.equal(payload.kpoe.duet, true);
  assert.match(payload.lyrics, /\[00:00\.00\] main/);
  assert.ok(!payload.lyrics.includes('echo'));
  assert.match(payload.subLyrics, /echo/);
  assert.equal(payload.dynamicLines.length, 1);
});

test('falls back to even character timing when a Word line has no syllabus', () => {
  const payload = convertKpoeResponse({
    type: 'Word',
    lyrics: [{ time: 0, duration: 400, text: 'abcd' }],
  });

  assert.ok(payload);
  assert.deepEqual(payload.dynamicLines[0].chars, [
    { t: 0, c: 'a' },
    { t: 100, c: 'b' },
    { t: 200, c: 'c' },
    { t: 300, c: 'd' },
  ]);
});

test('returns null for error, empty, or invalid responses', () => {
  assert.equal(convertKpoeResponse(null), null);
  assert.equal(convertKpoeResponse({ status: 'error', message: 'Lyrics not found in local library' }), null);
  assert.equal(convertKpoeResponse({ type: 'Word', lyrics: [] }), null);
});

test('fetchKpoeLyrics normalizes a success response', async () => {
  await withMockFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      type: 'Line',
      lyrics: [{ time: 500, duration: 1000, text: 'line' }],
    }),
  }), async () => {
    const res = await fetchKpoeLyrics({ baseUrl: 'http://localhost:3946', title: 'line' });
    assert.ok(res);
    assert.equal(res.lyricsSource, 'kpoe');
    assert.equal(res.lyrics, '[00:00.50] line');
  });
});

test('fetchKpoeLyrics treats 404 as not-found instead of throwing', async () => {
  await withMockFetch(async () => ({
    ok: false,
    status: 404,
    json: async () => ({ status: 'error', message: 'Lyrics not found in local library' }),
  }), async () => {
    const res = await fetchKpoeLyrics({ baseUrl: 'http://localhost:3946', title: 'missing' });
    assert.equal(res, null);
  });
});
