const cache = /* @__PURE__ */ new WeakMap();
const newline = /(\n|\r\n?|\u2028|\u2029)/g;
const leadingWhitespace = /^\s*/;
const nonWhitespace = /\S/;
const slice = Array.prototype.slice;
const zero = "0".charCodeAt(0);
const nine = "9".charCodeAt(0);
const lowerA = "a".charCodeAt(0);
const lowerF = "f".charCodeAt(0);
const upperA = "A".charCodeAt(0);
const upperF = "F".charCodeAt(0);
function dedent(arg) {
  if (typeof arg === "string") {
    return process([arg])[0];
  }
  if (typeof arg === "function") {
    return function() {
      const args = slice.call(arguments);
      args[0] = processTemplateStringsArray(args[0]);
      return arg.apply(this, args);
    };
  }
  const strings = processTemplateStringsArray(arg);
  let s = getCooked(strings, 0);
  for (let i = 1; i < strings.length; i++) {
    s += arguments[i] + getCooked(strings, i);
  }
  return s;
}
function getCooked(strings, index) {
  const str = strings[index];
  if (str === void 0)
    throw new TypeError(`invalid cooked string at index ${index}`);
  return str;
}
function processTemplateStringsArray(strings) {
  const cached = cache.get(strings);
  if (cached)
    return cached;
  const raw = process(strings.raw);
  const cooked = raw.map(cook);
  Object.defineProperty(cooked, "raw", {
    value: Object.freeze(raw)
  });
  Object.freeze(cooked);
  cache.set(strings, cooked);
  return cooked;
}
function process(strings) {
  const splitQuasis = strings.map((quasi) => quasi.split(newline));
  let common;
  for (let i = 0; i < splitQuasis.length; i++) {
    const lines = splitQuasis[i];
    const firstSplit = i === 0;
    const lastSplit = i + 1 === splitQuasis.length;
    if (firstSplit) {
      if (lines.length === 1 || lines[0].length > 0) {
        throw new Error("invalid content on opening line");
      }
      lines[1] = "";
    }
    if (lastSplit) {
      if (lines.length === 1 || nonWhitespace.test(lines[lines.length - 1])) {
        throw new Error("invalid content on closing line");
      }
      lines[lines.length - 2] = "";
      lines[lines.length - 1] = "";
    }
    for (let j = 2; j < lines.length; j += 2) {
      const text = lines[j];
      const lineContainsTemplateExpression = j + 1 === lines.length && !lastSplit;
      const leading = leadingWhitespace.exec(text)[0];
      if (!lineContainsTemplateExpression && leading.length === text.length) {
        lines[j] = "";
        continue;
      }
      common = commonStart(leading, common);
    }
  }
  const min = common ? common.length : 0;
  return splitQuasis.map((lines) => {
    let quasi = lines[0];
    for (let i = 1; i < lines.length; i += 2) {
      const newline2 = lines[i];
      const text = lines[i + 1];
      quasi += newline2 + text.slice(min);
    }
    return quasi;
  });
}
function commonStart(a, b) {
  if (b === void 0 || a === b)
    return a;
  let i = 0;
  for (const len = Math.min(a.length, b.length); i < len; i++) {
    if (a[i] !== b[i])
      break;
  }
  return a.slice(0, i);
}
function cook(raw) {
  let out = "";
  let start = 0;
  let i = 0;
  while ((i = raw.indexOf("\\", i)) > -1) {
    out += raw.slice(start, i);
    if (++i === raw.length)
      return void 0;
    const next = raw[i++];
    switch (next) {
      // Escaped control codes need to be individually processed.
      case "b":
        out += "\b";
        break;
      case "t":
        out += "	";
        break;
      case "n":
        out += "\n";
        break;
      case "v":
        out += "\v";
        break;
      case "f":
        out += "\f";
        break;
      case "r":
        out += "\r";
        break;
      // Escaped line terminators just skip the char.
      case "\r":
        if (i < raw.length && raw[i] === "\n")
          ++i;
      // fall through
      case "\n":
      case "\u2028":
      case "\u2029":
        break;
      // `\0` is a null control char, but `\0` followed by another digit is an illegal octal escape.
      case "0":
        if (isDigit(raw, i))
          return void 0;
        out += "\0";
        break;
      // Hex escapes must contain 2 hex chars.
      case "x": {
        const n = parseHex(raw, i, i + 2);
        if (n === -1)
          return void 0;
        i += 2;
        out += String.fromCharCode(n);
        break;
      }
      // Unicode escapes contain either 4 chars, or an unlimited number between `{` and `}`.
      // The hex value must not overflow 0x10ffff.
      case "u": {
        let n;
        if (i < raw.length && raw[i] === "{") {
          const end = raw.indexOf("}", ++i);
          if (end === -1)
            return void 0;
          n = parseHex(raw, i, end);
          i = end + 1;
        } else {
          n = parseHex(raw, i, i + 4);
          i += 4;
        }
        if (n === -1 || n > 1114111)
          return void 0;
        out += String.fromCodePoint(n);
        break;
      }
      default:
        if (isDigit(next, 0))
          return void 0;
        out += next;
    }
    start = i;
  }
  return out + raw.slice(start);
}
function isDigit(str, index) {
  const c = str.charCodeAt(index);
  return c >= zero && c <= nine;
}
function parseHex(str, index, end) {
  if (end >= str.length)
    return -1;
  let n = 0;
  for (; index < end; index++) {
    const c = hexToInt(str.charCodeAt(index));
    if (c === -1)
      return -1;
    n = n * 16 + c;
  }
  return n;
}
function hexToInt(c) {
  if (c >= zero && c <= nine)
    return c - zero;
  if (c >= lowerA && c <= lowerF)
    return c - lowerA + 10;
  if (c >= upperA && c <= upperF)
    return c - upperA + 10;
  return -1;
}
const createStoreImpl = (createState) => {
  let state;
  const listeners = /* @__PURE__ */ new Set();
  const setState = (partial, replace) => {
    const nextState = typeof partial === "function" ? partial(state) : partial;
    if (!Object.is(nextState, state)) {
      const previousState = state;
      state = (replace != null ? replace : typeof nextState !== "object" || nextState === null) ? nextState : Object.assign({}, state, nextState);
      listeners.forEach((listener) => listener(state, previousState));
    }
  };
  const getState = () => state;
  const getInitialState = () => initialState;
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const api = { setState, getState, getInitialState, subscribe };
  const initialState = state = createState(setState, getState, api);
  return api;
};
const createStore = ((createState) => createState ? createStoreImpl(createState) : createStoreImpl);
function initPlaywriterToolbar() {
  if (window.__playwriterToolbarInstalled) return;
  window.__playwriterToolbarInstalled = true;
  try {
    if (window !== window.top) return;
  } catch {
    return;
  }
  let pinModeActive = false;
  let toastTimer = null;
  let overlayEl = null;
  let pinMoveRaf = 0;
  let pinMoveEvent = null;
  let isRecording = false;
  let startInFlight = false;
  let pendingStop = false;
  let pinBtn;
  let accumulatedPins = [];
  const host = document.createElement("div");
  host.setAttribute("data-playwriter-toolbar", "1");
  host.style.cssText = `all:initial;position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;opacity:1;visibility:visible;display:block;filter:none;font-size:0;line-height:0;contain:layout style;`;
  const shadow = host.attachShadow({ mode: "closed" });
  const styleEl = document.createElement("style");
  styleEl.textContent = `
    *,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }
    .stack {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      pointer-events: none;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 2px 4px;
      background: #393B44;
      border: 1px solid rgba(255,255,255,0.1);
      border-top: none;
      border-radius: 0 0 8px 8px;
      pointer-events: all;
      user-select: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      contain: layout style;
      opacity: 1;
      transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1);
      @starting-style {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .toolbar {
        transition: none;
      }
    }
    /* Collapsed state (default): a small tab flush with the top edge, like react-scan.
       Clicking it expands the toolbar; the toolbar x button collapses it again. */
    .tab {
      display: none;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 14px;
      border: 1px solid rgba(255,255,255,0.1);
      border-top: none;
      border-radius: 0 0 6px 6px;
      background: #393B44;
      color: rgba(161,161,170,1);
      cursor: pointer;
      pointer-events: all;
      padding: 0;
      outline: none;
      opacity: 1;
      transition: color 0.15s, opacity 200ms cubic-bezier(0.23, 1, 0.32, 1);
      @starting-style {
        opacity: 0;
      }
    }
    .tab svg {
      width: 9px;
      height: 9px;
    }
    .tab:hover {
      color: rgba(228,228,231,1);
    }
    .stack.collapsed .tab {
      display: flex;
    }
    .stack.collapsed .toolbar,
    .stack.collapsed .remote-panel {
      display: none;
    }
    @media (prefers-reduced-motion: reduce) {
      .tab {
        transition: none;
      }
    }
    .separator {
      width: 1px;
      height: 15px;
      background: rgba(255,255,255,0.15);
      margin: 0 2px;
      flex-shrink: 0;
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: rgba(161,161,170,1);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      padding: 0;
      flex-shrink: 0;
      outline: none;
    }
    .btn.labeled {
      width: auto;
      padding: 0 7px;
      font-size: 12px;
      font-weight: 500;
      font-family: inherit;
      white-space: nowrap;
    }
    .btn:hover {
      background: rgba(255,255,255,0.08);
      color: rgba(228,228,231,1);
    }
    .btn.active {
      background: rgba(255,255,255,0.12);
      color: #fff;
    }
    .btn.active:hover {
      background: rgba(255,255,255,0.18);
    }
    .record-btn {
      display: flex;
      align-items: center;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: rgba(161,161,170,1);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      padding: 3px 8px;
      font-size: 12px;
      font-weight: 500;
      outline: none;
      white-space: nowrap;
      font-family: inherit;
    }
    .record-btn:hover {
      background: rgba(255,255,255,0.08);
      color: rgba(228,228,231,1);
    }
    .record-btn.active {
      color: rgba(161,161,170,1);
    }
    .record-btn.active:hover {
      background: rgba(255,255,255,0.08);
      color: rgba(228,228,231,1);
    }
    .record-btn.loading {
      cursor: progress;
    }
    .remote-btn svg {
      color: #7dd3fc;
    }
    .remote-btn.remote-active {
      color: #7dd3fc;
      background: rgba(125,211,252,0.10);
    }
    .remote-btn.remote-active:hover {
      background: rgba(125,211,252,0.18);
      color: #bae6fd;
    }
    .toolbar .label {
      display: block;
      margin-left: 5px;
      white-space: nowrap;
    }
    .remote-btn .chevron {
      margin-left: 4px;
      width: 10px;
      height: 10px;
      opacity: 0.75;
      flex-shrink: 0;
    }
    .remote-btn.menu-open .chevron {
      transform: rotate(180deg);
    }
    .remote-panel {
      display: none;
      flex-direction: column;
      gap: 2px;
      margin-top: 6px;
      padding: 4px;
      background: #393B44;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      pointer-events: all;
      box-shadow: 0 12px 60px rgba(0,0,0,0.6), 0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,0,0,0.15);
      min-width: 168px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .remote-panel.open {
      display: flex;
    }
    /* The Playwright fork sets data-playwriter-agent on the host before each
       hit-target check (injectedScript.ts), so agent clicks pass through. */
    :host([data-playwriter-agent]) .toolbar,
    :host([data-playwriter-agent]) .tab,
    :host([data-playwriter-agent]) .remote-panel {
      pointer-events: none;
    }
    .remote-panel button {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      border: none;
      background: transparent;
      color: rgba(228,228,231,1);
      text-align: left;
      padding: 6px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
    }
    .remote-panel button:hover {
      background: rgba(255,255,255,0.08);
    }
    .remote-panel button svg {
      flex-shrink: 0;
      color: rgba(161,161,170,1);
    }
    .remote-panel button.danger svg {
      color: #f87171;
    }
    .remote-panel p {
      color: rgba(212,212,216,1);
      font-size: 11px;
      line-height: 1.4;
      padding: 6px 8px 2px;
      max-width: 240px;
    }
    .remote-panel a {
      color: #7dd3fc;
      font-size: inherit;
      padding: 0;
      text-decoration: none;
    }
    .remote-panel a:hover {
      text-decoration: underline;
    }
    .remote-panel-actions {
      display: flex;
      gap: 4px;
      padding: 4px;
    }
    .remote-panel-actions button {
      flex: 1;
      width: auto;
      justify-content: center;
      text-align: center;
    }
    .remote-panel-actions button.primary {
      background: rgba(125,211,252,0.16);
      color: #7dd3fc;
    }
    .remote-panel-actions button.primary:hover {
      background: rgba(125,211,252,0.24);
    }
    .record-btn .spinner {
      display: block;
      width: 12px;
      height: 12px;
      animation: record-spin 0.7s linear infinite;
    }
    @keyframes record-spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .record-btn .spinner {
        animation: none;
      }
    }
    [data-tooltip] {
      position: relative;
    }
    [data-tooltip]::after {
      content: attr(data-tooltip);
      position: absolute;
      top: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      padding: 5px 10px;
      background: #393B44;
      border: 1px solid rgba(255,255,255,0.1);
      color: rgba(228,228,231,1);
      font-size: 11px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      white-space: nowrap;
      border-radius: 6px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      box-shadow: 0 12px 60px rgba(0,0,0,0.6), 0 4px 20px rgba(0,0,0,0.4);
    }
    [data-tooltip]:hover::after {
      opacity: 1;
      transition: opacity 0.15s ease 0.3s;
    }
    .tooltips-disabled [data-tooltip]:hover::after {
      opacity: 0;
      transition: none;
    }
  `;
  const toolbarEl = document.createElement("div");
  toolbarEl.className = "toolbar";
  toolbarEl.setAttribute("role", "toolbar");
  toolbarEl.setAttribute("aria-label", "Playwriter tools");
  const stack = document.createElement("div");
  stack.className = "stack collapsed";
  shadow.appendChild(styleEl);
  shadow.appendChild(stack);
  stack.appendChild(toolbarEl);
  const toastHost = document.createElement("div");
  toastHost.setAttribute("data-playwriter-toolbar", "1");
  toastHost.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;opacity:1;visibility:visible;display:block;filter:none;";
  const toastShadow = toastHost.attachShadow({ mode: "closed" });
  const toastStyle = document.createElement("style");
  toastStyle.textContent = `
    .toast {
      position: absolute;
      background: #393B44;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 9999px;
      padding: 6px 14px;
      color: rgba(228,228,231,1);
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 12px 60px rgba(0,0,0,0.6), 0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,0,0,0.15);
      white-space: nowrap;
      animation: toast-in 0.15s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `;
  toastShadow.appendChild(toastStyle);
  function showToast(msg, anchor) {
    toastShadow.querySelectorAll(".toast").forEach((el) => {
      el.remove();
    });
    if (toastTimer !== null) clearTimeout(toastTimer);
    const toastEl = document.createElement("div");
    toastEl.className = "toast";
    toastEl.textContent = msg;
    const GAP = 10;
    const bar = host.getBoundingClientRect();
    const x = anchor ? Math.max(8, Math.min(anchor.clientX, window.innerWidth - 8)) : bar.left + bar.width / 2;
    const belowY = anchor ? anchor.rect.bottom + GAP : bar.bottom + GAP;
    const aboveY = anchor ? anchor.rect.top - GAP : bar.top - GAP;
    const fitsBelow = belowY + 36 < window.innerHeight;
    toastEl.style.left = x + "px";
    toastEl.style.top = (fitsBelow ? belowY : aboveY) + "px";
    toastEl.style.transform = fitsBelow ? "translateX(-50%)" : "translateX(-50%) translateY(-100%)";
    toastShadow.appendChild(toastEl);
    toastTimer = window.setTimeout(() => {
      toastEl.remove();
    }, 1900);
  }
  function getOverlay() {
    if (!overlayEl) {
      const EDGE = "color-mix(in oklch, oklch(0.62 0.18 255) 80%, transparent)";
      const FILL = "color-mix(in oklch, oklch(0.62 0.18 255) 8%, transparent)";
      const container = document.createElement("div");
      container.setAttribute("data-playwriter-overlay", "1");
      container.style.cssText = [
        "position:fixed",
        "pointer-events:none",
        "z-index:2147483646",
        `background:${FILL}`,
        "visibility:hidden",
        "contain:layout style paint"
      ].join(";");
      const edgeTop = document.createElement("div");
      edgeTop.style.cssText = `position:absolute;top:0;left:0;width:100%;height:1px;background:${EDGE};`;
      const edgeRight = document.createElement("div");
      edgeRight.style.cssText = `position:absolute;top:0;right:0;width:1px;height:100%;background:${EDGE};`;
      const edgeBottom = document.createElement("div");
      edgeBottom.style.cssText = `position:absolute;bottom:0;left:0;width:100%;height:1px;background:${EDGE};`;
      const edgeLeft = document.createElement("div");
      edgeLeft.style.cssText = `position:absolute;top:0;left:0;width:1px;height:100%;background:${EDGE};`;
      container.appendChild(edgeTop);
      container.appendChild(edgeRight);
      container.appendChild(edgeBottom);
      container.appendChild(edgeLeft);
      document.documentElement.appendChild(container);
      overlayEl = container;
    }
    return overlayEl;
  }
  function positionOverlay(target) {
    const rect = target.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const overlay = getOverlay();
    overlay.style.visibility = "visible";
    overlay.style.top = rect.top + "px";
    overlay.style.left = rect.left + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
  }
  function hideOverlay() {
    if (overlayEl) overlayEl.style.visibility = "hidden";
  }
  function cancelPinMove() {
    if (pinMoveRaf) {
      cancelAnimationFrame(pinMoveRaf);
      pinMoveRaf = 0;
    }
    pinMoveEvent = null;
  }
  function removeOverlay() {
    cancelPinMove();
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }
  function getTargetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || el === host || el === document.documentElement || el === document.body) {
      return null;
    }
    if (el.hasAttribute("data-playwriter-overlay") || el.hasAttribute("data-playwriter-toolbar")) {
      return null;
    }
    return el;
  }
  function isOverToolbar(e) {
    return e.composedPath().some((node) => node === host);
  }
  function isTrustedToolbarClick(e) {
    if (!e.isTrusted || !navigator.userActivation.isActive) {
      return false;
    }
    const style = getComputedStyle(host);
    const restyled = style.display === "none" || style.visibility !== "visible" || Number(style.opacity) < 0.9 || style.filter !== "none" || style.backdropFilter !== "none";
    const rect = host.getBoundingClientRect();
    const expectedCenterX = window.innerWidth / 2;
    const moved = Math.abs(rect.left + rect.width / 2 - expectedCenterX) >= Math.max(2, expectedCenterX * 0.25) || Math.abs(rect.top) >= 2;
    if (restyled || moved || document.elementFromPoint(e.clientX, e.clientY) !== host) {
      showToast("Blocked: this page is restyling the Playwriter toolbar");
      return false;
    }
    return true;
  }
  function flashElement(el, persistent = false) {
    const s = el.style;
    const prevOutline = s?.outline || "";
    const prevOffset = s?.outlineOffset || "";
    if (!s) return { prevOutline, prevOffset };
    s.outline = "1px solid #22c55e";
    s.outlineOffset = "2px";
    if (!persistent) {
      window.setTimeout(() => {
        s.outline = prevOutline;
        s.outlineOffset = prevOffset;
      }, 350);
    }
    return { prevOutline, prevOffset };
  }
  function clearAccumulatedOutlines() {
    for (const pin of accumulatedPins) {
      const s = pin.element.style;
      if (!s) continue;
      s.outline = pin.prevOutline;
      s.outlineOffset = pin.prevOffset;
    }
    accumulatedPins = [];
  }
  function copyText(text) {
    void chrome.runtime.sendMessage({ action: "copyToolbarText", text });
  }
  async function pinTarget(target) {
    const markerBytes = new Uint8Array(16);
    crypto.getRandomValues(markerBytes);
    const marker = Array.from(markerBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    target.setAttribute("data-playwriter-pin-target", marker);
    try {
      const result = await chrome.runtime.sendMessage({
        action: "pinToolbarElement",
        marker
      });
      return result?.pinNumber || null;
    } catch {
      return null;
    } finally {
      if (target.getAttribute("data-playwriter-pin-target") === marker) {
        target.removeAttribute("data-playwriter-pin-target");
      }
    }
  }
  function onMouseMove(e) {
    pinMoveEvent = e;
    if (pinMoveRaf) return;
    pinMoveRaf = requestAnimationFrame(() => {
      pinMoveRaf = 0;
      const ev = pinMoveEvent;
      if (!ev) return;
      if (isOverToolbar(ev)) {
        hideOverlay();
        return;
      }
      const target = getTargetAt(ev.clientX, ev.clientY);
      if (target) positionOverlay(target);
      else hideOverlay();
    });
  }
  function buildInspectionCode(n, url) {
    const URL_LIT = JSON.stringify(url).replace(/'/g, "\\u0027");
    return `inspectPinnedElement(${URL_LIT},"globalThis.playwriterPinnedElem${n}")`;
  }
  async function onClick(e) {
    if (!e.isTrusted) return;
    if (isOverToolbar(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = getTargetAt(e.clientX, e.clientY);
    if (!target) return;
    const n = await pinTarget(target);
    if (!pinModeActive) return;
    if (!n) {
      showToast("Could not pin element");
      return;
    }
    playSound2("success");
    const url = location.href;
    if (e.shiftKey) {
      const alreadyPinned = accumulatedPins.some((p) => p.element === target);
      if (!alreadyPinned) {
        const saved = flashElement(target, true);
        accumulatedPins.push({ n, element: target, ...saved });
      }
      const clipboardText = accumulatedPins.map((p) => {
        return "playwriter -e '" + buildInspectionCode(p.n, url) + "'";
      }).join(",\n");
      copyText(clipboardText);
      showToast(`Copied ${accumulatedPins.length} locators`, {
        rect: target.getBoundingClientRect(),
        clientX: e.clientX
      });
    } else {
      const rect = target.getBoundingClientRect();
      const alreadyPinned = accumulatedPins.some((p) => p.element === target);
      const allPins = alreadyPinned ? accumulatedPins : [...accumulatedPins, { n, element: target, prevOutline: "", prevOffset: "" }];
      clearAccumulatedOutlines();
      flashElement(target);
      if (allPins.length > 1) {
        const clipboardText = allPins.map((p) => {
          return "playwriter -e '" + buildInspectionCode(p.n, url) + "'";
        }).join(",\n");
        copyText(clipboardText);
        showToast(`Copied ${allPins.length} locators`, { rect, clientX: e.clientX });
      } else {
        const code = buildInspectionCode(n, url);
        const clipboardText = "playwriter -e '" + code + "'";
        copyText(clipboardText);
        showToast("Copied locator", { rect, clientX: e.clientX });
      }
      setPinMode(false);
    }
  }
  function onMouseDown(e) {
    if (isOverToolbar(e)) return;
    e.preventDefault();
  }
  function onKeyDown(e) {
    if (e.key === "Escape") setPinMode(false);
  }
  function setPinMode(on) {
    pinModeActive = on;
    pinBtn.classList.toggle("active", on);
    if (on) {
      accumulatedPins = [];
      document.documentElement.style.cursor = "crosshair";
      getOverlay();
      document.addEventListener("mousedown", onMouseDown, true);
      document.addEventListener("mousemove", onMouseMove, { capture: true, passive: true });
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKeyDown, true);
    } else {
      cancelPinMove();
      clearAccumulatedOutlines();
      document.documentElement.style.cursor = "";
      hideOverlay();
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
    }
  }
  const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 424 424" aria-hidden="true"><path fill-rule="evenodd" d="M 0 212 C 0 112.063 0 62.095 31.037 31.037 C 62.116 0 112.063 0 212 0 C 311.937 0 361.905 0 392.942 31.037 C 424 62.116 424 112.063 424 212 C 424 311.937 424 361.905 392.942 392.942 C 361.926 424 311.937 424 212 424 C 112.063 424 62.095 424 31.037 392.942 C 0 361.926 0 311.937 0 212 Z M 225.732 260.521 L 277.905 312.673 C 283.311 318.1 286.003 320.793 289.014 322.043 C 293.042 323.718 297.557 323.718 301.585 322.043 C 304.596 320.793 307.309 318.1 312.694 312.694 C 318.1 307.288 320.793 304.596 322.043 301.585 C 323.722 297.563 323.722 293.036 322.043 289.014 C 320.793 286.003 318.1 283.29 312.694 277.905 L 260.521 225.732 L 276.442 209.789 C 292.766 193.465 300.907 185.325 298.999 176.548 C 297.07 167.792 286.237 163.785 264.591 155.814 L 192.384 129.208 C 149.2 113.308 127.618 105.358 116.488 116.488 C 105.358 127.618 113.308 149.2 129.208 192.384 L 155.814 264.591 C 163.785 286.237 167.792 297.07 176.548 298.999 C 185.303 300.928 193.465 292.766 209.789 276.442 Z" fill="currentColor"/></svg>`;
  const CLOSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const RECORD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="#ef4444"/></svg>`;
  const STOP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="#ef4444"/></svg>`;
  const CLOUD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`;
  const CHEVRON_SVG = `<svg class="chevron" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
  const CLIPBOARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>`;
  const HASH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/></svg>`;
  const CLOUD_OFF_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 2 20 20"/><path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"/><path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.01 7.01 0 0 0 10 5.07"/></svg>`;
  const SPINNER_SVG = `<svg class="spinner" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2.5" stroke-opacity="0.25"/><path d="M20 12a8 8 0 0 0-8-8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;
  let audioCtx = null;
  const SOUND_RECIPES = {
    // Three-note ascending confirmation (copy to clipboard)
    success: {
      masterGain: 0.5,
      layers: [
        { kind: "tone", waveform: "sine", frequency: 880, attack: 4e-3, decay: 0.09, peak: 0.06 },
        { kind: "tone", waveform: "sine", frequency: 1108.73, offset: 0.06, attack: 4e-3, decay: 0.1, peak: 0.06 },
        { kind: "tone", waveform: "sine", frequency: 1318.51, offset: 0.12, attack: 4e-3, decay: 0.18, peak: 0.07 }
      ],
      shimmer: { delay: 0.1, feedback: 0.22, wet: 0.16, lowpass: 4500 }
    },
    // Short UI tick for toolbar buttons
    click: {
      masterGain: 0.38,
      layers: [
        { kind: "tone", waveform: "sine", frequency: 1400, attack: 2e-3, decay: 0.04, peak: 0.05 },
        { kind: "noise", filterType: "highpass", filterFreq: 3e3, filterQ: 0.5, attack: 1e-3, decay: 0.025, peak: 0.018 }
      ]
    },
    // Lock-on sweep that resolves (recording started)
    record: {
      masterGain: 0.48,
      layers: [
        { kind: "noise", filterType: "bandpass", filterFreq: 3600, filterQ: 1.8, attack: 1e-3, decay: 0.02, peak: 0.11 },
        { kind: "tone", waveform: "triangle", frequency: 330, glideTo: 660, glideTime: 0.12, offset: 0.012, attack: 4e-3, decay: 0.16, peak: 0.055 },
        { kind: "tone", waveform: "sine", frequency: 990, offset: 0.13, attack: 4e-3, decay: 0.22, peak: 0.06 }
      ],
      shimmer: { delay: 0.1, feedback: 0.16, wet: 0.1, lowpass: 4200 }
    }
  };
  function renderSoundRecipe(ctx, recipe) {
    const now = ctx.currentTime;
    const output = ctx.createGain();
    output.gain.value = 4;
    output.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = recipe.masterGain;
    master.connect(output);
    if (recipe.shimmer) {
      const s = recipe.shimmer;
      const dl = ctx.createDelay(1);
      dl.delayTime.value = s.delay;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = s.lowpass;
      const fb = ctx.createGain();
      fb.gain.value = s.feedback;
      const wet = ctx.createGain();
      wet.gain.value = s.wet;
      master.connect(dl);
      dl.connect(lp).connect(fb).connect(dl);
      lp.connect(wet).connect(output);
    }
    for (const l of recipe.layers) {
      const t = now + (l.offset || 0);
      const env = ctx.createGain();
      env.gain.setValueAtTime(1e-4, t);
      env.gain.exponentialRampToValueAtTime(l.peak, t + l.attack);
      env.gain.exponentialRampToValueAtTime(1e-4, t + l.attack + l.decay);
      env.connect(master);
      if (l.kind === "tone") {
        const osc = ctx.createOscillator();
        osc.type = l.waveform;
        osc.frequency.setValueAtTime(l.frequency, t);
        if (l.glideTo) {
          osc.frequency.exponentialRampToValueAtTime(l.glideTo, t + (l.glideTime || l.attack + l.decay));
        }
        osc.connect(env);
        osc.start(t);
        osc.stop(t + l.attack + l.decay + 0.05);
      } else {
        const dur = l.attack + l.decay + 0.05;
        const buf = ctx.createBuffer(1, Math.max(1, Math.floor(dur * ctx.sampleRate)), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = 2 * Math.random() - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const flt = ctx.createBiquadFilter();
        flt.type = l.filterType;
        flt.frequency.value = l.filterFreq;
        if (l.filterQ) flt.Q.value = l.filterQ;
        src.connect(flt).connect(env);
        src.start(t);
        src.stop(t + dur);
      }
    }
  }
  function playSound2(name) {
    try {
      const recipe = SOUND_RECIPES[name];
      if (!recipe) return;
      if (!audioCtx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        audioCtx = new Ctor();
      }
      const ctx = audioCtx;
      if (ctx.state === "running") {
        renderSoundRecipe(ctx, recipe);
      } else {
        void ctx.resume().then(() => {
          if (ctx.state === "running") renderSoundRecipe(ctx, recipe);
        }).catch(() => {
        });
      }
    } catch {
    }
  }
  pinBtn = document.createElement("button");
  pinBtn.className = "btn labeled";
  pinBtn.setAttribute("data-tooltip", "Copy locator");
  pinBtn.setAttribute("aria-label", "Copy Locator");
  pinBtn.innerHTML = PIN_SVG + '<span class="label">Copy Locator</span>';
  pinBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    playSound2("click");
    setPinMode(!pinModeActive);
  });
  const sep1 = document.createElement("div");
  sep1.className = "separator";
  const recordBtn = document.createElement("button");
  recordBtn.className = "record-btn";
  function updateRecordBtn() {
    recordBtn.classList.remove("active", "loading");
    if (isRecording) {
      recordBtn.innerHTML = STOP_SVG + '<span class="label">Stop recording…</span>';
      recordBtn.setAttribute("data-tooltip", "Stop recording");
      recordBtn.classList.add("active");
      return;
    }
    if (startInFlight) {
      recordBtn.innerHTML = SPINNER_SVG + '<span class="label">Starting…</span>';
      recordBtn.setAttribute("data-tooltip", "Starting recorder");
      recordBtn.classList.add("loading");
      return;
    }
    recordBtn.innerHTML = RECORD_SVG + '<span class="label">Record Skill</span>';
    recordBtn.setAttribute("data-tooltip", "Record a skill");
  }
  updateRecordBtn();
  function setRecording(recording) {
    startInFlight = false;
    if (isRecording !== recording) {
      isRecording = recording;
      if (recording) {
        setPinMode(false);
      }
    }
    updateRecordBtn();
    if (recording && pendingStop) {
      pendingStop = false;
      window.__playwriterToolbarStopRecording?.();
      return;
    }
    if (!recording) {
      pendingStop = false;
    }
  }
  recordBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!isTrustedToolbarClick(e)) {
      return;
    }
    if (isRecording) {
      playSound2("click");
      window.__playwriterToolbarStopRecording?.();
      return;
    }
    if (startInFlight) {
      pendingStop = true;
      return;
    }
    if (!window.__playwriterToolbarStartRecording) {
      showToast("Relay not connected");
      return;
    }
    playSound2("record");
    startInFlight = true;
    updateRecordBtn();
    window.__playwriterToolbarStartRecording();
  });
  const sep2 = document.createElement("div");
  sep2.className = "separator";
  let remoteActive = false;
  const REMOTE_SECURITY_URL = "https://playwriter.dev/docs/remote-control";
  const remoteBtn = document.createElement("button");
  remoteBtn.className = "record-btn remote-btn";
  const remoteMenu = document.createElement("div");
  remoteMenu.className = "remote-panel";
  remoteMenu.setAttribute("role", "menu");
  const copyPromptItem = document.createElement("button");
  copyPromptItem.setAttribute("role", "menuitem");
  copyPromptItem.innerHTML = CLIPBOARD_SVG + " <span>Copy agent prompt</span>";
  const copyIdItem = document.createElement("button");
  copyIdItem.setAttribute("role", "menuitem");
  copyIdItem.innerHTML = HASH_SVG + " <span>Copy id</span>";
  const stopShareItem = document.createElement("button");
  stopShareItem.setAttribute("role", "menuitem");
  stopShareItem.className = "danger";
  stopShareItem.innerHTML = CLOUD_OFF_SVG + " <span>Stop sharing</span>";
  remoteMenu.appendChild(copyPromptItem);
  remoteMenu.appendChild(copyIdItem);
  remoteMenu.appendChild(stopShareItem);
  const remoteDialog = document.createElement("div");
  remoteDialog.className = "remote-panel";
  remoteDialog.setAttribute("role", "dialog");
  remoteDialog.setAttribute("aria-label", "Share browser");
  const dialogText = document.createElement("p");
  const dialogMore = document.createElement("a");
  dialogMore.href = REMOTE_SECURITY_URL;
  dialogMore.target = "_blank";
  dialogMore.rel = "noopener noreferrer";
  dialogMore.textContent = "Read more";
  dialogText.append(
    "Share your browser? Anyone with the copied id can control all Playwriter tabs and open new ones. ",
    dialogMore
  );
  const dialogActions = document.createElement("div");
  dialogActions.className = "remote-panel-actions";
  const dialogCancel = document.createElement("button");
  dialogCancel.textContent = "Cancel";
  const dialogShare = document.createElement("button");
  dialogShare.className = "primary";
  dialogShare.textContent = "Share";
  dialogActions.appendChild(dialogCancel);
  dialogActions.appendChild(dialogShare);
  remoteDialog.appendChild(dialogText);
  remoteDialog.appendChild(dialogActions);
  stack.appendChild(remoteMenu);
  stack.appendChild(remoteDialog);
  function setTooltipsEnabled(enabled) {
    stack.classList.toggle("tooltips-disabled", !enabled);
  }
  function hideRemotePanels() {
    remoteMenu.classList.remove("open");
    remoteDialog.classList.remove("open");
    remoteBtn.classList.remove("menu-open");
    setTooltipsEnabled(true);
    if (remoteActive) {
      remoteBtn.setAttribute("aria-expanded", "false");
      remoteBtn.setAttribute("data-tooltip", "Remote options");
    } else {
      remoteBtn.setAttribute("data-tooltip", "Share browser");
    }
  }
  function alignRemotePanel(panel) {
    const bar = toolbarEl.getBoundingClientRect();
    const btn = remoteBtn.getBoundingClientRect();
    panel.style.marginRight = Math.max(0, bar.right - btn.right) + "px";
  }
  function showRemotePanel(panel) {
    hideRemotePanels();
    panel.classList.add("open");
    alignRemotePanel(panel);
    setTooltipsEnabled(false);
    remoteBtn.removeAttribute("data-tooltip");
    if (panel === remoteMenu) {
      remoteBtn.classList.add("menu-open");
      remoteBtn.setAttribute("aria-expanded", "true");
    }
  }
  function updateRemoteBtn() {
    remoteBtn.classList.toggle("remote-active", remoteActive);
    if (remoteActive) {
      remoteBtn.innerHTML = CLOUD_SVG + '<span class="label">Remote ON</span>' + CHEVRON_SVG;
      remoteBtn.setAttribute("data-tooltip", "Remote options");
      remoteBtn.setAttribute("aria-label", "Remote control options");
      remoteBtn.setAttribute("aria-haspopup", "menu");
      remoteBtn.setAttribute("aria-expanded", "false");
      return;
    }
    remoteBtn.innerHTML = CLOUD_SVG + '<span class="label">Remote control</span>';
    remoteBtn.setAttribute("data-tooltip", "Share browser");
    remoteBtn.setAttribute("aria-label", "Start remote control");
    remoteBtn.removeAttribute("aria-haspopup");
    remoteBtn.removeAttribute("aria-expanded");
  }
  updateRemoteBtn();
  function setRemote(active) {
    remoteActive = active;
    hideRemotePanels();
    updateRemoteBtn();
  }
  remoteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!isTrustedToolbarClick(e)) {
      return;
    }
    playSound2("click");
    if (remoteActive) {
      if (!window.__playwriterToolbarStopRemote) {
        showToast("Extension not connected");
        return;
      }
      if (remoteMenu.classList.contains("open")) {
        hideRemotePanels();
        return;
      }
      showRemotePanel(remoteMenu);
      return;
    }
    if (!window.__playwriterToolbarStartRemote) {
      showToast("Extension not connected");
      return;
    }
    if (remoteDialog.classList.contains("open")) {
      hideRemotePanels();
      return;
    }
    showRemotePanel(remoteDialog);
  });
  copyPromptItem.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!isTrustedToolbarClick(e)) {
      return;
    }
    playSound2("click");
    hideRemotePanels();
    void chrome.runtime.sendMessage({ action: "remoteControlCopyPrompt" });
  });
  copyIdItem.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!isTrustedToolbarClick(e)) {
      return;
    }
    playSound2("click");
    hideRemotePanels();
    void chrome.runtime.sendMessage({ action: "remoteControlCopyId" });
  });
  stopShareItem.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!isTrustedToolbarClick(e)) {
      return;
    }
    hideRemotePanels();
    if (!window.__playwriterToolbarStopRemote) {
      showToast("Extension not connected");
      return;
    }
    window.__playwriterToolbarStopRemote();
  });
  dialogCancel.addEventListener("click", (e) => {
    e.stopPropagation();
    hideRemotePanels();
  });
  dialogShare.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!isTrustedToolbarClick(e)) {
      return;
    }
    hideRemotePanels();
    if (!window.__playwriterToolbarStartRemote) {
      showToast("Extension not connected");
      return;
    }
    window.__playwriterToolbarStartRemote();
  });
  toolbarEl.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (remoteBtn === target || remoteBtn.contains(target)) {
      return;
    }
    hideRemotePanels();
  });
  function onDocMouseDown(e) {
    if (isOverToolbar(e)) {
      return;
    }
    hideRemotePanels();
  }
  document.addEventListener("mousedown", onDocMouseDown, true);
  function onRemoteKeyDown(e) {
    if (e.key === "Escape") {
      hideRemotePanels();
    }
  }
  document.addEventListener("keydown", onRemoteKeyDown, true);
  const sep3 = document.createElement("div");
  sep3.className = "separator";
  function setExpanded(expanded) {
    if (!expanded) {
      setPinMode(false);
      hideRemotePanels();
    }
    stack.classList.toggle("collapsed", !expanded);
  }
  const tabBtn = document.createElement("button");
  tabBtn.className = "tab";
  tabBtn.setAttribute("data-tooltip", "Show Playwriter toolbar");
  tabBtn.setAttribute("aria-label", "Show Playwriter toolbar");
  tabBtn.innerHTML = CHEVRON_SVG;
  tabBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    playSound2("click");
    setExpanded(true);
  });
  stack.insertBefore(tabBtn, toolbarEl);
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.setAttribute("data-tooltip", "Collapse toolbar");
  closeBtn.setAttribute("aria-label", "Collapse toolbar");
  closeBtn.innerHTML = CLOSE_SVG;
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    playSound2("click");
    setExpanded(false);
  });
  toolbarEl.append(pinBtn, sep1, recordBtn, sep2, remoteBtn, sep3, closeBtn);
  stack.querySelectorAll("button, a").forEach((el) => {
    el.tabIndex = -1;
  });
  stack.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });
  document.documentElement.appendChild(host);
  document.documentElement.appendChild(toastHost);
  window.__playwriterToolbarShowToast = function(msg) {
    showToast(msg);
  };
  window.__playwriterToolbarPlaySound = function(name) {
    playSound2(name);
  };
  window.__playwriterToolbarSetRecording = setRecording;
  window.__playwriterToolbarSetRemote = setRemote;
  window.__playwriterToolbarStartRecording = () => {
    void chrome.runtime.sendMessage({ action: "actionRecorderStart" });
  };
  window.__playwriterToolbarStopRecording = () => {
    void chrome.runtime.sendMessage({ action: "actionRecorderStop" });
  };
  window.__playwriterToolbarStartRemote = () => {
    void chrome.runtime.sendMessage({ action: "remoteControlStart" });
  };
  window.__playwriterToolbarStopRemote = () => {
    void chrome.runtime.sendMessage({ action: "remoteControlStop" });
  };
  window.__playwriterToolbarDestroy = function() {
    setPinMode(false);
    hideRemotePanels();
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onRemoteKeyDown, true);
    removeOverlay();
    host.remove();
    toastHost.remove();
    delete window.__playwriterToolbarInstalled;
    delete window.__playwriterToolbarDestroy;
    delete window.__playwriterToolbarSetRecording;
    delete window.__playwriterToolbarStopRecording;
    delete window.__playwriterToolbarStartRecording;
    delete window.__playwriterToolbarSetRemote;
    delete window.__playwriterToolbarStartRemote;
    delete window.__playwriterToolbarStopRemote;
    delete window.__playwriterToolbarShowToast;
    delete window.__playwriterToolbarPlaySound;
  };
}
const INVENTORY_READY_CAPABILITY = "inventory-ready-v1";
const EXTENSION_INVENTORY_TIMEOUT_CLOSE = 4005;
const EXTENSION_INVENTORY_FAILED_CLOSE = 4006;
const DEFAULT_TAB_GROUP_TITLE = "playwriter";
function normalizeTabGroupTitle(title) {
  if (typeof title !== "string") {
    return null;
  }
  const trimmed = title.replace(new RegExp("\\p{C}", "gu"), " ").trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 80);
}
const TAB_GROUP_ALL_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange"
];
function normalizeTabGroupColor(color) {
  if (typeof color !== "string") {
    return null;
  }
  const lowered = color.trim().toLowerCase();
  return TAB_GROUP_ALL_COLORS.find((c) => c === lowered) || null;
}
const TAB_GROUP_COLORS = ["grey", "blue", "red", "yellow", "pink", "purple", "cyan", "orange"];
function colorForTabGroupTitle(title) {
  if (title === DEFAULT_TAB_GROUP_TITLE) {
    return "green";
  }
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = hash * 31 + title.charCodeAt(i) | 0;
  }
  return TAB_GROUP_COLORS[Math.abs(hash) % TAB_GROUP_COLORS.length];
}
function shouldDisconnectAfterTabGroupChange(options) {
  const { currentGroupId, managedGroupIds, tabState } = options;
  if (managedGroupIds.length === 0) {
    return false;
  }
  if (tabState !== "connected") {
    return false;
  }
  return !managedGroupIds.includes(currentGroupId);
}
function shouldUpdateTabGroupForTab({
  currentTitle,
  currentKey,
  from,
  key,
  ownedOnly = false
}) {
  if (currentTitle !== from) {
    return false;
  }
  if (from !== DEFAULT_TAB_GROUP_TITLE && !ownedOnly) {
    return true;
  }
  return Boolean(key && currentKey === key);
}
function computeTabGroupSyncPlan(input) {
  const ownedTabIds = new Set(input.ownedTabIds);
  const desiredByTitle = /* @__PURE__ */ new Map();
  const desiredTitleByTab = /* @__PURE__ */ new Map();
  for (const { tabId, title } of input.desiredTabs) {
    desiredTitleByTab.set(tabId, title);
    desiredByTitle.set(title, [...desiredByTitle.get(title) || [], tabId]);
  }
  const keeperByTitle = /* @__PURE__ */ new Map();
  const ungroupTabIds = [];
  for (const group of input.groups) {
    const keeper = keeperByTitle.get(group.title);
    const isDuplicate = keeper !== void 0;
    if (!isDuplicate) {
      keeperByTitle.set(group.title, { groupId: group.groupId, tabIds: group.tabIds });
    }
    for (const tabId of group.tabIds) {
      const desiredTitle = desiredTitleByTab.get(tabId);
      if (desiredTitle === group.title && !isDuplicate) {
        continue;
      }
      if (desiredTitle !== void 0 && desiredTitle !== group.title) {
        continue;
      }
      if (desiredTitle === group.title && isDuplicate) {
        continue;
      }
      if (!ownedTabIds.has(tabId)) {
        continue;
      }
      ungroupTabIds.push(tabId);
    }
  }
  const groupOps = [];
  const updateOps = [];
  for (const [title, tabIds] of desiredByTitle) {
    const keeper = keeperByTitle.get(title);
    const alreadyInKeeper = new Set(keeper?.tabIds || []);
    const toAdd = tabIds.filter((tabId) => {
      return !alreadyInKeeper.has(tabId);
    });
    if (toAdd.length > 0) {
      groupOps.push({ title, tabIds: toAdd, ...keeper ? { groupId: keeper.groupId } : {} });
    } else if (keeper) {
      updateOps.push({ groupId: keeper.groupId, title });
    }
  }
  return { ungroupTabIds, groupOps, updateOps };
}
async function handleGhostBrowserCommand(params, chromeApi) {
  const { namespace, method, args } = params;
  try {
    const api = chromeApi[namespace];
    if (!api) {
      return {
        success: false,
        error: `chrome.${namespace} not available (not running in Ghost Browser?)`
      };
    }
    const fn = api[method];
    if (typeof fn !== "function") {
      if (method in api) {
        return { success: true, result: api[method] };
      }
      return {
        success: false,
        error: `chrome.${namespace}.${method} is not a function or property`
      };
    }
    const result = await new Promise((resolve, reject) => {
      fn.call(api, ...args, (result2) => {
        if (chromeApi.runtime.lastError) {
          reject(new Error(chromeApi.runtime.lastError.message));
        } else {
          resolve(result2);
        }
      });
    });
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
const REMOTE_TUNNEL_BASE_DOMAIN = "playwriter.dev";
const REMOTE_VIEWER_BASE_URL = "https://playwriter.dev";
const REMOTE_VIEWER_PATH = "/remote-control";
const REMOTE_TUNNEL_MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
function shouldDropRemoteTunnelFrame({
  bufferedAmount,
  isScreencastFrame
}) {
  return isScreencastFrame && bufferedAmount >= REMOTE_TUNNEL_MAX_BUFFERED_BYTES;
}
function generateTunnelId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => {
    return b.toString(16).padStart(2, "0");
  }).join("");
}
function buildRemoteControlUrl({
  tunnelId,
  baseUrl = REMOTE_VIEWER_BASE_URL
}) {
  return `${baseUrl}${REMOTE_VIEWER_PATH}#${tunnelId}`;
}
function buildRemoteUpstreamWsUrl({
  tunnelId,
  baseDomain = REMOTE_TUNNEL_BASE_DOMAIN
}) {
  return `wss://${baseDomain}/tunnel/${encodeURIComponent(tunnelId)}/upstream`;
}
const REMOTE_BLOCKED_CDP_COMMANDS = /* @__PURE__ */ new Map([
  ["Network.clearBrowserCookies", "clears cookies for EVERY site in the user profile"],
  ["Network.clearBrowserCache", "clears the browser cache for the whole user profile"],
  ["Network.getAllCookies", "reads cookies for EVERY site in the user profile"],
  ["Storage.clearCookies", "clears cookies for EVERY site in the user profile"],
  ["Storage.getCookies", "reads cookies for EVERY site in the user profile"],
  ["Storage.setCookies", "changes cookies for any site in the user profile"]
]);
function getRemoteCdpCommandRejection(method) {
  const blockedReason = REMOTE_BLOCKED_CDP_COMMANDS.get(method);
  if (blockedReason) {
    return `${method} is not allowed over Remote control: it ${blockedReason}.`;
  }
  return null;
}
function getRemoteExtensionMethodRejection(method) {
  if (method === "closeTabsForKey") {
    return "Closing session tabs is not available over Remote control.";
  }
  if (method === "ghost-browser") {
    return "Ghost Browser APIs are not available over Remote control.";
  }
  return null;
}
function namespaceRemoteTabGroupKey(key) {
  return key ? `remote:${key}` : void 0;
}
dedent`
  Could not reach the remote-control browser. The tunnel dropped. Ask the user to confirm Remote control is still on, then retry. If they clicked Stop sharing, they need to share a fresh id.
`;
function buildRemoteControlPrompt({ id }) {
  return dedent`
    Connect to my Chrome browser:

    npx -y playwriter@latest session new --remote ${id}

    Then use the printed session id. Read https://playwriter.dev/SKILL.md. NEVER share this id.
  `;
}
function buildRemoteHelloMessage({
  browser,
  version
}) {
  return {
    method: "hello",
    params: {
      browser,
      version,
      remote: true
    }
  };
}
const PING_INTERVAL_MS = 2e4;
const RECONNECT_DELAY_MS = 3e3;
const CONFLICT_RETRY_DELAY_MS = 15e3;
const MAX_CONFLICT_RETRIES = 12;
class RemoteTunnel {
  options;
  ws = null;
  closed = false;
  pingInterval = null;
  reconnectTimer = null;
  connections = /* @__PURE__ */ new Map();
  conflictRetries = 0;
  constructor(options) {
    this.options = options;
  }
  /** Link the user shares. Points at the viewer page, not at the tunnel host. */
  get url() {
    return buildRemoteControlUrl({ tunnelId: this.options.tunnelId });
  }
  start() {
    if (this.closed) {
      return;
    }
    this.options.onStatusChange("connecting");
    const wsUrl = buildRemoteUpstreamWsUrl({
      tunnelId: this.options.tunnelId,
      baseDomain: this.options.baseDomain
    });
    this.options.logger.debug("Remote tunnel connecting");
    let accepted = false;
    const socket = new WebSocket(wsUrl);
    this.ws = socket;
    socket.onmessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.type === "upstream_accepted") {
        accepted = true;
        this.conflictRetries = 0;
        this.options.logger.debug("Remote tunnel online");
        this.options.onStatusChange("online");
        this.startPing();
        return;
      }
      this.handleMessage(msg);
    };
    socket.onclose = (event) => {
      this.stopPing();
      this.ws = null;
      this.closeAllConnections();
      if (this.closed) {
        return;
      }
      if (event.code === 4409) {
        this.conflictRetries++;
        if (this.conflictRetries > MAX_CONFLICT_RETRIES) {
          this.closed = true;
          this.options.logger.error("Remote tunnel id still in use after retries, giving up");
          this.options.onStatusChange("error", "Tunnel id already in use");
          return;
        }
        this.options.logger.debug(
          `Remote tunnel id in use (stale upstream?), retry ${this.conflictRetries}/${MAX_CONFLICT_RETRIES} in ${CONFLICT_RETRY_DELAY_MS}ms`
        );
        this.options.onStatusChange("connecting", "Waiting for stale tunnel to expire");
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.start();
        }, CONFLICT_RETRY_DELAY_MS);
        return;
      }
      this.options.logger.debug(
        `Remote tunnel disconnected (code=${event.code} accepted=${accepted}), reconnecting in ${RECONNECT_DELAY_MS}ms`
      );
      this.options.onStatusChange("connecting");
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.start();
      }, RECONNECT_DELAY_MS);
    };
    socket.onerror = () => {
      this.options.logger.debug("Remote tunnel WebSocket error");
    };
  }
  close() {
    this.closed = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeAllConnections();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
      }
      this.ws = null;
    }
  }
  closeAllConnections() {
    for (const handlers of this.connections.values()) {
      try {
        handlers.onClose();
      } catch {
      }
    }
    this.connections.clear();
  }
  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      this.send({ method: "ping" });
    }, PING_INTERVAL_MS);
  }
  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
  send(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
    }
  }
  handleMessage(msg) {
    switch (msg.type) {
      case "http_request": {
        const isRoot = msg.path === "/" || msg.path.startsWith("/?");
        this.send({
          type: "http_response",
          id: msg.id,
          status: isRoot ? 200 : 404,
          headers: { "content-type": "text/plain" },
          body: isRoot ? btoa("playwriter remote control tunnel") : null
        });
        return;
      }
      case "ws_open": {
        this.handleWsOpen(msg);
        return;
      }
      case "ws_frame": {
        const handlers = this.connections.get(msg.connId);
        if (!handlers) {
          return;
        }
        if (msg.binary) {
          return;
        }
        handlers.onMessage(msg.data);
        return;
      }
      case "ws_close": {
        const handlers = this.connections.get(msg.connId);
        this.connections.delete(msg.connId);
        if (handlers) {
          try {
            handlers.onClose();
          } catch {
          }
        }
        return;
      }
    }
  }
  handleWsOpen(msg) {
    const path = msg.path.split("?")[0];
    if (path !== "/extension") {
      this.send({ type: "ws_error", connId: msg.connId, error: `Unknown path: ${path}` });
      return;
    }
    const connId = msg.connId;
    const handlers = this.options.onConnectionOpen({
      id: connId,
      send: (data) => {
        this.send({ type: "ws_frame", connId, data, binary: false });
      },
      canSendScreencastFrame: () => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return false;
        }
        return !shouldDropRemoteTunnelFrame({
          bufferedAmount: this.ws.bufferedAmount,
          isScreencastFrame: true
        });
      },
      close: () => {
        this.connections.delete(connId);
        this.send({ type: "ws_closed", connId, code: 1e3, reason: "closed by extension" });
      }
    });
    if (!handlers) {
      this.send({ type: "ws_error", connId, error: "Connection rejected" });
      return;
    }
    this.connections.set(connId, handlers);
    this.send({ type: "ws_opened", connId });
    this.options.logger.debug("Remote relay connected through tunnel:", connId);
  }
}
const MAX_REATTACHES_PER_WINDOW = 5;
const REATTACH_WINDOW_MS = 5e3;
const REPLAYED_SETTERS = /* @__PURE__ */ new Set([
  "Page.setLifecycleEventsEnabled",
  "Page.setInterceptFileChooserDialog",
  "Page.setBypassCSP",
  "Network.setExtraHTTPHeaders",
  "Network.setCacheDisabled",
  "Network.setBypassServiceWorker",
  "Network.emulateNetworkConditions",
  "Network.setUserAgentOverride",
  "Security.setIgnoreCertificateErrors",
  "Target.setAutoAttach"
]);
const tabSessions = /* @__PURE__ */ new Map();
let nextInitScriptId = 1;
function startTabSession(tabId) {
  tabSessions.set(tabId, { setup: /* @__PURE__ */ new Map(), frameIds: /* @__PURE__ */ new Set(), reattachTimes: [] });
}
function endTabSession(tabId) {
  tabSessions.delete(tabId);
}
function tabSessionIds() {
  return [...tabSessions.keys()];
}
function canReattach(tabId) {
  const session = tabSessions.get(tabId);
  if (!session) {
    return false;
  }
  const now = Date.now();
  session.reattachTimes = session.reattachTimes.filter((time) => {
    return now - time < REATTACH_WINDOW_MS;
  });
  if (session.reattachTimes.length >= MAX_REATTACHES_PER_WINDOW) {
    return false;
  }
  session.reattachTimes.push(now);
  return true;
}
function trackFrameEvent({ tabId, method, params }) {
  const frameIds = tabSessions.get(tabId)?.frameIds;
  if (method === "Page.frameAttached") {
    frameIds?.add(params.frameId);
  }
  if (method === "Page.frameDetached") {
    frameIds?.delete(params.frameId);
  }
}
function takeRemovedFrameIds({ tabId, frameTree }) {
  const frameIds = tabSessions.get(tabId)?.frameIds;
  if (!frameIds) {
    return [];
  }
  const collectIds = (tree) => {
    return [tree.frame.id, ...(tree.childFrames ?? []).flatMap(collectIds)];
  };
  const liveFrameIds = new Set(collectIds(frameTree));
  const removed = [...frameIds].filter((frameId) => {
    return !liveFrameIds.has(frameId);
  });
  removed.forEach((frameId) => {
    frameIds.delete(frameId);
  });
  return removed;
}
function resolveSetupParams({
  tabId,
  method,
  params
}) {
  if (method !== "Page.removeScriptToEvaluateOnNewDocument") {
    return params;
  }
  const { identifier } = params;
  const scriptIdentifier = tabSessions.get(tabId)?.setup.get(`script:${identifier}`)?.scriptIdentifier;
  return scriptIdentifier ? { ...params, identifier: scriptIdentifier } : params;
}
function recordInitScript({
  tabId,
  params,
  result
}) {
  const setup = tabSessions.get(tabId)?.setup;
  if (!setup) {
    return result;
  }
  const identifier = `playwriter-${nextInitScriptId++}`;
  setup.set(`script:${identifier}`, {
    method: "Page.addScriptToEvaluateOnNewDocument",
    params: { ...params, runImmediately: false },
    scriptIdentifier: result.identifier
  });
  return { ...result, identifier };
}
function recordSetupCommand({ tabId, method, params }) {
  const setup = tabSessions.get(tabId)?.setup;
  if (!setup) {
    return;
  }
  const put = (key) => {
    setup.delete(key);
    setup.set(key, { method, params });
  };
  const [domain, command = ""] = method.split(".");
  const fields = params;
  if (command === "enable") {
    put(domain);
  } else if (command === "disable") {
    setup.delete(domain);
  } else if (method === "Page.removeScriptToEvaluateOnNewDocument") {
    setup.delete(`script:${fields?.identifier}`);
  } else if (method === "Runtime.addBinding") {
    put(`binding:${fields?.name}`);
  } else if (method === "Runtime.removeBinding") {
    setup.delete(`binding:${fields?.name}`);
  } else if (domain === "Emulation" && command.startsWith("clear")) {
    setup.delete(`Emulation.set${command.slice("clear".length)}`);
  } else if (domain === "Emulation" && command.startsWith("set") || REPLAYED_SETTERS.has(method)) {
    put(method);
  }
}
async function replaySetup({
  tabId,
  send
}) {
  const failures = [];
  for (const command of tabSessions.get(tabId)?.setup.values() ?? []) {
    try {
      const result = await send(command.method, command.params);
      if (command.method === "Page.addScriptToEvaluateOnNewDocument") {
        command.scriptIdentifier = result.identifier;
      }
    } catch (error) {
      failures.push({ method: command.method, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }
  return failures;
}
const ghostCursorBundleCode = '(() => {\n  var __defProp = Object.defineProperty;\n  var __getOwnPropNames = Object.getOwnPropertyNames;\n  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;\n  var __hasOwnProp = Object.prototype.hasOwnProperty;\n  function __accessProp(key) {\n    return this[key];\n  }\n  var __toCommonJS = (from) => {\n    var entry = (__moduleCache ??= new WeakMap).get(from), desc;\n    if (entry)\n      return entry;\n    entry = __defProp({}, "__esModule", { value: true });\n    if (from && typeof from === "object" || typeof from === "function") {\n      for (var key of __getOwnPropNames(from))\n        if (!__hasOwnProp.call(entry, key))\n          __defProp(entry, key, {\n            get: __accessProp.bind(from, key),\n            enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable\n          });\n    }\n    __moduleCache.set(from, entry);\n    return entry;\n  };\n  var __moduleCache;\n\n  // src/ghost-cursor-client.ts\n  var exports_ghost_cursor_client = {};\n\n  // src/assets/cursors/screen-studio/pointer-macos-tahoe-svg.ts\n  var SCREENSTUDIO_POINTER_MACOS_TAHOE_SVG = `<svg width="618" height="958" viewBox="0 0 618 958" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g filter="url(#filter0_d_384_27)">\n<path fill-rule="evenodd" clip-rule="evenodd" d="M127.062 37.0331L540.696 451.555C592.653 503.66 555.794 592.574 482.226 592.574L421.831 592.569L481.821 735.054C492.331 760.021 492.479 787.652 482.265 812.767C472.002 837.932 452.561 857.57 427.496 868.08C414.864 873.359 401.64 876.024 388.121 876.024C347.117 876.024 310.358 851.6 294.47 813.804L231.42 663.918L190.368 700.337C137.029 747.508 53 709.663 53 638.413V67.6744C53 28.9903 99.7268 9.64828 127.062 37.0331Z" fill="white"/>\n<path fill-rule="evenodd" clip-rule="evenodd" d="M102.316 99.652C102.316 93.1882 110.162 89.9316 114.701 94.5204L504.897 485.555C526.164 506.871 511.065 543.236 480.967 543.236L347.546 543.161L436.342 754.143C447.542 780.788 435.009 811.429 408.414 822.581C381.72 833.781 351.128 821.298 339.977 794.702L250.293 581.352L158.517 662.644C137.991 680.801 106.319 668.145 102.664 642.323L102.316 637.331V99.652Z" fill="black"/>\n</g>\n<defs>\n<filter id="filter0_d_384_27" x="0.34" y="0.799219" width="617.32" height="957.144" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">\n<feFlood flood-opacity="0" result="BackgroundImageFix"/>\n<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>\n<feOffset dy="29.26"/>\n<feGaussianBlur stdDeviation="26.33"/>\n<feComposite in2="hardAlpha" operator="out"/>\n<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.65 0"/>\n<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_384_27"/>\n<feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_384_27" result="shape"/>\n</filter>\n</defs>\n</svg>`;\n\n  // src/ghost-cursor-client.ts\n  var isTopFrame = (() => {\n    try {\n      return window === window.top;\n    } catch {\n      return false;\n    }\n  })();\n  var CURSOR_ID = "__playwriter_ghost_cursor__";\n  var SCREENSTUDIO_POINTER_ASPECT_RATIO = 618 / 958;\n  var SCREENSTUDIO_HOTSPOT_X_RATIO = 0.14;\n  var SCREENSTUDIO_HOTSPOT_Y_RATIO = 0.06;\n  var MINIMAL_TRIANGLE_HOTSPOT_X_RATIO = 0.07;\n  var MINIMAL_TRIANGLE_HOTSPOT_Y_RATIO = 0.06;\n  var MOVE_EASING = "cubic-bezier(0.65, 0, 0.35, 1)";\n  var PRESS_EASING = "cubic-bezier(0.23, 1, 0.32, 1)";\n  var PRESS_DURATION_MS = 140;\n  var IDLE_HIDE_DELAY_MS = 5000;\n  var IDLE_FADE_OUT_MS = 600;\n  var DEFAULT_OPTIONS = {\n    style: "minimal",\n    color: "#111827",\n    size: 22,\n    zIndex: 2147483647,\n    easing: MOVE_EASING,\n    minDurationMs: 220,\n    maxDurationMs: 1500,\n    speedPxPerMs: 1.2\n  };\n  var runtime = {\n    outerElement: null,\n    innerElement: null,\n    options: DEFAULT_OPTIONS,\n    x: 0,\n    y: 0,\n    scale: 1,\n    hasPosition: false,\n    enabled: true,\n    idleHidden: true\n  };\n  var idleHideTimer = null;\n  function clamp(options) {\n    const { value, min, max } = options;\n    return Math.min(max, Math.max(min, value));\n  }\n  function mergeOptions(options) {\n    if (!options) {\n      return DEFAULT_OPTIONS;\n    }\n    return {\n      style: options.style ?? DEFAULT_OPTIONS.style,\n      color: options.color ?? DEFAULT_OPTIONS.color,\n      size: options.size ?? DEFAULT_OPTIONS.size,\n      zIndex: options.zIndex ?? DEFAULT_OPTIONS.zIndex,\n      easing: options.easing ?? DEFAULT_OPTIONS.easing,\n      minDurationMs: options.minDurationMs ?? DEFAULT_OPTIONS.minDurationMs,\n      maxDurationMs: options.maxDurationMs ?? DEFAULT_OPTIONS.maxDurationMs,\n      speedPxPerMs: options.speedPxPerMs ?? DEFAULT_OPTIONS.speedPxPerMs\n    };\n  }\n  function getCursorDimensions() {\n    if (runtime.options.style === "screenstudio") {\n      const height = runtime.options.size;\n      const width = Math.max(10, Math.round(height * SCREENSTUDIO_POINTER_ASPECT_RATIO));\n      return { width, height };\n    }\n    if (runtime.options.style === "minimal") {\n      const size = Math.max(12, runtime.options.size);\n      return { width: size, height: size };\n    }\n    return { width: runtime.options.size, height: runtime.options.size };\n  }\n  function getHotspotOffsetPx() {\n    const dimensions = getCursorDimensions();\n    if (runtime.options.style === "screenstudio") {\n      return {\n        x: Math.round(dimensions.width * SCREENSTUDIO_HOTSPOT_X_RATIO),\n        y: Math.round(dimensions.height * SCREENSTUDIO_HOTSPOT_Y_RATIO)\n      };\n    }\n    if (runtime.options.style === "minimal") {\n      return {\n        x: Math.round(dimensions.width * MINIMAL_TRIANGLE_HOTSPOT_X_RATIO),\n        y: Math.round(dimensions.height * MINIMAL_TRIANGLE_HOTSPOT_Y_RATIO)\n      };\n    }\n    return {\n      x: Math.round(dimensions.width / 2),\n      y: Math.round(dimensions.height / 2)\n    };\n  }\n  function getBaseOpacity() {\n    if (runtime.options.style === "screenstudio") {\n      return "0.95";\n    }\n    if (runtime.options.style === "minimal") {\n      return "1";\n    }\n    return "0.72";\n  }\n  function applyTranslate() {\n    if (!runtime.outerElement) {\n      return;\n    }\n    const hotspot = getHotspotOffsetPx();\n    runtime.outerElement.style.transform = `translate3d(${runtime.x - hotspot.x}px, ${runtime.y - hotspot.y}px, 0)`;\n  }\n  function applyScale() {\n    if (!runtime.innerElement) {\n      return;\n    }\n    runtime.innerElement.style.transform = `scale(${runtime.scale})`;\n  }\n  function computeDurationMs(options) {\n    if (!runtime.hasPosition) {\n      return 0;\n    }\n    const dx = options.targetX - runtime.x;\n    const dy = options.targetY - runtime.y;\n    const distance = Math.hypot(dx, dy);\n    if (distance === 0) {\n      return 0;\n    }\n    const rawDurationMs = distance / runtime.options.speedPxPerMs;\n    return clamp({\n      value: rawDurationMs,\n      min: runtime.options.minDurationMs,\n      max: runtime.options.maxDurationMs\n    });\n  }\n  function createCursorElement() {\n    const outer = document.createElement("div");\n    outer.id = CURSOR_ID;\n    outer.setAttribute("aria-hidden", "true");\n    outer.style.position = "fixed";\n    outer.style.left = "0";\n    outer.style.top = "0";\n    outer.style.pointerEvents = "none";\n    outer.style.zIndex = `${runtime.options.zIndex}`;\n    outer.style.transitionProperty = "transform";\n    outer.style.transitionTimingFunction = runtime.options.easing;\n    outer.style.transitionDuration = "0ms";\n    outer.style.willChange = "transform";\n    const inner = document.createElement("div");\n    inner.style.transitionProperty = "transform, opacity";\n    inner.style.transitionTimingFunction = PRESS_EASING;\n    inner.style.transitionDuration = `${PRESS_DURATION_MS}ms`;\n    inner.style.opacity = getBaseOpacity();\n    outer.appendChild(inner);\n    runtime.outerElement = outer;\n    runtime.innerElement = inner;\n    applyRuntimeVisualOptions();\n    return outer;\n  }\n  function ensureCursorElement() {\n    const existing = document.getElementById(CURSOR_ID);\n    if (existing) {\n      runtime.outerElement = existing;\n      runtime.innerElement = existing.firstElementChild || null;\n      return existing;\n    }\n    const outer = createCursorElement();\n    const root = document.documentElement || document.body;\n    root.appendChild(outer);\n    return outer;\n  }\n  function applyRuntimeVisualOptions() {\n    if (!runtime.innerElement) {\n      return;\n    }\n    const dimensions = getCursorDimensions();\n    runtime.innerElement.style.width = `${dimensions.width}px`;\n    runtime.innerElement.style.height = `${dimensions.height}px`;\n    if (runtime.outerElement) {\n      runtime.outerElement.style.zIndex = `${runtime.options.zIndex}`;\n      runtime.outerElement.style.transitionTimingFunction = runtime.options.easing;\n    }\n    const hotspot = getHotspotOffsetPx();\n    runtime.innerElement.style.transformOrigin = `${hotspot.x}px ${hotspot.y}px`;\n    runtime.innerElement.replaceChildren();\n    runtime.innerElement.style.backgroundImage = "none";\n    if (runtime.options.style === "screenstudio") {\n      runtime.innerElement.style.borderRadius = "0";\n      runtime.innerElement.style.border = "none";\n      runtime.innerElement.style.backgroundColor = "transparent";\n      runtime.innerElement.style.backdropFilter = "none";\n      runtime.innerElement.style.filter = "none";\n      runtime.innerElement.style.boxShadow = "none";\n      runtime.innerElement.style.opacity = getBaseOpacity();\n      setInnerSvg(runtime.innerElement, SCREENSTUDIO_POINTER_MACOS_TAHOE_SVG);\n      return;\n    }\n    if (runtime.options.style === "minimal") {\n      const triangleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="-1 -1 26 26"><path fill="white" stroke="${runtime.options.color}" stroke-width="1.5" stroke-linejoin="round" d="m23.284 19.124l-6.866-6.895a.4.4 0 0 1-.118-.296a.43.43 0 0 1 .163-.282l4.439-3.077a1.48 1.48 0 0 0 .621-1.48a1.48 1.48 0 0 0-1.036-1.198L1.623.302a1.14 1.14 0 0 0-1.11.282A1.13 1.13 0 0 0 .29 1.649L5.928 20.44a1.48 1.48 0 0 0 1.183 1.035a1.48 1.48 0 0 0 1.48-.621l3.078-4.44a.37.37 0 0 1 .31-.118a.43.43 0 0 1 .296.104l6.91 6.91a1.48 1.48 0 0 0 2.087 0l2.086-2.086a1.48 1.48 0 0 0-.074-2.101"/></svg>`;\n      runtime.innerElement.style.borderRadius = "0";\n      runtime.innerElement.style.border = "none";\n      runtime.innerElement.style.backgroundColor = "transparent";\n      runtime.innerElement.style.backdropFilter = "none";\n      runtime.innerElement.style.boxShadow = "none";\n      runtime.innerElement.style.filter = "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4))";\n      runtime.innerElement.style.opacity = getBaseOpacity();\n      setInnerSvg(runtime.innerElement, triangleSvg);\n      return;\n    }\n    runtime.innerElement.style.borderRadius = "999px";\n    runtime.innerElement.style.border = "none";\n    runtime.innerElement.style.backgroundColor = runtime.options.color;\n    runtime.innerElement.style.backdropFilter = "none";\n    runtime.innerElement.style.filter = "none";\n    runtime.innerElement.style.boxShadow = "0 2px 10px rgba(0, 0, 0, 0.18), inset 0 0 0 2px rgba(255, 255, 255, 0.55)";\n    runtime.innerElement.style.opacity = getBaseOpacity();\n  }\n  function setInnerSvg(host, markup) {\n    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");\n    const svg = parsed.documentElement;\n    if (svg.namespaceURI !== "http://www.w3.org/2000/svg" || svg.localName !== "svg") {\n      return;\n    }\n    const imported = host.ownerDocument.importNode(svg, true);\n    imported.setAttribute("width", "100%");\n    imported.setAttribute("height", "100%");\n    imported.style.display = "block";\n    host.appendChild(imported);\n  }\n  function clearIdleHideTimer() {\n    if (idleHideTimer !== null) {\n      clearTimeout(idleHideTimer);\n      idleHideTimer = null;\n    }\n  }\n  function scheduleIdleHide() {\n    clearIdleHideTimer();\n    idleHideTimer = setTimeout(() => {\n      idleHideTimer = null;\n      if (!runtime.enabled || !runtime.innerElement) {\n        return;\n      }\n      runtime.idleHidden = true;\n      runtime.innerElement.style.transitionDuration = `${IDLE_FADE_OUT_MS}ms`;\n      runtime.innerElement.style.transitionTimingFunction = PRESS_EASING;\n      runtime.innerElement.style.opacity = "0";\n    }, IDLE_HIDE_DELAY_MS);\n  }\n  function wakeFromIdle(options) {\n    runtime.x = options.x;\n    runtime.y = options.y;\n    runtime.hasPosition = true;\n    if (runtime.innerElement) {\n      runtime.innerElement.style.transitionDuration = `${PRESS_DURATION_MS}ms`;\n      runtime.innerElement.style.transitionTimingFunction = PRESS_EASING;\n      runtime.innerElement.style.opacity = getBaseOpacity();\n    }\n  }\n  function moveCursor(options) {\n    if (!runtime.enabled) {\n      return;\n    }\n    ensureCursorElement();\n    const durationMs = computeDurationMs({ targetX: options.x, targetY: options.y });\n    if (runtime.outerElement) {\n      runtime.outerElement.style.transitionDuration = `${Math.round(durationMs)}ms`;\n      runtime.outerElement.style.transitionTimingFunction = runtime.options.easing;\n    }\n    runtime.x = options.x;\n    runtime.y = options.y;\n    runtime.hasPosition = true;\n    applyTranslate();\n  }\n  function setPressed(options) {\n    if (!runtime.enabled || !runtime.innerElement) {\n      return;\n    }\n    runtime.scale = options.pressed ? runtime.options.style === "dot" ? 0.92 : 0.95 : 1;\n    runtime.innerElement.style.transitionDuration = `${PRESS_DURATION_MS}ms`;\n    runtime.innerElement.style.transitionTimingFunction = PRESS_EASING;\n    runtime.innerElement.style.opacity = options.pressed ? "1" : getBaseOpacity();\n    applyScale();\n  }\n  function enable(options) {\n    runtime.options = mergeOptions(options);\n    runtime.enabled = true;\n    ensureCursorElement();\n    applyRuntimeVisualOptions();\n    if (!runtime.hasPosition) {\n      runtime.x = Math.round(window.innerWidth / 2);\n      runtime.y = Math.round(window.innerHeight / 2);\n      runtime.scale = 1;\n      runtime.hasPosition = true;\n    }\n    runtime.idleHidden = false;\n    if (runtime.innerElement) {\n      runtime.innerElement.style.opacity = getBaseOpacity();\n    }\n    applyTranslate();\n    applyScale();\n    scheduleIdleHide();\n  }\n  function disable() {\n    runtime.enabled = false;\n    runtime.scale = 1;\n    runtime.hasPosition = false;\n    runtime.idleHidden = false;\n    clearIdleHideTimer();\n    if (runtime.outerElement) {\n      runtime.outerElement.remove();\n      runtime.outerElement = null;\n      runtime.innerElement = null;\n    }\n  }\n  function applyMouseAction(action) {\n    if (!runtime.enabled) {\n      return;\n    }\n    if (runtime.idleHidden) {\n      runtime.idleHidden = false;\n      wakeFromIdle({ x: action.x, y: action.y });\n    }\n    if (action.type === "move" || action.type === "wheel") {\n      moveCursor({ x: action.x, y: action.y });\n    } else if (action.type === "down") {\n      moveCursor({ x: action.x, y: action.y });\n      setPressed({ pressed: true });\n    } else if (action.type === "up") {\n      moveCursor({ x: action.x, y: action.y });\n      setPressed({ pressed: false });\n    }\n    scheduleIdleHide();\n  }\n  var api = {\n    enable,\n    disable,\n    applyMouseAction,\n    isEnabled: () => {\n      return runtime.enabled;\n    }\n  };\n  if (isTopFrame) {\n    globalThis.__playwriterGhostCursor = api;\n  }\n})();\n';
const bippyBundleCode = '(() => {\n  // ../node_modules/.pnpm/bippy@0.5.27_@types+react@19.2.7_react@19.2.7/node_modules/bippy/dist/rdt-hook-BZMdLD7S.js\n  var e = `0.5.27`;\n  var t = `bippy-${e}`;\n  var n = Object.defineProperty;\n  var r = Object.prototype.hasOwnProperty;\n  var i = () => {};\n  var a = (e2) => {\n    try {\n      let t2 = Function.prototype.toString.call(e2);\n      t2.indexOf(`^_^`) > -1 && setTimeout(() => {\n        throw Error(`React is running in production mode, but dead code elimination has not been applied. Read how to correctly configure React for production: https://reactjs.org/link/perf-use-production-build`);\n      });\n    } catch {}\n  };\n  var o = (e2 = h()) => (`getFiberRoots` in e2);\n  var s = false;\n  var c;\n  var l = (e2 = h()) => s ? true : (typeof e2.inject == `function` && (c = e2.inject.toString()), !!c?.includes(`(injected)`));\n  var u = new Set;\n  var d = new Set;\n  var f = (e2) => {\n    let r2 = new Map, o2 = 0, s2 = { _instrumentationIsActive: false, _instrumentationSource: t, checkDCE: a, hasUnsupportedRendererAttached: false, inject(e3) {\n      let t2 = ++o2;\n      return r2.set(t2, e3), d.add(e3), s2._instrumentationIsActive || (s2._instrumentationIsActive = true, u.forEach((e4) => e4())), t2;\n    }, on: i, onCommitFiberRoot: i, onCommitFiberUnmount: i, onPostCommitFiberRoot: i, renderers: r2, supportsFiber: true, supportsFlight: true };\n    try {\n      n(globalThis, `__REACT_DEVTOOLS_GLOBAL_HOOK__`, { configurable: true, enumerable: true, get() {\n        return s2;\n      }, set(t3) {\n        if (t3 && typeof t3 == `object`) {\n          let n2 = s2.renderers;\n          s2 = t3, n2.size > 0 && (n2.forEach((e3, n3) => {\n            d.add(e3), t3.renderers.set(n3, e3);\n          }), p(e2));\n        }\n      } });\n      let t2 = window.hasOwnProperty, r3 = false;\n      n(window, `hasOwnProperty`, { configurable: true, value: function(...e3) {\n        try {\n          if (!r3 && e3[0] === `__REACT_DEVTOOLS_GLOBAL_HOOK__`)\n            return globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = undefined, r3 = true, -0;\n        } catch {}\n        return t2.apply(this, e3);\n      }, writable: true });\n    } catch {\n      p(e2);\n    }\n    return s2;\n  };\n  var p = (e2) => {\n    e2 && u.add(e2);\n    try {\n      let n2 = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;\n      if (!n2)\n        return;\n      if (!n2._instrumentationSource) {\n        n2.checkDCE = a, n2.supportsFiber = true, n2.supportsFlight = true, n2.hasUnsupportedRendererAttached = false, n2._instrumentationSource = t, n2._instrumentationIsActive = false;\n        let e3 = o(n2);\n        if (e3 || (n2.on = i), n2.renderers.size) {\n          n2._instrumentationIsActive = true, u.forEach((e4) => e4());\n          return;\n        }\n        let r2 = n2.inject, c2 = l(n2);\n        if (c2 && !e3) {\n          s = true;\n          let e4 = n2.inject({ scheduleRefresh() {} });\n          e4 && (n2._instrumentationIsActive = true);\n        }\n        n2.inject = (e4) => {\n          let t2 = r2(e4);\n          return d.add(e4), c2 && n2.renderers.set(t2, e4), n2._instrumentationIsActive = true, u.forEach((e5) => e5()), t2;\n        };\n      }\n      (n2.renderers.size || n2._instrumentationIsActive || l()) && e2?.();\n    } catch {}\n  };\n  var m = () => r.call(globalThis, `__REACT_DEVTOOLS_GLOBAL_HOOK__`);\n  var h = (e2) => m() ? (p(e2), globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__) : f(e2);\n  var g = () => !!(typeof window < `u` && (window.document?.createElement || window.navigator?.product === `ReactNative`));\n  var _ = () => {\n    try {\n      g() && h();\n    } catch {}\n  };\n\n  // ../node_modules/.pnpm/bippy@0.5.27_@types+react@19.2.7_react@19.2.7/node_modules/bippy/dist/install-hook-only-BOBPiBkc.js\n  _();\n\n  // ../node_modules/.pnpm/bippy@0.5.27_@types+react@19.2.7_react@19.2.7/node_modules/bippy/dist/core-coQbWNwP.js\n  var a2 = 0;\n  var o2 = 1;\n  var c2 = 5;\n  var f2 = 11;\n  var p2 = 13;\n  var m2 = 14;\n  var h2 = 15;\n  var ee = 16;\n  var te = 19;\n  var y = 26;\n  var b = 27;\n  var ne = 28;\n  var re = 30;\n  var ie = 2;\n  var ae = 4096;\n  var oe = 4;\n  var se = 16;\n  var ce = 32;\n  var le = 1024;\n  var ue = 8192;\n  var O = ie | oe | se | ce | ae | ue | le;\n  var k = (e2) => {\n    switch (e2.tag) {\n      case c2:\n      case y:\n      case b:\n        return true;\n      default:\n        return typeof e2.type == `string`;\n    }\n  };\n  var pe = (e2) => {\n    switch (e2.tag) {\n      case o2:\n      case f2:\n      case a2:\n      case m2:\n      case h2:\n        return true;\n      default:\n        return false;\n    }\n  };\n  function N(e2, t2, n2 = false) {\n    if (!e2)\n      return null;\n    let r2 = t2(e2);\n    if (r2 instanceof Promise)\n      return (async () => {\n        if (await r2 === true)\n          return e2;\n        let i3 = n2 ? e2.return : e2.child;\n        for (;i3; ) {\n          let e3 = await F(i3, t2, n2);\n          if (e3)\n            return e3;\n          i3 = n2 ? null : i3.sibling;\n        }\n        return null;\n      })();\n    if (r2 === true)\n      return e2;\n    let i2 = n2 ? e2.return : e2.child;\n    for (;i2; ) {\n      let e3 = P(i2, t2, n2);\n      if (e3)\n        return e3;\n      i2 = n2 ? null : i2.sibling;\n    }\n    return null;\n  }\n  var P = (e2, t2, n2 = false) => {\n    if (!e2)\n      return null;\n    if (t2(e2) === true)\n      return e2;\n    let r2 = n2 ? e2.return : e2.child;\n    for (;r2; ) {\n      let e3 = P(r2, t2, n2);\n      if (e3)\n        return e3;\n      r2 = n2 ? null : r2.sibling;\n    }\n    return null;\n  };\n  var F = async (e2, t2, n2 = false) => {\n    if (!e2)\n      return null;\n    if (await t2(e2) === true)\n      return e2;\n    let r2 = n2 ? e2.return : e2.child;\n    for (;r2; ) {\n      let e3 = await F(r2, t2, n2);\n      if (e3)\n        return e3;\n      r2 = n2 ? null : r2.sibling;\n    }\n    return null;\n  };\n  var I = (e2) => {\n    let t2 = e2;\n    return typeof t2 == `function` ? t2 : typeof t2 == `object` && t2 ? I(t2.type || t2.render) : null;\n  };\n  var Te = (e2) => {\n    let t2 = e2;\n    if (typeof t2 == `string`)\n      return t2;\n    if (typeof t2 != `function` && !(typeof t2 == `object` && t2))\n      return null;\n    let n2 = t2.displayName || t2.name || null;\n    if (n2)\n      return n2;\n    let r2 = I(t2);\n    return r2 && (r2.displayName || r2.name) || null;\n  };\n  var z = new WeakMap;\n  var K = new WeakMap;\n  var Pe = (e2) => {\n    let n2 = h();\n    for (let t2 of n2.renderers.values())\n      try {\n        let n3 = t2.findFiberByHostInstance?.(e2);\n        if (n3)\n          return n3;\n      } catch {}\n    if (typeof e2 == `object` && e2) {\n      if (`_reactRootContainer` in e2)\n        return e2._reactRootContainer?._internalRoot?.current?.child;\n      for (let t2 in e2)\n        if (t2.startsWith(`__reactContainer$`) || t2.startsWith(`__reactInternalInstance$`) || t2.startsWith(`__reactFiber`))\n          return e2[t2] || null;\n    }\n    return null;\n  };\n  var Fe = Error();\n  var $ = new Set;\n\n  // ../node_modules/.pnpm/bippy@0.5.27_@types+react@19.2.7_react@19.2.7/node_modules/bippy/dist/source.js\n  var g3 = Object.create;\n  var _3 = Object.defineProperty;\n  var v2 = Object.getOwnPropertyDescriptor;\n  var y2 = Object.getOwnPropertyNames;\n  var b2 = Object.getPrototypeOf;\n  var x2 = Object.prototype.hasOwnProperty;\n  var S2 = (e2, t2) => () => (t2 || e2((t2 = { exports: {} }).exports, t2), t2.exports);\n  var ee2 = (e2, t2, n2, r2) => {\n    if (t2 && typeof t2 == `object` || typeof t2 == `function`)\n      for (var i2 = y2(t2), a3 = 0, o3 = i2.length, s3;a3 < o3; a3++)\n        s3 = i2[a3], !x2.call(e2, s3) && s3 !== n2 && _3(e2, s3, { get: ((e3) => t2[e3]).bind(null, s3), enumerable: !(r2 = v2(t2, s3)) || r2.enumerable });\n    return e2;\n  };\n  var C2 = (e2, t2, n2) => (n2 = e2 == null ? {} : g3(b2(e2)), ee2(t2 || !e2 || !e2.__esModule ? _3(n2, `default`, { value: e2, enumerable: true }) : n2, e2));\n  var w2 = /^[a-zA-Z][a-zA-Z\\d+\\-.]*:/;\n  var te2 = [`rsc://`, `file:///`, `webpack://`, `webpack-internal://`, `node:`, `turbopack://`, `metro://`, `/app-pages-browser/`];\n  var T2 = `about://React/`;\n  var ne2 = [`<anonymous>`, `eval`, ``];\n  var re2 = /\\.(jsx|tsx|ts|js)$/;\n  var ie2 = /(\\.min|bundle|chunk|vendor|vendors|runtime|polyfill|polyfills)\\.(js|mjs|cjs)$|(chunk|bundle|vendor|vendors|runtime|polyfill|polyfills|framework|app|main|index)[-_.][A-Za-z0-9_-]{4,}\\.(js|mjs|cjs)$|[\\da-f]{8,}\\.(js|mjs|cjs)$|[-_.][\\da-f]{20,}\\.(js|mjs|cjs)$|\\/dist\\/|\\/build\\/|\\/.next\\/|\\/out\\/|\\/node_modules\\/|\\.webpack\\.|\\.vite\\.|\\.turbopack\\./i;\n  var ae2 = /^\\?[\\w~.\\-]+(?:=[^&#]*)?(?:&[\\w~.\\-]+(?:=[^&#]*)?)*$/;\n  var E = `(at Server)`;\n  var oe2 = /(^|@)\\S+:\\d+/;\n  var se2 = /^\\s*at .*(\\S+:\\d+|\\(native\\))/m;\n  var ce2 = /^(eval@)?(\\[native code\\])?$/;\n  var D = (e2, t2) => {\n    if (t2?.includeInElement !== false) {\n      let n2 = e2.split(`\n`), r2 = [];\n      for (let e3 of n2)\n        if (/^\\s*at\\s+/.test(e3)) {\n          let t3 = A2(e3, undefined)[0];\n          t3 && r2.push(t3);\n        } else if (/^\\s*in\\s+/.test(e3)) {\n          let t3 = e3.replace(/^\\s*in\\s+/, ``).replace(/\\s*\\(at .*\\)$/, ``);\n          r2.push({ functionName: t3, source: e3 });\n        } else if (e3.match(oe2)) {\n          let t3 = j2(e3, undefined)[0];\n          t3 && r2.push(t3);\n        }\n      return k2(r2, t2);\n    }\n    return e2.match(se2) ? A2(e2, t2) : j2(e2, t2);\n  };\n  var O2 = (e2) => {\n    if (!e2.includes(`:`))\n      return [e2, undefined, undefined];\n    let t2 = /(.+?)(?::(\\d+))?(?::(\\d+))?$/, n2 = e2.startsWith(`(`) && e2.endsWith(`)`) ? e2.slice(1, -1) : e2, r2 = t2.exec(n2);\n    return [r2[1], r2[2] || undefined, r2[3] || undefined];\n  };\n  var k2 = (e2, t2) => t2 && t2.slice != null ? Array.isArray(t2.slice) ? e2.slice(t2.slice[0], t2.slice[1]) : e2.slice(0, t2.slice) : e2;\n  var A2 = (e2, t2) => {\n    let n2 = k2(e2.split(`\n`).filter((e3) => !!e3.match(se2)), t2);\n    return n2.map((e3) => {\n      let t3 = e3;\n      t3.includes(`(eval `) && (t3 = t3.replace(/eval code/g, `eval`).replace(/(\\(eval at [^()]*)|(,.*$)/g, ``));\n      let n3 = t3.replace(/^\\s+/, ``).replace(/\\(eval code/g, `(`).replace(/^.*?\\s+/, ``), r2 = n3.match(/ (\\(.+\\)$)/);\n      n3 = r2 ? n3.replace(r2[0], ``) : n3;\n      let i2 = O2(r2 ? r2[1] : n3), a3 = r2 && n3 || undefined, o3 = [`eval`, `<anonymous>`].includes(i2[0]) ? undefined : i2[0];\n      return { functionName: a3, fileName: o3, lineNumber: i2[1] ? +i2[1] : undefined, columnNumber: i2[2] ? +i2[2] : undefined, source: t3 };\n    });\n  };\n  var j2 = (e2, t2) => {\n    let n2 = k2(e2.split(`\n`).filter((e3) => !e3.match(ce2)), t2);\n    return n2.map((e3) => {\n      let t3 = e3;\n      if (t3.includes(` > eval`) && (t3 = t3.replace(/ line (\\d+)(?: > eval line \\d+)* > eval:\\d+:\\d+/g, `:$1`)), !t3.includes(`@`) && !t3.includes(`:`))\n        return { functionName: t3 };\n      {\n        let e4 = /(([^\\n\\r"\\u2028\\u2029]*".[^\\n\\r"\\u2028\\u2029]*"[^\\n\\r@\\u2028\\u2029]*(?:@[^\\n\\r"\\u2028\\u2029]*"[^\\n\\r@\\u2028\\u2029]*)*(?:[\\n\\r\\u2028\\u2029][^@]*)?)?[^@]*)@/, n3 = t3.match(e4), r2 = n3 && n3[1] ? n3[1] : undefined, i2 = O2(t3.replace(e4, ``));\n        return { functionName: r2, fileName: i2[0], lineNumber: i2[1] ? +i2[1] : undefined, columnNumber: i2[2] ? +i2[2] : undefined, source: t3 };\n      }\n    });\n  };\n  var pe2 = S2((exports, t2) => {\n    (function(n2, r2) {\n      typeof exports == `object` && t2 !== undefined ? r2(exports) : typeof define == `function` && define.amd ? define([`exports`], r2) : (n2 = typeof globalThis < `u` ? globalThis : n2 || self, r2(n2.sourcemapCodec = {}));\n    })(undefined, function(e2) {\n      let t3 = 44, n2 = 59, r2 = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/`, i2 = new Uint8Array(64), a3 = new Uint8Array(128);\n      for (let e3 = 0;e3 < r2.length; e3++) {\n        let t4 = r2.charCodeAt(e3);\n        i2[e3] = t4, a3[t4] = e3;\n      }\n      function o3(e3, t4) {\n        let n3 = 0, r3 = 0, i3 = 0;\n        do {\n          let t5 = e3.next();\n          i3 = a3[t5], n3 |= (i3 & 31) << r3, r3 += 5;\n        } while (i3 & 32);\n        let o4 = n3 & 1;\n        return n3 >>>= 1, o4 && (n3 = -2147483648 | -n3), t4 + n3;\n      }\n      function s3(e3, t4, n3) {\n        let r3 = t4 - n3;\n        r3 = r3 < 0 ? -r3 << 1 | 1 : r3 << 1;\n        do {\n          let t5 = r3 & 31;\n          r3 >>>= 5, r3 > 0 && (t5 |= 32), e3.write(i2[t5]);\n        } while (r3 > 0);\n        return t4;\n      }\n      function c3(e3, n3) {\n        return e3.pos >= n3 ? false : e3.peek() !== t3;\n      }\n      let l3 = 1024 * 16, u3 = typeof TextDecoder < `u` ? new TextDecoder : typeof Buffer < `u` ? { decode(e3) {\n        let t4 = Buffer.from(e3.buffer, e3.byteOffset, e3.byteLength);\n        return t4.toString();\n      } } : { decode(e3) {\n        let t4 = ``;\n        for (let n3 = 0;n3 < e3.length; n3++)\n          t4 += String.fromCharCode(e3[n3]);\n        return t4;\n      } };\n\n      class d3 {\n        constructor() {\n          this.pos = 0, this.out = ``, this.buffer = new Uint8Array(l3);\n        }\n        write(e3) {\n          let { buffer: t4 } = this;\n          t4[this.pos++] = e3, this.pos === l3 && (this.out += u3.decode(t4), this.pos = 0);\n        }\n        flush() {\n          let { buffer: e3, out: t4, pos: n3 } = this;\n          return n3 > 0 ? t4 + u3.decode(e3.subarray(0, n3)) : t4;\n        }\n      }\n\n      class f3 {\n        constructor(e3) {\n          this.pos = 0, this.buffer = e3;\n        }\n        next() {\n          return this.buffer.charCodeAt(this.pos++);\n        }\n        peek() {\n          return this.buffer.charCodeAt(this.pos);\n        }\n        indexOf(e3) {\n          let { buffer: t4, pos: n3 } = this, r3 = t4.indexOf(e3, n3);\n          return r3 === -1 ? t4.length : r3;\n        }\n      }\n      let p3 = [];\n      function m3(e3) {\n        let { length: t4 } = e3, n3 = new f3(e3), r3 = [], i3 = [], a4 = 0;\n        for (;n3.pos < t4; n3.pos++) {\n          a4 = o3(n3, a4);\n          let e4 = o3(n3, 0);\n          if (!c3(n3, t4)) {\n            let t5 = i3.pop();\n            t5[2] = a4, t5[3] = e4;\n            continue;\n          }\n          let s4 = o3(n3, 0), l4 = o3(n3, 0), u4 = l4 & 1, d4 = u4 ? [a4, e4, 0, 0, s4, o3(n3, 0)] : [a4, e4, 0, 0, s4], f4 = p3;\n          if (c3(n3, t4)) {\n            f4 = [];\n            do {\n              let e5 = o3(n3, 0);\n              f4.push(e5);\n            } while (c3(n3, t4));\n          }\n          d4.vars = f4, r3.push(d4), i3.push(d4);\n        }\n        return r3;\n      }\n      function h3(e3) {\n        let t4 = new d3;\n        for (let n3 = 0;n3 < e3.length; )\n          n3 = g4(e3, n3, t4, [0]);\n        return t4.flush();\n      }\n      function g4(e3, n3, r3, i3) {\n        let a4 = e3[n3], { 0: o4, 1: c4, 2: l4, 3: u4, 4: d4, vars: f4 } = a4;\n        n3 > 0 && r3.write(t3), i3[0] = s3(r3, o4, i3[0]), s3(r3, c4, 0), s3(r3, d4, 0);\n        let p4 = a4.length === 6 ? 1 : 0;\n        s3(r3, p4, 0), a4.length === 6 && s3(r3, a4[5], 0);\n        for (let e4 of f4)\n          s3(r3, e4, 0);\n        for (n3++;n3 < e3.length; ) {\n          let t4 = e3[n3], { 0: a5, 1: o5 } = t4;\n          if (a5 > l4 || a5 === l4 && o5 >= u4)\n            break;\n          n3 = g4(e3, n3, r3, i3);\n        }\n        return r3.write(t3), i3[0] = s3(r3, l4, i3[0]), s3(r3, u4, 0), n3;\n      }\n      function _4(e3) {\n        let { length: t4 } = e3, n3 = new f3(e3), r3 = [], i3 = [], a4 = 0, s4 = 0, l4 = 0, u4 = 0, d4 = 0, m4 = 0, h4 = 0, g5 = 0;\n        do {\n          let e4 = n3.indexOf(`;`), t5 = 0;\n          for (;n3.pos < e4; n3.pos++) {\n            if (t5 = o3(n3, t5), !c3(n3, e4)) {\n              let e5 = i3.pop();\n              e5[2] = a4, e5[3] = t5;\n              continue;\n            }\n            let f4 = o3(n3, 0), _5 = f4 & 1, v4 = f4 & 2, y4 = f4 & 4, b4 = null, x4 = p3, S4;\n            if (_5) {\n              let e5 = o3(n3, s4);\n              l4 = o3(n3, s4 === e5 ? l4 : 0), s4 = e5, S4 = [a4, t5, 0, 0, e5, l4];\n            } else\n              S4 = [a4, t5, 0, 0];\n            if (S4.isScope = !!y4, v4) {\n              let e5 = u4, t6 = d4;\n              u4 = o3(n3, u4);\n              let r4 = e5 === u4;\n              d4 = o3(n3, r4 ? d4 : 0), m4 = o3(n3, r4 && t6 === d4 ? m4 : 0), b4 = [u4, d4, m4];\n            }\n            if (S4.callsite = b4, c3(n3, e4)) {\n              x4 = [];\n              do {\n                h4 = a4, g5 = t5;\n                let e5 = o3(n3, 0), r4;\n                if (e5 < -1) {\n                  r4 = [[o3(n3, 0)]];\n                  for (let t6 = -1;t6 > e5; t6--) {\n                    let e6 = h4;\n                    h4 = o3(n3, h4), g5 = o3(n3, h4 === e6 ? g5 : 0);\n                    let t7 = o3(n3, 0);\n                    r4.push([t7, h4, g5]);\n                  }\n                } else\n                  r4 = [[e5]];\n                x4.push(r4);\n              } while (c3(n3, e4));\n            }\n            S4.bindings = x4, r3.push(S4), i3.push(S4);\n          }\n          a4++, n3.pos = e4 + 1;\n        } while (n3.pos < t4);\n        return r3;\n      }\n      function v3(e3) {\n        if (e3.length === 0)\n          return ``;\n        let t4 = new d3;\n        for (let n3 = 0;n3 < e3.length; )\n          n3 = y3(e3, n3, t4, [0, 0, 0, 0, 0, 0, 0]);\n        return t4.flush();\n      }\n      function y3(e3, n3, r3, i3) {\n        let a4 = e3[n3], { 0: o4, 1: c4, 2: l4, 3: u4, isScope: d4, callsite: f4, bindings: p4 } = a4;\n        i3[0] < o4 ? (b3(r3, i3[0], o4), i3[0] = o4, i3[1] = 0) : n3 > 0 && r3.write(t3), i3[1] = s3(r3, a4[1], i3[1]);\n        let m4 = (a4.length === 6 ? 1 : 0) | (f4 ? 2 : 0) | (d4 ? 4 : 0);\n        if (s3(r3, m4, 0), a4.length === 6) {\n          let { 4: e4, 5: t4 } = a4;\n          e4 !== i3[2] && (i3[3] = 0), i3[2] = s3(r3, e4, i3[2]), i3[3] = s3(r3, t4, i3[3]);\n        }\n        if (f4) {\n          let { 0: e4, 1: t4, 2: n4 } = a4.callsite;\n          e4 === i3[4] ? t4 !== i3[5] && (i3[6] = 0) : (i3[5] = 0, i3[6] = 0), i3[4] = s3(r3, e4, i3[4]), i3[5] = s3(r3, t4, i3[5]), i3[6] = s3(r3, n4, i3[6]);\n        }\n        if (p4)\n          for (let e4 of p4) {\n            e4.length > 1 && s3(r3, -e4.length, 0);\n            let t4 = e4[0][0];\n            s3(r3, t4, 0);\n            let n4 = o4, i4 = c4;\n            for (let t5 = 1;t5 < e4.length; t5++) {\n              let a5 = e4[t5];\n              n4 = s3(r3, a5[1], n4), i4 = s3(r3, a5[2], i4), s3(r3, a5[0], 0);\n            }\n          }\n        for (n3++;n3 < e3.length; ) {\n          let t4 = e3[n3], { 0: a5, 1: o5 } = t4;\n          if (a5 > l4 || a5 === l4 && o5 >= u4)\n            break;\n          n3 = y3(e3, n3, r3, i3);\n        }\n        return i3[0] < l4 ? (b3(r3, i3[0], l4), i3[0] = l4, i3[1] = 0) : r3.write(t3), i3[1] = s3(r3, u4, i3[1]), n3;\n      }\n      function b3(e3, t4, r3) {\n        do\n          e3.write(n2);\n        while (++t4 < r3);\n      }\n      function x3(e3) {\n        let { length: t4 } = e3, n3 = new f3(e3), r3 = [], i3 = 0, a4 = 0, s4 = 0, l4 = 0, u4 = 0;\n        do {\n          let e4 = n3.indexOf(`;`), t5 = [], d4 = true, f4 = 0;\n          for (i3 = 0;n3.pos < e4; ) {\n            let r4;\n            i3 = o3(n3, i3), i3 < f4 && (d4 = false), f4 = i3, c3(n3, e4) ? (a4 = o3(n3, a4), s4 = o3(n3, s4), l4 = o3(n3, l4), c3(n3, e4) ? (u4 = o3(n3, u4), r4 = [i3, a4, s4, l4, u4]) : r4 = [i3, a4, s4, l4]) : r4 = [i3], t5.push(r4), n3.pos++;\n          }\n          d4 || S3(t5), r3.push(t5), n3.pos = e4 + 1;\n        } while (n3.pos <= t4);\n        return r3;\n      }\n      function S3(e3) {\n        e3.sort(ee3);\n      }\n      function ee3(e3, t4) {\n        return e3[0] - t4[0];\n      }\n      function C3(e3) {\n        let r3 = new d3, i3 = 0, a4 = 0, o4 = 0, c4 = 0;\n        for (let l4 = 0;l4 < e3.length; l4++) {\n          let u4 = e3[l4];\n          if (l4 > 0 && r3.write(n2), u4.length === 0)\n            continue;\n          let d4 = 0;\n          for (let e4 = 0;e4 < u4.length; e4++) {\n            let n3 = u4[e4];\n            e4 > 0 && r3.write(t3), d4 = s3(r3, n3[0], d4), n3.length !== 1 && (i3 = s3(r3, n3[1], i3), a4 = s3(r3, n3[2], a4), o4 = s3(r3, n3[3], o4), n3.length !== 4 && (c4 = s3(r3, n3[4], c4)));\n          }\n        }\n        return r3.flush();\n      }\n      e2.decode = x3, e2.decodeGeneratedRanges = _4, e2.decodeOriginalScopes = m3, e2.encode = C3, e2.encodeGeneratedRanges = v3, e2.encodeOriginalScopes = h3, Object.defineProperty(e2, `__esModule`, { value: true });\n    });\n  });\n  var F2 = C2(pe2(), 1);\n  var I2 = /^[a-zA-Z][a-zA-Z\\d+\\-.]*:/;\n  var me2 = /^data:application\\/json[^,]+base64,/;\n  var he2 = /(?:\\/\\/[@#][ \\t]+sourceMappingURL=([^\\s\'"]+?)[ \\t]*$)|(?:\\/\\*[@#][ \\t]+sourceMappingURL=([^*]+?)[ \\t]*(?:\\*\\/)[ \\t]*$)/;\n  var L2 = typeof WeakRef < `u`;\n  var R = new Map;\n  var z2 = new Map;\n  var ge2 = (e2) => L2 && e2 instanceof WeakRef;\n  var B2 = (e2, t2, n2, r2) => {\n    if (n2 < 0 || n2 >= e2.length)\n      return null;\n    let i2 = e2[n2];\n    if (!i2 || i2.length === 0)\n      return null;\n    let a3 = null;\n    for (let e3 of i2)\n      if (e3[0] <= r2)\n        a3 = e3;\n      else\n        break;\n    if (!a3 || a3.length < 4)\n      return null;\n    let [, o3, s3, c3] = a3;\n    if (o3 === undefined || s3 === undefined || c3 === undefined)\n      return null;\n    let l3 = t2[o3];\n    return l3 ? { columnNumber: c3, fileName: l3, lineNumber: s3 + 1 } : null;\n  };\n  var V2 = (e2, t2, n2) => {\n    if (e2.sections) {\n      let r2 = null;\n      for (let i3 of e2.sections)\n        if (t2 > i3.offset.line || t2 === i3.offset.line && n2 >= i3.offset.column)\n          r2 = i3;\n        else\n          break;\n      if (!r2)\n        return null;\n      let i2 = t2 - r2.offset.line, a3 = t2 === r2.offset.line ? n2 - r2.offset.column : n2;\n      return B2(r2.map.mappings, r2.map.sources, i2, a3);\n    }\n    return B2(e2.mappings, e2.sources, t2 - 1, n2);\n  };\n  var _e2 = (e2, t2) => {\n    let n2 = t2.split(`\n`), r2;\n    for (let e3 = n2.length - 1;e3 >= 0 && !r2; e3--) {\n      let t3 = n2[e3].match(he2);\n      t3 && (r2 = t3[1] || t3[2]);\n    }\n    if (!r2)\n      return null;\n    let i2 = I2.test(r2);\n    if (!(me2.test(r2) || i2 || r2.startsWith(`/`))) {\n      let t3 = e2.split(`/`);\n      t3[t3.length - 1] = r2, r2 = t3.join(`/`);\n    }\n    return r2;\n  };\n  var ve2 = (e2) => ({ file: e2.file, mappings: (0, F2.decode)(e2.mappings), names: e2.names, sourceRoot: e2.sourceRoot, sources: e2.sources, sourcesContent: e2.sourcesContent, version: 3 });\n  var ye2 = (e2) => {\n    let t2 = e2.sections.map(({ map: e3, offset: t3 }) => ({ map: { ...e3, mappings: (0, F2.decode)(e3.mappings) }, offset: t3 })), n2 = new Set;\n    for (let e3 of t2)\n      for (let t3 of e3.map.sources)\n        n2.add(t3);\n    return { file: e2.file, mappings: [], names: [], sections: t2, sourceRoot: undefined, sources: Array.from(n2), sourcesContent: undefined, version: 3 };\n  };\n  var H2 = (e2) => {\n    if (!e2)\n      return false;\n    let t2 = e2.trim();\n    if (!t2)\n      return false;\n    let n2 = t2.match(I2);\n    if (!n2)\n      return true;\n    let r2 = n2[0].toLowerCase();\n    return r2 === `http:` || r2 === `https:`;\n  };\n  var U2 = async (e2, t2 = fetch) => {\n    if (!H2(e2))\n      return null;\n    let n2;\n    try {\n      let r3 = await t2(e2);\n      n2 = await r3.text();\n    } catch {\n      return null;\n    }\n    if (!n2)\n      return null;\n    let r2 = _e2(e2, n2);\n    if (!r2 || !H2(r2))\n      return null;\n    try {\n      let e3 = await t2(r2), n3 = await e3.json();\n      return `sections` in n3 ? ye2(n3) : ve2(n3);\n    } catch {\n      return null;\n    }\n  };\n  var W2 = async (e2, t2 = true, n2) => {\n    if (t2 && R.has(e2)) {\n      let t3 = R.get(e2);\n      if (t3 == null)\n        return null;\n      if (ge2(t3)) {\n        let n3 = t3.deref();\n        if (n3)\n          return n3;\n        R.delete(e2);\n      } else\n        return t3;\n    }\n    if (t2 && z2.has(e2))\n      return z2.get(e2);\n    let r2 = U2(e2, n2);\n    t2 && z2.set(e2, r2);\n    let i2 = await r2;\n    return t2 && z2.delete(e2), t2 && (i2 === null ? R.set(e2, null) : R.set(e2, L2 ? new WeakRef(i2) : i2)), i2;\n  };\n  var G2 = async (e2, t2 = true, n2) => await Promise.all(e2.map(async (e3) => {\n    if (!e3.fileName)\n      return e3;\n    let r2 = await W2(e3.fileName, t2, n2);\n    if (!r2 || typeof e3.lineNumber != `number` || typeof e3.columnNumber != `number`)\n      return e3;\n    let i2 = V2(r2, e3.lineNumber, e3.columnNumber);\n    return i2 ? { ...e3, source: i2.fileName && e3.source ? e3.source.replace(e3.fileName, i2.fileName) : e3.source, fileName: i2.fileName, lineNumber: i2.lineNumber, columnNumber: i2.columnNumber, isSymbolicated: true } : e3;\n  }));\n  var K2 = (e2) => e2._debugStack instanceof Error && typeof e2._debugStack?.stack == `string`;\n  var be2 = () => {\n    let n2 = h();\n    for (let t2 of [...Array.from(d), ...Array.from(n2.renderers.values())]) {\n      let e2 = t2.currentDispatcherRef;\n      if (e2 && typeof e2 == `object`)\n        return `H` in e2 ? e2.H : e2.current;\n    }\n    return null;\n  };\n  var q = (t2) => {\n    for (let n2 of d) {\n      let e2 = n2.currentDispatcherRef;\n      e2 && typeof e2 == `object` && (`H` in e2 ? e2.H = t2 : e2.current = t2);\n    }\n  };\n  var J = (e2) => `\n    in ${e2}`;\n  var Y = (e2, t2) => {\n    let n2 = J(e2);\n    return t2 && (n2 += ` (at ${t2})`), n2;\n  };\n  var X2 = false;\n  var Z = (e2, t2) => {\n    if (!e2 || X2)\n      return ``;\n    let n2 = Error.prepareStackTrace;\n    Error.prepareStackTrace = undefined, X2 = true;\n    let r2 = be2();\n    q(null);\n    let { error: i2, warn: a3 } = console;\n    console.error = () => {}, console.warn = () => {};\n    try {\n      let n3 = { DetermineComponentFrameRoot() {\n        let n4;\n        try {\n          if (t2) {\n            let t3 = function() {\n              throw Error();\n            };\n            if (Object.defineProperty(t3.prototype, `props`, { set: function() {\n              throw Error();\n            } }), typeof Reflect == `object` && Reflect.construct) {\n              try {\n                Reflect.construct(t3, []);\n              } catch (e3) {\n                n4 = e3;\n              }\n              Reflect.construct(e2, [], t3);\n            } else {\n              try {\n                t3.call();\n              } catch (e3) {\n                n4 = e3;\n              }\n              e2.call(t3.prototype);\n            }\n          } else {\n            try {\n              throw Error();\n            } catch (e3) {\n              n4 = e3;\n            }\n            let t3 = e2();\n            t3 && typeof t3.catch == `function` && t3.catch(() => {});\n          }\n        } catch (e3) {\n          if (e3 instanceof Error && n4 instanceof Error && typeof e3.stack == `string`)\n            return [e3.stack, n4.stack];\n        }\n        return [null, null];\n      } };\n      n3.DetermineComponentFrameRoot.displayName = `DetermineComponentFrameRoot`;\n      let r3 = Object.getOwnPropertyDescriptor(n3.DetermineComponentFrameRoot, `name`);\n      r3?.configurable && Object.defineProperty(n3.DetermineComponentFrameRoot, `name`, { value: `DetermineComponentFrameRoot` });\n      let [i3, a4] = n3.DetermineComponentFrameRoot();\n      if (i3 && a4) {\n        let t3 = i3.split(`\n`), n4 = a4.split(`\n`), r4 = 0, o4 = 0;\n        for (;r4 < t3.length && !t3[r4].includes(`DetermineComponentFrameRoot`); )\n          r4++;\n        for (;o4 < n4.length && !n4[o4].includes(`DetermineComponentFrameRoot`); )\n          o4++;\n        if (r4 === t3.length || o4 === n4.length)\n          for (r4 = t3.length - 1, o4 = n4.length - 1;r4 >= 1 && o4 >= 0 && t3[r4] !== n4[o4]; )\n            o4--;\n        for (;r4 >= 1 && o4 >= 0; r4--, o4--)\n          if (t3[r4] !== n4[o4]) {\n            if (r4 !== 1 || o4 !== 1)\n              do\n                if (r4--, o4--, o4 < 0 || t3[r4] !== n4[o4]) {\n                  let n5 = `\n${t3[r4].replace(` at new `, ` at `)}`, i4 = Te(e2);\n                  return i4 && n5.includes(`<anonymous>`) && (n5 = n5.replace(`<anonymous>`, i4)), n5;\n                }\n              while (r4 >= 1 && o4 >= 0);\n            break;\n          }\n      }\n    } finally {\n      X2 = false, Error.prepareStackTrace = n2, q(r2), console.error = i2, console.warn = a3;\n    }\n    let o3 = e2 ? Te(e2) : ``, s3 = o3 ? J(o3) : ``;\n    return s3;\n  };\n  var xe2 = (e2, t2) => {\n    let m3 = e2.tag, h3 = ``;\n    switch (m3) {\n      case ne:\n        h3 = J(`Activity`);\n        break;\n      case o2:\n        h3 = Z(e2.type, true);\n        break;\n      case f2:\n        h3 = Z(e2.type.render, false);\n        break;\n      case a2:\n      case h2:\n        h3 = Z(e2.type, false);\n        break;\n      case c2:\n      case y:\n      case b:\n        h3 = J(e2.type);\n        break;\n      case ee:\n        h3 = J(`Lazy`);\n        break;\n      case p2:\n        h3 = e2.child !== t2 && t2 !== null ? J(`Suspense Fallback`) : J(`Suspense`);\n        break;\n      case te:\n        h3 = J(`SuspenseList`);\n        break;\n      case re:\n        h3 = J(`ViewTransition`);\n        break;\n      default:\n        return ``;\n    }\n    return h3;\n  };\n  var Se2 = (e2) => {\n    try {\n      let t2 = ``, n2 = e2, r2 = null;\n      do {\n        t2 += xe2(n2, r2);\n        let e3 = n2._debugInfo;\n        if (e3 && Array.isArray(e3))\n          for (let n3 = e3.length - 1;n3 >= 0; n3--) {\n            let r3 = e3[n3];\n            typeof r3.name == `string` && (t2 += Y(r3.name, r3.env));\n          }\n        r2 = n2, n2 = n2.return;\n      } while (n2);\n      return t2;\n    } catch (e3) {\n      return e3 instanceof Error ? `\nError generating stack: ${e3.message}\n${e3.stack}` : ``;\n    }\n  };\n  var Ce2 = (e2) => {\n    let t2 = Error.prepareStackTrace;\n    Error.prepareStackTrace = undefined;\n    let n2 = e2;\n    if (!n2)\n      return ``;\n    Error.prepareStackTrace = t2, n2.startsWith(`Error: react-stack-top-frame\n`) && (n2 = n2.slice(29));\n    let r2 = n2.indexOf(`\n`);\n    if (r2 !== -1 && (n2 = n2.slice(r2 + 1)), r2 = Math.max(n2.indexOf(`react_stack_bottom_frame`), n2.indexOf(`react-stack-bottom-frame`)), r2 !== -1 && (r2 = n2.lastIndexOf(`\n`, r2)), r2 !== -1)\n      n2 = n2.slice(0, r2);\n    else\n      return ``;\n    return n2;\n  };\n  var we2 = (e2) => !!(e2.fileName?.startsWith(`rsc://`) && e2.functionName);\n  var Te2 = (e2, t2) => e2.fileName === t2.fileName && e2.lineNumber === t2.lineNumber && e2.columnNumber === t2.columnNumber;\n  var Ee2 = (e2) => {\n    let t2 = new Map;\n    for (let n2 of e2)\n      for (let e3 of n2.stackFrames) {\n        if (!we2(e3))\n          continue;\n        let n3 = e3.functionName, r2 = t2.get(n3) ?? [], i2 = r2.some((t3) => Te2(t3, e3));\n        i2 || (r2.push(e3), t2.set(n3, r2));\n      }\n    return t2;\n  };\n  var De2 = (e2, t2, n2) => {\n    if (!e2.functionName)\n      return { ...e2, isServer: true };\n    let r2 = t2.get(e2.functionName);\n    if (!r2 || r2.length === 0)\n      return { ...e2, isServer: true };\n    let i2 = n2.get(e2.functionName) ?? 0, a3 = r2[i2 % r2.length];\n    return n2.set(e2.functionName, i2 + 1), { ...e2, isServer: true, fileName: a3.fileName, lineNumber: a3.lineNumber, columnNumber: a3.columnNumber, source: e2.source?.replace(E, `(${a3.fileName}:${a3.lineNumber}:${a3.columnNumber})`) };\n  };\n  var Oe = (e2) => {\n    let t2 = [];\n    return N(e2, (e3) => {\n      if (!K2(e3))\n        return;\n      let n2 = typeof e3.type == `string` ? e3.type : Te(e3.type) || `<anonymous>`;\n      t2.push({ componentName: n2, stackFrames: D(Ce2(e3._debugStack?.stack)) });\n    }, true), t2;\n  };\n  var Q = async (e2, t2 = true, n2) => {\n    let r2 = Oe(e2), i2 = D(Se2(e2)), a3 = Ee2(r2), o3 = new Map, s3 = i2.map((e3) => {\n      let t3 = e3.source?.includes(E) ?? false;\n      return t3 ? De2(e3, a3, o3) : e3;\n    }), c3 = s3.filter((e3, t3, n3) => {\n      if (t3 === 0)\n        return true;\n      let r3 = n3[t3 - 1];\n      return e3.functionName !== r3.functionName;\n    });\n    return G2(c3, t2, n2);\n  };\n  var ke2 = (e2) => {\n    let t2 = e2._debugSource;\n    return t2 ? typeof t2 == `object` && !!t2 && `fileName` in t2 && typeof t2.fileName == `string` && `lineNumber` in t2 && typeof t2.lineNumber == `number` : false;\n  };\n  var Ae2 = async (e2, t2 = true, n2) => {\n    if (ke2(e2)) {\n      let t3 = e2._debugSource;\n      return t3 || null;\n    }\n    let r2 = await Q(e2, t2, n2);\n    for (let e3 of r2)\n      if (e3.fileName)\n        return { fileName: e3.fileName, lineNumber: e3.lineNumber, columnNumber: e3.columnNumber, functionName: e3.functionName };\n    return null;\n  };\n  var $2 = (e2) => {\n    if (!e2 || ne2.some((t3) => t3 === e2))\n      return ``;\n    let t2 = e2;\n    if (t2.startsWith(`http://`) || t2.startsWith(`https://`))\n      try {\n        let e3 = new URL(t2);\n        t2 = e3.pathname;\n      } catch {}\n    if (t2.startsWith(T2)) {\n      let e3 = t2.slice(T2.length), n3 = e3.indexOf(`/`), r3 = e3.indexOf(`:`);\n      t2 = n3 !== -1 && (r3 === -1 || n3 < r3) ? e3.slice(n3 + 1) : e3;\n    }\n    let n2 = true;\n    for (;n2; ) {\n      n2 = false;\n      for (let e3 of te2)\n        if (t2.startsWith(e3)) {\n          t2 = t2.slice(e3.length), e3 === `file:///` && (t2 = `/${t2.replace(/^\\/+/, ``)}`), n2 = true;\n          break;\n        }\n    }\n    if (w2.test(t2)) {\n      let e3 = t2.match(w2);\n      e3 && (t2 = t2.slice(e3[0].length));\n    }\n    if (t2.startsWith(`//`)) {\n      let e3 = t2.indexOf(`/`, 2);\n      t2 = e3 === -1 ? `` : t2.slice(e3);\n    }\n    let r2 = t2.indexOf(`?`);\n    if (r2 !== -1) {\n      let e3 = t2.slice(r2);\n      ae2.test(e3) && (t2 = t2.slice(0, r2));\n    }\n    return t2;\n  };\n  var je2 = (e2) => {\n    let t2 = $2(e2);\n    return !(!t2 || !re2.test(t2) || ie2.test(t2));\n  };\n\n  // dist/_bippy-entry-6818-1793959649102.js\n  globalThis.__bippy = {\n    getFiberFromHostInstance: Pe,\n    getDisplayName: Te,\n    traverseFiber: N,\n    isCompositeFiber: pe,\n    isHostFiber: k,\n    getSource: Ae2,\n    getOwnerStack: Q,\n    normalizeFileName: $2,\n    isSourceFile: je2\n  };\n})();\n';
const js = dedent;
function isTruthy(value) {
  return Boolean(value);
}
const RELAY_HOST = "127.0.0.1";
const RELAY_PORT = Number("19988") || 19988;
const FAST_CDP_COMMAND_TIMEOUT_MS = /* @__PURE__ */ new Map([
  ["Browser.getWindowForTarget", 1e4],
  ["Page.enable", 1e4],
  ["Page.getFrameTree", 1e4],
  ["Page.setLifecycleEventsEnabled", 1e4],
  ["Page.createIsolatedWorld", 1e4],
  ["Page.setDownloadBehavior", 1e4],
  ["Log.enable", 1e4],
  ["Network.enable", 1e4],
  ["Emulation.setFocusEmulationEnabled", 1e4],
  ["Emulation.setEmulatedMedia", 1e4],
  ["Runtime.runIfWaitingForDebugger", 1e4],
  ["Target.setAutoAttach", 1e4]
]);
async function sendCommandWithTimeout(debuggee, method, params, timeout) {
  let timeoutId;
  try {
    return await Promise.race([
      chrome.debugger.sendCommand(debuggee, method, params),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`CDP command timed out after ${timeout}ms: ${method} (tab may be frozen/hibernated)`));
        }, timeout);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
function withTimeout(promise, timeoutMs, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(fallback);
      }
    );
  });
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function createInstallId() {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return Array.from(values).map((value) => {
    return value.toString(36);
  }).join("");
}
function browserNameFromBrands(brands) {
  const brandNames = brands.map((brand) => {
    return brand.brand.trim().toLowerCase();
  });
  if (brandNames.some((brand) => brand === "brave")) return "Brave";
  if (brandNames.some((brand) => brand === "microsoft edge")) return "Edge";
  if (brandNames.some((brand) => brand === "opera")) return "Opera";
  if (brandNames.some((brand) => brand === "vivaldi")) return "Vivaldi";
  if (brandNames.some((brand) => brand === "google chrome canary")) return "Chrome Canary";
  if (brandNames.some((brand) => brand === "google chrome")) return "Chrome";
  if (brandNames.some((brand) => brand === "chromium")) return "Chromium";
  return null;
}
async function detectBrowserName() {
  if (chrome.ghostPublicAPI) {
    return "Ghost";
  }
  const navigatorWithUaData = navigator;
  const brands = navigatorWithUaData.userAgentData?.brands;
  const highEntropyPromise = navigatorWithUaData.userAgentData?.getHighEntropyValues?.(["fullVersionList"]);
  const highEntropyValues = highEntropyPromise ? await withTimeout(highEntropyPromise, 2e3, null) : null;
  const fullVersionList = highEntropyValues?.fullVersionList || [];
  const highEntropyName = browserNameFromBrands(fullVersionList);
  if (highEntropyName) {
    return highEntropyName;
  }
  if (brands && brands.length > 0) {
    const lowEntropyName = browserNameFromBrands(brands);
    if (lowEntropyName) {
      return lowEntropyName;
    }
  }
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("edg/")) return "Edge";
  if (ua.includes("opr/")) return "Opera";
  if (ua.includes("vivaldi")) return "Vivaldi";
  if (ua.includes("brave")) return "Brave";
  if (ua.includes("chrome")) return "Chrome";
  return "Chromium";
}
let identityPromise = null;
let installIdPromise = null;
const tabSessionScope = (() => {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return Array.from(values).map((value) => {
    return value.toString(36);
  }).join("");
})();
async function getInstallId() {
  if (installIdPromise) {
    return installIdPromise;
  }
  installIdPromise = (async () => {
    const existing = await chrome.storage.local.get("playwriterInstallId");
    const storedInstallId = typeof existing.playwriterInstallId === "string" ? existing.playwriterInstallId : "";
    if (storedInstallId) {
      return storedInstallId;
    }
    const installId = createInstallId();
    await chrome.storage.local.set({ playwriterInstallId: installId });
    return installId;
  })().catch((error) => {
    installIdPromise = null;
    throw error;
  });
  return installIdPromise;
}
async function getExtensionIdentity() {
  if (identityPromise) {
    return identityPromise;
  }
  identityPromise = (async () => {
    const browser = await detectBrowserName();
    const installId = await withTimeout(getInstallId(), 2e3, tabSessionScope);
    const info = await withTimeout(
      chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }),
      2e3,
      { email: "", id: "" }
    );
    return {
      browser,
      email: info.email || "",
      id: info.id || "",
      installId
    };
  })();
  return identityPromise;
}
let childSessions = /* @__PURE__ */ new Map();
let nextSessionId = 1;
let tabGroupQueue = Promise.resolve();
let autoAttachParams = null;
let remoteTunnel = null;
const remoteRelayConnections = /* @__PURE__ */ new Map();
function detachAllTabDebuggers() {
  for (const tabId of store.getState().tabs.keys()) {
    chrome.debugger.detach({ tabId }).catch((err) => {
      logger.debug("Error detaching from tab:", tabId, err.message);
    });
  }
  childSessions.clear();
}
function markAllTabsConnecting(tabs) {
  return new Map(
    Array.from(tabs.entries()).map(([tabId, tab]) => {
      return [tabId, { ...tab, state: "connecting" }];
    })
  );
}
class ConnectionManager {
  ws = null;
  connectionPromise = null;
  // Monotonic id bumped on every connect(). The global timeout in ensureConnection()
  // does NOT cancel a losing connect(), so a stale socket's late onopen could otherwise
  // clobber `this.ws` of a newer attempt. Every socket callback checks this id and goes
  // inert if it belongs to a superseded attempt. Fixes the connect/disconnect loop (#40).
  currentAttemptId = 0;
  preserveTabsOnDetach = false;
  async ensureConnection() {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (store.getState().connectionState === "extension-replaced") {
      throw new Error("Another Playwriter extension is already connected");
    }
    const GLOBAL_TIMEOUT_MS = 15e3;
    this.connectionPromise = Promise.race([
      this.connect(),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error("Connection timeout (global)"));
        }, GLOBAL_TIMEOUT_MS);
      })
    ]);
    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }
  async connect() {
    const attemptId = ++this.currentAttemptId;
    logger.debug(`Waiting for server at http://${RELAY_HOST}:${RELAY_PORT}...`);
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await fetch(`http://${RELAY_HOST}:${RELAY_PORT}`, { method: "HEAD", signal: AbortSignal.timeout(2e3) });
        logger.debug("Server is available");
        break;
      } catch {
        if (attempt === maxAttempts - 1) {
          throw new Error("Server not available");
        }
        logger.debug(`Server not available, retrying... (attempt ${attempt + 1}/${maxAttempts})`);
        await sleep(1e3);
      }
    }
    const identity = await getExtensionIdentity();
    const relayUrl = new URL(`ws://${RELAY_HOST}:${RELAY_PORT}/extension`);
    if (identity.browser) {
      relayUrl.searchParams.set("browser", identity.browser);
    }
    if (identity.email) {
      relayUrl.searchParams.set("email", identity.email);
    }
    if (identity.id) {
      relayUrl.searchParams.set("id", identity.id);
    }
    if (identity.installId) {
      relayUrl.searchParams.set("installId", identity.installId);
    }
    {
      relayUrl.searchParams.set("v", "0.10.0");
    }
    relayUrl.searchParams.set("capabilities", INVENTORY_READY_CAPABILITY);
    logger.debug("Creating WebSocket connection to:", relayUrl);
    const socket = new WebSocket(relayUrl.toString());
    await new Promise((resolve, reject) => {
      let settled = false;
      let handshakeTimeout = null;
      const openTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        logger.debug("WebSocket connection TIMEOUT after 5 seconds");
        try {
          socket.close();
        } catch {
        }
        reject(new Error("Connection timeout"));
      }, 5e3);
      const rejectConnection = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(openTimeout);
        if (handshakeTimeout) {
          clearTimeout(handshakeTimeout);
        }
        reject(error);
      };
      socket.onmessage = async (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (error) {
          logger.debug("Error parsing message:", error);
          sendToLocalRelay({ error: { code: -32700, message: `Error parsing message: ${error.message}` } });
          return;
        }
        await dispatchRelayMessage(message, localRelaySink);
      };
      socket.onerror = (event) => {
        logger.debug("WebSocket error:", event);
        rejectConnection(new Error("WebSocket connection failed"));
      };
      socket.onclose = (event) => {
        logger.debug("WebSocket closed:", { code: event.code, reason: event.reason });
        const error = event.code === 4002 || event.reason === "Extension Already In Use" ? new Error("Extension Already In Use") : new Error(`WebSocket closed: ${event.reason || event.code}`);
        rejectConnection(error);
        if (this.ws === socket && attemptId === this.currentAttemptId) {
          recorderActive = false;
          skillRecordingId = null;
          setRecorderStateInAllTabs(false);
          this.handleClose(event.reason, event.code);
        }
      };
      socket.onopen = () => {
        if (settled) return;
        if (attemptId !== this.currentAttemptId) {
          try {
            socket.close();
          } catch {
          }
          return;
        }
        clearTimeout(openTimeout);
        this.ws = socket;
        handshakeTimeout = setTimeout(() => {
          socket.close(EXTENSION_INVENTORY_TIMEOUT_CLOSE, "Target inventory timeout");
          rejectConnection(new Error("Target inventory timeout"));
        }, 15e3);
        void completeLocalRelayHandshake(socket).then(
          () => {
            if (settled) return;
            if (attemptId !== this.currentAttemptId) {
              try {
                socket.close();
              } catch {
              }
              return;
            }
            settled = true;
            logger.debug("WebSocket connected");
            if (handshakeTimeout) {
              clearTimeout(handshakeTimeout);
            }
            resolve();
          },
          (error) => {
            socket.close(EXTENSION_INVENTORY_FAILED_CLOSE, "Target inventory failed");
            rejectConnection(new Error("Could not announce extension target inventory", { cause: error }));
          }
        );
      };
    });
    logger.debug("Connection established");
  }
  handleClose(reason, code) {
    try {
      const mem = performance.memory;
      if (mem) {
        const formatMB = (b) => (b / 1024 / 1024).toFixed(2) + "MB";
        logger.warn(
          `DISCONNECT MEMORY: used=${formatMB(mem.usedJSHeapSize)} total=${formatMB(mem.totalJSHeapSize)} limit=${formatMB(mem.jsHeapSizeLimit)}`
        );
      }
    } catch {
    }
    logger.warn(`DISCONNECT: WS closed code=${code} reason=${reason || "none"} stack=${getCallStack()}`);
    const isExtensionReplaced = reason === "Extension Replaced" || code === 4001;
    const isExtensionInUse = reason === "Extension Already In Use" || code === 4002;
    this.preserveTabsOnDetach = !(isExtensionReplaced || isExtensionInUse);
    const keepTabsForRemote = remoteTunnel !== null;
    if (!keepTabsForRemote) {
      detachAllTabDebuggers();
    }
    this.ws = null;
    if (isExtensionReplaced || isExtensionInUse) {
      const errorText = isExtensionReplaced ? "Another Playwriter extension took over the connection" : "Another Playwriter extension is actively in use";
      logger.debug(
        isExtensionReplaced ? "Disconnected: another Playwriter extension connected (this one was idle)" : "Rejected: another Playwriter extension is actively in use"
      );
      store.setState((state) => {
        return {
          tabs: keepTabsForRemote ? state.tabs : /* @__PURE__ */ new Map(),
          connectionState: "extension-replaced",
          errorText
        };
      });
      return;
    }
    store.setState((state) => {
      return {
        tabs: keepTabsForRemote ? state.tabs : markAllTabsConnecting(state.tabs),
        connectionState: "idle",
        errorText: void 0
      };
    });
  }
  async maintainLoop() {
    while (true) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        await sleep(1e3);
        continue;
      }
      if (store.getState().connectionState === "extension-replaced") {
        try {
          const response = await fetch(`http://${RELAY_HOST}:${RELAY_PORT}/extension/status`, {
            method: "GET",
            signal: AbortSignal.timeout(2e3)
          });
          const data = await response.json();
          const slotAvailable = !data.connected;
          if (slotAvailable) {
            store.setState({ connectionState: "idle", errorText: void 0 });
            logger.debug(
              "Extension slot is free (connected:",
              data.connected,
              "activeTargets:",
              data.activeTargets,
              "), cleared error state"
            );
          } else {
            logger.debug("Extension slot still taken (activeTargets:", data.activeTargets, "), will retry...");
          }
        } catch {
          logger.debug("Server not available, will retry...");
        }
        await sleep(3e3);
        continue;
      }
      const hasConnectedTabs = Array.from(store.getState().tabs.values()).some((t) => t.state === "connected");
      if (hasConnectedTabs && remoteTunnel === null) {
        store.setState((state) => {
          const newTabs = new Map(state.tabs);
          for (const [tabId, tab] of newTabs) {
            if (tab.state === "connected") {
              newTabs.set(tabId, { ...tab, state: "connecting" });
            }
          }
          return { tabs: newTabs };
        });
      }
      try {
        await this.ensureConnection();
        store.setState({ connectionState: "connected" });
        this.preserveTabsOnDetach = false;
      } catch (error) {
        logger.debug("Connection attempt failed:", error.message);
        if (error.message === "Extension Already In Use") {
          store.setState({
            connectionState: "extension-replaced",
            errorText: "Another Playwriter extension is actively in use"
          });
        } else {
          store.setState({ connectionState: "idle" });
        }
      }
      await sleep(3e3);
    }
  }
}
const connectionManager = new ConnectionManager();
const store = createStore(() => ({
  tabs: /* @__PURE__ */ new Map(),
  connectionState: "idle",
  currentTabId: void 0,
  preferredWindowId: void 0,
  errorText: void 0
}));
globalThis.toggleExtensionForActiveTab = toggleExtensionForActiveTab;
globalThis.disconnectEverything = disconnectEverything;
globalThis.getExtensionState = () => store.getState();
globalThis.startRemoteControlForActiveTab = startRemoteControlForActiveTab;
globalThis.stopRemoteControl = stopRemoteControl;
globalThis.getRemoteControlState = getRemoteControlState;
globalThis.runMenuItemForActiveTab = runMenuItemForActiveTab;
const MAX_LOG_STRING_LENGTH = 2e3;
function truncateLogString(value) {
  if (value.length <= MAX_LOG_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_LOG_STRING_LENGTH)}…[truncated ${value.length - MAX_LOG_STRING_LENGTH} chars]`;
}
function safeSerialize(arg) {
  if (arg === void 0) return "undefined";
  if (arg === null) return "null";
  if (typeof arg === "function") return `[Function: ${arg.name || "anonymous"}]`;
  if (typeof arg === "symbol") return String(arg);
  if (typeof arg === "string") return truncateLogString(arg);
  if (arg instanceof Error) return truncateLogString(arg.stack || arg.message || String(arg));
  if (typeof arg === "object") {
    try {
      const seen = /* @__PURE__ */ new WeakSet();
      const serialized = JSON.stringify(arg, (key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
          if (value instanceof Map) return { dataType: "Map", value: Array.from(value.entries()) };
          if (value instanceof Set) return { dataType: "Set", value: Array.from(value.values()) };
        }
        return value;
      });
      return truncateLogString(serialized);
    } catch {
      return truncateLogString(String(arg));
    }
  }
  return truncateLogString(String(arg));
}
function sendLog(level, args) {
  sendMessage({
    method: "log",
    params: { level, args: args.map(safeSerialize) }
  });
}
const logger = {
  log: (...args) => {
    console.log(...args);
    sendLog("log", args);
  },
  debug: (...args) => {
    console.debug(...args);
    sendLog("debug", args);
  },
  info: (...args) => {
    console.info(...args);
    sendLog("info", args);
  },
  warn: (...args) => {
    console.warn(...args);
    sendLog("warn", args);
  },
  error: (...args) => {
    console.error(...args);
    sendLog("error", args);
  }
};
function getCallStack() {
  const stack = new Error().stack || "";
  return stack.split("\n").slice(2, 6).join(" <- ").replace(/\s+/g, " ");
}
self.addEventListener("error", (event) => {
  const error = event.error;
  const stack = error?.stack || `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`;
  logger.error("Uncaught error:", stack);
});
self.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const stack = reason?.stack || String(reason);
  logger.error("Unhandled promise rejection:", stack);
});
let messageCount = 0;
function sendToLocalRelay(message) {
  if (connectionManager.ws?.readyState === WebSocket.OPEN) {
    try {
      connectionManager.ws.send(JSON.stringify(message));
      if (++messageCount % 100 === 0) {
        checkMemory();
      }
    } catch (error) {
      console.debug("ERROR sending message:", error, "message type:", message.method || "response");
    }
  }
}
const localRelaySink = { send: sendToLocalRelay };
function resolveTabGroupKey({ key, remote }) {
  if (!key) {
    return void 0;
  }
  return remote ? namespaceRemoteTabGroupKey(key) : key;
}
function broadcastEventToRemoteRelays(message) {
  if (message?.method !== "forwardCDPEvent") {
    return;
  }
  for (const conn of remoteRelayConnections.values()) {
    conn.send(message);
  }
}
function sendMessage(message) {
  sendToLocalRelay(message);
  broadcastEventToRemoteRelays(message);
}
async function dispatchRelayMessage(message, sink) {
  if (message.method === "ping") {
    sink.send({ method: "pong" });
    return;
  }
  if (message.method === "forwardCDPCommand" && message.params?.method === "Page.screencastFrameAck") {
    if (message.id !== void 0) {
      sink.send({ id: message.id, result: {} });
    }
    return;
  }
  if (message.method === "setRecorderState") {
    recorderActive = !!message.params?.recording;
    if (!recorderActive) {
      skillRecordingId = null;
    }
    setRecorderStateInAllTabs(recorderActive);
    return;
  }
  if (sink.remoteRuntime) {
    const rejection = getRemoteExtensionMethodRejection(message.method);
    if (rejection) {
      if (message.id !== void 0) {
        sink.send({ id: message.id, error: rejection });
      }
      return;
    }
  }
  if (message.method === "createInitialTab") {
    try {
      const initialTabParams = message.params;
      const groupTitle = normalizeTabGroupTitle(initialTabParams?.tabGroup) || void 0;
      const groupKey = resolveTabGroupKey({ key: initialTabParams?.tabGroupKey, remote: Boolean(sink.remoteRuntime) });
      const groupColor = normalizeTabGroupColor(initialTabParams?.tabGroupColor) || void 0;
      logger.debug("Creating initial tab for Playwright client, group:", groupTitle || DEFAULT_TAB_GROUP_TITLE);
      const tab = await createTabInPreferredWindow({ url: "about:blank", active: false });
      if (tab.id) {
        const tabId = tab.id;
        setTabConnecting(tabId, { groupTitle, groupKey, groupColor });
        const attach = () => {
          return attachTab(tabId, { skipAttachedEvent: true });
        };
        const { targetInfo, sessionId } = sink.remoteRuntime ? await attachForRemote({ runtime: sink.remoteRuntime, tabId, attach }) : await attach();
        logger.debug("Initial tab created and connected:", tab.id, "sessionId:", sessionId);
        sink.send({
          id: message.id,
          result: {
            success: true,
            tabId: tab.id,
            sessionId,
            targetInfo
          }
        });
      } else {
        throw new Error("Failed to create tab - no tab ID returned");
      }
    } catch (error) {
      logger.debug("Failed to create initial tab:", error);
      sink.send({ id: message.id, error: error.message });
    }
    return;
  }
  if (message.method === "closeTabsForKey") {
    const params = message.params;
    const key = resolveTabGroupKey({ key: params?.key, remote: Boolean(sink.remoteRuntime) });
    if (!key) {
      sink.send({ id: message.id, error: "closeTabsForKey requires a key" });
      return;
    }
    const tabIds = [...store.getState().tabs].filter(([, info]) => info.groupKey === key).map(([tabId]) => tabId);
    void Promise.allSettled(tabIds.map((tabId) => chrome.tabs.remove(tabId))).then((results) => {
      const errors = results.flatMap((r) => r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : []).filter((error) => !error.startsWith("No tab with id"));
      if (errors.length > 0) {
        sink.send({ id: message.id, error: errors.join("; ") });
        return;
      }
      const closedTabs = results.filter((r) => r.status === "fulfilled").length;
      sink.send({ id: message.id, result: { success: true, closedTabs } });
    });
    return;
  }
  if (message.method === "updateTabGroup") {
    tabGroupQueue = tabGroupQueue.then(async () => {
      try {
        const params = message.params;
        const from = normalizeTabGroupTitle(params?.from);
        const to = normalizeTabGroupTitle(params?.to);
        const remote = Boolean(sink.remoteRuntime);
        const key = resolveTabGroupKey({ key: params?.key, remote });
        const color = normalizeTabGroupColor(params?.color) || void 0;
        if (!from || !to) {
          sink.send({ id: message.id, error: "updateTabGroup requires non-empty from/to titles" });
          return;
        }
        const fromIsDefault = from === DEFAULT_TAB_GROUP_TITLE;
        const isRename = to !== from;
        let movedTabs = 0;
        store.setState((state) => {
          const newTabs = new Map(state.tabs);
          for (const [tabId, info] of newTabs) {
            if (!shouldUpdateTabGroupForTab({
              currentTitle: info.groupTitle || DEFAULT_TAB_GROUP_TITLE,
              currentKey: info.groupKey,
              from,
              key,
              ownedOnly: remote
            })) {
              continue;
            }
            const changedTitle = isRename && info.groupTitle !== to;
            const changedColor = color !== void 0 && info.groupColor !== color;
            if (!changedTitle && !changedColor) {
              continue;
            }
            newTabs.set(tabId, {
              ...info,
              groupTitle: isRename ? to : info.groupTitle,
              groupColor: color ?? info.groupColor
            });
            movedTabs++;
          }
          return { tabs: newTabs };
        });
        if (!fromIsDefault && !remote) {
          const managedTitles = await getManagedTabGroupTitles();
          if (managedTitles.has(from)) {
            const persisted = await loadManagedTabGroups();
            const ownedTabIds = /* @__PURE__ */ new Set([...persisted.ownedTabIds, ...store.getState().tabs.keys()]);
            const explicitColor = color || Array.from(store.getState().tabs.values()).find((info) => {
              return (info.groupTitle || DEFAULT_TAB_GROUP_TITLE) === to && info.groupColor;
            })?.groupColor;
            const allGroups = await chrome.tabGroups.query({});
            for (const group of allGroups) {
              if (group.title !== from) {
                continue;
              }
              const tabsInGroup = await chrome.tabs.query({ groupId: group.id });
              const hasForeignTabs = tabsInGroup.some((t) => t.id !== void 0 && !ownedTabIds.has(t.id));
              if (hasForeignTabs) {
                continue;
              }
              await chrome.tabGroups.update(group.id, {
                title: to,
                color: explicitColor || colorForTabGroupTitle(to)
              });
            }
            if (isRename) {
              persisted.titles.delete(from);
              persisted.titles.add(to);
              saveManagedTabGroups(persisted);
            }
          }
        }
        sink.send({ id: message.id, result: { success: true, movedTabs } });
      } catch (error) {
        logger.error("Failed to update tab group:", error);
        sink.send({ id: message.id, error: error.message });
      }
    }).catch((e) => {
      logger.debug("updateTabGroup queue error:", e);
    });
    return;
  }
  if (message.method === "ghost-browser") {
    const params = message.params;
    const result = await handleGhostBrowserCommand(params, chrome);
    if (!result.success) {
      logger.error("Ghost Browser API error:", result.error);
    }
    if (result.success && params.namespace === "ghostPublicAPI" && params.method === "openTab") {
      const tabId = result.result;
      if (tabId) {
        logger.debug("Auto-connecting Ghost Browser tab:", tabId);
        setTabConnecting(tabId);
        await sleep(100);
        await attachTab(tabId);
      }
    }
    sink.send({ id: message.id, result });
    return;
  }
  const response = { id: message.id };
  try {
    response.result = await handleCommand(message, { remoteRuntime: sink.remoteRuntime });
  } catch (error) {
    logger.debug("Error handling command:", error);
    response.error = error.message;
  }
  sink.send(response);
}
async function getPreferredWindowId() {
  const { preferredWindowId, currentTabId } = store.getState();
  if (preferredWindowId !== void 0) {
    try {
      await chrome.windows.get(preferredWindowId);
      return preferredWindowId;
    } catch {
      store.setState({ preferredWindowId: void 0 });
    }
  }
  if (currentTabId !== void 0) {
    try {
      const tab = await chrome.tabs.get(currentTabId);
      if (tab.windowId !== void 0) {
        return tab.windowId;
      }
    } catch {
    }
  }
  try {
    const focusedWindow = await chrome.windows.getLastFocused({ populate: false });
    return focusedWindow.id;
  } catch {
    return void 0;
  }
}
async function createTabInPreferredWindow(options) {
  const windowId = await getPreferredWindowId();
  const createProperties = {
    url: options.url,
    active: options.active,
    ...windowId !== void 0 ? { windowId } : {}
  };
  try {
    return await chrome.tabs.create(createProperties);
  } catch (error) {
    logger.debug("Could not create tab in preferred window, falling back:", error.message);
    return await chrome.tabs.create({ url: options.url, active: options.active });
  }
}
const MANAGED_TAB_GROUPS_STORAGE_KEY = "playwriterManagedTabGroups";
async function loadManagedTabGroups() {
  try {
    const stored = await chrome.storage.local.get(MANAGED_TAB_GROUPS_STORAGE_KEY);
    const value = stored[MANAGED_TAB_GROUPS_STORAGE_KEY];
    const titles = Array.isArray(value?.titles) ? value.titles.filter((t) => typeof t === "string") : [];
    const tabIds = Array.isArray(value?.tabIds) ? value.tabIds.filter((t) => typeof t === "number") : [];
    return {
      titles: /* @__PURE__ */ new Set([DEFAULT_TAB_GROUP_TITLE, ...titles]),
      ownedTabIds: new Set(tabIds)
    };
  } catch {
    return { titles: /* @__PURE__ */ new Set([DEFAULT_TAB_GROUP_TITLE]), ownedTabIds: /* @__PURE__ */ new Set() };
  }
}
let lastSavedManagedTabGroups = "";
function saveManagedTabGroups(value) {
  const serialized = JSON.stringify({
    titles: Array.from(value.titles).sort(),
    tabIds: Array.from(value.ownedTabIds).sort((a, b) => a - b)
  });
  if (serialized === lastSavedManagedTabGroups) {
    return;
  }
  lastSavedManagedTabGroups = serialized;
  void chrome.storage.local.set({ [MANAGED_TAB_GROUPS_STORAGE_KEY]: JSON.parse(serialized) }).catch(() => {
  });
}
async function getManagedTabGroupTitles() {
  const { titles } = await loadManagedTabGroups();
  for (const info of store.getState().tabs.values()) {
    if (info.groupTitle) {
      titles.add(info.groupTitle);
    }
  }
  return titles;
}
async function syncTabGroup() {
  try {
    const { connectionState } = store.getState();
    const isRelayConnected = connectionState === "connected";
    const desiredTabs = Array.from(store.getState().tabs.entries()).filter(([_, info]) => info.state === "connected" || info.state === "connecting" && isRelayConnected).map(([tabId, info]) => ({ tabId, title: info.groupTitle || DEFAULT_TAB_GROUP_TITLE }));
    const persisted = await loadManagedTabGroups();
    const managedTitles = new Set(persisted.titles);
    const ownedTabIds = new Set(persisted.ownedTabIds);
    const colorByTitle = /* @__PURE__ */ new Map();
    for (const [tabId, info] of store.getState().tabs) {
      ownedTabIds.add(tabId);
      if (info.groupTitle) {
        managedTitles.add(info.groupTitle);
      }
      if (info.groupColor) {
        colorByTitle.set(info.groupTitle || DEFAULT_TAB_GROUP_TITLE, info.groupColor);
      }
    }
    const resolveGroupColor = (title) => {
      return colorByTitle.get(title) || colorForTabGroupTitle(title);
    };
    const allGroups = await chrome.tabGroups.query({});
    const groups = [];
    for (const group of allGroups) {
      if (!group.title || !managedTitles.has(group.title)) {
        continue;
      }
      const tabsInGroup = await chrome.tabs.query({ groupId: group.id });
      groups.push({ groupId: group.id, title: group.title, tabIds: tabsInGroup.map((t) => t.id).filter(isTruthy) });
    }
    const plan = computeTabGroupSyncPlan({ desiredTabs, groups, ownedTabIds: Array.from(ownedTabIds) });
    const foreignGroupIds = new Set(
      groups.filter((group) => group.tabIds.some((tabId) => !ownedTabIds.has(tabId))).map((group) => group.groupId)
    );
    for (const op of plan.groupOps) {
      const color = resolveGroupColor(op.title);
      try {
        if (op.groupId === void 0) {
          const newGroupId = await chrome.tabs.group({ tabIds: op.tabIds });
          await chrome.tabGroups.update(newGroupId, { title: op.title, color });
          logger.debug("Created tab group:", op.title, newGroupId, "with tabs:", op.tabIds);
        } else {
          await chrome.tabs.group({ tabIds: op.tabIds, groupId: op.groupId });
          if (!foreignGroupIds.has(op.groupId)) {
            await chrome.tabGroups.update(op.groupId, { title: op.title, color });
          }
          logger.debug("Added tabs to group:", op.title, op.tabIds);
        }
      } catch (e) {
        logger.debug("Failed to group tabs:", op.title, op.tabIds, e.message);
      }
    }
    for (const op of plan.updateOps) {
      if (foreignGroupIds.has(op.groupId)) {
        continue;
      }
      try {
        await chrome.tabGroups.update(op.groupId, { title: op.title, color: resolveGroupColor(op.title) });
      } catch (e) {
        logger.debug("Failed to update tab group:", op.title, e.message);
      }
    }
    let failedUngroupIds = [];
    if (plan.ungroupTabIds.length > 0) {
      try {
        await chrome.tabs.ungroup(plan.ungroupTabIds);
        logger.debug("Removed tabs from managed groups:", plan.ungroupTabIds);
      } catch (e) {
        failedUngroupIds = plan.ungroupTabIds;
        logger.debug("Failed to ungroup tabs:", plan.ungroupTabIds, e.message);
      }
    }
    saveManagedTabGroups({
      titles: /* @__PURE__ */ new Set([DEFAULT_TAB_GROUP_TITLE, ...desiredTabs.map((t) => t.title)]),
      ownedTabIds: /* @__PURE__ */ new Set([...desiredTabs.map((t) => t.tabId), ...failedUngroupIds])
    });
  } catch (error) {
    logger.debug("Failed to sync tab group:", error.message);
  }
}
function getTabBySessionId(sessionId) {
  for (const [tabId, tab] of store.getState().tabs) {
    if (tab.sessionId === sessionId) {
      return { tabId, tab };
    }
  }
  return void 0;
}
function getTabByTargetId(targetId) {
  for (const [tabId, tab] of store.getState().tabs) {
    if (tab.targetId === targetId) {
      return { tabId, tab };
    }
  }
  return void 0;
}
function emitChildDetachesForTab(tabId) {
  const childEntries = Array.from(childSessions.entries()).filter(([_, parentTab]) => parentTab.tabId === tabId);
  childEntries.forEach(([childSessionId, parentTab]) => {
    const childDetachParams = parentTab.targetId ? { sessionId: childSessionId, targetId: parentTab.targetId } : { sessionId: childSessionId };
    sendMessage({
      method: "forwardCDPEvent",
      params: {
        method: "Target.detachedFromTarget",
        params: childDetachParams
      }
    });
    logger.debug("Cleaning up child session:", childSessionId, "for tab:", tabId);
    childSessions.delete(childSessionId);
  });
}
function getTabForCommand(msg) {
  const sessionId = msg.params.sessionId;
  if (sessionId) {
    const found = getTabBySessionId(sessionId);
    if (found) {
      return found;
    }
    const child = childSessions.get(sessionId);
    if (child) {
      const tab = store.getState().tabs.get(child.tabId);
      if (tab) {
        return { tabId: child.tabId, tab };
      }
    }
  }
  const paramsSessionId = msg.params.params && "sessionId" in msg.params.params && typeof msg.params.params.sessionId === "string" ? msg.params.params.sessionId : void 0;
  if (paramsSessionId) {
    const found = getTabBySessionId(paramsSessionId);
    if (found) {
      return found;
    }
    const child = childSessions.get(paramsSessionId);
    if (child) {
      const tab = store.getState().tabs.get(child.tabId);
      if (tab) {
        return { tabId: child.tabId, tab };
      }
    }
  }
  const targetId = msg.params.params && "targetId" in msg.params.params && typeof msg.params.params.targetId === "string" ? msg.params.params.targetId : void 0;
  if (targetId) {
    return getTabByTargetId(targetId);
  }
  return void 0;
}
async function handleCommand(msg, { remoteRuntime }) {
  if (msg.method !== "forwardCDPCommand") return;
  if (remoteRuntime) {
    const rejection = getRemoteCdpCommandRejection(msg.params.method);
    if (rejection) {
      throw new Error(rejection);
    }
  }
  const resolved = getTabForCommand(msg);
  let targetTabId = resolved?.tabId;
  let targetTab = resolved?.tab;
  if (targetTabId) {
    await tabReattaches.get(targetTabId);
  }
  const debuggee = targetTabId ? { tabId: targetTabId } : void 0;
  if (msg.params.method === "Target.setAutoAttach" && !msg.params.sessionId) {
    const params2 = msg.params.params;
    if (!params2) {
      return {};
    }
    autoAttachParams = params2;
    const connectedTabIds = Array.from(store.getState().tabs.entries()).filter(([_, info]) => info.state === "connected").map(([tabId]) => tabId);
    await Promise.all(
      connectedTabIds.map(async (tabId) => {
        try {
          await sendCommandWithTimeout({ tabId }, "Target.setAutoAttach", params2, 1e4);
        } catch (error) {
          logger.debug("Failed to set auto-attach for tab:", tabId, error);
        }
      })
    );
    return {};
  }
  switch (msg.params.method) {
    case "Runtime.enable": {
      if (!debuggee) {
        throw new Error(`No debuggee found for Runtime.enable (sessionId: ${msg.params.sessionId})`);
      }
      const runtimeSession = {
        ...debuggee,
        sessionId: msg.params.sessionId !== targetTab?.sessionId ? msg.params.sessionId : void 0
      };
      try {
        await sendCommandWithTimeout(runtimeSession, "Runtime.disable", void 0, 1e4);
        await sleep(50);
      } catch (e) {
        logger.debug("Error disabling Runtime (ignoring):", e);
      }
      const result2 = await sendCommandWithTimeout(runtimeSession, "Runtime.enable", msg.params.params, 1e4);
      if (!runtimeSession.sessionId) {
        recordSetupCommand({ tabId: debuggee.tabId, method: "Runtime.enable", params: msg.params.params });
      }
      return result2;
    }
    case "Target.createTarget": {
      const url = msg.params.params?.url || "about:blank";
      const groupTitle = normalizeTabGroupTitle(msg.params.tabGroup) || void 0;
      const groupKey = resolveTabGroupKey({ key: msg.params.tabGroupKey, remote: Boolean(remoteRuntime) });
      const groupColor = normalizeTabGroupColor(msg.params.tabGroupColor) || void 0;
      logger.debug("Creating new tab with URL:", url, "group:", groupTitle || DEFAULT_TAB_GROUP_TITLE);
      const tab = await createTabInPreferredWindow({ url, active: false });
      if (!tab.id) throw new Error("Failed to create tab");
      const tabId = tab.id;
      setTabConnecting(tabId, { groupTitle, groupKey, groupColor });
      logger.debug("Created tab:", tabId, "waiting for it to load...");
      await sleep(100);
      const attach = () => {
        return attachTab(tabId);
      };
      const { targetInfo } = remoteRuntime ? await attachForRemote({ runtime: remoteRuntime, tabId, attach }) : await attach();
      return { targetId: targetInfo.targetId };
    }
    case "Target.closeTarget": {
      if (!targetTabId) {
        logger.log(`Target not found: ${msg.params.params?.targetId}`);
        return { success: false };
      }
      await chrome.tabs.remove(targetTabId);
      return { success: true };
    }
  }
  if (!debuggee || !targetTab) {
    if (msg.params.method === "Target.detachFromTarget") {
      return {};
    }
    throw new Error(
      `No tab found for method ${msg.params.method} sessionId: ${msg.params.sessionId} params: ${JSON.stringify(msg.params.params || null)}`
    );
  }
  logger.debug("CDP command:", msg.params.method, "for tab:", targetTabId);
  const debuggerSession = {
    ...debuggee,
    sessionId: msg.params.sessionId !== targetTab.sessionId ? msg.params.sessionId : void 0
  };
  const method = msg.params.method;
  const isRootSession = !debuggerSession.sessionId;
  const params = isRootSession ? resolveSetupParams({ tabId: debuggee.tabId, method, params: msg.params.params }) : msg.params.params;
  const timeout = FAST_CDP_COMMAND_TIMEOUT_MS.get(method);
  const result = timeout ? await sendCommandWithTimeout(debuggerSession, method, params, timeout) : await chrome.debugger.sendCommand(debuggerSession, method, params);
  if (!isRootSession) {
    return result;
  }
  if (method === "Page.addScriptToEvaluateOnNewDocument") {
    return recordInitScript({
      tabId: debuggee.tabId,
      params: msg.params.params,
      result
    });
  }
  recordSetupCommand({ tabId: debuggee.tabId, method, params: msg.params.params });
  return result;
}
const DROPPED_CDP_EVENTS = /* @__PURE__ */ new Set(["Network.dataReceived", "Network.resourceChangedPriority"]);
function onDebuggerEvent(source, method, params) {
  if (DROPPED_CDP_EVENTS.has(method)) {
    return;
  }
  const tab = source.tabId ? store.getState().tabs.get(source.tabId) : void 0;
  if (!tab) return;
  if (method === "Page.screencastFrame" && typeof params?.sessionId === "number") {
    void chrome.debugger.sendCommand(source, "Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {
    });
  }
  if (method !== "Page.screencastFrame" && method !== "Page.lifecycleEvent" && !method.startsWith("Network.")) {
    logger.debug("Forwarding CDP event:", method, "from tab:", source.tabId);
  }
  if (!source.sessionId && source.tabId) {
    trackFrameEvent({ tabId: source.tabId, method, params });
  }
  if (method === "Target.attachedToTarget" && params?.sessionId) {
    const targetUrl = params.targetInfo?.url;
    if (isRestrictedUrl(targetUrl)) {
      logger.debug(
        "Ignoring restricted child target:",
        targetUrl,
        "sessionId:",
        params.sessionId,
        "for tab:",
        source.tabId
      );
      if (source.tabId) {
        chrome.debugger.sendCommand({ tabId: source.tabId }, "Target.detachFromTarget", { sessionId: params.sessionId }).catch((e) => {
          logger.debug("Failed to detach restricted child target (expected):", e);
        });
      }
      return;
    }
    logger.debug("Child target attached:", params.sessionId, "for tab:", source.tabId);
    const targetId = params.targetInfo?.targetId;
    childSessions.set(params.sessionId, { tabId: source.tabId, targetId });
  }
  if (method === "Target.detachedFromTarget" && params?.sessionId) {
    const mainTab = getTabBySessionId(params.sessionId);
    if (mainTab) {
      logger.debug("Main tab detached via CDP event:", mainTab.tabId, "sessionId:", params.sessionId);
      store.setState((state) => {
        const newTabs = new Map(state.tabs);
        newTabs.delete(mainTab.tabId);
        return { tabs: newTabs };
      });
      emitChildDetachesForTab(mainTab.tabId);
    } else {
      logger.debug("Child target detached:", params.sessionId);
      childSessions.delete(params.sessionId);
    }
  }
  sendMessage({
    method: "forwardCDPEvent",
    params: {
      sessionId: source.sessionId || tab.sessionId,
      method,
      params
    }
  });
}
function onDebuggerDetach(source, reason) {
  const tabId = source.tabId;
  if (!tabId) {
    logger.debug("Ignoring debugger detach event without a tab id");
    return;
  }
  if (!store.getState().tabs.has(tabId)) {
    logger.debug("Ignoring debugger detach event for untracked tab:", tabId);
    return;
  }
  logger.warn(`DISCONNECT: onDebuggerDetach tabId=${tabId} reason=${reason}`);
  const detachTabFromPlaywright = (detachedTabId, tab2) => {
    sendMessage({
      method: "forwardCDPEvent",
      params: {
        method: "Target.detachedFromTarget",
        params: { sessionId: tab2.sessionId, targetId: tab2.targetId }
      }
    });
    emitChildDetachesForTab(detachedTabId);
  };
  if (reason === chrome.debugger.DetachReason.CANCELED_BY_USER) {
    stopRemoteControl();
    for (const [detachedTabId, tab2] of store.getState().tabs.entries()) {
      detachTabFromPlaywright(detachedTabId, tab2);
    }
    store.setState({ tabs: /* @__PURE__ */ new Map(), connectionState: "idle", errorText: void 0 });
    return;
  }
  if (connectionManager.preserveTabsOnDetach && remoteTunnel === null) {
    logger.debug("Ignoring debugger detach during relay reconnect:", tabId, reason);
    return;
  }
  const dropTab = () => {
    const tab2 = store.getState().tabs.get(tabId);
    if (tab2) {
      detachTabFromPlaywright(tabId, tab2);
    }
    store.setState((state) => {
      const newTabs = new Map(state.tabs);
      newTabs.delete(tabId);
      return { tabs: newTabs };
    });
    forgetRemoteTab(tabId);
  };
  const tab = store.getState().tabs.get(tabId);
  if (reason === chrome.debugger.DetachReason.TARGET_CLOSED && tab?.state === "connected") {
    const reattach = reattachTab({ tabId, tab }).then((reattached) => {
      if (!reattached) {
        dropTab();
      }
      return reattached;
    }).finally(() => {
      tabReattaches.delete(tabId);
    });
    tabReattaches.set(tabId, reattach);
    return;
  }
  dropTab();
}
const tabReattaches = /* @__PURE__ */ new Map();
async function reattachTab({ tabId, tab }) {
  const { sessionId, targetId } = tab;
  if (!sessionId || !targetId) {
    return false;
  }
  if (!canReattach(tabId)) {
    logger.warn(`Not reattaching tab ${tabId}: too many reattaches in a short time`);
    return false;
  }
  sendMessage({
    method: "forwardCDPEvent",
    params: { sessionId, method: "Runtime.executionContextsCleared", params: {} }
  });
  emitChildDetachesForTab(tabId);
  logger.warn(`Reattaching debugger to tab ${tabId} after unexpected detach`);
  try {
    await chrome.tabs.get(tabId);
    await removeRestrictedIframes(tabId);
    const { targetInfo } = await attachTab(tabId, { skipAttachedEvent: true, sessionId });
    if (targetInfo.targetId !== targetId) {
      throw new Error(`targetId changed after reattach: ${targetId} -> ${targetInfo.targetId}`);
    }
    const { frameTree } = await chrome.debugger.sendCommand(
      { tabId },
      "Page.getFrameTree"
    );
    takeRemovedFrameIds({ tabId, frameTree }).forEach((frameId) => {
      sendMessage({
        method: "forwardCDPEvent",
        params: { sessionId, method: "Page.frameDetached", params: { frameId, reason: "remove" } }
      });
    });
    const failures = await replaySetup({
      tabId,
      send: (method, params) => {
        return sendCommandWithTimeout({ tabId }, method, params, 1e4);
      }
    });
    failures.forEach(({ method, error }) => {
      logger.warn("Failed to replay CDP command after reattach:", method, "tab:", tabId, error);
    });
    logger.warn(`Reattached debugger to tab ${tabId}`);
    return true;
  } catch (error) {
    logger.warn("Failed to reattach debugger to tab:", tabId, error);
    chrome.debugger.detach({ tabId }).catch(() => {
    });
    return false;
  }
}
async function removeRestrictedIframes(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      // allFrames: true ensures we also scan same-origin subframes, not just the top document.
      target: { tabId, allFrames: true },
      func: (ownExtIds) => {
        const removeFrom = (root) => {
          const removed = Array.from(root.querySelectorAll("iframe")).flatMap((iframe) => {
            const src = iframe.src || iframe.getAttribute("src") || "";
            if (!src.startsWith("chrome-extension://")) {
              return [];
            }
            const extId = src.replace("chrome-extension://", "").split("/")[0];
            if (ownExtIds.includes(extId)) {
              return [];
            }
            iframe.remove();
            return [extId];
          });
          const nested = Array.from(root.querySelectorAll("*")).flatMap((el) => {
            const shadow = el instanceof HTMLElement ? chrome.dom.openOrClosedShadowRoot(el) : null;
            return shadow ? removeFrom(shadow) : [];
          });
          return [...removed, ...nested];
        };
        return removeFrom(document);
      },
      args: [OUR_EXTENSION_IDS]
    });
    const removedExtIds = results.flatMap((r) => r.result ?? []);
    if (removedExtIds.length > 0) {
      logger.warn(
        `Removed ${removedExtIds.length} chrome-extension:// iframe(s) from tab ${tabId}, injected by:`,
        [...new Set(removedExtIds)].join(", ")
      );
    }
    return removedExtIds.length;
  } catch (e) {
    logger.debug("Could not remove restricted iframes (expected on some pages):", e.message);
    return 0;
  }
}
const inFlightTabAttaches = /* @__PURE__ */ new Map();
function attachTab(tabId, options = {}) {
  const inFlight = inFlightTabAttaches.get(tabId);
  if (inFlight) {
    return inFlight;
  }
  const attach = attachTabDebugger(tabId, options).finally(() => {
    inFlightTabAttaches.delete(tabId);
  });
  inFlightTabAttaches.set(tabId, attach);
  return attach;
}
async function attachTabDebugger(tabId, { skipAttachedEvent = false, sessionId: reusedSessionId } = {}) {
  const debuggee = { tabId };
  let debuggerAttached = false;
  try {
    logger.debug("Attaching debugger to tab:", tabId);
    const maxAttachAttempts = 3;
    for (let attempt = 1; attempt <= maxAttachAttempts; attempt++) {
      try {
        await chrome.debugger.attach(debuggee, "1.3");
        break;
      } catch (attachError) {
        const msg = attachError.message ?? "";
        const isRestrictedIframeError = msg.includes("chrome-extension://") || msg.includes("different extension");
        if (!isRestrictedIframeError || attempt === maxAttachAttempts) {
          throw attachError;
        }
        logger.debug(
          `Debugger attach blocked by chrome-extension:// iframe (attempt ${attempt}/${maxAttachAttempts}), removing and retrying:`,
          tabId
        );
        await removeRestrictedIframes(tabId);
        await sleep(50);
      }
    }
    debuggerAttached = true;
    logger.debug("Debugger attached successfully to tab:", tabId);
    await chrome.debugger.sendCommand(debuggee, "Page.enable");
    if (autoAttachParams) {
      try {
        await chrome.debugger.sendCommand(debuggee, "Target.setAutoAttach", autoAttachParams);
      } catch (error) {
        logger.debug("Failed to apply auto-attach for tab:", tabId, error);
      }
    }
    const runInCurrentDocument = !reusedSessionId;
    try {
      await chrome.debugger.sendCommand(debuggee, "Page.addScriptToEvaluateOnNewDocument", {
        source: ghostCursorBundleCode
      });
      if (runInCurrentDocument) {
        await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", { expression: ghostCursorBundleCode });
      }
    } catch (err) {
      logger.debug("Could not inject ghost cursor (restricted page):", err.message);
    }
    const result = await chrome.debugger.sendCommand(
      debuggee,
      "Target.getTargetInfo"
    );
    const targetInfo = result.targetInfo;
    if (!targetInfo.url || targetInfo.url === "" || targetInfo.url === ":") {
      logger.error(
        "WARNING: Target.attachedToTarget will be sent with empty URL! tabId:",
        tabId,
        "targetInfo:",
        JSON.stringify(targetInfo)
      );
    }
    const previousTab = store.getState().tabs.get(tabId);
    const reusedTab = reusedSessionId && previousTab?.sessionId === reusedSessionId ? previousTab : void 0;
    const attachOrder = reusedTab ? reusedTab.attachOrder : nextSessionId;
    const sessionId = reusedTab?.sessionId ?? `pw-tab-${tabSessionScope}-${nextSessionId++}`;
    if (!reusedTab) {
      startTabSession(tabId);
    }
    store.setState((state) => {
      const newTabs = new Map(state.tabs);
      newTabs.set(tabId, {
        sessionId,
        targetId: targetInfo.targetId,
        state: "connected",
        attachOrder,
        // Preserve the tab group assigned by setTabConnecting/createTarget
        groupTitle: state.tabs.get(tabId)?.groupTitle,
        groupKey: state.tabs.get(tabId)?.groupKey,
        groupColor: state.tabs.get(tabId)?.groupColor
      });
      return { tabs: newTabs, connectionState: "connected", errorText: void 0 };
    });
    if (!skipAttachedEvent) {
      sendMessage({
        method: "forwardCDPEvent",
        params: {
          method: "Target.attachedToTarget",
          params: {
            sessionId,
            targetInfo: { ...targetInfo, attached: true },
            waitingForDebugger: false
          }
        }
      });
    }
    logger.debug(
      "Tab attached successfully:",
      tabId,
      "sessionId:",
      sessionId,
      "targetId:",
      targetInfo.targetId,
      "url:",
      targetInfo.url,
      "skipAttachedEvent:",
      skipAttachedEvent
    );
    injectToolbar(tabId);
    return { targetInfo, sessionId };
  } catch (error) {
    if (debuggerAttached) {
      logger.debug("Cleaning up debugger after partial attach failure:", tabId);
      chrome.debugger.detach(debuggee).catch(() => {
      });
    }
    throw error;
  }
}
function detachTab(tabId, shouldDetachDebugger) {
  const tab = store.getState().tabs.get(tabId);
  if (!tab) {
    logger.debug("detachTab: tab not found in map:", tabId);
    return;
  }
  void chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: () => {
      window.__playwriterToolbarDestroy?.();
    }
  }).catch(() => {
  });
  void chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      globalThis.__playwriterGhostCursor?.disable?.();
    }
  }).catch(() => {
  });
  logger.warn(`DISCONNECT: detachTab tabId=${tabId} shouldDetach=${shouldDetachDebugger} stack=${getCallStack()}`);
  if (tab.sessionId && tab.targetId) {
    sendMessage({
      method: "forwardCDPEvent",
      params: {
        method: "Target.detachedFromTarget",
        params: { sessionId: tab.sessionId, targetId: tab.targetId }
      }
    });
  }
  store.setState((state) => {
    const newTabs = new Map(state.tabs);
    newTabs.delete(tabId);
    return { tabs: newTabs };
  });
  emitChildDetachesForTab(tabId);
  {
    chrome.debugger.detach({ tabId }).catch((err) => {
      logger.debug("Error detaching debugger from tab:", tabId, err.message);
    });
  }
}
let recorderActive = false;
let skillRecordingId = null;
let skillRecordingStartInFlight = false;
function injectToolbar(tabId) {
  chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    world: "ISOLATED",
    func: initPlaywriterToolbar
  }).then(() => {
    syncToolbarState(tabId);
  }).catch((err) => {
    logger.debug("Could not inject toolbar (restricted page):", err.message);
  });
}
function syncToolbarState(tabId) {
  chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    world: "ISOLATED",
    func: (recording, remoteActive) => {
      window.__playwriterToolbarSetRecording?.(recording);
      window.__playwriterToolbarSetRemote?.(remoteActive);
    },
    args: [recorderActive, remoteTunnel !== null]
  }).catch(() => {
  });
}
function getConnectedTabIds() {
  return Array.from(store.getState().tabs.entries()).filter(([_, tab]) => {
    return tab.state === "connected";
  }).map(([tabId]) => {
    return tabId;
  });
}
function setRecorderStateInAllTabs(recording) {
  for (const tabId of getConnectedTabIds()) {
    chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      world: "ISOLATED",
      func: (rec) => {
        window.__playwriterToolbarSetRecording?.(rec);
      },
      args: [recording]
    }).catch(() => {
    });
  }
}
function setRemoteStateInAllTabs(active) {
  for (const tabId of getConnectedTabIds()) {
    chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      world: "ISOLATED",
      func: (on) => {
        window.__playwriterToolbarSetRemote?.(on);
      },
      args: [active]
    }).catch(() => {
    });
  }
}
function playToolbarSound(tabId, name) {
  chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    world: "ISOLATED",
    func: (soundName) => {
      window.__playwriterToolbarPlaySound?.(soundName);
    },
    args: [name]
  }).catch(() => {
  });
}
async function connectTab(tabId, options) {
  try {
    logger.debug(`Starting connection to tab ${tabId}`);
    setTabConnecting(tabId, options);
    if (remoteTunnel === null) {
      await connectionManager.ensureConnection();
    } else {
      void connectionManager.ensureConnection().catch(() => {
      });
    }
    if (store.getState().tabs.get(tabId)?.state === "connected") {
      logger.debug(`Tab ${tabId} was attached by the relay handshake`);
      return;
    }
    await attachTab(tabId);
    logger.debug(`Successfully connected to tab ${tabId}`);
  } catch (error) {
    logger.debug(`Failed to connect to tab ${tabId}:`, error);
    const isExtensionInUse = error.message === "Extension Already In Use" || error.message === "Another Playwriter extension is already connected";
    const isWsError = error.message === "Server not available" || error.message === "Connection timeout" || error.message.startsWith("WebSocket");
    if (isExtensionInUse) {
      logger.debug(`Another extension is in use, entering polling mode`);
      store.setState((state) => {
        const newTabs = new Map(state.tabs);
        newTabs.delete(tabId);
        return {
          tabs: newTabs,
          connectionState: "extension-replaced",
          errorText: "Another Playwriter extension is actively in use"
        };
      });
    } else if (isWsError) {
      logger.debug(`WS connection failed, keeping tab ${tabId} in connecting state for retry`);
    } else {
      let tabStillExists = true;
      try {
        await chrome.tabs.get(tabId);
      } catch {
        tabStillExists = false;
      }
      if (!tabStillExists) {
        logger.debug(`Tab ${tabId} was closed during connect, dropping error state`);
        store.setState((state) => {
          const newTabs = new Map(state.tabs);
          newTabs.delete(tabId);
          return { tabs: newTabs };
        });
        return;
      }
      if (!store.getState().tabs.has(tabId)) {
        logger.debug(`Tab ${tabId} was detached during connect, dropping error state`);
        return;
      }
      store.setState((state) => {
        const newTabs = new Map(state.tabs);
        const prior = state.tabs.get(tabId);
        newTabs.set(tabId, {
          state: "error",
          errorText: `Error: ${error.message}`,
          groupTitle: prior?.groupTitle,
          groupKey: prior?.groupKey,
          groupColor: prior?.groupColor
        });
        return { tabs: newTabs };
      });
    }
  }
}
function setTabConnecting(tabId, options) {
  store.setState((state) => {
    const newTabs = new Map(state.tabs);
    const existing = newTabs.get(tabId);
    newTabs.set(tabId, {
      ...existing,
      state: "connecting",
      groupTitle: options?.groupTitle || existing?.groupTitle,
      groupKey: options?.groupKey || existing?.groupKey,
      groupColor: options?.groupColor || existing?.groupColor
    });
    return { tabs: newTabs };
  });
}
async function disconnectTab(tabId) {
  logger.debug(`Disconnecting tab ${tabId}`);
  forgetRemoteTab(tabId);
  const { tabs } = store.getState();
  if (!tabs.has(tabId)) {
    logger.debug("Tab not in tabs map, ignoring disconnect");
    return;
  }
  detachTab(tabId, true);
}
async function toggleExtensionForActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error("No active tab found");
  await onActionClicked(tab);
  await new Promise((resolve) => {
    const check = () => {
      const state2 = store.getState();
      const tabInfo = state2.tabs.get(tab.id);
      if (tabInfo?.state === "connecting") {
        setTimeout(check, 100);
        return;
      }
      resolve();
    };
    check();
  });
  const state = store.getState();
  const isConnected = state.tabs.has(tab.id) && state.tabs.get(tab.id)?.state === "connected";
  return { isConnected, state };
}
async function disconnectEverything() {
  tabGroupQueue = tabGroupQueue.then(async () => {
    const { tabs } = store.getState();
    for (const tabId of tabs.keys()) {
      await disconnectTab(tabId);
    }
  });
  await tabGroupQueue;
}
const REMOTE_TUNNEL_STORAGE_KEY = "playwriterRemoteTunnel";
function persistRemoteTunnel() {
  const entry = remoteTunnel ? {
    anchorTabId: remoteTunnel.anchorTabId,
    tunnelId: remoteTunnel.tunnelId,
    remoteTabIds: Array.from(remoteTunnel.remoteTabIds)
  } : null;
  void chrome.storage.session.set({ [REMOTE_TUNNEL_STORAGE_KEY]: entry }).catch(() => {
  });
}
const REMOTE_CONTROL_STOPPED_ERROR = "Remote control was stopped by the user.";
function isRemoteOwnedTab({ runtime, tabId }) {
  return tabId === runtime.anchorTabId || runtime.remoteTabIds.has(tabId);
}
async function attachForRemote({
  runtime,
  tabId,
  attach
}) {
  if (remoteTunnel !== runtime) {
    detachTab(tabId, true);
    throw new Error(REMOTE_CONTROL_STOPPED_ERROR);
  }
  if (!runtime.remoteTabIds.has(tabId)) {
    runtime.remoteTabIds.add(tabId);
    persistRemoteTunnel();
  }
  const result = await attach();
  if (remoteTunnel !== runtime) {
    detachTab(tabId, true);
    throw new Error(REMOTE_CONTROL_STOPPED_ERROR);
  }
  return result;
}
function forgetRemoteTab(tabId) {
  if (remoteTunnel === null) {
    return;
  }
  if (remoteTunnel.anchorTabId === tabId) {
    stopRemoteControl();
    return;
  }
  if (remoteTunnel.remoteTabIds.delete(tabId)) {
    persistRemoteTunnel();
  }
}
async function announceConnectedTabs({
  send,
  firstTabId
}) {
  const tabs = Array.from(store.getState().tabs.entries()).sort(([a], [b]) => {
    return Number(b === firstTabId) - Number(a === firstTabId);
  });
  for (const [tabId, tab] of tabs) {
    if (tab.state !== "connected" || !tab.sessionId) {
      continue;
    }
    try {
      const result = await chrome.debugger.sendCommand(
        { tabId },
        "Target.getTargetInfo"
      );
      send({
        method: "forwardCDPEvent",
        params: {
          method: "Target.attachedToTarget",
          params: {
            sessionId: tab.sessionId,
            targetInfo: { ...result.targetInfo, attached: true },
            waitingForDebugger: false
          }
        }
      });
    } catch (error) {
      logger.debug("Failed to announce tab target:", tabId, error);
    }
  }
}
async function announceConnectedTabsToLocalRelay(socket = connectionManager.ws) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("Local relay connection changed during target inventory");
  }
  await announceConnectedTabs({
    send: (message) => {
      socket.send(JSON.stringify(message));
    }
  });
}
async function completeLocalRelayHandshake(socket) {
  await announceConnectedTabsToLocalRelay(socket);
  await reattachConnectingTabsToLocalRelay();
  if (connectionManager.ws !== socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("Local relay connection changed during target inventory");
  }
  socket.send(JSON.stringify({ method: "ready" }));
}
async function reattachConnectingTabsToLocalRelay() {
  const tabsToReattach = Array.from(store.getState().tabs.entries()).filter(([_, tab]) => tab.state === "connecting").map(([tabId]) => tabId);
  await Promise.all(
    tabsToReattach.map(async (tabId) => {
      const currentTab = store.getState().tabs.get(tabId);
      if (!currentTab || currentTab.state !== "connecting") {
        return;
      }
      try {
        await chrome.tabs.get(tabId);
        await attachTab(tabId);
        logger.debug("Successfully re-attached tab:", tabId);
      } catch (error) {
        logger.debug("Failed to re-attach tab:", tabId, error instanceof Error ? error.message : String(error));
        store.setState((state) => {
          const newTabs = new Map(state.tabs);
          newTabs.delete(tabId);
          return { tabs: newTabs };
        });
      }
    })
  );
}
async function sendRemoteHelloAndTargets(conn) {
  const browser = await detectBrowserName().catch(() => {
    return void 0;
  });
  conn.send(
    buildRemoteHelloMessage({
      browser,
      version: "0.10.0"
    })
  );
  await announceConnectedTabs({ send: conn.send, firstTabId: remoteTunnel?.anchorTabId });
}
async function startRemoteControl(anchorTabId, options = {}) {
  if (remoteTunnel) {
    setRemoteStateInAllTabs(true);
    return { url: remoteTunnel.tunnel.url, started: false, id: remoteTunnel.tunnelId };
  }
  const tunnelId = options.tunnelId || generateTunnelId();
  const tunnel = new RemoteTunnel({
    tunnelId,
    baseDomain: REMOTE_TUNNEL_BASE_DOMAIN,
    logger,
    onStatusChange: (status, detail) => {
      if (remoteTunnel?.tunnel === tunnel) {
        remoteTunnel.status = status;
      }
      logger.debug("Remote tunnel status:", status, detail || "");
    },
    onConnectionOpen: (virtualConn) => {
      const connKey = `${tunnelId}:${virtualConn.id}`;
      const conn = {
        send: (message) => {
          const isScreencastFrame = message?.method === "forwardCDPEvent" && message.params?.method === "Page.screencastFrame";
          if (isScreencastFrame && !virtualConn.canSendScreencastFrame()) {
            return;
          }
          virtualConn.send(JSON.stringify(message));
        }
      };
      remoteRelayConnections.set(connKey, conn);
      void sendRemoteHelloAndTargets(conn);
      return {
        onMessage: (data) => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            return;
          }
          void dispatchRelayMessage(parsed, { send: conn.send, remoteRuntime: runtime });
        },
        onClose: () => {
          remoteRelayConnections.delete(connKey);
        }
      };
    }
  });
  const runtime = { tunnel, tunnelId, anchorTabId, remoteTabIds: /* @__PURE__ */ new Set(), status: "connecting" };
  remoteTunnel = runtime;
  if (store.getState().tabs.get(anchorTabId)?.state !== "connected") {
    try {
      setTabConnecting(anchorTabId);
      await attachTab(anchorTabId);
    } catch (error) {
      stopRemoteControl();
      detachTab(anchorTabId, true);
      throw error;
    }
    if (remoteTunnel !== runtime) {
      detachTab(anchorTabId, true);
      throw new Error(REMOTE_CONTROL_STOPPED_ERROR);
    }
  }
  for (const tabId of options.remoteTabIds || []) {
    if (tabId === anchorTabId) {
      continue;
    }
    const alreadyConnected = store.getState().tabs.get(tabId)?.state === "connected";
    if (!alreadyConnected) {
      setTabConnecting(tabId);
    }
    try {
      await attachForRemote({
        runtime,
        tabId,
        attach: async () => {
          if (!alreadyConnected) {
            await attachTab(tabId);
          }
        }
      });
    } catch (error) {
      if (remoteTunnel !== runtime) {
        throw error;
      }
      logger.debug("Failed to restore remote tab:", tabId, error);
      forgetRemoteTab(tabId);
      detachTab(tabId, true);
    }
  }
  tunnel.start();
  persistRemoteTunnel();
  updateSharingMenus();
  setRemoteStateInAllTabs(true);
  logger.log("Remote control started, anchor tab", anchorTabId);
  return { url: tunnel.url, started: true, id: tunnelId };
}
function stopRemoteControl() {
  const runtime = remoteTunnel;
  if (runtime === null) {
    return false;
  }
  setRemoteStateInAllTabs(false);
  remoteTunnel = null;
  updateSharingMenus();
  runtime.tunnel.close();
  persistRemoteTunnel();
  for (const tabId of runtime.remoteTabIds) {
    detachTab(tabId, true);
  }
  if (connectionManager.ws?.readyState !== WebSocket.OPEN) {
    const replaced = store.getState().connectionState === "extension-replaced";
    detachAllTabDebuggers();
    store.setState((state) => {
      return { tabs: replaced ? /* @__PURE__ */ new Map() : markAllTabsConnecting(state.tabs) };
    });
  }
  logger.log("Remote control stopped, anchor tab", runtime.anchorTabId);
  return true;
}
async function restoreRemoteTunnelAfterRestart() {
  try {
    const stored = await chrome.storage.session.get(REMOTE_TUNNEL_STORAGE_KEY);
    const entry = stored[REMOTE_TUNNEL_STORAGE_KEY];
    if (!entry) {
      return;
    }
    const tabExists = (tabId) => {
      return chrome.tabs.get(tabId).then(
        () => true,
        () => false
      );
    };
    if (!await tabExists(entry.anchorTabId)) {
      persistRemoteTunnel();
      return;
    }
    const existing = await Promise.all(
      (entry.remoteTabIds || []).map(async (tabId) => {
        return await tabExists(tabId) ? tabId : void 0;
      })
    );
    await startRemoteControl(entry.anchorTabId, {
      tunnelId: entry.tunnelId,
      remoteTabIds: existing.filter(isTruthy)
    });
  } catch (error) {
    logger.error("Failed to restore remote control:", error);
    persistRemoteTunnel();
  }
}
async function startRemoteControlForActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error("No active tab found");
  return await startRemoteControl(tab.id);
}
function getRemoteControlState() {
  if (remoteTunnel === null) {
    return null;
  }
  return {
    anchorTabId: remoteTunnel.anchorTabId,
    url: remoteTunnel.tunnel.url,
    status: remoteTunnel.status,
    remoteTabIds: Array.from(remoteTunnel.remoteTabIds)
  };
}
async function resetDebugger() {
  let targets = await chrome.debugger.getTargets();
  targets = targets.filter((x) => x.tabId && x.attached);
  logger.log(`found ${targets.length} existing debugger targets. detaching them before background script starts`);
  await Promise.all(
    targets.map(async (target) => {
      try {
        await withTimeout(chrome.debugger.detach({ tabId: target.tabId }), 3e3, void 0);
      } catch (error) {
        logger.debug("resetDebugger detach failed/stalled for tab:", target.tabId, error.message);
      }
    })
  );
}
const OUR_EXTENSION_IDS = [
  "jfeammnjpkecdekppnclgkkffahnhfhe",
  // Production extension (Chrome Web Store)
  "pebbngnfojnignonigcnkdilknapkgid"
  // Dev extension (stable ID from manifest key)
];
function isRestrictedUrl(url) {
  if (!url) return false;
  if (url.startsWith("chrome-extension://")) {
    const extensionId = url.replace("chrome-extension://", "").split("/")[0];
    return !OUR_EXTENSION_IDS.includes(extensionId);
  }
  const restrictedPrefixes = [
    "chrome://",
    "devtools://",
    "edge://",
    "https://chrome.google.com/",
    "https://chromewebstore.google.com/"
  ];
  return restrictedPrefixes.some((prefix) => url.startsWith(prefix));
}
const icons = {
  connected: {
    path: {
      "16": "/icons/icon-green-16.png",
      "32": "/icons/icon-green-32.png",
      "48": "/icons/icon-green-48.png",
      "128": "/icons/icon-green-128.png"
    },
    title: "Connected - Click to disconnect",
    badgeText: "",
    badgeColor: [64, 64, 64, 255]
  },
  connecting: {
    path: {
      "16": "/icons/icon-gray-16.png",
      "32": "/icons/icon-gray-32.png",
      "48": "/icons/icon-gray-48.png",
      "128": "/icons/icon-gray-128.png"
    },
    title: "Waiting for MCP WS server...",
    badgeText: "...",
    badgeColor: [64, 64, 64, 255]
  },
  idle: {
    path: {
      "16": "/icons/icon-black-16.png",
      "32": "/icons/icon-black-32.png",
      "48": "/icons/icon-black-48.png",
      "128": "/icons/icon-black-128.png"
    },
    title: "Click to attach debugger",
    badgeText: "",
    badgeColor: [64, 64, 64, 255]
  },
  restricted: {
    path: {
      "16": "/icons/icon-gray-16.png",
      "32": "/icons/icon-gray-32.png",
      "48": "/icons/icon-gray-48.png",
      "128": "/icons/icon-gray-128.png"
    },
    title: "Cannot attach to this page",
    badgeText: "",
    badgeColor: [64, 64, 64, 255]
  },
  extensionReplaced: {
    path: {
      "16": "/icons/icon-gray-16.png",
      "32": "/icons/icon-gray-32.png",
      "48": "/icons/icon-gray-48.png",
      "128": "/icons/icon-gray-128.png"
    },
    title: "Another Playwriter extension connected - Click to retry",
    badgeText: "!",
    badgeColor: [220, 38, 38, 255]
  },
  tabError: {
    path: {
      "16": "/icons/icon-gray-16.png",
      "32": "/icons/icon-gray-32.png",
      "48": "/icons/icon-gray-48.png",
      "128": "/icons/icon-gray-128.png"
    },
    title: "Error",
    badgeText: "!",
    badgeColor: [220, 38, 38, 255]
  }
};
async function updateIcons() {
  const state = store.getState();
  const { connectionState, tabs, errorText } = state;
  const connectedCount = Array.from(tabs.values()).filter((t) => t.state === "connected").length;
  const allTabs = await chrome.tabs.query({});
  const tabUrlMap = new Map(allTabs.map((tab) => [tab.id, tab.url]));
  const allTabIds = [void 0, ...allTabs.map((tab) => tab.id).filter(isTruthy)];
  for (const tabId of allTabIds) {
    const tabInfo = tabId !== void 0 ? tabs.get(tabId) : void 0;
    const tabUrl = tabId !== void 0 ? tabUrlMap.get(tabId) : void 0;
    const iconConfig = (() => {
      if (connectionState === "extension-replaced") return icons.extensionReplaced;
      if (tabId !== void 0 && isRestrictedUrl(tabUrl)) return icons.restricted;
      if (tabInfo?.state === "error") return icons.tabError;
      if (tabInfo?.state === "connecting") return icons.connecting;
      if (tabInfo?.state === "connected") return icons.connected;
      return icons.idle;
    })();
    const title = (() => {
      if (connectionState === "extension-replaced" && errorText) return errorText;
      if (tabInfo?.errorText) return tabInfo.errorText;
      return iconConfig.title;
    })();
    const badgeText = (() => {
      if (iconConfig === icons.connected || iconConfig === icons.idle || iconConfig === icons.restricted) {
        return connectedCount > 0 ? String(connectedCount) : "";
      }
      return iconConfig.badgeText;
    })();
    void chrome.action.setIcon({ tabId, path: iconConfig.path });
    void chrome.action.setTitle({ tabId, title });
    if (iconConfig.badgeColor) void chrome.action.setBadgeBackgroundColor({ tabId, color: iconConfig.badgeColor });
    void chrome.action.setBadgeText({ tabId, text: badgeText });
  }
}
async function onTabRemoved(tabId) {
  popupSourceTabMap.delete(tabId);
  forgetRemoteTab(tabId);
  const { tabs } = store.getState();
  if (!tabs.has(tabId)) return;
  logger.debug(`Connected tab ${tabId} was closed, disconnecting`);
  await disconnectTab(tabId);
}
async function onTabActivated(activeInfo) {
  store.setState({ currentTabId: activeInfo.tabId, preferredWindowId: activeInfo.windowId });
}
const TUTORIAL_PAGE_PATH = "src/tutorial.html";
function shouldOpenTutorialPage() {
  return false;
}
async function openTutorialPage() {
  try {
    const baseUrl = chrome.runtime.getURL(TUTORIAL_PAGE_PATH);
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((t) => t.url?.startsWith(baseUrl));
    if (existing?.id) {
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId !== void 0) {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      return;
    }
    await chrome.tabs.create({ url: `${TUTORIAL_PAGE_PATH}?port=${RELAY_PORT}` });
  } catch (e) {
    logger.debug("Failed to open tutorial page:", e);
  }
}
async function onActionClicked(tab) {
  if (shouldOpenTutorialPage()) {
    void openTutorialPage();
  }
  if (!tab.id) {
    logger.debug("No tab ID available");
    return;
  }
  if (tab.windowId !== void 0) {
    store.setState({ currentTabId: tab.id, preferredWindowId: tab.windowId });
  }
  if (isRestrictedUrl(tab.url)) {
    logger.debug("Cannot attach to restricted URL:", tab.url);
    return;
  }
  const { tabs, connectionState } = store.getState();
  const tabInfo = tabs.get(tab.id);
  if (connectionState === "extension-replaced") {
    logger.debug("Clearing extension-replaced state, attempting to reconnect");
    store.setState({ connectionState: "idle", errorText: void 0 });
    await connectTab(tab.id);
    return;
  }
  if (tabInfo?.state === "error") {
    logger.debug("Tab has error - disconnecting to clear state");
    await disconnectTab(tab.id);
    return;
  }
  if (tabInfo?.state === "connecting") {
    logger.debug("Tab is already connecting, ignoring click");
    return;
  }
  if (tabInfo?.state === "connected") {
    await disconnectTab(tab.id);
  } else {
    await connectTab(tab.id);
  }
}
chrome.debugger.onEvent.addListener(onDebuggerEvent);
chrome.debugger.onDetach.addListener(onDebuggerDetach);
void resetDebugger().then(() => {
  return restoreRemoteTunnelAfterRestart();
}).finally(() => {
  tabGroupQueue = tabGroupQueue.then(syncTabGroup).catch((e) => {
    logger.debug("startup syncTabGroup error:", e);
  });
});
void connectionManager.maintainLoop();
const MENU = {
  pinElement: "playwriter-pin-element",
  copyReactSource: "playwriter-copy-react-source",
  separator: "playwriter-separator",
  copyRemotePrompt: "playwriter-copy-remote-prompt",
  copyRemoteId: "playwriter-copy-remote-id",
  stopSharing: "playwriter-stop-sharing"
};
const PAGE_MENU_CONTEXTS = [
  "page",
  "frame",
  "selection",
  "link",
  "editable",
  "image",
  "video",
  "audio"
];
const SHARED_MENU_CONTEXTS = ["action", ...PAGE_MENU_CONTEXTS];
const menusReady = chrome.contextMenus.removeAll().then(() => {
  chrome.contextMenus.create({
    id: MENU.pinElement,
    title: "Copy Playwriter Locator for this element",
    contexts: PAGE_MENU_CONTEXTS
  });
  chrome.contextMenus.create({
    id: MENU.copyReactSource,
    title: "Copy React Component Source Path (file:line)",
    contexts: PAGE_MENU_CONTEXTS,
    visible: false
  });
  chrome.contextMenus.create({
    id: MENU.separator,
    type: "separator",
    contexts: PAGE_MENU_CONTEXTS,
    visible: false
  });
  chrome.contextMenus.create({
    id: MENU.copyRemotePrompt,
    title: "Copy remote agent prompt (paste it in your agent)",
    contexts: SHARED_MENU_CONTEXTS,
    visible: false
  });
  chrome.contextMenus.create({
    id: MENU.copyRemoteId,
    title: "Copy remote id (secret, gives full browser access)",
    contexts: SHARED_MENU_CONTEXTS,
    visible: false
  });
  chrome.contextMenus.create({
    id: MENU.stopSharing,
    title: "Stop sharing and revoke remote agent access",
    contexts: SHARED_MENU_CONTEXTS,
    visible: false
  });
});
function updateMenus(updates) {
  void menusReady.then(async () => {
    await Promise.all(
      updates.map(([id, properties]) => {
        return chrome.contextMenus.update(id, properties);
      })
    );
  }).catch((error) => {
    logger.debug("Could not update menus:", error.message);
  });
}
function updateContextMenuVisibility() {
  const { currentTabId, tabs } = store.getState();
  const isConnected = currentTabId !== void 0 && tabs.get(currentTabId)?.state === "connected";
  updateMenus([[MENU.copyReactSource, { visible: isConnected }]]);
}
function updateSharingMenus() {
  const sharing = remoteTunnel !== null;
  updateMenus([
    [MENU.separator, { visible: sharing }],
    [MENU.copyRemotePrompt, { visible: sharing }],
    [MENU.copyRemoteId, { visible: sharing }],
    [MENU.stopSharing, { visible: sharing }]
  ]);
}
updateSharingMenus();
async function toastTab(tabId, message) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content-script.js"] });
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "ISOLATED",
      func: (text) => {
        ;
        (window.__playwriterToolbarShowToast ?? window.__playwriterShowToast)?.(text);
      },
      args: [message]
    });
  } catch (error) {
    logger.debug("Could not show toast in tab:", tabId, error.message);
  }
}
async function markContextMenuTarget(tabId) {
  const markerBytes = new Uint8Array(16);
  crypto.getRandomValues(markerBytes);
  const marker = Array.from(markerBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: "ISOLATED",
    func: (value) => {
      const target = window.__playwriterContextTarget;
      if (!target?.isConnected) {
        return false;
      }
      target.setAttribute("data-playwriter-pin-target", value);
      return true;
    },
    args: [marker]
  });
  return result?.result ? marker : null;
}
async function pinMarkedElement(options) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: options.tabId, frameIds: [0] },
    world: "MAIN",
    func: (marker, flash) => {
      const selector = `[data-playwriter-pin-target="${marker}"]`;
      const find = (root) => {
        const hit = root.querySelector(selector);
        if (hit) {
          return hit;
        }
        for (const element of root.querySelectorAll("*")) {
          const inner = element.shadowRoot ? find(element.shadowRoot) : null;
          if (inner) {
            return inner;
          }
        }
        return null;
      };
      const target = find(document);
      if (!target) {
        return null;
      }
      target.removeAttribute("data-playwriter-pin-target");
      const pinNumber = (window.__playwriterPinCount || 0) + 1;
      window.__playwriterPinCount = pinNumber;
      window[`playwriterPinnedElem${pinNumber}`] = target;
      const style = target.style;
      if (flash && style) {
        const prevOutline = style.outline;
        const prevOffset = style.outlineOffset;
        style.outline = "2px solid #22c55e";
        style.outlineOffset = "2px";
        setTimeout(() => {
          style.outline = prevOutline;
          style.outlineOffset = prevOffset;
        }, 350);
      }
      return pinNumber;
    },
    args: [options.marker, options.flash]
  });
  return result?.result || null;
}
async function copyElementLocator(options) {
  const { info, tab } = options;
  if (!tab.id) {
    return;
  }
  const tabId = tab.id;
  if (info.frameId) {
    await toastTab(tabId, "Iframes are not supported");
    return;
  }
  const marker = await markContextMenuTarget(tabId);
  if (!marker) {
    await toastTab(tabId, "Reload the page and try again");
    return;
  }
  const pinNumber = await pinMarkedElement({ tabId, marker, flash: true });
  if (!pinNumber) {
    await toastTab(tabId, "Could not pin element");
    return;
  }
  const tabState = store.getState().tabs.get(tabId)?.state;
  if (tabState !== "connected" && tabState !== "connecting") {
    void connectTab(tabId);
  }
  const code = buildPinnedElementInspectionCode({ pinName: `playwriterPinnedElem${pinNumber}`, url: tab.url || "" });
  await copyTextInOffscreenDocument("playwriter -e '" + code + "'");
  await toastTab(tabId, "Copied locator");
}
async function startSkillRecording(tabId) {
  if (skillRecordingStartInFlight) {
    return;
  }
  if (recorderActive) {
    setRecorderStateInAllTabs(true);
    return;
  }
  skillRecordingStartInFlight = true;
  try {
    const response = await fetch(`http://${RELAY_HOST}:${RELAY_PORT}/recorder/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    const result = await response.json().catch(() => {
      return {};
    });
    if (!response.ok || !result.recordingId) {
      logger.error("Action recorder start failed:", result.error || response.status);
      await toastTab(tabId, result.error || "Failed to start recording");
      return;
    }
    skillRecordingId = result.recordingId;
    recorderActive = true;
  } catch (error) {
    logger.error("Action recorder start failed:", error);
    await toastTab(tabId, "Failed to start recording");
  } finally {
    skillRecordingStartInFlight = false;
    setRecorderStateInAllTabs(recorderActive);
  }
}
async function stopSkillRecording(tabId) {
  try {
    const response = await fetch(`http://${RELAY_HOST}:${RELAY_PORT}/recorder/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(skillRecordingId ? { recordingId: skillRecordingId } : {})
    });
    const result = await response.json();
    if (!result.recordingId) {
      logger.error("Action recorder stop failed:", result.error || "unknown");
      await toastTab(tabId, result.error || "Failed to stop recording");
      return;
    }
    skillRecordingId = null;
    recorderActive = false;
    setRecorderStateInAllTabs(false);
    const prompt = dedent`
      I just recorded a browser workflow (recording ${result.recordingId}).
      Analyze it and create a reusable skill from it.

      First read how Playwriter works (do not skip):
      https://playwriter.dev/SKILL.md

      Then run:
      playwriter recorder events -r ${result.recordingId}
    `;
    try {
      await copyTextInOffscreenDocument(prompt);
      await toastTab(tabId, "Copied prompt");
    } catch (error) {
      logger.error("Could not copy recorder prompt:", error);
      await toastTab(tabId, `Copy failed. Run: playwriter recorder events -r ${result.recordingId}`);
    }
  } catch (error) {
    logger.error("Action recorder stop failed:", error);
    await toastTab(tabId, "Failed to stop recording");
  }
}
async function copyRemoteText(options) {
  const runtime = remoteTunnel;
  if (!runtime) {
    await toastTab(options.tabId, "Remote control is not active");
    return;
  }
  const text = options.kind === "prompt" ? buildRemoteControlPrompt({ id: runtime.tunnelId }) : runtime.tunnelId;
  try {
    await copyTextInOffscreenDocument(text);
    await toastTab(options.tabId, options.kind === "prompt" ? "Copied prompt" : "Copied id");
  } catch (error) {
    logger.error("Remote control copy failed:", error);
    await toastTab(options.tabId, `Copy failed: ${error.message}`);
  }
}
function buildPinnedElementInspectionCode(options) {
  const URL_LIT = JSON.stringify(options.url).replace(/'/g, "\\u0027");
  return `inspectPinnedElement(${URL_LIT},"globalThis.${options.pinName}")`;
}
chrome.runtime.onInstalled.addListener((details) => {
  return;
});
function serializeTabs(tabs) {
  return JSON.stringify(Array.from(tabs.entries()));
}
store.subscribe((state, prevState) => {
  logger.log(state);
  void updateIcons();
  updateContextMenuVisibility();
  tabSessionIds().filter((tabId) => {
    return !state.tabs.has(tabId);
  }).forEach(endTabSession);
  const tabsChanged = serializeTabs(state.tabs) !== serializeTabs(prevState.tabs);
  if (tabsChanged) {
    tabGroupQueue = tabGroupQueue.then(syncTabGroup).catch((e) => {
      logger.debug("syncTabGroup error:", e);
    });
  }
});
logger.debug(`Using relay host: ${RELAY_HOST}, port: ${RELAY_PORT}`);
let lastMemoryUsage = 0;
let lastMemoryCheck = Date.now();
const MEMORY_WARNING_THRESHOLD = 50 * 1024 * 1024;
const MEMORY_CRITICAL_THRESHOLD = 100 * 1024 * 1024;
const MEMORY_GROWTH_THRESHOLD = 10 * 1024 * 1024;
function checkMemory() {
  try {
    const memory = performance.memory;
    if (!memory) {
      return;
    }
    const used = memory.usedJSHeapSize;
    const total = memory.totalJSHeapSize;
    const limit = memory.jsHeapSizeLimit;
    const now = Date.now();
    const timeDelta = now - lastMemoryCheck;
    const memoryDelta = used - lastMemoryUsage;
    const formatMB = (bytes) => (bytes / 1024 / 1024).toFixed(2) + "MB";
    const growthRate = timeDelta > 0 ? memoryDelta / timeDelta * 1e3 : 0;
    if (used > MEMORY_CRITICAL_THRESHOLD) {
      logger.error(
        `MEMORY CRITICAL: used=${formatMB(used)} total=${formatMB(total)} limit=${formatMB(limit)} growth=${formatMB(memoryDelta)} rate=${formatMB(growthRate)}/s`
      );
    } else if (used > MEMORY_WARNING_THRESHOLD) {
      logger.warn(
        `MEMORY WARNING: used=${formatMB(used)} total=${formatMB(total)} limit=${formatMB(limit)} growth=${formatMB(memoryDelta)} rate=${formatMB(growthRate)}/s`
      );
    } else if (memoryDelta > MEMORY_GROWTH_THRESHOLD && timeDelta < 6e4) {
      logger.warn(
        `MEMORY SPIKE: grew ${formatMB(memoryDelta)} in ${(timeDelta / 1e3).toFixed(1)}s (used=${formatMB(used)})`
      );
    }
    lastMemoryUsage = used;
    lastMemoryCheck = now;
  } catch (e) {
  }
}
setInterval(checkMemory, 5e3);
checkMemory();
chrome.tabs.onRemoved.addListener(onTabRemoved);
chrome.tabs.onActivated.addListener(onTabActivated);
chrome.action.onClicked.addListener(onActionClicked);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void updateIcons();
  const isUntrackedGroupedTabLoading = changeInfo.status === "loading" && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE && !store.getState().tabs.has(tabId);
  if (changeInfo.groupId !== void 0 || isUntrackedGroupedTabLoading) {
    tabGroupQueue = tabGroupQueue.then(async () => {
      const managedTitles = await getManagedTabGroupTitles();
      const readManagedGroups = async () => {
        const allGroups = await chrome.tabGroups.query({});
        return allGroups.filter((g) => g.title && managedTitles.has(g.title));
      };
      const readCurrentGroupId = async () => {
        const currentTab = await chrome.tabs.get(tabId).catch(() => {
          return void 0;
        });
        return currentTab?.groupId ?? chrome.tabGroups.TAB_GROUP_ID_NONE;
      };
      const managedGroups = await readManagedGroups();
      if (managedGroups.length === 0) {
        return;
      }
      const { tabs } = store.getState();
      const currentGroupId = await readCurrentGroupId();
      const currentGroup = managedGroups.find((g) => g.id === currentGroupId);
      if (currentGroup) {
        const tabInfo2 = tabs.get(tabId);
        if (!tabInfo2 && !isRestrictedUrl(tab.url)) {
          const sourceTabId = popupSourceTabMap.get(tabId);
          const sourceTabInfo = sourceTabId === void 0 ? void 0 : tabs.get(sourceTabId);
          logger.debug("Tab added to managed group:", tabId, currentGroup.title, "source:", sourceTabId);
          await connectTab(tabId, {
            groupTitle: currentGroup.title,
            groupKey: sourceTabInfo?.groupKey,
            groupColor: sourceTabInfo?.groupColor
          });
          return;
        }
        const currentTitle = currentGroup.title;
        if (tabInfo2 && currentTitle && (tabInfo2.groupTitle || DEFAULT_TAB_GROUP_TITLE) !== currentTitle) {
          logger.debug("Tab moved between managed groups, adopting title:", tabId, currentTitle);
          store.setState((state) => {
            const newTabs = new Map(state.tabs);
            const existing = newTabs.get(tabId);
            if (!existing) {
              return state;
            }
            newTabs.set(tabId, { ...existing, groupTitle: currentTitle });
            return { tabs: newTabs };
          });
        }
        return;
      }
      const tabInfo = tabs.get(tabId);
      if (!shouldDisconnectAfterTabGroupChange({
        currentGroupId,
        managedGroupIds: managedGroups.map((g) => g.id),
        tabState: tabInfo?.state
      })) {
        logger.debug(
          "Ignoring stale tab group change:",
          tabId,
          "eventGroupId:",
          changeInfo.groupId,
          "currentGroupId:",
          currentGroupId,
          "state:",
          tabInfo?.state
        );
        return;
      }
      await sleep(500);
      const recheckedGroups = await readManagedGroups();
      const recheckedGroupId = await readCurrentGroupId();
      const freshInfo = store.getState().tabs.get(tabId);
      if (!shouldDisconnectAfterTabGroupChange({
        currentGroupId: recheckedGroupId,
        managedGroupIds: recheckedGroups.map((g) => g.id),
        tabState: freshInfo?.state
      })) {
        logger.debug("Tab regrouped during recheck, keeping connection:", tabId);
        return;
      }
      logger.debug("Tab manually removed from managed groups:", tabId);
      await disconnectTab(tabId);
    }).catch((e) => {
      logger.debug("onTabUpdated handler error:", e);
    });
  }
});
const popupSourceTabMap = /* @__PURE__ */ new Map();
chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  popupSourceTabMap.set(details.tabId, details.sourceTabId);
  setTimeout(() => {
    popupSourceTabMap.delete(details.tabId);
  }, 1e4);
  void maybeAttachRemoteChildTab(details);
});
async function maybeAttachRemoteChildTab(details) {
  const runtime = remoteTunnel;
  if (runtime === null || !isRemoteOwnedTab({ runtime, tabId: details.sourceTabId })) {
    return;
  }
  let tab;
  try {
    tab = await chrome.tabs.get(details.tabId);
  } catch {
    return;
  }
  if (isRestrictedUrl(tab.url)) {
    return;
  }
  const win = await chrome.windows.get(tab.windowId).catch(() => {
    return null;
  });
  if (!win || win.type !== "normal") {
    return;
  }
  if (store.getState().tabs.has(details.tabId)) {
    return;
  }
  try {
    const sourceTabInfo = store.getState().tabs.get(details.sourceTabId);
    await attachForRemote({
      runtime,
      tabId: details.tabId,
      attach: () => {
        return connectTab(details.tabId, {
          groupTitle: sourceTabInfo?.groupTitle,
          groupKey: sourceTabInfo?.groupKey,
          groupColor: sourceTabInfo?.groupColor
        });
      }
    });
  } catch (error) {
    logger.debug("Failed to attach remote child tab:", details.tabId, error);
  }
}
chrome.windows.onCreated.addListener(async (popupWindow) => {
  if (popupWindow.type !== "popup" || popupWindow.id === void 0) {
    return;
  }
  try {
    let popupTabs = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      popupTabs = await chrome.tabs.query({ windowId: popupWindow.id });
      if (popupTabs.length > 0) break;
      await sleep(20);
    }
    const tabIds = popupTabs.map((t) => t.id).filter(isTruthy);
    if (tabIds.length === 0) {
      logger.debug(`Popup window ${popupWindow.id} has no tabs after retry, skipping`);
      return;
    }
    const { tabs: connectedTabs } = store.getState();
    let sourceTabId;
    for (const tabId of tabIds) {
      const candidate = popupSourceTabMap.get(tabId);
      if (candidate !== void 0 && connectedTabs.has(candidate)) {
        sourceTabId = candidate;
        break;
      }
    }
    for (const tabId of tabIds) {
      popupSourceTabMap.delete(tabId);
    }
    if (sourceTabId === void 0) {
      logger.debug(
        `Popup window ${popupWindow.id} not opened by a Playwriter-connected tab, leaving alone (tabs=${JSON.stringify(tabIds)})`
      );
      return;
    }
    let destinationWindowId;
    try {
      const sourceTab = await chrome.tabs.get(sourceTabId);
      if (sourceTab.windowId === void 0) {
        const focused = await chrome.windows.getLastFocused({ populate: false });
        if (focused.id === void 0 || focused.id === popupWindow.id) {
          return;
        }
        destinationWindowId = focused.id;
      } else {
        destinationWindowId = sourceTab.windowId;
      }
    } catch (e) {
      logger.debug(`Source tab ${sourceTabId} no longer exists, skipping relocation:`, e);
      return;
    }
    logger.debug(
      `Relocating ${tabIds.length} popup tab(s) from window ${popupWindow.id} into source window ${destinationWindowId} (sourceTabId=${sourceTabId})`
    );
    await chrome.tabs.move(tabIds, { windowId: destinationWindowId, index: -1 });
    try {
      await chrome.windows.remove(popupWindow.id);
    } catch {
    }
    const sourceTabInfo = connectedTabs.get(sourceTabId);
    const runtime = remoteTunnel && isRemoteOwnedTab({ runtime: remoteTunnel, tabId: sourceTabId }) ? remoteTunnel : null;
    for (const tabId of tabIds) {
      if (connectedTabs.has(tabId)) continue;
      const attach = () => {
        return connectTab(tabId, {
          groupTitle: sourceTabInfo?.groupTitle,
          groupKey: sourceTabInfo?.groupKey,
          groupColor: sourceTabInfo?.groupColor
        });
      };
      try {
        await (runtime ? attachForRemote({ runtime, tabId, attach }) : attach());
      } catch (e) {
        logger.warn(`Failed to auto-connect relocated popup tab ${tabId}:`, e);
      }
    }
  } catch (e) {
    logger.warn("Failed to relocate popup window:", e);
  }
});
async function runMenuAction(info, tab) {
  if (!tab.id) {
    return;
  }
  const tabId = tab.id;
  try {
    switch (info.menuItemId) {
      case MENU.pinElement:
        return await copyElementLocator({ info, tab });
      case MENU.copyReactSource:
        return await copyReactSource({ info, tab });
      case MENU.copyRemotePrompt:
        return await copyRemoteText({ tabId, kind: "prompt" });
      case MENU.copyRemoteId:
        return await copyRemoteText({ tabId, kind: "id" });
      case MENU.stopSharing:
        stopRemoteControl();
        return await toastTab(tabId, "Sharing stopped");
    }
  } catch (error) {
    logger.error("Menu action failed:", info.menuItemId, error);
    await toastTab(tabId, `Failed: ${error.message}`);
  }
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab) {
    void runMenuAction(info, tab);
  }
});
async function runMenuItemForActiveTab(menuItemId) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) {
    throw new Error("No active tab");
  }
  await runMenuAction({ menuItemId, frameId: 0, editable: false, pageUrl: tab.url || "" }, tab);
}
async function copyReactSource(options) {
  const { info, tab } = options;
  if (!tab.id || store.getState().tabs.get(tab.id)?.state !== "connected") {
    return;
  }
  const tabId = tab.id;
  const debuggee = { tabId };
  if (info.frameId) {
    await toastTab(tabId, "Iframes are not supported");
    return;
  }
  const marker = await markContextMenuTarget(tabId);
  const pinNumber = marker ? await pinMarkedElement({ tabId, marker, flash: true }) : null;
  if (!pinNumber) {
    await toastTab(tabId, "Reload the page and try again");
    return;
  }
  const elementExpression = `window.playwriterPinnedElem${pinNumber}`;
  const hasBippy = await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", {
    expression: "!!globalThis.__bippy",
    returnByValue: true
  });
  if (!hasBippy.result?.value) {
    await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", { expression: bippyBundleCode });
  }
  const jsResolveSource = js`
    (async () => {
      const el = ${elementExpression};
      if (!el) return JSON.stringify({ error: 'Pinned element not found' });

      const bippy = globalThis.__bippy;
      if (!bippy) return JSON.stringify({ error: 'bippy not loaded' });

      // bippy.normalizeFileName strips "/app-pages-browser/" but not the parenthesized
      // form "/(app-pages-browser)/" that Next.js webpack actually uses. This regex
      // strips all Next.js webpack layer prefixes: (app-pages-browser), (ssr), (rsc),
      // (action-browser), (pages-dir-browser), (pages-dir-edge), (pages-dir-node).
      // Also strips leading "./" that often follows the layer prefix.
      const cleanFileName = (name) => {
        let f = bippy.normalizeFileName(name);
        f = f.replace(/^\/?\\([-\\w]+\\)\\//, '');
        f = f.replace(/^\\.[\\/]/, '');
        return f;
      };

      let fiber;
      try { fiber = bippy.getFiberFromHostInstance(el); } catch {}
      if (!fiber) return JSON.stringify({ error: 'No React fiber found. Is this a React app?' });

      // Walk up to find nearest composite fiber with source info
      let current = fiber;
      for (let i = 0; i < 50 && current; i++) {
        try {
          if (bippy.isCompositeFiber(current)) {
            const source = await bippy.getSource(current);
            if (source && source.fileName && bippy.isSourceFile(source.fileName)) {
              return JSON.stringify({
                fileName: cleanFileName(source.fileName),
                lineNumber: source.lineNumber || null,
                columnNumber: source.columnNumber || null,
                componentName: source.functionName || bippy.getDisplayName(current.type) || null,
              });
            }
            // Try owner stack as fallback for this fiber
            const ownerStack = await bippy.getOwnerStack(current);
            for (const frame of ownerStack) {
              if (frame.fileName && bippy.isSourceFile(frame.fileName)) {
                return JSON.stringify({
                  fileName: cleanFileName(frame.fileName),
                  lineNumber: frame.lineNumber || null,
                  columnNumber: frame.columnNumber || null,
                  componentName: frame.functionName || bippy.getDisplayName(current.type) || null,
                });
              }
            }
          }
        } catch {}
        current = current.return;
      }
      return JSON.stringify({ error: 'No React source location found. Is this a dev build with source maps?' });
    })()
  `;
  const sourceResult = await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", {
    expression: jsResolveSource,
    returnByValue: true,
    awaitPromise: true
  });
  if (sourceResult.exceptionDetails) {
    throw new Error("Could not resolve React source", { cause: new Error(sourceResult.exceptionDetails.text) });
  }
  const parsed = JSON.parse(sourceResult.result?.value || "{}");
  if (!parsed.fileName) {
    logger.debug("React source not found:", parsed.error);
    await toastTab(tabId, parsed.error || "No React source found");
    return;
  }
  const clipboardText = parsed.lineNumber ? `${parsed.fileName}:${parsed.lineNumber}` : parsed.fileName;
  await copyTextInOffscreenDocument(clipboardText);
  await toastTab(tabId, "Copied source path");
  logger.debug("Copied React source path:", clipboardText, "component:", parsed.componentName);
}
void updateIcons();
let offscreenDocumentCreating = null;
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL("src/offscreen.html")]
  });
  if (existingContexts.length > 0) {
    return;
  }
  if (offscreenDocumentCreating) {
    return offscreenDocumentCreating;
  }
  offscreenDocumentCreating = chrome.offscreen.createDocument({
    url: "src/offscreen.html",
    reasons: [chrome.offscreen.Reason.CLIPBOARD, chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: "Copy prompts to the clipboard and play menu action sounds"
  });
  try {
    await offscreenDocumentCreating;
  } finally {
    offscreenDocumentCreating = null;
  }
}
async function copyTextInOffscreenDocument(text) {
  await writeClipboardInOffscreenDocument(text);
  playSound("success");
}
async function writeClipboardInOffscreenDocument(text) {
  await ensureOffscreenDocument();
  const result = await chrome.runtime.sendMessage({ action: "copyText", text });
  if (!result.success) {
    throw new Error("Could not copy to clipboard", { cause: new Error(result.error) });
  }
}
function getToolbarSenderTabId(sender) {
  const tabId = sender.tab?.id;
  if (!tabId || sender.frameId !== 0 || store.getState().tabs.get(tabId)?.state !== "connected") {
    return null;
  }
  return tabId;
}
function playSound(sound) {
  void ensureOffscreenDocument().then(async () => {
    const result = await chrome.runtime.sendMessage({ action: "playSound", sound });
    if (!result.success) {
      logger.debug("Could not play sound:", sound, result.error);
    }
  }).catch((error) => {
    logger.debug("Could not play sound:", sound, error.message);
  });
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "remoteControlStart") {
    const tabId = getToolbarSenderTabId(sender);
    if (!tabId) {
      return false;
    }
    void (async () => {
      const { started, id } = await startRemoteControl(tabId);
      try {
        await copyTextInOffscreenDocument(buildRemoteControlPrompt({ id }));
      } catch (error) {
        if (started) {
          stopRemoteControl();
        }
        throw error;
      }
    })().then(
      () => {
        void toastTab(tabId, "Copied prompt");
      },
      (error) => {
        logger.error("Remote control start failed:", error);
        void toastTab(tabId, `Remote control failed: ${error.message}`);
      }
    );
    return false;
  }
  if (message.action === "remoteControlStop") {
    const tabId = getToolbarSenderTabId(sender);
    if (!tabId) {
      return false;
    }
    stopRemoteControl();
    void toastTab(tabId, "Sharing stopped");
    playToolbarSound(tabId, "click");
    return false;
  }
  if (message.action === "remoteControlCopyPrompt" || message.action === "remoteControlCopyId") {
    const tabId = getToolbarSenderTabId(sender);
    if (!tabId) {
      return false;
    }
    void copyRemoteText({ tabId, kind: message.action === "remoteControlCopyPrompt" ? "prompt" : "id" });
    return false;
  }
  if (message.action === "actionRecorderStart") {
    const tabId = getToolbarSenderTabId(sender);
    if (!tabId) {
      return false;
    }
    void startSkillRecording(tabId);
    return false;
  }
  if (message.action === "actionRecorderStop") {
    const tabId = getToolbarSenderTabId(sender);
    if (!tabId) {
      return false;
    }
    void stopSkillRecording(tabId);
    return false;
  }
  if (message.action === "copyToolbarText") {
    const tabId = getToolbarSenderTabId(sender);
    if (!tabId || typeof message.text !== "string") {
      return false;
    }
    void writeClipboardInOffscreenDocument(message.text).catch((error) => {
      logger.error("Could not copy toolbar text:", error);
      void toastTab(tabId, "Copy failed");
    });
    return false;
  }
  if (message.action === "pinToolbarElement") {
    const tabId = getToolbarSenderTabId(sender);
    if (!tabId || typeof message.marker !== "string") {
      return false;
    }
    pinMarkedElement({ tabId, marker: message.marker, flash: false }).then(
      (pinNumber) => {
        sendResponse({ pinNumber: pinNumber || void 0 });
      },
      (error) => {
        logger.error("Could not pin toolbar element:", error);
        sendResponse({});
      }
    );
    return true;
  }
  return false;
});
chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }
  if (store.getState().tabs.get(details.tabId)?.state !== "connected") {
    return;
  }
  injectToolbar(details.tabId);
});
