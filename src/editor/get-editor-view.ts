/**
 * Acquire the CM6 EditorView from GROWI's DOM.
 *
 * GROWI uses @uiw/react-codemirror which stores an internal view reference
 * on the .cm-content element via the `cmTile` property (CM6 internal).
 *
 * This is a non-public API and may break across GROWI/CM6 version updates.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Minimal interface for CM6 EditorView, typed loosely to avoid
 * importing from @codemirror/* (which would create module identity issues).
 */
export interface EditorViewLike {
  state: {
    doc: {
      toString(): string;
      length: number;
      lineAt(pos: number): { from: number; to: number; number: number; text: string };
      line(n: number): { from: number; to: number; number: number; text: string };
      lines: number;
    };
    update(spec: any): any;
    field(field: any, required?: boolean): any;
    config: {
      base: any[];
      compartments: Map<any, any>;
      dynamicSlots: any[];
    };
    constructor: any;
    values: any[];
  };
  dispatch(spec: any): void;
  dom: HTMLElement;
  contentDOM: HTMLElement;
  docView: {
    decorations: any[];
  };
  constructor: any;
}

/**
 * Attempt to extract the CM6 EditorView from the DOM.
 * Returns null if not in edit mode or editor is not mounted.
 */
export function getEditorView(): EditorViewLike | null {
  const content = document.querySelector('.cm-content');
  if (!content) return null;

  const tile = (content as any).cmTile;
  if (!tile) return null;

  const view = tile.parent?.view ?? tile.view;
  return view ?? null;
}

/**
 * Wait for the CM6 editor to appear in the DOM.
 * Resolves when EditorView is available, rejects after timeout.
 */
export function waitForEditorView(timeoutMs = 10000): Promise<EditorViewLike> {
  return new Promise((resolve, reject) => {
    const view = getEditorView();
    if (view) {
      resolve(view);
      return;
    }

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error('EditorView not found within timeout'));
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      const view = getEditorView();
      if (view) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(view);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}
