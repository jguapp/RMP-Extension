/**
 * Turning CUNYfirst instructor strings into structured names.
 *
 * Schedule Builder is not consistent about how it prints an instructor. Real
 * values observed across CUNY campuses include:
 *
 *   "Smith,John A"            "Smith, John"        "John Smith"
 *   "SMITH, JOHN A."          "Dr. John Smith"     "John Smith, Ph.D."
 *   "Smith,John; Doe,Jane"    "John Smith and Jane Doe"
 *   "Staff"                   "TBA"                "To be Announced"
 *
 * Everything downstream (cache keys, RMP queries, match scoring) depends on
 * getting this right, so the parser is deliberately conservative: when it
 * cannot confidently read a name it returns nothing rather than guessing.
 */
(function (root) {
  'use strict';

  const RMPX = (root.RMPX = root.RMPX || {});

  /** Honorifics stripped from the front of a name. */
  const TITLES = new Set([
    'dr', 'prof', 'professor', 'mr', 'mrs', 'ms', 'miss', 'mx', 'rev', 'fr', 'sir', 'doctor',
  ]);

  /** Credentials and generational suffixes stripped from the end of a name. */
  const SUFFIXES = new Set([
    'jr', 'sr', 'ii', 'iii', 'iv', 'v',
    'phd', 'ph', 'md', 'edd', 'dds', 'dvm', 'jd', 'esq', 'mba', 'mfa', 'msw', 'lcsw',
    'ma', 'ms', 'msc', 'mph', 'rn', 'cpa', 'do', 'psyd', 'dsw', 'md/phd', 'pe',
  ]);

  /**
   * Surname particles that belong with the surname rather than the given name.
   * Only folded in when they appear lowercase or in a known position.
   */
  const PARTICLES = new Set([
    'van', 'von', 'de', 'del', 'della', 'di', 'da', 'das', 'dos', 'du', 'la', 'le',
    'los', 'las', 'den', 'der', 'ten', 'ter', 'bin', 'ibn', 'al', 'el', 'st', 'saint',
    'mac', 'abu', 'ben',
  ]);

  /** Values that mean "no instructor assigned yet". */
  const PLACEHOLDERS = new Set([
    'staff', 'staff staff', 'tba', 'tbd', 'tba tba', 'na', 'none', 'nobody',
    'tobeannounced', 'tobeassigned', 'tobedetermined', 'notassigned', 'unassigned',
    'instructor', 'faculty', 'arranged', 'multipleinstructors', 'seedepartment',
    'staffstaff', 'openseat', 'onlinecourse',
  ]);

  /**
   * Nickname pairs, stored canonically so lookups work in both directions.
   * Keeps "Bob Smith" on the roster matched to "Robert Smith" on RMP.
   */
  const NICKNAME_GROUPS = [
    ['robert', 'bob', 'rob', 'bobby'],
    ['william', 'will', 'bill', 'billy'],
    ['richard', 'rick', 'dick', 'richie'],
    ['james', 'jim', 'jimmy', 'jamie'],
    ['john', 'jack', 'johnny', 'jon'],
    ['jonathan', 'jon', 'jonny'],
    ['michael', 'mike', 'mickey'],
    ['christopher', 'chris'],
    ['christina', 'chris', 'tina'],
    ['daniel', 'dan', 'danny'],
    ['david', 'dave', 'davey'],
    ['thomas', 'tom', 'tommy'],
    ['anthony', 'tony'],
    ['charles', 'charlie', 'chuck'],
    ['joseph', 'joe', 'joey'],
    ['edward', 'ed', 'eddie', 'ted'],
    ['steven', 'stephen', 'steve'],
    ['kenneth', 'ken', 'kenny'],
    ['matthew', 'matt'],
    ['nicholas', 'nick'],
    ['alexander', 'alex', 'xander'],
    ['alexandra', 'alex', 'sandra'],
    ['benjamin', 'ben', 'benny'],
    ['samuel', 'sam', 'sammy'],
    ['samantha', 'sam'],
    ['elizabeth', 'liz', 'beth', 'lisa', 'betty', 'eliza'],
    ['katherine', 'catherine', 'kate', 'kathy', 'katie', 'cathy', 'kat'],
    ['margaret', 'maggie', 'meg', 'peggy'],
    ['patricia', 'pat', 'patty', 'tricia'],
    ['jennifer', 'jen', 'jenny'],
    ['jessica', 'jess'],
    ['deborah', 'deb', 'debbie'],
    ['barbara', 'barb', 'babs'],
    ['susan', 'sue', 'susie'],
    ['rebecca', 'becky', 'becca'],
    ['victoria', 'vicky', 'tori'],
    ['theodore', 'ted', 'teddy'],
    ['lawrence', 'larry'],
    ['gregory', 'greg'],
    ['timothy', 'tim'],
    ['ronald', 'ron', 'ronnie'],
    ['donald', 'don', 'donnie'],
    ['andrew', 'andy', 'drew'],
    ['peter', 'pete'],
    ['francis', 'frank', 'francisco'],
    ['eugene', 'gene'],
    ['albert', 'al'],
    ['alfred', 'al', 'fred'],
    ['frederick', 'fred', 'freddie'],
    ['raymond', 'ray'],
    ['vincent', 'vince'],
    ['gerald', 'jerry'],
    ['abigail', 'abby'],
    ['stephanie', 'steph'],
    ['veronica', 'roni'],
    ['yosef', 'joseph', 'yossi'],
    ['mohammed', 'muhammad', 'mohamed', 'mohammad'],
  ];

  const NICKNAMES = (function buildNicknameIndex() {
    const index = new Map();
    NICKNAME_GROUPS.forEach(function (group, groupIndex) {
      group.forEach(function (name) {
        if (!index.has(name)) index.set(name, new Set());
        index.get(name).add(groupIndex);
      });
    });
    return index;
  })();

  /** Lowercase, strip accents, drop everything that is not a letter. */
  function normalizeToken(value) {
    if (!value) return '';
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
  }

  /** Split a surname on spaces and hyphens so "Smith-Jones" matches either half. */
  function surnameTokens(last) {
    if (!last) return [];
    return String(last)
      .split(/[\s\-–—]+/)
      .map(normalizeToken)
      .filter(Boolean);
  }

  /** True when two given names are the same person by nickname convention. */
  function isNicknameEquivalent(a, b) {
    const left = normalizeToken(a);
    const right = normalizeToken(b);
    if (!left || !right) return false;
    if (left === right) return true;
    const leftGroups = NICKNAMES.get(left);
    const rightGroups = NICKNAMES.get(right);
    if (!leftGroups || !rightGroups) return false;
    for (const groupIndex of leftGroups) {
      if (rightGroups.has(groupIndex)) return true;
    }
    return false;
  }

  /** "Staff", "TBA" and friends are not people. */
  function isPlaceholderName(value) {
    const compact = normalizeToken(value);
    if (!compact) return true;
    if (compact.length < 2) return true;
    return PLACEHOLDERS.has(compact);
  }

  /** Title-case a token while preserving McDonald / O'Brien / hyphenated caps. */
  function titleCase(token) {
    if (!token) return '';
    // Leave anything with internal capitals alone -- it is already styled.
    if (/[a-z][A-Z]/.test(token)) return token;
    return token
      .toLowerCase()
      .replace(/(^|[\s'\-])([a-z])/g, function (_match, boundary, letter) {
        return boundary + letter.toUpperCase();
      })
      .replace(/\bMc([a-z])/g, function (_m, letter) {
        return 'Mc' + letter.toUpperCase();
      });
  }

  function stripTitles(tokens) {
    const out = tokens.slice();
    while (out.length > 1) {
      const head = normalizeToken(out[0]);
      if (TITLES.has(head)) out.shift();
      else break;
    }
    return out;
  }

  function stripSuffixes(tokens) {
    const out = tokens.slice();
    while (out.length > 1) {
      const tail = normalizeToken(out[out.length - 1]);
      if (SUFFIXES.has(tail)) out.pop();
      else break;
    }
    return out;
  }

  /**
   * Remove trailing credential clauses such as ", Ph.D." before we start
   * counting commas -- otherwise they look like extra instructors.
   */
  function stripCredentialClauses(text) {
    let out = String(text);
    let changed = true;
    while (changed) {
      changed = false;
      out = out.replace(/,\s*([A-Za-z.]{1,8})\s*$/, function (match, clause) {
        if (SUFFIXES.has(normalizeToken(clause))) {
          changed = true;
          return '';
        }
        return match;
      });
    }
    return out.trim();
  }

  /** Fold trailing particles ("van der") into the surname. */
  function splitGivenAndSurname(tokens) {
    if (tokens.length === 0) return { first: '', middle: '', last: '' };
    if (tokens.length === 1) return { first: '', middle: '', last: tokens[0] };

    let surnameStart = tokens.length - 1;
    while (surnameStart > 1) {
      const candidate = tokens[surnameStart - 1];
      const isLowercaseParticle = candidate === candidate.toLowerCase();
      if (PARTICLES.has(normalizeToken(candidate)) && isLowercaseParticle) surnameStart -= 1;
      else break;
    }

    return {
      first: tokens[0],
      middle: tokens.slice(1, surnameStart).join(' '),
      last: tokens.slice(surnameStart).join(' '),
    };
  }

  /**
   * Parse a single instructor string into { first, middle, last, display }.
   * Returns null for placeholders and anything unparseable.
   */
  function parseName(raw) {
    if (raw == null) return null;

    let text = String(raw)
      .replace(/\s+/g, ' ')
      .replace(/\((?:[^)]*)\)/g, ' ') // drop "(Primary Instructor)" style annotations
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) return null;
    text = stripCredentialClauses(text);
    if (!text || isPlaceholderName(text)) return null;

    let first = '';
    let middle = '';
    let last = '';

    const commaIndex = text.indexOf(',');
    if (commaIndex !== -1) {
      // "Last, First Middle" -- the dominant CUNYfirst shape.
      const lastPart = text.slice(0, commaIndex).trim();
      const restPart = text.slice(commaIndex + 1).trim();
      const lastTokens = stripTitles(lastPart.split(' ').filter(Boolean));
      const restTokens = stripSuffixes(stripTitles(restPart.split(' ').filter(Boolean)));

      last = lastTokens.join(' ');
      first = restTokens[0] || '';
      middle = restTokens.slice(1).join(' ');
    } else {
      const tokens = stripSuffixes(stripTitles(text.split(' ').filter(Boolean)));
      const split = splitGivenAndSurname(tokens);
      first = split.first;
      middle = split.middle;
      last = split.last;
    }

    if (!last) return null;
    if (isPlaceholderName(last) && !first) return null;
    if (!normalizeToken(last)) return null;

    // A bare surname with no given name is too weak to search on.
    if (!first) return null;

    const parsed = {
      first: titleCase(first.replace(/\.$/, '')),
      middle: titleCase(middle),
      last: titleCase(last),
    };
    parsed.display = (parsed.first + ' ' + parsed.last).replace(/\s+/g, ' ').trim();
    parsed.initialOnly = normalizeToken(parsed.first).length === 1;
    // An initial-only given name ("Smith, J") makes a poor search term, so we
    // search the surname alone and let the matcher disambiguate the results.
    parsed.query = parsed.initialOnly ? parsed.last : parsed.display;
    parsed.key = normalizeToken(parsed.first) + '|' + surnameTokens(parsed.last).join('-');
    return parsed;
  }

  /** Separators between co-instructors in a single cell. */
  const SEPARATOR_PATTERN = /[;\n|]|\s(?:and|&)\s|\s\/\s/gi;

  /** Split on a pattern, returning character ranges instead of substrings. */
  function splitWithOffsets(text, pattern) {
    const out = [];
    pattern.lastIndex = 0;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > cursor) out.push({ start: cursor, end: match.index });
      cursor = match.index + match[0].length;
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
    if (cursor < text.length) out.push({ start: cursor, end: text.length });
    return out;
  }

  function trimRange(text, range) {
    let start = range.start;
    let end = range.end;
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    return { start: start, end: end };
  }

  /**
   * "Smith, John, Doe, Jane" -- an even run of >=4 comma parts is most likely
   * several "Last, First" pairs rather than one very long name.
   */
  function commaPairRanges(text, range) {
    const slice = text.slice(range.start, range.end);
    const parts = [];
    let cursor = 0;

    slice.split(',').forEach(function (part) {
      const localStart = cursor;
      cursor += part.length + 1;
      const trimmed = trimRange(text, {
        start: range.start + localStart,
        end: range.start + localStart + part.length,
      });
      if (trimmed.end > trimmed.start) parts.push(trimmed);
    });

    if (parts.length >= 4 && parts.length % 2 === 0) {
      const pairs = [];
      for (let i = 0; i < parts.length; i += 2) {
        pairs.push({ start: parts[i].start, end: parts[i + 1].end });
      }
      return pairs;
    }
    return [range];
  }

  /**
   * Split a raw instructor cell into one segment per instructor, keeping the
   * character offsets into the ORIGINAL string. The DOM annotator relies on
   * those offsets to wrap each name in place without rebuilding host markup.
   */
  function segmentInstructorField(raw) {
    if (raw == null) return [];
    const text = String(raw);
    if (!text.trim()) return [];

    const segments = [];
    splitWithOffsets(text, SEPARATOR_PATTERN).forEach(function (chunk) {
      const trimmed = trimRange(text, chunk);
      if (trimmed.end <= trimmed.start) return;

      commaPairRanges(text, trimmed).forEach(function (range) {
        const tight = trimRange(text, range);
        if (tight.end <= tight.start) return;
        const slice = text.slice(tight.start, tight.end);
        const person = parseName(slice);
        if (person) {
          segments.push({ start: tight.start, end: tight.end, text: slice, person: person });
        }
      });
    });

    // De-duplicate co-taught sections that list the same person twice.
    const seen = new Set();
    return segments.filter(function (segment) {
      if (seen.has(segment.person.key)) return false;
      seen.add(segment.person.key);
      return true;
    });
  }

  /**
   * Split a raw instructor cell into one entry per instructor, then parse each.
   * Returns [] when nothing usable is present.
   */
  function parseInstructorField(raw) {
    return segmentInstructorField(raw).map(function (segment) { return segment.person; });
  }

  /**
   * Cheap pre-filter used by the DOM scanner: does this text even look like
   * it could be a person's name? Keeps us from querying RMP for "MW 9:00AM".
   */
  function looksLikePersonName(raw) {
    if (raw == null) return false;
    const text = String(raw).trim();
    if (text.length < 4 || text.length > 70) return false;
    if (/\d/.test(text)) return false;
    if (/[@#%*=+<>{}[\]$]/.test(text)) return false;
    if (/\b(?:am|pm|mon|tue|wed|thu|fri|sat|sun|room|bldg|hrs|credits?|units?)\b/i.test(text)) {
      return false;
    }
    if (isPlaceholderName(text)) return false;
    const letters = text.replace(/[^A-Za-z]/g, '');
    if (letters.length < 4) return false;
    // Needs at least two word-ish parts (given + surname, comma form counts).
    return /[A-Za-z]{2,}[\s,]+[A-Za-z]/.test(text);
  }

  RMPX.nameUtils = {
    normalizeToken: normalizeToken,
    surnameTokens: surnameTokens,
    isNicknameEquivalent: isNicknameEquivalent,
    isPlaceholderName: isPlaceholderName,
    titleCase: titleCase,
    parseName: parseName,
    parseInstructorField: parseInstructorField,
    segmentInstructorField: segmentInstructorField,
    looksLikePersonName: looksLikePersonName,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RMPX.nameUtils;
})(typeof self !== 'undefined' ? self : globalThis);
