// ============================================================
// TTML (Timed Text Markup Language) Lyrics Parser
// ============================================================

export const parseTime = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const trimmed = timeStr.trim();
  if (!trimmed) return null;

  // Handle seconds format like "12.345s" or "12.345"
  if (/^\d+(?:\.\d+)?s?$/i.test(trimmed)) {
    const sec = parseFloat(trimmed.replace(/s$/i, ''));
    return Number.isFinite(sec) ? sec : null;
  }

  // Handle "hh:mm:ss.sss" or "mm:ss.sss"
  const parts = trimmed.split(':');
  let sec = 0;
  if (parts.length === 3) {
    sec += parseInt(parts[0], 10) * 3600;
    sec += parseInt(parts[1], 10) * 60;
    sec += parseFloat(parts[2]);
  } else if (parts.length === 2) {
    sec += parseInt(parts[0], 10) * 60;
    sec += parseFloat(parts[1]);
  } else {
    return null;
  }
  return Number.isFinite(sec) ? sec : null;
};

const getAttr = (el, localName, nsUri) => {
  if (!el || typeof el.getAttribute !== 'function') return null;
  if (nsUri && typeof el.getAttributeNS === 'function') {
    const nsVal = el.getAttributeNS(nsUri, localName);
    if (nsVal !== null && nsVal !== undefined && nsVal !== '') return nsVal;
  }
  // Fallbacks for prefixed or direct attributes
  const direct = el.getAttribute(localName);
  if (direct !== null && direct !== undefined && direct !== '') return direct;
  for (const prefix of ['ttm:', 'tts:', 'tt:']) {
    const prefixed = el.getAttribute(prefix + localName);
    if (prefixed !== null && prefixed !== undefined && prefixed !== '') return prefixed;
  }
  return null;
};

const hasBgRole = (el) => {
  if (!el) return false;
  const role = getAttr(el, 'role', 'http://www.w3.org/ns/ttml#metadata');
  return role === 'x-bg';
};

export const isTTMLString = (str) => {
  if (typeof str !== 'string') return false;
  const trimmed = str.trim();
  return (
    trimmed.startsWith('<tt') ||
    (trimmed.startsWith('<?xml') && trimmed.includes('<tt')) ||
    /<tt[\s>]/.test(trimmed)
  );
};

export const parseTTML = (xmlString) => {
  if (!isTTMLString(xmlString)) return null;

  let doc = null;
  try {
    if (typeof DOMParser !== 'undefined') {
      doc = new DOMParser().parseFromString(xmlString, 'application/xml');
    }
  } catch (e) {
    return null;
  }
  if (!doc) return null;

  const parserError = doc.querySelector ? doc.querySelector('parsererror') : null;
  if (parserError) return null;

  const pElements = Array.from(
    doc.getElementsByTagNameNS ? doc.getElementsByTagNameNS('*', 'p') : doc.getElementsByTagName('p')
  );
  if (!pElements.length) return null;

  const lines = [];
  const dynamicLines = [];
  let hasAnyWordSync = false;

  pElements.forEach((p, lineIdx) => {
    const beginSec = parseTime(getAttr(p, 'begin'));
    const endSec = parseTime(getAttr(p, 'end'));
    const pRole = getAttr(p, 'role', 'http://www.w3.org/ns/ttml#metadata');
    const pAlign = getAttr(p, 'textAlign', 'http://www.w3.org/ns/ttml#styling');
    const pAgent = getAttr(p, 'agent', 'http://www.w3.org/ns/ttml#metadata');

    let isBgLine = (pRole === 'x-bg');
    let isRight = (pAlign === 'right' || pAlign === 'end');
    let isCenter = (pAlign === 'center');

    if (isBgLine) {
      isRight = true;
    } else if (pAgent && pAgent.toLowerCase() !== 'v1') {
      isRight = true;
    }

    const spanElements = Array.from(
      p.getElementsByTagNameNS ? p.getElementsByTagNameNS('*', 'span') : p.getElementsByTagName('span')
    );

    // Leaf spans only
    const leafSpans = spanElements.filter(span => {
      const childSpans = span.getElementsByTagName('span');
      return !childSpans || childSpans.length === 0;
    });

    const words = [];
    const dynamicChars = [];

    if (leafSpans.length > 0) {
      leafSpans.forEach((span, spanIdx) => {
        const spanBeginSec = parseTime(getAttr(span, 'begin'));
        const spanEndSec = parseTime(getAttr(span, 'end'));

        let isBg = false;
        let curr = span;
        while (curr && curr !== p) {
          if (hasBgRole(curr)) {
            isBg = true;
            break;
          }
          curr = curr.parentNode;
        }

        let wText = span.textContent || '';
        // Include adjacent text nodes if any
        if (spanIdx === 0 && span.previousSibling && span.previousSibling.nodeType === 3) {
          wText = span.previousSibling.textContent + wText;
        }
        if (span.nextSibling && span.nextSibling.nodeType === 3) {
          wText += span.nextSibling.textContent;
        }
        wText = wText.replace(/\r?\n/g, ' ');

        const startSec = (spanBeginSec !== null) ? spanBeginSec : beginSec;
        const endSecResolved = (spanEndSec !== null) ? spanEndSec : endSec;

        words.push({
          text: wText,
          start: startSec,
          end: endSecResolved,
          isBg,
        });

        if (startSec !== null) {
          hasAnyWordSync = true;
          const startMs = Math.round(startSec * 1000);
          dynamicChars.push({
            t: startMs,
            c: wText,
          });
        }
      });
    }

    const pText = p.textContent.trim().replace(/\s+/g, ' ');
    if (!pText && !words.length) return;

    const resolvedTime = (beginSec !== null) ? beginSec : (words[0]?.start ?? null);
    const resolvedEnd = (endSec !== null) ? endSec : (words[words.length - 1]?.end ?? null);

    lines.push({
      time: resolvedTime,
      end: resolvedEnd,
      text: pText,
      words: words.length > 0 ? words : undefined,
      isRight,
      isCenter,
      isBgLine,
      duetSide: isRight ? 'right' : 'left',
    });

    if (dynamicChars.length > 0 && resolvedTime !== null) {
      const startMs = Math.round(resolvedTime * 1000);
      const endMs = (resolvedEnd !== null) ? Math.round(resolvedEnd * 1000) : startMs + 2000;
      dynamicLines.push({
        startTimeMs: startMs,
        endTimeMs: endMs,
        text: pText,
        chars: dynamicChars,
        isRight,
        isCenter,
        isBgLine,
      });
    }
  });

  if (!lines.length) return null;

  return {
    lines,
    dynamicLines: hasAnyWordSync && dynamicLines.length ? dynamicLines : null,
    hasWordSync: hasAnyWordSync,
  };
};

if (typeof window !== 'undefined') {
  window.TTMLParser = { parseTime, isTTMLString, parseTTML };
}

