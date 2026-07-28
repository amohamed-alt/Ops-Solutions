import { JSDOM } from 'jsdom';

const GLOBAL_KEYS = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'getComputedStyle'];

export function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost'
  });

  const previousDescriptors = new Map(
    GLOBAL_KEYS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  );

  const replacements = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window)
  };

  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      enumerable: false,
      writable: true
    });
  }

  return function restoreDom() {
    dom.window.close();
    for (const key of GLOBAL_KEYS) {
      const descriptor = previousDescriptors.get(key);
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete globalThis[key];
      }
    }
  };
}
