import { App, Plugin, PluginManifest } from 'obsidian';

const OBSIDIAN_REST_API_PORT = 27123;
const JARVIS_STYLE_ID = 'jarvis-node-animations';

interface JarvisGestureEvent extends Event {
  detail: {
    gesture: string;
    pointerX?: number;
    pointerY?: number;
  };
}

interface GraphNode {
  el: Element;
  x: number;
  y: number;
}

function getGraphNodes(graphContainer: Element): GraphNode[] {
  const nodes: GraphNode[] = [];
  // Obsidian renders graph nodes as <circle> elements or as <div> with data attributes
  // Target both SVG circles and canvas-based node divs
  const circles = graphContainer.querySelectorAll('circle[data-id]');
  circles.forEach((el) => {
    const cx = parseFloat(el.getAttribute('cx') ?? '0');
    const cy = parseFloat(el.getAttribute('cy') ?? '0');
    nodes.push({ el, x: cx, y: cy });
  });
  // Fallback: any element with data-node-id
  if (nodes.length === 0) {
    graphContainer.querySelectorAll('[data-node-id]').forEach((el) => {
      const rect = el.getBoundingClientRect();
      nodes.push({ el, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    });
  }
  return nodes;
}

function findNearestNode(nodes: GraphNode[], px: number, py: number): GraphNode | null {
  if (nodes.length === 0) return null;
  let nearest = nodes[0];
  let minDist = Infinity;
  for (const node of nodes) {
    const d = Math.sqrt((node.x - px) ** 2 + (node.y - py) ** 2);
    if (d < minDist) {
      minDist = d;
      nearest = node;
    }
  }
  return nearest;
}

export default class JarvisPlugin extends Plugin {
  private canvas: HTMLCanvasElement | null = null;
  private gestureHandler: ((e: Event) => void) | null = null;
  private graphObserver: MutationObserver | null = null;
  private hoveredNode: Element | null = null;
  private hoverAttachedNodes: Set<Element> = new Set();

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }

  async onload() {
    console.log('[JARVIS] Plugin loaded');
    this.injectStyles();
    this.injectGraphOverlay();
    this.listenForGestures();
  }

  onunload() {
    this.removeGraphOverlay();
    this.removeStyles();
    if (this.gestureHandler) {
      document.removeEventListener('jarvis-gesture', this.gestureHandler);
      this.gestureHandler = null;
    }
    if (this.graphObserver) {
      this.graphObserver.disconnect();
      this.graphObserver = null;
    }
    // Clean up any lingering highlight/pulse classes
    this.hoverAttachedNodes.forEach((el) => {
      el.classList.remove('jarvis-hover-highlight', 'jarvis-pinch-pulse');
    });
    this.hoverAttachedNodes.clear();
    this.hoveredNode = null;
    console.log('[JARVIS] Plugin unloaded');
  }

  private injectStyles() {
    if (document.getElementById(JARVIS_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = JARVIS_STYLE_ID;
    style.textContent = `
      /* SVG circle node hover highlight */
      circle.jarvis-hover-highlight {
        stroke: rgba(100, 200, 255, 0.9) !important;
        stroke-width: 4 !important;
        filter: drop-shadow(0 0 6px rgba(100, 200, 255, 0.7));
        transition: stroke 0.15s ease, stroke-width 0.15s ease, filter 0.15s ease;
      }

      /* Div-based node hover highlight */
      [data-node-id].jarvis-hover-highlight {
        outline: 2px solid rgba(100, 200, 255, 0.9) !important;
        box-shadow: 0 0 10px rgba(100, 200, 255, 0.5) !important;
        transition: outline 0.15s ease, box-shadow 0.15s ease;
      }

      /* Pinch pulse keyframes for SVG circles */
      @keyframes jarvis-pulse-svg {
        0%   { stroke: rgba(100, 200, 255, 0.9); stroke-width: 4; }
        40%  { stroke: rgba(120, 255, 210, 1.0); stroke-width: 9; filter: drop-shadow(0 0 10px rgba(120, 255, 210, 0.8)); }
        100% { stroke: rgba(100, 200, 255, 0.4); stroke-width: 4; filter: none; }
      }

      circle.jarvis-pinch-pulse {
        animation: jarvis-pulse-svg 0.45s ease-out 2;
      }

      /* Pinch pulse keyframes for div nodes */
      @keyframes jarvis-pulse-div {
        0%   { box-shadow: 0 0 0 0   rgba(100, 200, 255, 0.9); }
        50%  { box-shadow: 0 0 0 14px rgba(100, 200, 255, 0.0); }
        100% { box-shadow: 0 0 0 0   rgba(100, 200, 255, 0.0); }
      }

      [data-node-id].jarvis-pinch-pulse {
        animation: jarvis-pulse-div 0.45s ease-out 2;
      }
    `;
    document.head.appendChild(style);
  }

  private removeStyles() {
    document.getElementById(JARVIS_STYLE_ID)?.remove();
  }

  private injectGraphOverlay() {
    const tryInject = () => {
      const graphContainer = document.querySelector('.graph-view-content, .graph-canvas');
      if (!graphContainer || graphContainer.querySelector('.jarvis-overlay')) return;

      const parentEl = graphContainer as HTMLElement;
      const style = getComputedStyle(parentEl);
      if (style.position === 'static') {
        parentEl.style.position = 'relative';
      }

      this.canvas = document.createElement('canvas');
      this.canvas.classList.add('jarvis-overlay');
      this.canvas.style.cssText = [
        'position:absolute',
        'top:0',
        'left:0',
        'width:100%',
        'height:100%',
        'pointer-events:none',
        'z-index:100',
      ].join(';');
      this.canvas.width = parentEl.clientWidth || 800;
      this.canvas.height = parentEl.clientHeight || 600;

      parentEl.appendChild(this.canvas);
      console.log('[JARVIS] Graph overlay injected');

      this.attachNodeHoverListeners(graphContainer);
    };

    // Try immediately and observe for graph view mounting
    tryInject();
    this.graphObserver = new MutationObserver(() => {
      tryInject();
      const graphContainer = document.querySelector('.graph-view-content, .graph-canvas');
      if (graphContainer) this.attachNodeHoverListeners(graphContainer);
    });
    this.graphObserver.observe(document.body, { childList: true, subtree: true });
  }

  private attachNodeHoverListeners(graphContainer: Element) {
    const attach = (el: Element) => {
      if (this.hoverAttachedNodes.has(el)) return;
      this.hoverAttachedNodes.add(el);
      el.addEventListener('mouseenter', () => this.onNodeHoverEnter(el));
      el.addEventListener('mouseleave', () => this.onNodeHoverLeave(el));
    };

    graphContainer.querySelectorAll('circle[data-id]').forEach(attach);
    graphContainer.querySelectorAll('[data-node-id]').forEach(attach);
  }

  private onNodeHoverEnter(el: Element) {
    if (this.hoveredNode && this.hoveredNode !== el) {
      this.hoveredNode.classList.remove('jarvis-hover-highlight');
    }
    this.hoveredNode = el;
    el.classList.add('jarvis-hover-highlight');
  }

  private onNodeHoverLeave(el: Element) {
    el.classList.remove('jarvis-hover-highlight');
    if (this.hoveredNode === el) {
      this.hoveredNode = null;
    }
  }

  private removeGraphOverlay() {
    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.canvas = null;
  }

  private listenForGestures() {
    this.gestureHandler = (rawEvent: Event) => {
      const e = rawEvent as JarvisGestureEvent;
      if (e.detail?.gesture !== 'PINCH') return;
      this.handlePinchSelect(e.detail.pointerX ?? 0, e.detail.pointerY ?? 0);
    };
    document.addEventListener('jarvis-gesture', this.gestureHandler);
  }

  private handlePinchSelect(px: number, py: number) {
    const graphContainer = document.querySelector('.graph-view-content, .graph-canvas');
    if (!graphContainer) return;

    const nodes = getGraphNodes(graphContainer);
    const nearest = findNearestNode(nodes, px, py);
    if (!nearest) return;

    // Fire a click on the nearest node element to trigger Obsidian's selection
    nearest.el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    console.log('[JARVIS] PINCH selected node:', nearest.el.getAttribute('data-id') ?? 'unknown');

    // Trigger CSS pulse animation on the node element
    nearest.el.classList.remove('jarvis-pinch-pulse');
    // Force reflow so re-adding the class restarts the animation
    void (nearest.el as HTMLElement).offsetWidth;
    nearest.el.classList.add('jarvis-pinch-pulse');
    nearest.el.addEventListener(
      'animationend',
      () => nearest.el.classList.remove('jarvis-pinch-pulse'),
      { once: true },
    );

    // Briefly clear any canvas overlay state to keep it non-disruptive
    if (this.canvas) {
      const ctx = this.canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }
  }

  async readNote(path: string): Promise<string> {
    const resp = await fetch(`http://localhost:${OBSIDIAN_REST_API_PORT}/vault/${encodeURIComponent(path)}`, {
      headers: { 'Authorization': 'Bearer local' },
    });
    if (!resp.ok) throw new Error(`REST API error: ${resp.status}`);
    return resp.text();
  }

  async writeNote(path: string, content: string): Promise<void> {
    const resp = await fetch(`http://localhost:${OBSIDIAN_REST_API_PORT}/vault/${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer local',
        'Content-Type': 'text/markdown',
      },
      body: content,
    });
    if (!resp.ok) throw new Error(`REST API write error: ${resp.status}`);
  }
}
