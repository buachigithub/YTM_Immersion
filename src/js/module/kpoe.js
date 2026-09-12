// ============================================================
// Custom KPoe / LyricsPlus 互換 歌詞配信API クライアント
//
// 利用者が指定した KPoe 互換サーバー（既定: http://localhost:3946）から
// 歌詞を取得し、この拡張機能が解釈できる形へ正規化する。
//
// ■ なぜ background（Service Worker）で fetch するのか
//   KPoe サーバーは Access-Control-Allow-Origin: * を返すため、
//   MV3 の Service Worker からでも CORS を通過して取得できる。
//   content script と違い、既存の歌詞ソース（LRCHub / LrcLib）と同じ
//   経路に乗せられるので、優先順位やフォールバックの扱いを統一できる。
//
// ■ 出力の形
//   既存の LRCHub 経路と互換の payload を返す。
//     lyrics         … 行同期 LRC 文字列
//     dynamicLines   … 文字・音節単位の timing（単語同期 / カラオケ用）
//     subLyrics      … デュエット(v2)用の LRC（Dynamic形式なら右側も単語同期）
//   dynamicLines は要素 { startTimeMs, endTimeMs, text, chars:[{t,c}] } で、
//   既存の normalizeDynamicLinesToCharLevel / renderLyrics がそのまま扱える。
//
// ■ デュエット
//   element.singer が "v2" の行は subLyrics 側へ分離する。既存の
//   duet レンダリング（duetSubLyricsRaw）に渡すことで左右に振り分けられる。
//   v1 が1行も無い場合は全行をメイン扱いにして崩れを防ぐ。
// ============================================================

export const DEFAULT_KPOE_BASE_URL = 'http://localhost:3946';

const toFiniteNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

