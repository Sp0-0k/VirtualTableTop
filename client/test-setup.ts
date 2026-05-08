import '@testing-library/dom';
import 'konva/lib/index-node';

// jsdom doesn't implement ResizeObserver; stub it so Canvas.tsx doesn't throw.
if (typeof ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
