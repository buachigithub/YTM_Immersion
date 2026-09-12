import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTime, isTTMLString, parseTTML } from '../src/js/module/ttml-parser.js';

test('parseTime converts various time formats to seconds', () => {
  assert.equal(parseTime('00:01:23.456'), 83.456);
  assert.equal(parseTime('01:23.456'), 83.456);
  assert.equal(parseTime('12.345s'), 12.345);
  assert.equal(parseTime('12.345'), 12.345);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime(null), null);
});

test('isTTMLString detects TTML XML strings correctly', () => {
  assert.ok(isTTMLString('<tt xmlns="http://www.w3.org/ns/ttml"><body></body></tt>'));
  assert.ok(isTTMLString('<?xml version="1.0"?><tt><body></body></tt>'));
  assert.ok(!isTTMLString('[00:12.34] Hello world'));
  assert.ok(!isTTMLString('Plain text lyrics'));
});

test('parseTTML extracts lines, words, background vocals, and alignment', () => {
  // Use a minimal mock DOMParser in Node.js environment if DOMParser is not available
  const sampleTTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:tts="http://www.w3.org/ns/ttml#styling">
  <body>
    <div>
      <p begin="00:00:10.000" end="00:00:14.000">
        <span begin="00:00:10.000" end="00:00:11.000">Hello </span>
        <span begin="00:00:11.000" end="00:00:12.000">world</span>
        <span ttm:role="x-bg" begin="00:00:12.500" end="00:00:13.500">(hello)</span>
      </p>
      <p begin="00:00:15.000" end="00:00:18.000" tts:textAlign="right" ttm:agent="v2">
        <span begin="00:00:15.000" end="00:00:16.500">Second </span>
        <span begin="00:00:16.500" end="00:00:18.000">voice</span>
      </p>
      <p begin="00:00:20.000" end="00:00:23.000" ttm:role="x-bg">
        <span begin="00:00:20.000" end="00:00:23.000">Background line</span>
      </p>
    </div>
  </body>
</tt>`;

  // In node.js, check if we need to mock DOMParser or if jsdom/native is needed
  if (typeof DOMParser === 'undefined') {
    // simple XML parser mock for testing if needed
    class MockDOMParser {
      parseFromString(xml) {
        // Simple regex-based mock node tree for node test runner
        const doc = {
          querySelector: () => null,
          getElementsByTagName: (tag) => {
            if (tag === 'p') {
              return [
                {
                  getAttribute: (a) => (a === 'begin' ? '00:00:10.000' : (a === 'end' ? '00:00:14.000' : null)),
                  textContent: 'Hello world (hello)',
                  parentNode: null,
                  getElementsByTagName: (t) => {
                    if (t === 'span') {
                      return [
                        { getAttribute: (a) => (a === 'begin' ? '00:00:10.000' : (a === 'end' ? '00:00:11.000' : null)), textContent: 'Hello ', getElementsByTagName: () => [] },
                        { getAttribute: (a) => (a === 'begin' ? '00:00:11.000' : (a === 'end' ? '00:00:12.000' : null)), textContent: 'world', getElementsByTagName: () => [] },
                        { getAttribute: (a) => (a === 'role' || a === 'ttm:role' ? 'x-bg' : (a === 'begin' ? '00:00:12.500' : (a === 'end' ? '00:00:13.500' : null))), textContent: '(hello)', getElementsByTagName: () => [] },
                      ];
                    }
                    return [];
                  }
                },
                {
                  getAttribute: (a) => (a === 'begin' ? '00:00:15.000' : (a === 'end' ? '00:00:18.000' : (a === 'textAlign' || a === 'tts:textAlign' ? 'right' : (a === 'agent' || a === 'ttm:agent' ? 'v2' : null)))),
                  textContent: 'Second voice',
                  parentNode: null,
                  getElementsByTagName: (t) => {
                    if (t === 'span') {
                      return [
                        { getAttribute: (a) => (a === 'begin' ? '00:00:15.000' : (a === 'end' ? '00:00:16.500' : null)), textContent: 'Second ', getElementsByTagName: () => [] },
                        { getAttribute: (a) => (a === 'begin' ? '00:00:16.500' : (a === 'end' ? '00:00:18.000' : null)), textContent: 'voice', getElementsByTagName: () => [] },
                      ];
                    }
                    return [];
                  }
                },
                {
                  getAttribute: (a) => (a === 'begin' ? '00:00:20.000' : (a === 'end' ? '00:00:23.000' : (a === 'role' || a === 'ttm:role' ? 'x-bg' : null))),
                  textContent: 'Background line',
                  parentNode: null,
                  getElementsByTagName: (t) => {
                    if (t === 'span') {
                      return [
                        { getAttribute: (a) => (a === 'begin' ? '00:00:20.000' : (a === 'end' ? '00:00:23.000' : null)), textContent: 'Background line', getElementsByTagName: () => [] }
                      ];
                    }
                    return [];
                  }
                }
              ];
            }
            return [];
          }
        };
        return doc;
      }
    }
    globalThis.DOMParser = MockDOMParser;
  }

  const result = parseTTML(sampleTTML);
  assert.ok(result, 'must parse valid TTML');
  assert.equal(result.lines.length, 3);

  // Line 1: Main vocal with background span
  const l1 = result.lines[0];
  assert.equal(l1.time, 10.0);
  assert.equal(l1.end, 14.0);
  assert.equal(l1.isRight, false);
  assert.equal(l1.isBgLine, false);
  assert.equal(l1.words.length, 3);
  assert.equal(l1.words[0].isBg, false);
  assert.equal(l1.words[1].isBg, false);
  assert.equal(l1.words[2].isBg, true, 'background vocal span must have isBg=true');

  // Line 2: Right-aligned duet line
  const l2 = result.lines[1];
  assert.equal(l2.time, 15.0);
  assert.equal(l2.isRight, true);
  assert.equal(l2.duetSide, 'right');

  // Line 3: Background line
  const l3 = result.lines[2];
  assert.equal(l3.time, 20.0);
  assert.equal(l3.isBgLine, true);
  assert.equal(l3.isRight, true);
});
