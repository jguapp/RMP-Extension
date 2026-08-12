/**
 * Finding instructor names on the page.
 *
 * CUNY runs at least two very different UIs -- the College Scheduler based
 * "Schedule Builder" and the PeopleSoft class search -- and each campus skins
 * them differently. Rather than pin selectors to one build, the scanner runs
 * four independent strategies and unions whatever they find:
 *
 *   1. the marked element holds the name       <span class="instructor">Ann Lee</span>
 *   2. the marker is an icon, name is beside it <i title="Instructor(s)"></i><span>Ann Lee</span>
 *   3. the column under an "Instructor" header  (PeopleSoft / result grids)
 *   4. text following an "Instructor:" label
 *
 * Strategy 2 matters because Schedule Builder renders class details as icon +
 * text rows, where the only thing carrying the word "Instructor" is a tooltip
 * on the icon -- the name itself is an unmarked sibling.
 *
 * Everything returned is a Text node, which is what lets the annotator wrap a
 * name in a link without rebuilding markup the host app owns.
 */
(function (root) {
  'use strict';

  const RMPX = (root.RMPX = root.RMPX || {});
  const nameUtils = RMPX.nameUtils;
  const subjects = RMPX.subjects;

  const INSTRUCTOR_WORD = /\b(?:instructor|professor|faculty|taught\s*by|teacher)s?\b/i;

  /**
   * Anything whose attributes name an instructor. `title` is here because
   * College Scheduler puts the label in a tooltip on the row's icon.
   */
  const MARKER_SELECTORS = [
    '[class*="instructor" i]',
    '[id*="instructor" i]',
    '[title*="instructor" i]',
    '[aria-label*="instructor" i]',
    '[data-testid*="instructor" i]',
    '[data-label*="instructor" i]',
    '[data-title*="instructor" i]',
    '[data-tooltip*="instructor" i]',
    '[data-original-title*="instructor" i]',
    '[class*="professor" i]',
    '[title*="professor" i]',
    '[aria-label*="taught by" i]',
    '[id*="MTG_INSTR"]',      // PeopleSoft class search meeting-instructor cells
    '[id*="DERIVED_CLS_DTL_SSR_INSTR_LONG"]',
  ];

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SELECT', 'OPTION',
    'TEXTAREA', 'INPUT', 'BUTTON', 'SVG', 'PATH', 'IFRAME', 'CANVAS',
  ]);

  /** Populated on every scan so a failing page can explain itself. */
  let lastReport = { explicit: 0, sibling: 0, table: 0, label: 0, accepted: 0 };

  function isOurs(node) {
    const element = node && node.nodeType === 1 ? node : node && node.parentElement;
    return Boolean(element && element.closest && element.closest('[data-rmpx]'));
  }

  function isSkippable(element) {
    if (!element || !element.tagName) return true;
    if (SKIP_TAGS.has(element.tagName)) return true;
    if (element.isContentEditable) return true;
    return false;
  }

  function directTextNodes(element) {
    const out = [];
    if (!element || !element.childNodes) return out;
    for (let i = 0; i < element.childNodes.length; i += 1) {
      const node = element.childNodes[i];
      if (node.nodeType === 3 && node.nodeValue && node.nodeValue.trim()) out.push(node);
    }
    return out;
  }

  /**
   * Walk down to the innermost elements that still carry text, so a nested
   * <td><span><a>Smith, John</a></span></td> yields the <a>, not the <td>.
   */
  function leafTextHolders(element, limit) {
    const found = [];
    const stack = [element];
    let guard = 0;

    while (stack.length && found.length < (limit || 40) && guard < 400) {
      guard += 1;
      const current = stack.pop();
      if (!current || isSkippable(current) || isOurs(current)) continue;

      const own = directTextNodes(current);
      if (own.length) found.push({ element: current, textNodes: own });

      if (current.children) {
        for (let i = 0; i < current.children.length; i += 1) stack.push(current.children[i]);
      }
    }
    return found;
  }

  /** Collect name-shaped text nodes from inside an element. */
  function harvest(element, source, hits, limit) {
    if (!element || isSkippable(element) || isOurs(element)) return 0;
    let added = 0;
    leafTextHolders(element, limit || 8).forEach(function (holder) {
      holder.textNodes.forEach(function (textNode) {
        if (!nameUtils.looksLikePersonName(textNode.nodeValue)) return;
        hits.push({ textNode: textNode, source: source });
        added += 1;
      });
    });
    return added;
  }

  /**
   * True when this element is the page saying nobody is assigned yet --
   * "Staff", "TBA", "To be Announced". Short text only, so a paragraph that
   * merely mentions the word does not count.
   */
  function holdsPlaceholder(element) {
    if (!element || isSkippable(element) || isOurs(element)) return false;
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 2 || text.length > 40) return false;
    if (!/[A-Za-z]/.test(text)) return false;
    return nameUtils.isPlaceholderName(text);
  }

  /** Course code from the nearest row/card, used as a department hint. */
  function subjectHintFor(element) {
    if (!subjects) return null;
    let current = element;
    let hops = 0;
    while (current && hops < 6) {
      const text = current.textContent || '';
      if (text.length > 8 && text.length < 4000) {
        const dept = subjects.departmentFromText(text);
        if (dept) return dept;
      }
      current = current.parentElement;
      hops += 1;
    }
    return null;
  }

  function markedElements(scope) {
    try {
      return Array.prototype.slice.call(scope.querySelectorAll(MARKER_SELECTORS.join(',')));
    } catch (err) {
      return [];
    }
  }

  /* ----------------------------------------------------------------------- *
   * Strategies 1 and 2 -- instructor markup, name inside or beside it
   * ----------------------------------------------------------------------- */

  function fromMarkers(scope, hits) {
    let inside = 0;
    let beside = 0;

    markedElements(scope).forEach(function (element) {
      if (isSkippable(element) || isOurs(element)) return;

      // 1. The marked element itself contains the name.
      const found = harvest(element, 'marker', hits, 12);
      if (found > 0) {
        inside += found;
        return;
      }

      // 2. The marker is an icon or a label with no name of its own, so the
      //    name is a sibling, or shares the marker's immediate parent.
      let fromSiblings = 0;
      let unassigned = false;
      let sibling = element.nextElementSibling;
      let steps = 0;
      while (sibling && steps < 3) {
        // "Staff" beside the marker *is* this section's instructor value. There
        // is nobody to look up, and nothing further along belongs to us either.
        if (holdsPlaceholder(sibling)) {
          unassigned = true;
          break;
        }
        fromSiblings += harvest(sibling, 'marker-sibling', hits, 6);
        sibling = sibling.nextElementSibling;
        steps += 1;
      }

      // Fall back to the parent only when this marker's siblings gave nothing,
      // and only one level up, so we never vacuum up an entire card.
      //
      // A section with no professor assigned must not reach this fallback:
      // Schedule Builder lays every detail row out under one parent, so
      // searching it would step over "Staff" and label a neighbouring row --
      // the instruction mode, or a room like "Ingersoll Hall" -- as the
      // instructor.
      if (fromSiblings === 0 && !unassigned && element.parentElement) {
        fromSiblings += harvest(element.parentElement, 'marker-parent', hits, 6);
      }
      beside += fromSiblings;
    });

    lastReport.explicit = inside;
    lastReport.sibling = beside;
    return hits;
  }

  /* ----------------------------------------------------------------------- *
   * Strategy 3 -- the column beneath an "Instructor" header
   * ----------------------------------------------------------------------- */

  function headerIndexes(table) {
    const indexes = [];
    const headerCells = table.querySelectorAll('th, [role="columnheader"]');
    headerCells.forEach(function (cell) {
      const text = (cell.textContent || '').trim();
      if (!INSTRUCTOR_WORD.test(text)) return;
      const rowCells = cell.parentElement ? cell.parentElement.children : null;
      if (!rowCells) return;
      const index = Array.prototype.indexOf.call(rowCells, cell);
      if (index >= 0 && indexes.indexOf(index) === -1) indexes.push(index);
    });
    return indexes;
  }

  function fromTableColumns(scope, hits) {
    let added = 0;
    let tables = [];
    try {
      tables = Array.prototype.slice.call(
        scope.querySelectorAll('table, [role="table"], [role="grid"]')
      );
    } catch (err) {
      return hits;
    }

    tables.forEach(function (table) {
      const indexes = headerIndexes(table);
      if (!indexes.length) return;

      const rows = table.querySelectorAll('tr, [role="row"]');
      rows.forEach(function (row) {
        indexes.forEach(function (index) {
          const cell = row.children && row.children[index];
          if (!cell || cell.tagName === 'TH') return;
          added += harvest(cell, 'table', hits, 8);
        });
      });
    });

    lastReport.table = added;
    return hits;
  }

  /* ----------------------------------------------------------------------- *
   * Strategy 4 -- "Instructor:" label followed by the name
   * ----------------------------------------------------------------------- */

  function fromLabels(scope, hits) {
    let added = 0;
    let walker;
    try {
      const doc = scope.ownerDocument || document;
      walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
    } catch (err) {
      return hits;
    }

    let node;
    let guard = 0;
    while ((node = walker.nextNode()) && guard < 8000) {
      guard += 1;
      const text = node.nodeValue || '';
      if (!INSTRUCTOR_WORD.test(text)) continue;
      if (text.replace(/\s+/g, ' ').trim().length > 40) continue;

      const label = node.parentElement;
      if (!label || isOurs(label)) continue;

      // "Instructor: Ann Lee" all in one text node.
      const inline = text.split(/:/)[1];
      if (inline && nameUtils.looksLikePersonName(inline)) {
        hits.push({ textNode: node, source: 'label-inline' });
        added += 1;
        continue;
      }

      let sibling = label.nextElementSibling;
      let steps = 0;
      while (sibling && steps < 3) {
        const found = harvest(sibling, 'label-sibling', hits, 6);
        added += found;
        if (found > 0) break;
        sibling = sibling.nextElementSibling;
        steps += 1;
      }
    }

    lastReport.label = added;
    return hits;
  }

  /* ----------------------------------------------------------------------- *
   * Public entry point
   * ----------------------------------------------------------------------- */

  /**
   * Scan `scope` and return candidate instructor sites.
   *
   * Each entry is { textNode, rawText, people, subjectHint }. Sites whose text
   * does not parse into at least one real person are dropped here, so callers
   * can trust the output. All four strategies run and their results are
   * unioned -- a page may present instructors more than one way.
   */
  function scan(scope) {
    const target = scope && scope.querySelectorAll ? scope : document.body;
    if (!target) return [];

    lastReport = { explicit: 0, sibling: 0, table: 0, label: 0, accepted: 0 };

    const hits = [];
    fromMarkers(target, hits);
    fromTableColumns(target, hits);
    // The label walk is the most expensive strategy; only run it when the
    // structural ones came up empty.
    if (hits.length === 0) fromLabels(target, hits);

    const seen = new Set();
    const sites = [];

    hits.forEach(function (hit) {
      const textNode = hit.textNode;
      if (!textNode || !textNode.parentElement) return;
      if (seen.has(textNode)) return;
      seen.add(textNode);

      if (isOurs(textNode)) return;

      const rawText = (textNode.nodeValue || '').trim();
      if (!rawText || rawText.length > 200) return;
      if (!nameUtils.looksLikePersonName(rawText)) return;

      const people = nameUtils.parseInstructorField(rawText);
      if (!people.length) return;

      sites.push({
        textNode: textNode,
        rawText: rawText,
        people: people,
        subjectHint: subjectHintFor(textNode.parentElement),
        source: hit.source,
      });
    });

    lastReport.accepted = sites.length;
    return sites;
  }

  /**
   * What the last scan saw, per strategy. Used to leave a breadcrumb in the
   * console when the extension loads on a page but finds nobody, which is the
   * difference between "not injected" and "markup not recognised".
   */
  function report() {
    return Object.assign({}, lastReport);
  }

  RMPX.scanner = {
    scan: scan,
    report: report,
    subjectHintFor: subjectHintFor,
  };
})(typeof self !== 'undefined' ? self : globalThis);
