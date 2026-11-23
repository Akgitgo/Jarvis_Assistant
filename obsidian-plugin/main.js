var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => JarvisPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var OBSIDIAN_REST_API_PORT = 27123;
var JARVIS_STYLE_ID = "jarvis-node-animations";
function getGraphNodes(graphContainer) {
  const nodes = [];
  const circles = graphContainer.querySelectorAll("circle[data-id]");
  circles.forEach((el) => {
    var _a, _b;
    const cx = parseFloat((_a = el.getAttribute("cx")) != null ? _a : "0");
    const cy = parseFloat((_b = el.getAttribute("cy")) != null ? _b : "0");
    nodes.push({ el, x: cx, y: cy });
  });
  if (nodes.length === 0) {
    graphContainer.querySelectorAll("[data-node-id]").forEach((el) => {
      const rect = el.getBoundingClientRect();
      nodes.push({ el, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    });
  }
  return nodes;
}
function findNearestNode(nodes, px, py) {
  if (nodes.length === 0)
    return null;
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
var JarvisPlugin = class extends import_obsidian.Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    this.canvas = null;
    this.gestureHandler = null;
    this.graphObserver = null;
    this.hoveredNode = null;
    this.hoverAttachedNodes = /* @__PURE__ */ new Set();
  }
  async onload() {
    console.log("[JARVIS] Plugin loaded");
    this.injectStyles();
    this.injectGraphOverlay();
    this.listenForGestures();
  }
  onunload() {
    this.removeGraphOverlay();
    this.removeStyles();
    if (this.gestureHandler) {
      document.removeEventListener("jarvis-gesture", this.gestureHandler);
      this.gestureHandler = null;
    }
    if (this.graphObserver) {
      this.graphObserver.disconnect();
      this.graphObserver = null;
    }
    this.hoverAttachedNodes.forEach((el) => {
      el.classList.remove("jarvis-hover-highlight", "jarvis-pinch-pulse");
    });
    this.hoverAttachedNodes.clear();
    this.hoveredNode = null;
    console.log("[JARVIS] Plugin unloaded");
  }
  injectStyles() {
    if (document.getElementById(JARVIS_STYLE_ID))
      return;
    const style = document.createElement("style");
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
  removeStyles() {
    var _a;
    (_a = document.getElementById(JARVIS_STYLE_ID)) == null ? void 0 : _a.remove();
  }
  injectGraphOverlay() {
    const tryInject = () => {
      const graphContainer = document.querySelector(".graph-view-content, .graph-canvas");
      if (!graphContainer || graphContainer.querySelector(".jarvis-overlay"))
        return;
      const parentEl = graphContainer;
      const style = getComputedStyle(parentEl);
      if (style.position === "static") {
        parentEl.style.position = "relative";
      }
      this.canvas = document.createElement("canvas");
      this.canvas.classList.add("jarvis-overlay");
      this.canvas.style.cssText = [
        "position:absolute",
        "top:0",
        "left:0",
        "width:100%",
        "height:100%",
        "pointer-events:none",
        "z-index:100"
      ].join(";");
      this.canvas.width = parentEl.clientWidth || 800;
      this.canvas.height = parentEl.clientHeight || 600;
      parentEl.appendChild(this.canvas);
      console.log("[JARVIS] Graph overlay injected");
      this.attachNodeHoverListeners(graphContainer);
    };
    tryInject();
    this.graphObserver = new MutationObserver(() => {
      tryInject();
      const graphContainer = document.querySelector(".graph-view-content, .graph-canvas");
      if (graphContainer)
        this.attachNodeHoverListeners(graphContainer);
    });
    this.graphObserver.observe(document.body, { childList: true, subtree: true });
  }
  attachNodeHoverListeners(graphContainer) {
    const attach = (el) => {
      if (this.hoverAttachedNodes.has(el))
        return;
      this.hoverAttachedNodes.add(el);
      el.addEventListener("mouseenter", () => this.onNodeHoverEnter(el));
      el.addEventListener("mouseleave", () => this.onNodeHoverLeave(el));
    };
    graphContainer.querySelectorAll("circle[data-id]").forEach(attach);
    graphContainer.querySelectorAll("[data-node-id]").forEach(attach);
  }
  onNodeHoverEnter(el) {
    if (this.hoveredNode && this.hoveredNode !== el) {
      this.hoveredNode.classList.remove("jarvis-hover-highlight");
    }
    this.hoveredNode = el;
    el.classList.add("jarvis-hover-highlight");
  }
  onNodeHoverLeave(el) {
    el.classList.remove("jarvis-hover-highlight");
    if (this.hoveredNode === el) {
      this.hoveredNode = null;
    }
  }
  removeGraphOverlay() {
    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.canvas = null;
  }
  listenForGestures() {
    this.gestureHandler = (rawEvent) => {
      var _a, _b, _c;
      const e = rawEvent;
      if (((_a = e.detail) == null ? void 0 : _a.gesture) !== "PINCH")
        return;
      this.handlePinchSelect((_b = e.detail.pointerX) != null ? _b : 0, (_c = e.detail.pointerY) != null ? _c : 0);
    };
    document.addEventListener("jarvis-gesture", this.gestureHandler);
  }
  handlePinchSelect(px, py) {
    var _a;
    const graphContainer = document.querySelector(".graph-view-content, .graph-canvas");
    if (!graphContainer)
      return;
    const nodes = getGraphNodes(graphContainer);
    const nearest = findNearestNode(nodes, px, py);
    if (!nearest)
      return;
    nearest.el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    console.log("[JARVIS] PINCH selected node:", (_a = nearest.el.getAttribute("data-id")) != null ? _a : "unknown");
    nearest.el.classList.remove("jarvis-pinch-pulse");
    void nearest.el.offsetWidth;
    nearest.el.classList.add("jarvis-pinch-pulse");
    nearest.el.addEventListener(
      "animationend",
      () => nearest.el.classList.remove("jarvis-pinch-pulse"),
      { once: true }
    );
    if (this.canvas) {
      const ctx = this.canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }
  }
  async readNote(path) {
    const resp = await fetch(`http://localhost:${OBSIDIAN_REST_API_PORT}/vault/${encodeURIComponent(path)}`, {
      headers: { "Authorization": "Bearer local" }
    });
    if (!resp.ok)
      throw new Error(`REST API error: ${resp.status}`);
    return resp.text();
  }
  async writeNote(path, content) {
    const resp = await fetch(`http://localhost:${OBSIDIAN_REST_API_PORT}/vault/${encodeURIComponent(path)}`, {
      method: "PUT",
      headers: {
        "Authorization": "Bearer local",
        "Content-Type": "text/markdown"
      },
      body: content
    });
    if (!resp.ok)
      throw new Error(`REST API write error: ${resp.status}`);
  }
};
