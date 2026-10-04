// Pointer-driven flourishes as Svelte actions, so components opt in with `use:`.

import type { Action } from 'svelte/action';
import { drag } from '../ui.svelte';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Leans the element toward the pointer. Only sets --rx/--ry/--gx/--gy and a
 * `tilting` class; the stylesheet decides what to do with them.
 */
export const tilt: Action<HTMLElement, boolean> = (node, enabled = false) => {
  let on = enabled;

  function move(e: PointerEvent) {
    if (!on || drag.active || reducedMotion()) return;
    const r = node.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    node.classList.add('tilting');
    node.style.setProperty('--ry', `${(nx * 7).toFixed(2)}deg`);
    node.style.setProperty('--rx', `${(-ny * 5).toFixed(2)}deg`);
    node.style.setProperty('--gx', `${((nx + 0.5) * 100).toFixed(1)}%`);
    node.style.setProperty('--gy', `${((ny + 0.5) * 100).toFixed(1)}%`);
  }

  function reset() {
    node.classList.remove('tilting');
    for (const p of ['--rx', '--ry', '--gx', '--gy']) node.style.removeProperty(p);
  }

  node.addEventListener('pointermove', move);
  node.addEventListener('pointerleave', reset);
  node.addEventListener('dragstart', reset);
  return {
    update(v) {
      on = v;
      if (!v) reset();
    },
    destroy() {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', reset);
      node.removeEventListener('dragstart', reset);
    },
  };
};

const GLYPHS = '!<>-_\\/[]{}=+*^?#ABCDEF0123456789';

/**
 * Owns the element's text: shows `text`, and when the pointer enters the
 * closest `trigger` ancestor, "decodes" it from random glyphs, left to right.
 */
export const decode: Action<HTMLElement, { text: string; enabled: boolean; trigger: string }> = (node, params) => {
  let p = params;
  let raf = 0;
  node.textContent = p.text;

  function run() {
    if (!p.enabled || drag.active || reducedMotion()) return;
    cancelAnimationFrame(raf);
    const text = p.text;
    let frame = 0;
    const step = () => {
      const done = frame >> 1;
      node.textContent = [...text].map((ch, i) => (i < done || ch === ' ' ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('');
      if (done < text.length) {
        frame++;
        raf = requestAnimationFrame(step);
      }
    };
    step();
  }

  const host = node.closest<HTMLElement>(p.trigger) ?? node;
  host.addEventListener('pointerenter', run);
  return {
    update(next) {
      p = next;
      cancelAnimationFrame(raf);
      node.textContent = p.text;
    },
    destroy() {
      cancelAnimationFrame(raf);
      host.removeEventListener('pointerenter', run);
    },
  };
};

/**
 * macOS-dock magnification: sets --s (1 to 1.5) on each `[role="listitem"]`
 * child by its distance from the pointer, and a `settling` class on the
 * container while it springs back. Distances are measured from where the items
 * sat at rest, so growing icons pushing their neighbours aside can't feed back
 * into the next frame.
 */
export const magnify: Action<HTMLElement, boolean> = (node, enabled = false) => {
  let on = enabled;
  let rest: { el: HTMLElement; x: number; y: number }[] = [];
  const REACH = 150;
  const GROW = 0.5;

  const items = () => [...node.querySelectorAll<HTMLElement>(':scope > [role="listitem"]')];

  function measure() {
    rest = items().map((el) => {
      const r = el.getBoundingClientRect();
      return { el, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  }

  function move(e: PointerEvent) {
    if (!on || drag.active || reducedMotion()) return;
    if (!rest.length) measure();
    node.classList.remove('settling');
    for (const { el, x, y } of rest) {
      const d = Math.hypot(e.clientX - x, (e.clientY - y) * 1.5);
      const s = d >= REACH ? 1 : 1 + (GROW * (Math.cos((d / REACH) * Math.PI) + 1)) / 2;
      el.style.setProperty('--s', s.toFixed(3));
    }
  }

  function reset() {
    rest = [];
    node.classList.add('settling');
    for (const el of items()) el.style.removeProperty('--s');
  }

  node.addEventListener('pointermove', move);
  node.addEventListener('pointerleave', reset);
  node.addEventListener('pointercancel', reset); // fired when a drag takes over
  node.addEventListener('dragstart', reset);
  return {
    update(v) {
      on = v;
      if (!v) reset();
    },
    destroy() {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', reset);
      node.removeEventListener('pointercancel', reset);
      node.removeEventListener('dragstart', reset);
    },
  };
};
