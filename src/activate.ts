/**
 * Main plugin activation logic.
 *
 * Lifecycle:
 *   activate() called once by GROWI on page load
 *     → listen for hashchange (edit mode detection)
 *       → on #edit: wait for CM6 DOM → extract CM6 modules (with retries)
 *         → inject fold extension → fold initially-closed <details> → observe preview
 *       → on leave edit: cleanup all observers
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { extractCM6Modules, type CM6Modules } from './editor/cm6-modules';
import { createDetailsFoldExtension, findDetailsRanges } from './editor/details-fold-extension';
import { getEditorView, waitForEditorView, type EditorViewLike } from './editor/get-editor-view';
import { injectExtension } from './editor/inject-extension';
import { observePreviewDetailsToggle } from './preview/details-toggle-observer';
import { FoldSyncController } from './sync/fold-sync-controller';

const LOG_PREFIX = '[growi-plugin-fold-details]';

let cleanups: Array<() => void> = [];
let editorSetupActive = false;

function cleanup(): void {
  cleanups.forEach((fn) => {
    try { fn(); } catch { /* ignore cleanup errors */ }
  });
  cleanups = [];
  editorSetupActive = false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractWithRetries(view: EditorViewLike, maxAttempts = 5): Promise<CM6Modules> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return extractCM6Modules(view);
    } catch (e) {
      if (attempt === maxAttempts) throw e;
      console.debug(LOG_PREFIX, `Extraction attempt ${attempt}/${maxAttempts} failed, retrying...`);
      await sleep(500 * attempt);
      const freshView = getEditorView();
      if (freshView) view = freshView;
    }
  }
  throw new Error('unreachable');
}

function getEditorPreviewContainer(): Element | null {
  // CSS Modules generates hashed class names like "Preview_page-editor-preview-body__3Poyo"
  return document.querySelector('[class*="page-editor-preview-body"]');
}

function setPreviewDetailsOpen(index: number, isOpen: boolean): void {
  const preview = getEditorPreviewContainer();
  if (!preview) return;

  const allDetails = preview.querySelectorAll('details');
  const target = allDetails[index];
  if (target instanceof HTMLDetailsElement) {
    target.open = isOpen;
  }
}

/**
 * Fold all <details> blocks that don't have the `open` attribute.
 * This syncs the initial editor state with the preview state.
 */
function foldInitialClosedDetails(
  view: EditorViewLike,
  effects: { fold: any },
): void {
  const ranges = findDetailsRanges(view);
  const toFold = ranges.filter((r) => !r.hasOpen);

  if (toFold.length > 0) {
    view.dispatch({
      effects: toFold.map((r) => effects.fold.of({ from: r.from, to: r.to })),
    });
    console.debug(LOG_PREFIX, `Folded ${toFold.length} initially-closed <details> blocks`);
  }
}

async function setupEditor(): Promise<void> {
  if (editorSetupActive) return;

  let view;
  try {
    view = await waitForEditorView(5000);
  } catch (e) {
    console.warn(LOG_PREFIX, 'Editor not found:', e);
    return;
  }

  // Guard: check if fold extension is already injected (e.g. editor instance reused)
  // by checking for our DOM marker
  if (view.dom.dataset?.foldDetailsInjected === 'true') {
    editorSetupActive = true;
    return;
  }

  let cm6;
  try {
    cm6 = await extractWithRetries(view);
  } catch (e) {
    console.error(LOG_PREFIX, 'Failed to extract CM6 modules:', e);
    return;
  }

  // Create fold extension with reverse-sync callback (editor → preview)
  const { extension, effects, foldState } = createDetailsFoldExtension(
    cm6,
    (index, isOpen) => {
      setPreviewDetailsOpen(index, isOpen);
    },
  );

  injectExtension(view, cm6, extension);

  // Mark the editor DOM to prevent double-injection
  (view.dom as HTMLElement).dataset.foldDetailsInjected = 'true';

  // Fold initially-closed <details> blocks immediately after injection
  // (appendConfig is applied synchronously, so the fold state field is ready)
  const currentView = getEditorView() ?? view;
  foldInitialClosedDetails(currentView, effects);

  // Set up sync controller (preview → editor)
  const syncController = new FoldSyncController(effects, foldState);

  // Observe preview toggles → sync to editor
  const removeToggleObserver = observePreviewDetailsToggle((index, isOpen) => {
    // Always re-acquire view to avoid stale references
    const freshView = getEditorView();
    if (freshView) {
      syncController.onPreviewToggle(freshView, index, isOpen);
    }
  });
  cleanups.push(removeToggleObserver);

  editorSetupActive = true;
  console.debug(LOG_PREFIX, 'Editor fold extension activated');
}

function isEditMode(): boolean {
  return window.location.hash === '#edit';
}

function onHashChange(): void {
  if (isEditMode()) {
    setupEditor();
  } else {
    cleanup();
  }
}

export function activate(): void {
  console.debug(LOG_PREFIX, 'Plugin activated');

  window.addEventListener('hashchange', onHashChange);
  cleanups.push(() => window.removeEventListener('hashchange', onHashChange));

  if (isEditMode()) {
    setupEditor();
  }
}

export function deactivate(): void {
  cleanup();
  console.debug(LOG_PREFIX, 'Plugin deactivated');
}