// LRC のタイムスタンプ。既存パーサー（parseLRCInternal）に合わせて
// mm:ss.cc（センチ秒）で出力する。
const formatLrcTime = (ms) => {
  const total = Math.max(0, toFiniteNumber(ms) ?? 0) / 1000;
  const min = Math.floor(total / 60);
  const sec = Math.floor(total - min * 60);
  const cs = Math.floor((total - min * 60 - sec) * 100);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

// 先頭にスキームが無い入力を補い、末尾スラッシュを落とす。
// 不正な値（http/https 以外）は空文字を返し、呼び出し側で無効扱いにする。
export const normalizeKpoeBaseUrl = (value) => {
  const raw = String(value ?? '').trim();
  const candidate = raw || DEFAULT_KPOE_BASE_URL;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)
    ? candidate
    : `http://${candidate}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString().replace(/\/+$/, '');
  } catch (e) {
    return '';
  }
};

const resolveKpoeEndpoint = (base) => {
  if (/\/v2\/lyrics\/get$/i.test(base)) return base;
  if (/\/v2\/lyrics$/i.test(base)) return `${base}/get`;
  if (/\/v2$/i.test(base)) return `${base}/lyrics/get`;
  return `${base}/v2/lyrics/get`;
};

// GET /v2/lyrics/get の URL を組み立てる。title は仕様上必須だが、
// videoId があればサーバー側の完全一致に回せるので空でも送る。
export const buildKpoeRequestUrl = (params = {}) => {
  const base = normalizeKpoeBaseUrl(params.baseUrl);
  if (!base) return null;

  let url;
  try {
    url = new URL(resolveKpoeEndpoint(base));
  } catch (e) {
    return null;
  }

  const title = String(params.title ?? '').trim();
  if (title) url.searchParams.set('title', title);

  const artist = String(params.artist ?? '').trim();
  if (artist) url.searchParams.set('artist', artist);

  const duration = toFiniteNumber(params.duration);
  if (duration !== null && duration > 0) {
    url.searchParams.set('duration', String(Math.round(duration)));
  }

  const album = String(params.album ?? '').trim();
  if (album) url.searchParams.set('album', album);

  const videoId = String(params.videoId ?? params.id ?? '').trim();
  if (videoId) url.searchParams.set('id', videoId);

  const source = String(params.source ?? '').trim();
  if (source) url.searchParams.set('source', source);

  return url.toString();
};

const normalizeSyllabus = (syllabus) => {
  if (!Array.isArray(syllabus)) return [];
  return syllabus
    .map(item => {
      const text = String(item?.text ?? '').trim();
      const time = toFiniteNumber(item?.time);
      if (!text || time === null) return null;
      return { t: Math.max(0, time), c: text };
    })
    .filter(Boolean);
};

const lineStartMs = (line) => {
  const direct = toFiniteNumber(line?.time);
  if (direct !== null) return direct;
  const first = normalizeSyllabus(line?.syllabus)[0];
  return first ? first.t : null;
};

// 行の時刻・長さを確定させる。duration が無い場合は次の行の開始時刻から
// 逆算し、それも無ければ 1.5 秒を仮の長さにする。
const normalizeKpoeLines = (rawLines) => {
  const list = Array.isArray(rawLines) ? rawLines : [];
  return list
    .map((line, index) => {
      const syllabus = normalizeSyllabus(line?.syllabus);
      let startMs = lineStartMs(line);
      if (startMs === null) startMs = 0;
      startMs = Math.max(0, startMs);

      let durationMs = toFiniteNumber(line?.duration);
      const next = list[index + 1];
      const nextStart = next ? lineStartMs(next) : null;
      if (durationMs === null || durationMs <= 0) {
        durationMs = (nextStart !== null && nextStart > startMs)
          ? nextStart - startMs
          : 1500;
      }

      const text = String(
        line?.text ?? syllabus.map(item => item.c).join('')
      );
      const singer = String(line?.element?.singer ?? '').trim().toLowerCase();

      return {
        startMs,
        durationMs,
        endMs: startMs + durationMs,
        text,
        syllabus,
        singer,
      };
    })
    .filter(entry => entry.text.length || entry.syllabus.length);
};

// dynamicLines 用の chars を作る。syllabus があればそれをそのまま音節単位の
// タイミングとして使う（単語同期）。無くても type="Word" なら行の長さを
// 文字数で等分して文字同期を生成する。type="Line" は行同期のみ。
const buildLineChars = (entry, isWordType) => {
  if (entry.syllabus.length) return entry.syllabus.map(item => ({ ...item }));
  if (!isWordType) return [];

  const chars = Array.from(entry.text.replace(/\r?\n/g, ' '));
  if (!chars.length) return [];
  const duration = Math.max(1, entry.durationMs);
  const step = duration / chars.length;
  return chars.map((char, index) => ({
    t: Math.round(entry.startMs + step * index),
    c: char,
  }));
};

const buildLrc = (entries) => entries
  .map(entry => `[${formatLrcTime(entry.startMs)}] ${entry.text}`)
  .join('\n');

// サブボーカル用。syllabus がある行は <mm:ss.cc> タグ付きの Dynamic 形式にして
// 右側でも単語同期させる。
const buildSubLrc = (entries) => entries
  .map(entry => {
    if (!entry.syllabus.length) {
      return `[${formatLrcTime(entry.startMs)}] ${entry.text}`;
    }
    const tagged = entry.syllabus
      .map(item => `<${formatLrcTime(item.t)}>${item.c}`)
      .join('');
    return `[${formatLrcTime(entry.startMs)}]${tagged}`;
  })
  .join('\n');

// KPoe API のレスポンスを、この拡張の歌詞 payload へ正規化する。
// 歌詞配列が無い / 空のときは null を返す（= 他ソースへフォールバック）。
export const convertKpoeResponse = (data) => {
  if (!data || typeof data !== 'object') return null;
  if (String(data.status || '').toLowerCase() === 'error') return null;

  if (typeof data.ttml === 'string' && data.ttml.trim()) {
    const metadata = (data.metadata && typeof data.metadata === 'object') ? data.metadata : {};
    return {
      success: true,
      lyrics: data.ttml,
      dynamicLines: null,
      animated_lyrics: null,
      subLyrics: '',
      lyricsSource: 'kpoe',
      sourceLabel: 'Custom KPoe',
      fallbackUsed: false,
      lyricsQuality: 4,
      offset_ms: 0,
      kpoe: {
        type: 'word',
        source: String(metadata.source || 'apple').trim(),
        title: String(metadata.title || '').trim(),
        artist: String(metadata.artist || '').trim(),
        language: String(metadata.language || '').trim(),
        duet: false,
      },
    };
  }

  const entries = normalizeKpoeLines(data.lyrics);
  if (!entries.length) return null;

  const declaredType = String(data.type || '').trim().toLowerCase();
  const hasSyllabus = entries.some(entry => entry.syllabus.length);
  const isWordType = declaredType === 'word' || hasSyllabus;

  const hasV2 = entries.some(entry => entry.singer === 'v2');
  const hasNonV2 = entries.some(entry => entry.singer !== 'v2');
  const duet = hasV2 && hasNonV2;

  const mainEntries = duet ? entries.filter(entry => entry.singer !== 'v2') : entries;
  const subEntries = duet ? entries.filter(entry => entry.singer === 'v2') : [];

  const dynamicLines = isWordType
    ? mainEntries
      .map(entry => {
        const chars = buildLineChars(entry, isWordType);
        if (!chars.length) return null;
        return {
          startTimeMs: entry.startMs,
          endTimeMs: entry.endMs,
          text: entry.text,
          chars,
        };
      })
      .filter(Boolean)
    : null;

  const lyrics = buildLrc(mainEntries);
  const subLyrics = subEntries.length ? buildSubLrc(subEntries) : '';
  const isSynced = /\[\d+:\d{2}(?:[.:]\d{1,3})?\]/.test(lyrics);
  const lyricsQuality = dynamicLines && dynamicLines.length
    ? 4
    : (isSynced ? 2 : 1);

  const metadata = (data.metadata && typeof data.metadata === 'object') ? data.metadata : {};

  return {
    success: true,
    lyrics,
    dynamicLines,
    animated_lyrics: null,
    subLyrics,
    lyricsSource: 'kpoe',
    sourceLabel: 'Custom KPoe',
    fallbackUsed: false,
    lyricsQuality,
    offset_ms: 0,
    kpoe: {
      type: declaredType || (isWordType ? 'word' : 'line'),
      source: String(metadata.source || '').trim(),
      title: String(metadata.title || '').trim(),
      artist: String(metadata.artist || '').trim(),
      language: String(metadata.language || '').trim(),
      duet,
    },
  };
};

// KPoe サーバーから歌詞を取得して正規化する。取得失敗・未登録時は null。
export const fetchKpoeLyrics = async (params = {}) => {
  const url = buildKpoeRequestUrl(params);
  if (!url) return null;

  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) {
      // 404 は「未登録」。他のソースへフォールバックするだけなので静かに扱う。
      if (res.status !== 404) {
        console.warn(`[KPoe] fetch failed: HTTP ${res.status}`);
      }
      return null;
    }
    const data = await res.json();
    return convertKpoeResponse(data);
  } catch (err) {
    console.warn('[KPoe] fetch error:', err);
    return null;
  }
};
