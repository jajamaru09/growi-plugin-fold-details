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
      console.log(LOG_PREFIX, `Extraction attempt ${attempt}/${maxAttempts} failed, retrying...`);
      await sleep(500 * attempt);
      const freshView = getEditorView();
      if (freshView) view = freshView;
    }
  }
  throw new Error('unreachable');
}

/**
 * Set the open state of the nth <details> element in the preview pane.
 */
function setPreviewDetailsOpen(index: number, isOpen: boolean): void {
  // Prefer the editor preview pane, fall back to view-mode wiki container
  const preview =
    document.querySelector('.page-editor-preview-body')
    ?? document.querySelector('.wiki');
  if (!preview) return;

  const allDetails = preview.querySelectorAll('details');
  const target = allDetails[index];
  if (target) {
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
    console.log(LOG_PREFIX, `Folded ${toFold.length} initially-closed <details> blocks`);
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

  // Fold initially-closed <details> blocks
  // Slight delay to ensure the fold extension is ready
  await sleep(100);
  const currentView = getEditorView();
  if (currentView) {
    foldInitialClosedDetails(currentView, effects);
  }

  // Set up sync controller (preview → editor)
  const syncController = new FoldSyncController(
    currentView ?? view,
    effects,
    foldState,
  );

  // Observe preview toggles → sync to editor
  const removeToggleObserver = observePreviewDetailsToggle((index, isOpen) => {
    const v = getEditorView();
    if (v) {
      syncController.onPreviewToggle(index, isOpen);
    }
  });
  cleanups.push(removeToggleObserver);

  editorSetupActive = true;
  console.log(LOG_PREFIX, 'Editor fold extension activated');
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
  console.log(LOG_PREFIX, 'Plugin activated');

  window.addEventListener('hashchange', onHashChange);
  cleanups.push(() => window.removeEventListener('hashchange', onHashChange));

  if (isEditMode()) {
    setupEditor();
  }
}

export function deactivate(): void {
  cleanup();
  console.log(LOG_PREFIX, 'Plugin deactivated');
}
