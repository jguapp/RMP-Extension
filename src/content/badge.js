/**
 * Injecting the link and the rating badge into the page.
 *
 * The guiding constraint is to disturb the host application as little as
 * possible. We never rebuild markup with innerHTML and we never discard the
 * original Text node -- it is split with splitText() and re-parented inside our
 * anchor, so the node the host app holds a reference to still exists.
 *
 * All injected nodes carry a data-rmpx attribute, which is how the scanner
 * knows to skip its own output on the next pass.
 */
(function (root) {
  'use strict';

  const RMPX = (root.RMPX = root.RMPX || {});
  const nameUtils = RMPX.nameUtils;

  function el(tag, className, attrs) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.setAttribute('data-rmpx', attrs && attrs.role ? attrs.role : '1');
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'role') return;
        node.setAttribute(key, attrs[key]);
      });
    }
    return node;
  }

  function formatRating(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return '—';
    return value.toFixed(1);
  }

  /**
   * Render the badge contents for a resolved lookup.
   * `result` is whatever the service worker returned for this instructor.
   */
  function paintBadge(badge, result, settings) {
    while (badge.firstChild) badge.removeChild(badge.firstChild);
    badge.removeAttribute('data-rmpx-tone');

    if (!result || result.status === 'loading') {
      badge.setAttribute('data-rmpx-state', 'loading');
      badge.setAttribute('aria-label', 'Loading Rate My Professors rating');
      badge.appendChild(el('span', 'rmpx-badge__spinner', { role: 'spinner' }));
      return;
    }

    if (result.status === 'error') {
      badge.setAttribute('data-rmpx-state', 'error');
      badge.title = 'Could not reach Rate My Professors. ' + (result.message || '');
      badge.setAttribute('aria-label', 'Rate My Professors lookup failed');
      badge.textContent = '!';
      return;
    }

    if (result.status !== 'match' || !result.professor) {
      badge.setAttribute('data-rmpx-state', 'nomatch');
      badge.title = 'No Rate My Professors profile found — click to search';
      badge.setAttribute('aria-label', 'No Rate My Professors profile found');
      badge.textContent = 'n/a';
      return;
    }

    const professor = result.professor;
    const rated = typeof professor.avgRating === 'number' && professor.numRatings > 0;
    const minimum = settings && typeof settings.minRatingsForBadge === 'number'
      ? settings.minRatingsForBadge
      : 1;

    badge.setAttribute('data-rmpx-state', 'match');
    badge.setAttribute('data-rmpx-tone', rated ? RMPX.ratingTone(professor.avgRating) : 'unknown');

    if (!rated) {
      badge.textContent = 'no ratings';
      badge.title = professor.firstName + ' ' + professor.lastName +
        ' has a profile but no ratings yet';
      badge.setAttribute('aria-label', 'Profile found, no ratings yet');
      return;
    }

    if (professor.numRatings < minimum) {
      badge.setAttribute('data-rmpx-tone', 'unknown');
    }

    const score = el('span', 'rmpx-badge__score', { role: 'score' });
    score.textContent = formatRating(professor.avgRating);
    badge.appendChild(score);

    const count = el('span', 'rmpx-badge__count', { role: 'count' });
    count.textContent = String(professor.numRatings);
    badge.appendChild(count);

    // Spelled out, because a bare second number reads as another score.
    const countLabel = el('span', 'rmpx-badge__count-label', { role: 'count-label' });
    countLabel.textContent = professor.numRatings === 1 ? 'rating' : 'ratings';
    badge.appendChild(countLabel);

    const caveats = [];
    if (result.ambiguous) caveats.push('several professors share this name — verify on RMP');
    if (result.campusGuessed) {
      caveats.push('this page did not say which college, so the campus was guessed — ' +
        'set yours in the extension popup');
    }

    const summary = professor.firstName + ' ' + professor.lastName + ': ' +
      formatRating(professor.avgRating) + ' out of 5 from ' + professor.numRatings +
      ' rating' + (professor.numRatings === 1 ? '' : 's') +
      (caveats.length ? ' (' + caveats.join('; ') + ')' : '');

    badge.title = summary;
    badge.setAttribute('aria-label', summary);

    // One marker for "do not take this at face value", whatever the reason.
    if (result.ambiguous || result.campusGuessed) {
      badge.setAttribute('data-rmpx-ambiguous', '1');
    }
  }

  /** Point the anchor at the profile once we know where it lives. */
  function updateAnchor(anchor, result) {
    const href = (result && (result.url || result.searchUrl)) || null;
    if (!href) return;
    anchor.setAttribute('href', href);
    anchor.setAttribute('data-rmpx-state', result.status || 'unknown');
    if (result.status === 'match') {
      anchor.title = 'Open this professor on Rate My Professors';
    } else if (result.status === 'nomatch') {
      anchor.title = 'Search Rate My Professors for this name';
    }
  }

  /**
   * Wrap one instructor name in an anchor and drop a badge next to it.
   * Returns the created nodes, or null if the DOM shifted underneath us.
   */
  function wrapNameNode(nameNode, person) {
    const parent = nameNode.parentNode;
    if (!parent) return null;

    const anchor = el('a', 'rmpx-name', { role: 'name', rel: 'noopener noreferrer', target: '_blank' });
    anchor.setAttribute('data-rmpx-person', person.key);
    // Until the lookup resolves there is nothing useful to open.
    anchor.setAttribute('data-rmpx-state', 'loading');

    parent.insertBefore(anchor, nameNode);
    anchor.appendChild(nameNode);

    const badge = el('span', 'rmpx-badge', { role: 'badge' });
    badge.setAttribute('data-rmpx-state', 'loading');
    badge.setAttribute('role', 'status');
    if (anchor.nextSibling) parent.insertBefore(badge, anchor.nextSibling);
    else parent.appendChild(badge);

    return { anchor: anchor, badge: badge };
  }

  /**
   * Annotate every instructor found in one text node.
   *
   * Segments are consumed left to right using splitText, so each name ends up
   * isolated in its own Text node before being re-parented into an anchor.
   */
  function annotate(site) {
    const textNode = site && site.textNode;
    if (!textNode || !textNode.parentNode) return [];

    const raw = textNode.nodeValue || '';
    const segments = nameUtils.segmentInstructorField(raw);
    if (!segments.length) return [];

    const created = [];
    let current = textNode;
    let consumed = 0;

    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      const localStart = segment.start - consumed;
      const length = segment.end - segment.start;

      if (localStart < 0 || localStart + length > (current.nodeValue || '').length) break;

      let nameNode;
      let rest;
      try {
        nameNode = localStart > 0 ? current.splitText(localStart) : current;
        rest = nameNode.splitText(length);
      } catch (err) {
        break;
      }

      const nodes = wrapNameNode(nameNode, segment.person);
      if (nodes) {
        created.push({
          person: segment.person,
          anchor: nodes.anchor,
          badge: nodes.badge,
          subjectHint: site.subjectHint || null,
        });
      }

      current = rest;
      consumed = segment.end;
    }

    return created;
  }

  /** Remove every node this extension added, restoring the original text. */
  function removeAll(scope) {
    const target = scope || document;
    const anchors = target.querySelectorAll('a.rmpx-name[data-rmpx]');
    anchors.forEach(function (anchor) {
      const parent = anchor.parentNode;
      if (!parent) return;
      while (anchor.firstChild) parent.insertBefore(anchor.firstChild, anchor);
      parent.removeChild(anchor);
      if (parent.normalize) parent.normalize();
    });

    target.querySelectorAll('[data-rmpx="badge"], [data-rmpx="card"]').forEach(function (node) {
      if (node.parentNode) node.parentNode.removeChild(node);
    });
  }

  RMPX.badge = {
    annotate: annotate,
    paintBadge: paintBadge,
    updateAnchor: updateAnchor,
    removeAll: removeAll,
    formatRating: formatRating,
  };
})(typeof self !== 'undefined' ? self : globalThis);
