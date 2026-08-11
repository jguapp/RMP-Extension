/**
 * Deciding which Rate My Professors entry is actually the person on the roster.
 *
 * RMP's search is fuzzy and a surname query routinely returns a dozen people.
 * Showing the wrong professor's rating is worse than showing none at all, so
 * every candidate is scored and anything below MIN_ACCEPT_SCORE is discarded.
 */
(function (root) {
  'use strict';

  const RMPX = (root.RMPX = root.RMPX || {});
  const nameUtils = RMPX.nameUtils;

  if (!nameUtils) {
    throw new Error('matching.js requires name-utils.js to be loaded first');
  }

  const MIN_ACCEPT_SCORE = 62;

  const CONFIDENCE = {
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low',
  };

  /**
   * Compare the surnames. Returns a score contribution, or null to reject
   * the candidate outright.
   */
  function scoreSurname(parsedLast, candidateLast) {
    const wanted = nameUtils.surnameTokens(parsedLast);
    const got = nameUtils.surnameTokens(candidateLast);
    if (wanted.length === 0 || got.length === 0) return null;

    const wantedJoined = wanted.join('');
    const gotJoined = got.join('');

    if (wantedJoined === gotJoined) return 50;

    // Hyphenated or married names: "Smith-Jones" should still find "Smith".
    const overlap = wanted.filter(function (token) { return got.indexOf(token) !== -1; });
    if (overlap.length > 0) {
      const longest = overlap.reduce(function (max, t) { return Math.max(max, t.length); }, 0);
      return longest >= 4 ? 38 : 30;
    }

    // Tolerate a transliteration wobble on longer surnames only.
    if (wantedJoined.length >= 6 && gotJoined.length >= 6) {
      if (wantedJoined.startsWith(gotJoined) || gotJoined.startsWith(wantedJoined)) return 28;
    }

    return null;
  }

  /**
   * Compare the given names. Returns a score contribution, or null to reject.
   * `parsedInitialOnly` relaxes the rules when the roster only gave us "J".
   */
  function scoreGivenName(parsedFirst, candidateFirst, parsedInitialOnly) {
    const wanted = nameUtils.normalizeToken(parsedFirst);
    const got = nameUtils.normalizeToken(candidateFirst);

    if (!wanted || !got) return parsedInitialOnly ? 0 : null;
    if (wanted === got) return 40;
    if (nameUtils.isNicknameEquivalent(wanted, got)) return 33;

    // One side is just an initial.
    if (wanted.length === 1 || got.length === 1) {
      return wanted[0] === got[0] ? (parsedInitialOnly ? 20 : 16) : null;
    }

    // "Cathy" vs "Catherine" and similar truncations.
    if (wanted.length >= 4 && got.startsWith(wanted)) return 24;
    if (got.length >= 4 && wanted.startsWith(got)) return 24;

    return null;
  }

  /** A shared middle initial is weak but useful for breaking ties. */
  function scoreMiddle(parsedMiddle, candidateMiddle) {
    const wanted = nameUtils.normalizeToken(parsedMiddle);
    const got = nameUtils.normalizeToken(candidateMiddle);
    if (!wanted || !got) return 0;
    if (wanted === got) return 6;
    return wanted[0] === got[0] ? 3 : 0;
  }

  /**
   * When the page told us the subject ("ACC 3202"), a matching RMP department
   * is a meaningful signal. A mismatch is not penalised -- professors often
   * teach outside their listed department.
   */
  function scoreDepartment(subjectHint, candidateDepartment) {
    if (!subjectHint || !candidateDepartment) return 0;
    const hint = nameUtils.normalizeToken(subjectHint);
    const dept = nameUtils.normalizeToken(candidateDepartment);
    if (!hint || !dept) return 0;
    if (hint === dept) return 8;
    if (dept.startsWith(hint) || hint.startsWith(dept)) return 6;
    return 0;
  }

  function scoreCandidate(parsed, candidate, options) {
    const opts = options || {};
    const surname = scoreSurname(parsed.last, candidate.lastName);
    if (surname === null) return null;

    const given = scoreGivenName(parsed.first, candidate.firstName, parsed.initialOnly);
    if (given === null) return null;

    let score = surname + given;
    score += scoreMiddle(parsed.middle, candidate.middleName);
    score += scoreDepartment(opts.subjectHint, candidate.department);

    // A professor with real ratings is more likely to be the one being viewed
    // than an empty duplicate profile, but this must never rescue a bad name
    // match -- hence the small, capped bonus.
    const numRatings = Number(candidate.numRatings) || 0;
    if (numRatings > 0) score += Math.min(4, Math.log10(numRatings + 1) * 3);

    return Math.round(score * 100) / 100;
  }

  function confidenceFor(score) {
    if (score >= 86) return CONFIDENCE.HIGH;
    if (score >= 72) return CONFIDENCE.MEDIUM;
    return CONFIDENCE.LOW;
  }

  /**
   * Pick the best RMP candidate for a parsed roster name.
   *
   * Returns { match, score, confidence, ambiguous, considered } where `match`
   * is null when nothing cleared the acceptance bar.
   */
  function pickBestMatch(parsed, candidates, options) {
    const list = Array.isArray(candidates) ? candidates : [];
    const scored = [];

    list.forEach(function (candidate) {
      if (!candidate) return;
      const score = scoreCandidate(parsed, candidate, options);
      if (score === null || score < MIN_ACCEPT_SCORE) return;
      scored.push({ candidate: candidate, score: score });
    });

    if (scored.length === 0) {
      return { match: null, score: 0, confidence: null, ambiguous: false, considered: list.length };
    }

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (Number(b.candidate.numRatings) || 0) - (Number(a.candidate.numRatings) || 0);
    });

    const top = scored[0];
    const runnerUp = scored[1];

    // Two distinct people scoring within a hair of each other means we cannot
    // safely say which one is teaching the section.
    const ambiguous = Boolean(
      runnerUp &&
      String(runnerUp.candidate.legacyId) !== String(top.candidate.legacyId) &&
      top.score - runnerUp.score < 6
    );

    // A roster that only gave us "Smith, J" cannot distinguish John from Jane,
    // however good the surname match is -- never report better than low.
    const matchedOnInitialAlone = Boolean(
      parsed.initialOnly &&
      nameUtils.normalizeToken(top.candidate.firstName).length > 1
    );

    let confidence = confidenceFor(top.score);
    if (ambiguous || matchedOnInitialAlone) confidence = CONFIDENCE.LOW;

    return {
      match: top.candidate,
      score: top.score,
      confidence: confidence,
      ambiguous: ambiguous,
      considered: list.length,
    };
  }

  RMPX.matching = {
    MIN_ACCEPT_SCORE: MIN_ACCEPT_SCORE,
    CONFIDENCE: CONFIDENCE,
    scoreCandidate: scoreCandidate,
    pickBestMatch: pickBestMatch,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RMPX.matching;
})(typeof self !== 'undefined' ? self : globalThis);
