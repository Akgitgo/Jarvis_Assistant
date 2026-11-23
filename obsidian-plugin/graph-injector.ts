/**
 * graph-injector.ts — JARVIS Obsidian graph view injector
 *
 * Listens for JARVIS gesture events and applies visual effects to the
 * Obsidian graph view (highlight nodes, trigger animations).
 */

import { App } from 'obsidian';

const JARVIS_STYLE_ID = 'jarvis-graph-injector-styles';

interface JarvisGestureEvent extends Event {
  detail: {
    gesture: string;
    pointerX?: number;
    pointerY?: number;
  };
}

function injectStyles(): void {
  if (document.getElementById(JARVIS_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = JARVIS_STYLE_ID;
  style.textContent = `
    .jarvis-node-highlight circle {
      filter: drop-shadow(0 0 6px #06b6d4);
      transition: filter 0.3s ease;
    }
  `;
  document.head.appendChild(style);
}

function removeStyles(): void {
  document.getElementById(JARVIS_STYLE_ID)?.remove();
}

function getGraphContainer(): Element | null {
  return (
    document.querySelector('.graph-view-content') ??
    document.querySelector('.view-content .graph-view')
  );
}

function highlightNearest(px: number, py: number): void {
  const container = getGraphContainer();
  if (!container) return;

  const nodes = Array.from(container.querySelectorAll('circle[data-id], [data-node-id]'));
  if (nodes.length === 0) return;

  let nearest: Element | null = null;
  let minDist = Infinity;

  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const d = Math.hypot(cx - px, cy - py);
    if (d < minDist) {
      minDist = d;
      nearest = node;
    }
  }

  nodes.forEach((n) => n.classList.remove('jarvis-node-highlight'));
  nearest?.classList.add('jarvis-node-highlight');
}

function handleGestureEvent(event: Event): void {
  const { gesture, pointerX = 0, pointerY = 0 } = (event as JarvisGestureEvent).detail;

  if (gesture === 'POINT') {
    highlightNearest(pointerX, pointerY);
  } else if (gesture === 'OPEN_PALM') {
    const container = getGraphContainer();
    container?.querySelectorAll('.jarvis-node-highlight').forEach((n) =>
      n.classList.remove('jarvis-node-highlight')
    );
  }
}

export function activateGraphInjector(_app: App): () => void {
  injectStyles();
  window.addEventListener('jarvis-gesture', handleGestureEvent);

  return () => {
    window.removeEventListener('jarvis-gesture', handleGestureEvent);
    removeStyles();
  };
}
