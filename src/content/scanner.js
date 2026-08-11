/**
 * Finding instructor names on the page.
 *
 * CUNY runs at least two very different UIs -- the College Scheduler based
 * "Schedule Builder" and the PeopleSoft class search -- and each campus skins
 * them differently. Rather than pin selectors to one build, the scanner tries
 * progressively looser strategies and stops at the first that finds something:
 *
 *   1. explicit instructor markup (class / id / aria / data attributes)
 *   2. the column under an "Instructor" table header
 *   3. text next to an "Instructor:" label
 *
 * Everything it returns is a Text node, which is what lets the annotator wrap
 * a name in a link without rebuilding markup the host app owns.
 */
(function (root) {
  'use strict';

  const RMPX = (root.RMPX = root.RMPX || {});
  const nameUtils = RMPX.nameUtils;
  const subjects = RMPX.subjects;

  const PROCESSED_ATTR = 'data-rmpx-scanned';
  const INSTRUCTOR_WORD = /\b(?:instructor|professor|faculty|taught\s*by|teacher)s?\b/i;

  /** Attribute-based hooks seen across Schedule Builder / PeopleSoft builds. */
  const EXPLICIT_SELECTORS = [
    '[class*="instructor" i]',
    '[id*="instructor" i]',
    '[data-testid*="instructor" i]',
    '[data-label*="instructor" i]',
    '[aria-label*="instructor" i]',
    '[class*="professor" i]',
    '[id*="MTG_INSTR"]',      // PeopleSoft class search meeting-instructor cells
    '[id*="DERIVED_CLS_DTL_SSR_INSTR_LONG"]',
  ];

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SELECT', 'OPTION',
    'TEXTAREA', 'INPUT', 'BUTTON', 'SVG', 'PATH', 'IFRAME', 'CANVAS',
  ]);

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

  /**
   * Collect the Text nodes directly under `element` that could hold a name.
   * Only direct text children are considered so we never swallow a whole card.
   */
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

  /* ----------------------------------------------------------------------- *
   * Strategy 1 -- explicit instructor markup
   * ----------------------------------------------------------------------- */

  function fromExplicitMarkup(scope) {
    const hits = [];
    let elements = [];
    try {
      elements = Array.prototype.slice.call(scope.querySelectorAll(EXPLICIT_SELECTORS.join(',')));
    } catch (err) {
      return hits;
    }

    elements.forEach(function (element) {
      if (isSkippable(element) || isOurs(element)) return;
      // Containers that hold many instructors get descended into.
      leafTextHolders(element, 12).forEach(function (holder) {
        holder.textNodes.forEach(function (textNode) {
          hits.push({ textNode: textNode, source: 'explicit' });
        });
      });
    });
    return hits;
  }

  /* ----------------------------------------------------------------------- *
   * Strategy 2 -- the column beneath an "Instructor" header
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

  function fromTableColumns(scope) {
    const hits = [];
    let tables = [];
    try {
      tables = Array.prototype.slice.call(scope.querySelectorAll('table, [role="table"], [role="grid"]'));
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
          if (isSkippable(cell) || isOurs(cell)) return;
          leafTextHolders(cell, 8).forEach(function (holder) {
            holder.textNodes.forEach(function (textNode) {
              hits.push({ textNode: textNode, source: 'table' });
            });
          });
        });
      });
    });
    return hits;
  }

  /* ----------------------------------------------------------------------- *
   * Strategy 3 -- "Instructor:" label followed by the name
   * ----------------------------------------------------------------------- */

  function fromLabels(scope) {
    const hits = [];
    let walker;
    try {
      walker = scope.ownerDocument
        ? scope.ownerDocument.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null)
        : document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
    } catch (err) {
      return hits;
    }

    let node;
    let guard = 0;
    while ((node = walker.nextNode()) && guard < 6000) {
      guard += 1;
      const text = node.nodeValue || '';
      if (!INSTRUCTOR_WORD.test(text)) continue;
      if (text.replace(/\s+/g, ' ').trim().length > 40) continue;

      const label = node.parentElement;
      if (!label || isOurs(label)) continue;

      // The name usually sits in the next sibling element, or in the same
      // element right after a colon.
      const inline = text.split(/:/)[1];
      if (inline && nameUtils.looksLikePersonName(inline)) {
        hits.push({ textNode: node, source: 'label-inline', offset: text.indexOf(':') + 1 });
        continue;
      }

      let sibling = label.nextElementSibling;
      let steps = 0;
      while (sibling && steps < 3) {
        if (!isSkippable(sibling) && !isOurs(sibling)) {
          const holders = leafTextHolders(sibling, 6);
          let matched = false;
          holders.forEach(function (holder) {
            holder.textNodes.forEach(function (textNode) {
              if (nameUtils.looksLikePersonName(textNode.nodeValue)) {
                hits.push({ textNode: textNode, source: 'label-sibling' });
                matched = true;
              }
            });
          });
          if (matched) break;
        }
        sibling = sibling.nextElementSibling;
        steps += 1;
      }
    }
    return hits;
  }

  /* ----------------------------------------------------------------------- *
   * Public entry point
   * ----------------------------------------------------------------------- */

  /**
   * Scan `scope` and return candidate instructor sites.
   *
   * Each entry is { textNode, rawText, people, subjectHint } where `people`
   * is the parsed instructor list. Sites whose text does not parse into at
   * least one real person are dropped here, so callers can trust the output.
   */
  function scan(scope) {
    const target = scope && scope.querySelectorAll ? scope : document.body;
    if (!target) return [];

    let hits = fromExplicitMarkup(target);
    if (hits.length === 0) hits = fromTableColumns(target);
    if (hits.length === 0) hits = fromLabels(target);

    const seen = new Set();
    const sites = [];

    hits.forEach(function (hit) {
      const textNode = hit.textNode;
      if (!textNode || !textNode.parentElement) return;
      if (seen.has(textNode)) return;
      seen.add(textNode);

      if (textNode.parentElement.hasAttribute &&
          textNode.parentElement.hasAttribute(PROCESSED_ATTR)) {
        return;
      }

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

    return sites;
  }

  RMPX.scanner = {
    PROCESSED_ATTR: PROCESSED_ATTR,
    scan: scan,
    subjectHintFor: subjectHintFor,
  };
})(typeof self !== 'undefined' ? self : globalThis);
