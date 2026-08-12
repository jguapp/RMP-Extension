/**
 * The hover preview.
 *
 * Rate My Professors sets X-Frame-Options, so an actual iframe preview of the
 * profile is impossible. Instead we render a native card from the same data the
 * profile page uses: the headline score, difficulty, would-take-again, the
 * full 1-5 histogram, a three-bucket Awesome / Good / Bad summary, and the
 * tags students attached most often ("Tough grader", "Test heavy", ...).
 *
 * One card instance is reused for the whole page. It opens on hover and on
 * keyboard focus, and stays open while the pointer is inside it so the links
 * and tags remain clickable.
 */
(function (root) {
  'use strict';

  const RMPX = (root.RMPX = root.RMPX || {});

  const SHOW_DELAY_MS = 170;
  const HIDE_DELAY_MS = 220;
  const CARD_WIDTH = 330;
  const VIEWPORT_MARGIN = 10;

  let card = null;
  let showTimer = null;
  let hideTimer = null;
  let currentAnchor = null;
  let pointerInsideCard = false;
  let detailRequestToken = 0;

  /** Callback wired up by content.js so the card can ask for profile detail. */
  let detailProvider = function () { return Promise.resolve(null); };

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.setAttribute('data-rmpx', 'card-part');
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function ensureCard() {
    if (card && card.isConnected) return card;

    card = document.createElement('div');
    card.className = 'rmpx-card';
    card.setAttribute('data-rmpx', 'card');
    card.setAttribute('role', 'tooltip');
    card.setAttribute('aria-live', 'polite');
    card.hidden = true;

    card.addEventListener('mouseenter', function () {
      pointerInsideCard = true;
      window.clearTimeout(hideTimer);
    });
    card.addEventListener('mouseleave', function () {
      pointerInsideCard = false;
      scheduleHide();
    });

    document.body.appendChild(card);
    return card;
  }

  /* ----------------------------------------------------------------------- *
   * Rendering
   * ----------------------------------------------------------------------- */

  function pct(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 1000) / 10;
  }

  function renderStat(container, label, value, tone) {
    const stat = el('div', 'rmpx-card__stat');
    const valueNode = el('div', 'rmpx-card__stat-value');
    valueNode.textContent = value;
    if (tone) valueNode.setAttribute('data-rmpx-tone', tone);
    const labelNode = el('div', 'rmpx-card__stat-label');
    labelNode.textContent = label;
    stat.appendChild(valueNode);
    stat.appendChild(labelNode);
    container.appendChild(stat);
  }

  /** The three-bucket summary the user reads at a glance. */
  function renderSentiment(container, distribution) {
    const total = distribution.total;
    const counts = distribution.counts;

    const values = RMPX.SENTIMENT_BUCKETS.map(function (bucket) {
      const sum = bucket.stars.reduce(function (acc, star) {
        return acc + (counts[star] || 0);
      }, 0);
      return { key: bucket.key, label: bucket.label, count: sum, percent: pct(sum, total) };
    });

    const bar = el('div', 'rmpx-card__sentiment');
    bar.setAttribute('role', 'img');
    bar.setAttribute(
      'aria-label',
      values.map(function (v) { return v.label + ' ' + v.percent + '%'; }).join(', ')
    );

    values.forEach(function (value) {
      if (value.percent <= 0) return;
      const slice = el('div', 'rmpx-card__sentiment-slice');
      slice.setAttribute('data-rmpx-bucket', value.key);
      slice.style.width = value.percent + '%';
      slice.title = value.label + ': ' + value.count + ' (' + value.percent + '%)';
      bar.appendChild(slice);
    });
    container.appendChild(bar);

    const legend = el('div', 'rmpx-card__legend');
    values.forEach(function (value) {
      const item = el('span', 'rmpx-card__legend-item');
      item.setAttribute('data-rmpx-bucket', value.key);
      const dot = el('span', 'rmpx-card__legend-dot');
      dot.setAttribute('data-rmpx-bucket', value.key);
      const text = el('span', 'rmpx-card__legend-text');
      text.textContent = value.label + ' ' + value.percent + '%';
      item.appendChild(dot);
      item.appendChild(text);
      legend.appendChild(item);
    });
    container.appendChild(legend);
  }

  /** The familiar 5-to-1 histogram, using RMP's own wording. */
  function renderHistogram(container, distribution) {
    const total = distribution.total;
    const counts = distribution.counts;
    const max = Math.max(counts[1], counts[2], counts[3], counts[4], counts[5], 1);

    const list = el('div', 'rmpx-card__histogram');
    [5, 4, 3, 2, 1].forEach(function (star) {
      const count = counts[star] || 0;
      const row = el('div', 'rmpx-card__hist-row');

      const label = el('span', 'rmpx-card__hist-label');
      label.textContent = RMPX.RATING_LABELS[star];

      const track = el('span', 'rmpx-card__hist-track');
      const fill = el('span', 'rmpx-card__hist-fill');
      fill.setAttribute('data-rmpx-star', String(star));
      fill.style.width = Math.round((count / max) * 100) + '%';
      track.appendChild(fill);

      const value = el('span', 'rmpx-card__hist-count');
      value.textContent = String(count);
      value.title = pct(count, total) + '% of ratings';

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);
      list.appendChild(row);
    });
    container.appendChild(list);
  }

  /**
   * The tags students attached most often, most-mentioned first. Already
   * ranked and capped by the client, so everything handed over is rendered.
   */
  function renderTags(container, tags) {
    if (!tags || !tags.length) return;
    const wrap = el('div', 'rmpx-card__tags');
    tags.forEach(function (tag) {
      const chip = el('span', 'rmpx-card__tag');
      chip.textContent = tag.name;
      if (tag.count) {
        chip.title = tag.name + ' — mentioned in ' +
          tag.count + (tag.count === 1 ? ' rating' : ' ratings');
      }
      wrap.appendChild(chip);
    });
    container.appendChild(wrap);
  }

  function renderFooter(container, result, professor) {
    const footer = el('div', 'rmpx-card__footer');

    const link = document.createElement('a');
    link.className = 'rmpx-card__link';
    link.setAttribute('data-rmpx', 'card-part');
    link.href = (result && (result.url || result.searchUrl)) || RMPX.searchUrl(
      professor ? professor.firstName + ' ' + professor.lastName : ''
    );
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Read all reviews on Rate My Professors →';
    footer.appendChild(link);

    container.appendChild(footer);
  }

  function renderShell(result) {
    const node = ensureCard();
    clear(node);

    const professor = result && result.professor;
    const header = el('div', 'rmpx-card__header');

    const identity = el('div', 'rmpx-card__identity');
    const name = el('div', 'rmpx-card__name');
    name.textContent = professor
      ? (professor.firstName + ' ' + professor.lastName).trim()
      : 'Rate My Professors';
    identity.appendChild(name);

    const meta = el('div', 'rmpx-card__meta');
    const bits = [];
    if (professor && professor.department) bits.push(professor.department);
    if (professor && professor.school && professor.school.name) bits.push(professor.school.name);
    else if (result && result.schoolName) bits.push(result.schoolName);
    meta.textContent = bits.join(' · ');
    if (bits.length) identity.appendChild(meta);

    header.appendChild(identity);

    if (professor && typeof professor.avgRating === 'number' && professor.numRatings > 0) {
      const score = el('div', 'rmpx-card__score');
      score.setAttribute('data-rmpx-tone', RMPX.ratingTone(professor.avgRating));
      const big = el('span', 'rmpx-card__score-value');
      big.textContent = professor.avgRating.toFixed(1);
      const outOf = el('span', 'rmpx-card__score-max');
      outOf.textContent = '/5';
      score.appendChild(big);
      score.appendChild(outOf);
      header.appendChild(score);
    }

    node.appendChild(header);
    return node;
  }

  function renderLoading(result) {
    const node = renderShell(result);
    const body = el('div', 'rmpx-card__body');
    const loading = el('div', 'rmpx-card__loading');
    loading.textContent = 'Loading rating breakdown…';
    body.appendChild(loading);
    node.appendChild(body);
  }

  function renderMessage(result, message) {
    const node = renderShell(result);
    const body = el('div', 'rmpx-card__body');
    const text = el('div', 'rmpx-card__message');
    text.textContent = message;
    body.appendChild(text);
    node.appendChild(body);
    renderFooter(node, result, result && result.professor);
  }

  function renderProfile(result, detail, settings) {
    const professor = detail || (result && result.professor);
    const merged = Object.assign({}, result, { professor: professor });
    const node = renderShell(merged);
    const body = el('div', 'rmpx-card__body');

    if (result && result.ambiguous) {
      const warning = el('div', 'rmpx-card__warning');
      warning.textContent = 'Several professors share this name — double-check on RMP.';
      body.appendChild(warning);
    }

    // The campus narrows the search, so a guessed one can surface a real
    // professor from the wrong college. Name the college that was assumed and
    // point at the fix, rather than leaving the student to wonder.
    if (result && result.campusGuessed) {
      const warning = el('div', 'rmpx-card__warning');
      const where = (professor.school && professor.school.name) || result.schoolName;
      warning.textContent = where
        ? 'This page did not say which college, so this is ' + where +
          '. Set your campus in the extension popup if that is wrong.'
        : 'This page did not say which college, so the campus was guessed. ' +
          'Set yours in the extension popup.';
      body.appendChild(warning);
    }

    const stats = el('div', 'rmpx-card__stats');
    const ratingCount = professor.numRatings || 0;
    renderStat(stats, ratingCount === 1 ? 'rating' : 'ratings', String(ratingCount));

    if ((!settings || settings.showWouldTakeAgain) &&
        typeof professor.wouldTakeAgainPercent === 'number') {
      renderStat(stats, 'would retake', Math.round(professor.wouldTakeAgainPercent) + '%');
    }
    if ((!settings || settings.showDifficulty) &&
        typeof professor.avgDifficulty === 'number') {
      renderStat(stats, 'difficulty', professor.avgDifficulty.toFixed(1) + '/5');
    }
    body.appendChild(stats);

    if (professor.distribution && professor.distribution.total > 0) {
      renderSentiment(body, professor.distribution);
      renderHistogram(body, professor.distribution);
    } else if (ratingCount > 0) {
      const note = el('div', 'rmpx-card__message');
      note.textContent = 'Score breakdown is unavailable for this professor.';
      body.appendChild(note);
    } else {
      const note = el('div', 'rmpx-card__message');
      note.textContent = 'This professor has a profile but no ratings yet.';
      body.appendChild(note);
    }

    renderTags(body, professor.tags);
    node.appendChild(body);
    renderFooter(node, merged, professor);
  }

  /* ----------------------------------------------------------------------- *
   * Positioning
   * ----------------------------------------------------------------------- */

  function position(anchor) {
    const node = ensureCard();
    const rect = anchor.getBoundingClientRect();

    node.style.width = CARD_WIDTH + 'px';
    node.hidden = false;

    const cardRect = node.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < cardRect.height + 16 && rect.top > cardRect.height + 16;

    let top = placeAbove ? rect.top - cardRect.height - 8 : rect.bottom + 8;
    let left = rect.left;

    const maxLeft = window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN;
    if (left > maxLeft) left = maxLeft;
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;

    node.style.top = Math.round(top) + 'px';
    node.style.left = Math.round(left) + 'px';
    node.setAttribute('data-rmpx-placement', placeAbove ? 'above' : 'below');
  }

  /* ----------------------------------------------------------------------- *
   * Show / hide
   * ----------------------------------------------------------------------- */

  function hide() {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    detailRequestToken += 1;
    pointerInsideCard = false;
    currentAnchor = null;
    if (card) {
      card.hidden = true;
      clear(card);
    }
  }

  function scheduleHide() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(function () {
      if (!pointerInsideCard) hide();
    }, HIDE_DELAY_MS);
  }

  async function open(anchor, context) {
    const result = context && context.result;
    currentAnchor = anchor;

    if (!result || result.status === 'error') {
      renderMessage(result, 'Could not reach Rate My Professors.');
      position(anchor);
      return;
    }

    if (result.status === 'nomatch' || !result.professor) {
      renderMessage(result, 'No Rate My Professors profile matched this name.');
      position(anchor);
      return;
    }

    renderLoading(result);
    position(anchor);

    const token = ++detailRequestToken;
    let detail = null;
    try {
      detail = await detailProvider(result.professor);
    } catch (err) {
      detail = null;
    }

    // The pointer may have moved on while we were fetching.
    if (token !== detailRequestToken || currentAnchor !== anchor) return;

    renderProfile(result, detail, context.settings);
    position(anchor);
  }

  function scheduleShow(anchor, contextProvider) {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    showTimer = window.setTimeout(function () {
      Promise.resolve(contextProvider()).then(function (context) {
        if (!context) return;
        open(anchor, context);
      });
    }, SHOW_DELAY_MS);
  }

  /**
   * Attach hover/focus handlers to an annotated name.
   * `contextProvider` returns { result, settings } for this instructor.
   */
  function attach(anchor, contextProvider) {
    anchor.addEventListener('mouseenter', function () {
      scheduleShow(anchor, contextProvider);
    });
    anchor.addEventListener('mouseleave', function () {
      window.clearTimeout(showTimer);
      scheduleHide();
    });
    anchor.addEventListener('focus', function () {
      scheduleShow(anchor, contextProvider);
    });
    anchor.addEventListener('blur', function () {
      window.clearTimeout(showTimer);
      scheduleHide();
    });
  }

  function setDetailProvider(fn) {
    if (typeof fn === 'function') detailProvider = fn;
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') hide();
  });

  window.addEventListener('scroll', function () {
    if (currentAnchor && card && !card.hidden) position(currentAnchor);
  }, true);

  window.addEventListener('resize', hide);

  RMPX.hovercard = {
    attach: attach,
    hide: hide,
    setDetailProvider: setDetailProvider,
  };
})(typeof self !== 'undefined' ? self : globalThis);
