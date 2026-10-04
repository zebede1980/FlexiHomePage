// Hover-preview state. Rows report hover in and out; the single LinkPreview
// component renders whatever is current. Opening waits for a short pause (so
// sweeping the pointer across a card doesn't flash cards up), but once open the
// preview follows the pointer from link to link straight away.

import type { BNode } from './tree';

export interface PreviewTarget {
  node: BNode;
  /** Folder titles containing the link, for display. */
  path: string[];
  /** The hovered element; the preview positions itself beside it (or its card). */
  el: HTMLElement;
}

const INTENT_MS = 450;
const GRACE_MS = 140;

class PreviewState {
  target = $state.raw<PreviewTarget | null>(null);
  open = $state(false);
  #showTimer: ReturnType<typeof setTimeout> | undefined;
  #hideTimer: ReturnType<typeof setTimeout> | undefined;

  enter(t: PreviewTarget) {
    clearTimeout(this.#hideTimer);
    clearTimeout(this.#showTimer);
    if (this.open) {
      this.target = t;
      return;
    }
    this.#showTimer = setTimeout(() => {
      this.target = t;
      this.open = true;
    }, INTENT_MS);
  }

  leave() {
    clearTimeout(this.#showTimer);
    this.#hideTimer = setTimeout(() => (this.open = false), GRACE_MS);
  }

  close() {
    clearTimeout(this.#showTimer);
    clearTimeout(this.#hideTimer);
    this.open = false;
  }
}

export const preview = new PreviewState();
