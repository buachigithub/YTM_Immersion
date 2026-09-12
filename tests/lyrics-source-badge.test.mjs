// 左下の取得元バッジ。
//
// 聴いているだけの間は画面に何も足さない。没入が主眼なので常設の表示は
// 置かない。ただし「歌詞がずれている」と気づいた人は必ず何か操作しようと
// してマウスを動かすので、その瞬間に出す(body.ytm-pointer-active)。
// 動画プレイヤーの操作盤と同じ作法。
//
// 設定「いまの取得元を画面に表示する」を ON にした人は出しっぱなし
// (ytm-source-pinned)で、今までどおりの見え方になる。
//
// デバッグ(ytm_debug)で画面に出してはいけない。フラグを立てた人が欲しいのは
// コンソールへの記録であって、消せない常設表示ではない。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const uiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)
const cssSource = fs.readFileSync(
  new URL('../src/css/style.css', import.meta.url),
  'utf8',
)

const start = uiSource.indexOf('function updateLyricsSourceDebugBadge(payload) {')
const end = uiSource.indexOf('function updateLyricsSourceState(payload')
assert.ok(start !== -1 && end !== -1, '切り出しの目印が変わっていないか確認')
const fnSource = uiSource.slice(start, end)

const run = ({ showLyricsSource, debugEnabled, source = 'lrclib' }) => {
  let present = true
  let logged = 0
  let opened = 0
  const classes = new Set()
  const el = {
    textContent: '',
    title: '',
    classList: {
      toggle(name, on) { on ? classes.add(name) : classes.delete(name) },
      contains(name) { return classes.has(name) },
    },
    setAttribute() {},
    addEventListener() {},
    remove() { present = false },
  }
  const context = {
    config: { showLyricsSource },
    YTMLog: { enabled: debugEnabled, log() { logged += 1 } },
    currentLyricsSource: source,
    selectLyricsPayload: () => ({ quality: 2 }),
    createEl: () => el,
    openLyricsMenu: () => { opened += 1 },
    LYRICS_SOURCE_LABELS: { lrclib: 'LRCLIB' },
    LYRICS_QUALITY_LABELS: ['', '時刻なし', '行同期'],
    document: { body: {}, getElementById: () => (present ? el : null) },
  }
  vm.runInNewContext(`${fnSource}\nupdateLyricsSourceDebugBadge({});`, context)
  return { present, logged, opened, pinned: classes.has('ytm-source-pinned'), text: el.textContent }
}

test('設定が ON なら出しっぱなしの印を付ける', () => {
  const r = run({ showLyricsSource: true, debugEnabled: false })
  assert.equal(r.present, true)
  assert.equal(r.pinned, true)
  assert.match(r.text, /LRCLIB/)
})

test('設定が OFF でもバッジ自体は用意する', () => {
  // 手を動かした時に出せるよう置いておく。見えるかどうかは CSS が決める
  const r = run({ showLyricsSource: false, debugEnabled: false })
  assert.equal(r.present, true)
  assert.equal(r.pinned, false, '設定 OFF なのに出しっぱなしになっている')
})

test('取得元が分からず設定も OFF なら置かない', () => {
  assert.equal(run({ showLyricsSource: false, debugEnabled: false, source: null }).present, false)
})

test('デバッグを立てても画面には出しっぱなしにしない', () => {
  // 以前はここで強制表示していて、設定を切っても消せなくなっていた
  assert.equal(run({ showLyricsSource: false, debugEnabled: true }).pinned, false)
})

test('デバッグで増えるのはコンソールへの記録だけ', () => {
  assert.equal(run({ showLyricsSource: false, debugEnabled: true }).logged, 1)
  assert.equal(run({ showLyricsSource: false, debugEnabled: false }).logged, 0)
})

test('押すと歌詞メニューが開く', () => {
  assert.match(fnSource, /el\.addEventListener\('click', open\)/)
  assert.match(fnSource, /openLyricsMenu\(\)/)
  assert.match(fnSource, /role', 'button'/, '読み上げから押せることが分からない')
})

test('手を動かした時だけ出す(常設しない)', () => {
  assert.match(cssSource, /#ytm-lyrics-source-debug \{[\s\S]*?opacity: 0;/)
  assert.match(
    cssSource,
    /body\.ytm-pointer-active #ytm-lyrics-source-debug,\s*\n#ytm-lyrics-source-debug\.ytm-source-pinned \{[\s\S]*?opacity: 1;/,
  )
})

test('マウスが止まったら引っ込む', () => {
  assert.match(uiSource, /const POINTER_IDLE_HIDE_MS = \d+;/)
  assert.match(uiSource, /document\.body\.classList\.remove\('ytm-pointer-active'\)/)
  // 毎フレーム走るので、重い処理を足さないこと
  const watch = uiSource.slice(
    uiSource.indexOf('const notePointerActivity'),
    uiSource.indexOf('const setupPointerActivityWatch'),
  )
  assert.doesNotMatch(watch, /querySelector|getBoundingClientRect|storage\./)
})

// ── ズレ直し ────────────────────────────────────────────
// 歌詞のズレは、気づくのが歌詞を見ている時なのに、直すつまみは設定パネルの
// 奥にあった。「取得元を替える」と「ズレを直す」は同じ問題への2つの答えなので
// 同じ場所に置く。

test('ズレ直しが歌詞メニューの中にある', () => {
  assert.match(uiSource, /data-action="offset-minus"/)
  assert.match(uiSource, /data-action="offset-plus"/)
  assert.match(uiSource, /data-action="offset-reset"/)
  assert.match(uiSource, /data-role="offset-value"/)
})

test('押してもメニューが閉じない', () => {
  // 合うまで何度も押すものなので、1回で閉じると使えない
  const handler = uiSource.slice(
    uiSource.indexOf("ui.uploadMenu.addEventListener('click'"),
    uiSource.indexOf("const target = ev.target.closest('.ytm-upload-menu-item')"),
  )
  assert.match(handler, /ev\.stopPropagation\(\)/)
  assert.match(handler, /return;/)
  assert.doesNotMatch(handler, /toggleMenu\(false\)/, '押すたびに閉じている')
})

test('既存の syncOffset をそのまま使う', () => {
  // 値の置き場を増やさない。設定パネルの数値と食い違わせない
  assert.match(uiSource, /config\.syncOffset = clamped;/)
  assert.match(uiSource, /storage\.set\('ytm_sync_offset', clamped\)/)
  assert.match(uiSource, /getElementById\('sync-offset-input'\)/)
})

test('極端な値で止める', () => {
  assert.match(uiSource, /const LYRIC_OFFSET_MAX_MS = \d+;/)
  assert.match(uiSource, /Math\.max\(-LYRIC_OFFSET_MAX_MS, Math\.min\(LYRIC_OFFSET_MAX_MS/)
})

test('表示の見た目が CSS にある', () => {
  assert.match(cssSource, /\.ytm-offset-btn\s*\{/)
  assert.match(cssSource, /\.ytm-offset-value\s*\{/)
})
