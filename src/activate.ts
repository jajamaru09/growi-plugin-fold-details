/**
 * Main plugin activation logic.
 *
 * Lifecycle:
 *   activate() called once by GROWI on page load
 *     → listen for hashchange (edit mode detection)
 *       → on #edit: wait for CM6 DOM → extract CM6 modules (with retries) → inject fold extension → observe preview
 *       → on leave edit: cleanup all injected extensions and observers
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { extractCM6Modules, type CM6Modules } from './editor/cm6-modules';
import { createDetailsFoldExtension } from './editor/details-fold-extension';
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

/**
 * Try to extract CM6 modules with retries.
 * The editor may not have decorations immediately after mounting,
 * so we retry a few times with increasing delays.
 */
async function extractWithRetries(view: EditorViewLike, maxAttempts = 5): Promise<CM6Modules> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return extractCM6Modules(view);
    } catch (e) {
      if (attempt === maxAttempts) throw e;
      console.log(LOG_PREFIX, `Extraction attempt ${attempt}/${maxAttempts} failed, retrying...`);
      await sleep(500 * attempt);
      // Re-acquire view in case it changed
      const freshView = getEditorView();
      if (freshView) view = freshView;
    }
  }
  throw new Error('unreachable');
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

  // Create and inject fold extension
  const { extension, effects, foldState } = createDetailsFoldExtension(cm6);
  injectExtension(view, cm6, extension);

  // Set up sync controller
  const syncController = new FoldSyncController(view, effects, foldState);

  // Observe preview toggles → sync to editor
  const removeToggleObserver = observePreviewDetailsToggle((index, isOpen) => {
    // Re-acquire view in case DOM changed
    const currentView = getEditorView();
    if (currentView) {
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

  // If already in edit mode, set up immediately
  if (isEditMode()) {
    setupEditor();
  }
}

export function deactivate(): void {
  cleanup();
  console.log(LOG_PREFIX, 'Plugin deactivated');
}
