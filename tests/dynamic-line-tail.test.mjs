// 行末の音の長さ。
//
// 単語同期のデータは、行の「終わり時刻」を持っていないことが多い。
// これまでは足りないぶんを次の行の頭で埋めていたが、間奏に入る行では
// 行と行の間が数秒空くので、最後の文字が歌い終わってだいぶ経ってから
// 点灯していた。行の間の空きは無音であって、そのぶん歌が伸びている
// わけではない。
//
// 誤って通常の行の見え方を変えないこと(中央値が動かないこと)を重視する。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

globalThis.chrome = globalThis.chrome || { storage: { local: { get: (k, cb) => cb({}) } } }
const API = await import('../src/js/module/api.js')

const source = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)
const start = source.indexOf('// ── 行の終わり時刻を持たないデータの補完')
const end = source.indexOf('async function applyLyricsText')
assert.ok(start !== -1 && end !== -1, '切り出しの目印が変わっていないか確認')
const sandbox = { console }
vm.createContext(sandbox)
vm.runInContext(`${source.slice(start, end)}\nglobalThis._f = fillDynamicLineEnds`, sandbox)
const fillDynamicLineEnds = sandbox._f

const lastCharGap = (line) => {
  const cs = (line.chars || []).filter(c => typeof c.t === 'number')
  return cs.length >= 2 ? cs[cs.length - 1].t - cs[cs.length - 2].t : null
}

// ── parseDynamicLrc: 行末が次の行まで引き伸ばされないこと ──

test('間奏をまたぐ行で、行末の文字が次の行まで引き伸ばされない', () => {
  // 0.3秒間隔で進む行のあと、20秒の間奏を挟んで次の行が来る
  const lrc = [
    '[00:10.00] <00:10.00>あ<00:10.30>い<00:10.60>うえ',
    '[00:30.00] <00:30.00>か<00:30.30>き',
  ].join('\n')
  const lines = API.parseDynamicLrc(lrc)
  const gap = lastCharGap(lines[0])
  assert.ok(gap !== null)
  assert.ok(gap <= 900, `行末の文字に ${gap}ms も割り当てられている`)
})

test('間奏が無い普通の行では割り当てが変わらない', () => {
  // 次の行が 0.3 秒後。上限より短いので次の行頭がそのまま使われる
  const lrc = [
    '[00:10.00] <00:10.00>あ<00:10.30>い<00:10.60>う',
    '[00:10.90] <00:10.90>か',
  ].join('\n')
  const lines = API.parseDynamicLrc(lrc)
  assert.equal(lastCharGap(lines[0]), 300)
})

test('estimateCharDurationMs は行の中の伸ばした音に引きずられない', () => {
  const chars = [
    { t: 0, c: 'あ' }, { t: 300, c: 'い' }, { t: 600, c: 'う' },
    { t: 900, c: 'え' }, { t: 5000, c: 'お' },   // 1つだけ長い
  ]
  assert.equal(API.estimateCharDurationMs(chars), 300)
})

test('estimateCharDurationMs は極端な値を丸める', () => {
  assert.equal(API.estimateCharDurationMs([{ t: 0 }, { t: 10 }, { t: 20 }]), 120)
  assert.equal(API.estimateCharDurationMs([{ t: 0 }, { t: 9000 }, { t: 18000 }]), 900)
  assert.equal(API.estimateCharDurationMs([]), 300)
  assert.equal(API.estimateCharDurationMs([{ t: 0 }]), 300)
})

// ── fillDynamicLineEnds ──────────────────────────────────

const line = (times) => ({ chars: times.map((t, i) => ({ t, c: String(i) })) })

test('終わり時刻が無い行に、その行の進み方から見積もった終わりを入れる', () => {
  const lines = fillDynamicLineEnds([line([0, 300, 600, 900]), line([20000, 20300])])
  assert.equal(lines[0].endTimeMs, 900 + 300, '1文字ぶん(300ms)を足した値')
})

test('次の行に食い込まない', () => {
  const lines = fillDynamicLineEnds([line([0, 300, 600, 900]), line([1000, 1300])])
  assert.ok(lines[0].endTimeMs < 1000, '次の行の頭より前で終わること')
  assert.equal(lines[0].endTimeMs, 950)
})

test('間奏が長くても、行の終わりは1文字ぶんで止まる', () => {
  const lines = fillDynamicLineEnds([line([0, 300, 600, 900]), line([60000])])
  assert.equal(lines[0].endTimeMs, 1200, '間奏の長さに引きずられないこと')
})

test('もともと終わり時刻を持っている行には触らない', () => {
  const withEnd = { ...line([0, 300, 600]), endTimeMs: 9999 }
  const lines = fillDynamicLineEnds([withEnd, line([20000])])
  assert.equal(lines[0].endTimeMs, 9999)
})

test('文字が1つしか無い行は判断材料が無いので触らない', () => {
  const lines = fillDynamicLineEnds([line([500]), line([20000])])
  assert.equal(lines[0].endTimeMs, undefined)
})

test('伸ばした音のある行でも、中央値で見積もるので暴れない', () => {
  const lines = fillDynamicLineEnds([line([0, 300, 600, 900, 6000]), line([60000])])
  assert.equal(lines[0].endTimeMs, 6000 + 300)
})

test('キャッシュ済みの終わり時刻を残さない', () => {
  const l = line([0, 300, 600])
  l.__ytmEndSec = 0.8
  fillDynamicLineEnds([l, line([20000])])
  assert.equal(l.__ytmEndSec, undefined)
})
