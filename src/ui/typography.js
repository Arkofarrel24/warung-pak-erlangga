/**
 * Keeps words whole.
 *
 * A browser may break a line after any hyphen, which splits the doubled
 * words Indonesian is full of: "pelan-" at the end of one line and "pelan"
 * at the start of the next. There is no CSS for "do not break here", but
 * there is a character: the non-breaking hyphen looks the same and holds
 * the two halves together.
 *
 * Text reaches the page from many places (templates, formatted numbers,
 * sentences rebuilt on every change), so rather than ask each of them to
 * remember, the text is tidied as it arrives.
 */

const HYPHEN_IN_WORD = /(\p{L})-(?=\p{L})/gu;
const NON_BREAKING_HYPHEN = '‑';

function tidy(node) {
  const text = node.data;
  if (!text.includes('-')) return;
  const tidied = text.replace(HYPHEN_IN_WORD, `$1${NON_BREAKING_HYPHEN}`);
  // Writing only when something changed keeps the observer from answering itself.
  if (tidied !== text) node.data = tidied;
}

function tidyAll(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    tidy(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) tidy(node);
}

/** Tidies the text under `root`, now and whenever it changes. */
export function keepWordsWhole(root) {
  tidyAll(root);
  new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === 'characterData') tidy(change.target);
      else change.addedNodes.forEach(tidyAll);
    }
  }).observe(root, { subtree: true, childList: true, characterData: true });
}
