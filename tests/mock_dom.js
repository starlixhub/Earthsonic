/**
 * tests/mock_dom.js
 * Empirical DOM & Browser Mock Harness for testing DimensionalSpecDrawer in Node.js.
 */

export class MockClassList {
  constructor() {
    this.classes = new Set();
  }
  add(...tokens) {
    tokens.forEach(t => this.classes.add(t));
  }
  remove(...tokens) {
    tokens.forEach(t => this.classes.delete(t));
  }
  contains(token) {
    return this.classes.has(token);
  }
  toggle(token) {
    if (this.classes.has(token)) {
      this.classes.delete(token);
      return false;
    } else {
      this.classes.add(token);
      return true;
    }
  }
  toString() {
    return Array.from(this.classes).join(' ');
  }
}

export class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.id = '';
    this._className = '';
    this.classList = new MockClassList();
    this.attributes = new Map();
    this.style = {
      cssText: '',
      display: '',
      maxHeight: '',
      width: '',
      height: '',
    };
    this.children = [];
    this.parentNode = null;
    this._innerHTML = '';
    this.listeners = new Map();
    this.clientHeight = 600;
    this.clientWidth = 800;
    this.value = '';
  }

  get className() {
    return this._className;
  }

  set className(val) {
    this._className = val;
    this.classList.classes.clear();
    String(val).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  addEventListener(event, fn) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(fn);
  }

  removeEventListener(event, fn) {
    if (!this.listeners.has(event)) return;
    const list = this.listeners.get(event);
    const idx = list.indexOf(fn);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  }

  dispatchEvent(event) {
    const list = this.listeners.get(event.type) || [];
    for (const fn of list) {
      fn.call(this, event);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(html) {
    this._innerHTML = html;
    this.children = [];
    // Instantiate mock nodes for elements that code queries
    if (html.includes('id="spec-viewport-container"')) {
      const el = new MockElement('div');
      el.id = 'spec-viewport-container';
      this.appendChild(el);
    }
    if (html.includes('id="sensor-spec-select"')) {
      const el = new MockElement('select');
      el.id = 'sensor-spec-select';
      this.appendChild(el);
    }
    if (html.includes('id="btn-close-spec-drawer"')) {
      const el = new MockElement('button');
      el.id = 'btn-close-spec-drawer';
      this.appendChild(el);
    }
    if (html.includes('<svg')) {
      const el = new MockElement('svg');
      el.id = 'dw-sheet-svg';
      this.appendChild(el);
    }
  }

  querySelector(selector) {
    if (selector.startsWith('#')) {
      const targetId = selector.slice(1);
      if (this.id === targetId) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    } else {
      if (this.tagName.toLowerCase() === selector.toLowerCase()) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }
}

export class MockWindow {
  constructor() {
    this.listeners = new Map();
    this.nextRafId = 1;
    this.activeRafs = new Set();
    this.cancelledRafs = new Set();
  }

  addEventListener(event, fn) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(fn);
  }

  removeEventListener(event, fn) {
    if (!this.listeners.has(event)) return;
    const list = this.listeners.get(event);
    const idx = list.indexOf(fn);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  }

  dispatchEvent(event) {
    const list = this.listeners.get(event.type) || [];
    for (const fn of [...list]) {
      fn.call(this, event);
    }
  }

  requestAnimationFrame(cb) {
    const id = this.nextRafId++;
    this.activeRafs.add(id);
    return id;
  }

  cancelAnimationFrame(id) {
    this.activeRafs.delete(id);
    this.cancelledRafs.add(id);
  }

  getListenerCount(event) {
    return (this.listeners.get(event) || []).length;
  }
}

export class MockDocument {
  constructor() {
    this.body = new MockElement('body');
  }

  createElement(tagName) {
    return new MockElement(tagName);
  }
}

export function setupMockDOM() {
  const mockWin = new MockWindow();
  const mockDoc = new MockDocument();

  globalThis.window = mockWin;
  globalThis.document = mockDoc;
  globalThis.requestAnimationFrame = (cb) => mockWin.requestAnimationFrame(cb);
  globalThis.cancelAnimationFrame = (id) => mockWin.cancelAnimationFrame(id);

  return { mockWin, mockDoc };
}
