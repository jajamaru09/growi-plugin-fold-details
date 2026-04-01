# growi-plugin-fold-details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GROWI plugin that makes `<details>` blocks in the CodeMirror editor foldable, with fold state synced to the preview pane's `<details>` open/close state.

**Architecture:** The plugin registers via GROWI's `window.pluginActivators` API. On edit mode entry (detected via `hashchange`), it acquires the CodeMirror 6 EditorView through DOM traversal (`cmTile`), extracts CM6 class references (StateEffect, Compartment, Decoration, StateField, etc.) from the EditorView's object graph, and injects a custom fold extension. A preview observer listens for `<details>` toggle events and dispatches fold/unfold effects to keep the editor in sync.

**Tech Stack:** TypeScript, Vite, GROWI Plugin API (schemaVersion 4). No `@codemirror/*` dependencies — all CM6 classes are extracted from the running editor at runtime to avoid module identity issues.

**Critical Risk (RESOLVED):** CM6 uses identity-based matching for StateEffect, Facet, etc. Separately bundled copies do NOT work. Solution: extract class references from the live EditorView instance via `scrollIntoView().constructor` (StateEffect), `config.compartments` (Compartment), `docView.decorations` (Decoration), `config.base` (StateField, ViewPlugin), `EditorState.tabSize.constructor` (Facet). All validated on a running GROWI instance.

---

## File Structure

```
growi-plugin-fold-details/
├── package.json                    # Plugin metadata with growiPlugin field
├── tsconfig.json                   # TypeScript config
├── tsconfig.node.json              # Vite-specific TS config
├── vite.config.ts                  # Vite build config
├── client-entry.tsx                # Plugin entry point (registers activator)
├── src/
│   ├── activate.ts                 # Main activate/deactivate logic
│   ├── editor/
│   │   ├── get-editor-view.ts      # DOM hack to acquire CM6 EditorView
│   │   ├── cm6-modules.ts          # Extract CM6 modules from webpack runtime
│   │   ├── details-fold-extension.ts  # foldService for <details> tags
│   │   └── inject-extension.ts     # Inject CM6 extension via appendConfig
│   ├── preview/
│   │   └── details-toggle-observer.ts  # Watch preview <details> toggle events
│   └── sync/
│       └── fold-sync-controller.ts # Bridge preview toggle → editor fold
├── growi_plugin_dev_info.md        # Development reference (already created)
└── docs/
    └── superpowers/
        └── plans/
            └── 2026-04-02-fold-details-plugin.md  # This plan
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "growi-plugin-fold-details",
  "version": "0.1.0",
  "description": "Fold <details> blocks in GROWI's CodeMirror editor, synced with preview pane",
  "type": "module",
  "keywords": ["growi", "growi-plugin", "codemirror", "fold", "details"],
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  },
  "devDependencies": {
    "@growi/pluginkit": "^1.1.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  },
  "growiPlugin": {
    "schemaVersion": "4",
    "types": ["script"]
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src", "client-entry.tsx"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Create tsconfig.node.json**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    manifest: true,
    rollupOptions: {
      input: ['/client-entry.tsx'],
    },
  },
});
```

Note: No `react` plugin — this plugin does not use React/JSX. It operates purely on CM6 and DOM APIs.

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.node.json vite.config.ts
git commit -m "chore: scaffold growi-plugin-fold-details project"
```

---

### Task 2: EditorView Acquisition Utility

**Files:**
- Create: `src/editor/get-editor-view.ts`

- [ ] **Step 1: Create get-editor-view.ts**

This module extracts the CM6 EditorView from the DOM via the `cmTile` internal property. It handles the case where `.cm-content` is not yet in the DOM (edit mode not active).

```typescript
// src/editor/get-editor-view.ts

/**
 * Represents a CM6 EditorView instance (untyped to avoid module identity issues).
 * We access it via DOM internals, so we use a minimal interface.
 */
export interface EditorViewLike {
  state: {
    doc: { toString(): string; length: number; lineAt(pos: number): { from: number; to: number; number: number; text: string }; line(n: number): { from: number; to: number; number: number; text: string }; lines: number };
    update(spec: any): any;
    field(field: any, required?: boolean): any;
  };
  dispatch(spec: any): void;
  dom: HTMLElement;
  contentDOM: HTMLElement;
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
```

- [ ] **Step 2: Commit**

```bash
git add src/editor/get-editor-view.ts
git commit -m "feat: add EditorView DOM acquisition utility"
```

---

### Task 3: CM6 Module Extraction from Webpack Runtime (CRITICAL VALIDATION)

**Files:**
- Create: `src/editor/cm6-modules.ts`

**Why this is critical:** CM6 uses identity-based matching for `StateEffect` and `Facet`. A separately bundled copy of `@codemirror/state` produces different object identities — `StateEffect.appendConfig` from our bundle is NOT the same as GROWI's. We MUST use the same module instances that GROWI's editor uses.

**Strategy:** Next.js/webpack stores loaded modules in a runtime cache. We search this cache for CM6 module exports by looking for known properties (`StateEffect.appendConfig`, `EditorView.theme`, `foldService`, etc.).

- [ ] **Step 1: USER VALIDATION — Check webpack runtime in browser**

The user must run these commands in DevTools on the GROWI edit page to verify the approach is viable:

```js
// Check for webpack chunk storage
const chunkKeys = Object.keys(window).filter(k => /webpack|chunk/i.test(k));
console.log('Webpack globals:', chunkKeys);

// Check for __webpack_modules__ or similar
console.log('__webpack_modules__:', typeof __webpack_modules__);
console.log('__webpack_require__:', typeof __webpack_require__);

// Check webpackChunk array (Next.js pattern)
const webpackChunk = window["webpackChunk_N_E"] || window["webpackChunck_N_E"];
console.log('webpackChunk:', webpackChunk);
```

**Expected:** At least one webpack global should exist. If `webpackChunk_N_E` exists, we can iterate its module factories to find CM6 exports.

**If none found:** Skip to the Fallback Plan at the end of this document.

- [ ] **Step 2: USER VALIDATION — Locate CM6 modules in cache**

```js
// Search for StateEffect in webpack module cache
// The module cache is typically accessible via require.c or similar
// Try to find it by iterating loaded modules

// Approach: look for objects with 'appendConfig' property (StateEffect class)
function findInWebpackCache(predicate) {
  // Next.js stores modules in a require cache
  // Try accessing via the chunk loading mechanism
  const cache = window.__webpack_module_cache__ || window.__webpack_require__?.c;
  if (!cache) {
    console.log('No webpack cache found directly. Trying chunk approach...');
    return null;
  }
  for (const [id, mod] of Object.entries(cache)) {
    const exports = mod.exports || mod;
    if (predicate(exports)) return { id, exports };
    // Check default export
    if (exports.default && predicate(exports.default)) return { id, exports: exports.default };
  }
  return null;
}

// Look for @codemirror/state (has StateEffect with appendConfig)
const stateModule = findInWebpackCache(e =>
  e && typeof e === 'object' && e.StateEffect && e.StateEffect.appendConfig
);
console.log('@codemirror/state:', stateModule);

// Look for @codemirror/language (has foldService)
const langModule = findInWebpackCache(e =>
  e && typeof e === 'object' && e.foldService
);
console.log('@codemirror/language:', langModule);
```

**Expected:** Both modules found with their exports.

**If webpack cache is not directly accessible**, try alternative approach:

```js
// Alternative: Extract StateEffect from the EditorView's internals
// The EditorView uses StateEffect internally, so it must be in the same bundle
const tile = document.querySelector('.cm-content').cmTile;
const view = tile.parent?.view || tile.view;

// Try to trigger a transaction that uses appendConfig
// and intercept the effect type
const origDispatch = view.dispatch.bind(view);
let capturedAppendConfig = null;

// Monkey-patch temporarily to capture effect types
const origUpdate = view.state.update.bind(view.state);
// ... this approach is fragile, try webpack cache first
```

- [ ] **Step 3: Implement cm6-modules.ts**

Based on validation results, implement the module extraction:

```typescript
// src/editor/cm6-modules.ts

/**
 * CM6 module references extracted from GROWI's webpack runtime.
 * These MUST be the same instances used by the editor, not separately bundled copies.
 */
export interface CM6Modules {
  // From @codemirror/state
  StateEffect: {
    appendConfig: { of(value: any): any };
  };
  Compartment: new () => {
    of(extension: any): any;
    reconfigure(extension: any): any;
  };

  // From @codemirror/language
  foldService: { of(callback: (state: any, lineStart: number, lineEnd: number) => { from: number; to: number } | null): any };
  codeFolding: (config?: any) => any;
  foldEffect: { of(range: { from: number; to: number }): any };
  unfoldEffect: { of(range: { from: number; to: number }): any };
  foldState: any; // StateField
}

/**
 * Search the webpack module cache for a module whose exports match a predicate.
 */
function searchWebpackCache(predicate: (exports: any) => boolean): any | null {
  // Next.js webpack cache access
  const cache: Record<string, any> | undefined =
    (window as any).__webpack_module_cache__
    ?? (window as any).__webpack_require__?.c;

  if (!cache) return null;

  for (const id of Object.keys(cache)) {
    try {
      const mod = cache[id];
      const exports = mod?.exports;
      if (!exports) continue;

      // Check direct exports
      if (predicate(exports)) return exports;

      // Check named re-exports (common in bundled ESM)
      for (const key of Object.keys(exports)) {
        if (exports[key] && typeof exports[key] === 'object' && predicate(exports[key])) {
          return exports[key];
        }
      }
    } catch {
      // Skip modules that throw on access
    }
  }
  return null;
}

/**
 * Extract CM6 module references from GROWI's webpack runtime.
 * Throws if critical modules cannot be found.
 */
export function extractCM6Modules(): CM6Modules {
  // Find @codemirror/state
  const stateExports = searchWebpackCache(
    (e) => e && typeof e === 'object' && e.StateEffect?.appendConfig != null
  );
  if (!stateExports) {
    throw new Error('[fold-details] Could not find @codemirror/state in webpack cache');
  }

  // Find @codemirror/language
  const langExports = searchWebpackCache(
    (e) => e && typeof e === 'object' && e.foldService != null && e.foldEffect != null
  );
  if (!langExports) {
    throw new Error('[fold-details] Could not find @codemirror/language in webpack cache');
  }

  return {
    StateEffect: stateExports.StateEffect,
    Compartment: stateExports.Compartment,
    foldService: langExports.foldService,
    codeFolding: langExports.codeFolding,
    foldEffect: langExports.foldEffect,
    unfoldEffect: langExports.unfoldEffect,
    foldState: langExports.foldState,
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/editor/cm6-modules.ts
git commit -m "feat: extract CM6 module references from webpack runtime"
```

---

### Task 4: Details Fold Extension

**Files:**
- Create: `src/editor/details-fold-extension.ts`

- [ ] **Step 1: Create details-fold-extension.ts**

```typescript
// src/editor/details-fold-extension.ts

import type { CM6Modules } from './cm6-modules';
import type { EditorViewLike } from './get-editor-view';

/**
 * Create a foldService extension that recognizes <details>...</details> blocks.
 * The fold range spans from the end of the <details> opening tag line
 * to the end of the </details> closing tag line.
 */
export function createDetailsFoldExtension(cm6: CM6Modules): any {
  const detailsFoldService = cm6.foldService.of(
    (state: any, lineStart: number, _lineEnd: number) => {
      const line = state.doc.lineAt(lineStart);
      const text = line.text.trimStart();

      // Match lines starting with <details (with optional attributes)
      if (!/<details(\s[^>]*)?>/.test(text)) return null;

      // Search forward for matching </details>, handling nesting
      let depth = 1;
      for (let i = line.number + 1; i <= state.doc.lines; i++) {
        const scanLine = state.doc.line(i);
        const scanText = scanLine.text;

        const opens = (scanText.match(/<details(\s[^>]*)?>/g) || []).length;
        const closes = (scanText.match(/<\/details>/g) || []).length;
        depth += opens - closes;

        if (depth <= 0) {
          // Fold from end of <details> line to end of </details> line
          return { from: line.to, to: scanLine.to };
        }
      }

      return null;
    }
  );

  return [
    detailsFoldService,
    cm6.codeFolding({
      placeholderText: '▶ <details> ...',
    }),
  ];
}

/**
 * Find all <details> blocks in the document and return their fold ranges.
 * Each range maps to the nth <details> occurrence (0-indexed) for preview sync.
 */
export function findDetailsRanges(view: EditorViewLike): Array<{ index: number; from: number; to: number; lineFrom: number }> {
  const doc = view.state.doc;
  const ranges: Array<{ index: number; from: number; to: number; lineFrom: number }> = [];
  let detailsIndex = 0;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text.trimStart();

    if (/<details(\s[^>]*)?>/.test(text)) {
      let depth = 1;
      for (let j = i + 1; j <= doc.lines; j++) {
        const scanLine = doc.line(j);
        const opens = (scanLine.text.match(/<details(\s[^>]*)?>/g) || []).length;
        const closes = (scanLine.text.match(/<\/details>/g) || []).length;
        depth += opens - closes;

        if (depth <= 0) {
          ranges.push({
            index: detailsIndex,
            from: line.to,
            to: scanLine.to,
            lineFrom: line.from,
          });
          break;
        }
      }
      detailsIndex++;
    }
  }

  return ranges;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/editor/details-fold-extension.ts
git commit -m "feat: add foldService for <details> blocks"
```

---

### Task 5: Extension Injection Utility

**Files:**
- Create: `src/editor/inject-extension.ts`

- [ ] **Step 1: Create inject-extension.ts**

```typescript
// src/editor/inject-extension.ts

import type { CM6Modules } from './cm6-modules';
import type { EditorViewLike } from './get-editor-view';

/**
 * Inject a CM6 extension into an existing EditorView using StateEffect.appendConfig.
 * Returns a cleanup function that removes the extension.
 *
 * IMPORTANT: The CM6 modules must be the same instances used by the EditorView.
 * Using separately bundled copies will silently fail (identity-based matching).
 */
export function injectExtension(
  view: EditorViewLike,
  cm6: CM6Modules,
  extension: any,
): () => void {
  const compartment = new cm6.Compartment();

  view.dispatch({
    effects: cm6.StateEffect.appendConfig.of(compartment.of(extension)),
  });

  // Return cleanup function
  return () => {
    view.dispatch({
      effects: compartment.reconfigure([]),
    });
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/editor/inject-extension.ts
git commit -m "feat: add CM6 extension injection utility"
```

---

### Task 6: Preview Toggle Observer

**Files:**
- Create: `src/preview/details-toggle-observer.ts`

- [ ] **Step 1: Create details-toggle-observer.ts**

```typescript
// src/preview/details-toggle-observer.ts

export type DetailsToggleCallback = (index: number, isOpen: boolean) => void;

/**
 * Observe <details> toggle events in the GROWI preview pane.
 * Calls back with the 0-based index of the <details> element and its new open state.
 * Returns a cleanup function.
 */
export function observePreviewDetailsToggle(callback: DetailsToggleCallback): () => void {
  const handleToggle = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLDetailsElement)) return;

    // Only care about <details> inside the preview pane
    const preview = target.closest('.page-editor-preview-body, .wiki');
    if (!preview) return;

    // Determine the index of this <details> among its siblings in the preview
    const allDetails = preview.querySelectorAll('details');
    const index = Array.from(allDetails).indexOf(target);
    if (index === -1) return;

    callback(index, target.open);
  };

  // Use capture phase to catch toggle events (they don't bubble)
  document.addEventListener('toggle', handleToggle, true);

  return () => {
    document.removeEventListener('toggle', handleToggle, true);
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/preview/details-toggle-observer.ts
git commit -m "feat: add preview <details> toggle observer"
```

---

### Task 7: Fold Sync Controller

**Files:**
- Create: `src/sync/fold-sync-controller.ts`

- [ ] **Step 1: Create fold-sync-controller.ts**

```typescript
// src/sync/fold-sync-controller.ts

import type { CM6Modules } from '../editor/cm6-modules';
import type { EditorViewLike } from '../editor/get-editor-view';
import { findDetailsRanges } from '../editor/details-fold-extension';

/**
 * Sync fold state between the preview pane's <details> elements
 * and the CodeMirror editor.
 *
 * When a preview <details> is closed → fold the corresponding block in the editor.
 * When a preview <details> is opened → unfold the corresponding block in the editor.
 */
export class FoldSyncController {
  constructor(
    private view: EditorViewLike,
    private cm6: CM6Modules,
  ) {}

  /**
   * Handle a preview <details> toggle event.
   * @param index 0-based index of the <details> element in the preview
   * @param isOpen Whether the <details> is now open
   */
  onPreviewToggle(index: number, isOpen: boolean): void {
    const ranges = findDetailsRanges(this.view);
    const range = ranges.find((r) => r.index === index);
    if (!range) return;

    if (isOpen) {
      this.unfoldRange(range.from, range.to);
    } else {
      this.foldRange(range.from, range.to);
    }
  }

  private foldRange(from: number, to: number): void {
    // Check if already folded
    try {
      const foldState = this.view.state.field(this.cm6.foldState, false);
      if (foldState) {
        let alreadyFolded = false;
        foldState.between(from, to, (f: number, t: number) => {
          if (f === from && t === to) alreadyFolded = true;
        });
        if (alreadyFolded) return;
      }
    } catch {
      // foldState might not be available yet
    }

    this.view.dispatch({
      effects: this.cm6.foldEffect.of({ from, to }),
    });
  }

  private unfoldRange(from: number, to: number): void {
    this.view.dispatch({
      effects: this.cm6.unfoldEffect.of({ from, to }),
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/sync/fold-sync-controller.ts
git commit -m "feat: add fold sync controller for preview-editor bridge"
```

---

### Task 8: Main Activate Logic

**Files:**
- Create: `src/activate.ts`

- [ ] **Step 1: Create activate.ts**

```typescript
// src/activate.ts

import { extractCM6Modules, type CM6Modules } from './editor/cm6-modules';
import { createDetailsFoldExtension } from './editor/details-fold-extension';
import { getEditorView, waitForEditorView, type EditorViewLike } from './editor/get-editor-view';
import { injectExtension } from './editor/inject-extension';
import { observePreviewDetailsToggle } from './preview/details-toggle-observer';
import { FoldSyncController } from './sync/fold-sync-controller';

const LOG_PREFIX = '[growi-plugin-fold-details]';

/** All cleanup functions to call on deactivate or mode change */
let cleanups: Array<() => void> = [];

/** Whether the editor-side setup has been performed for the current edit session */
let editorSetupActive = false;

function cleanup(): void {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  editorSetupActive = false;
}

async function setupEditor(): Promise<void> {
  if (editorSetupActive) return;

  let cm6: CM6Modules;
  try {
    cm6 = extractCM6Modules();
  } catch (e) {
    console.error(LOG_PREFIX, 'Failed to extract CM6 modules:', e);
    return;
  }

  let view: EditorViewLike;
  try {
    view = await waitForEditorView(5000);
  } catch (e) {
    console.warn(LOG_PREFIX, 'Editor not found:', e);
    return;
  }

  // Inject fold extension
  const foldExtension = createDetailsFoldExtension(cm6);
  const removeExtension = injectExtension(view, cm6, foldExtension);
  cleanups.push(removeExtension);

  // Set up sync controller
  const syncController = new FoldSyncController(view, cm6);

  // Observe preview toggles
  const removeToggleObserver = observePreviewDetailsToggle((index, isOpen) => {
    // Re-acquire view in case it changed
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

  // Listen for mode changes
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
```

- [ ] **Step 2: Commit**

```bash
git add src/activate.ts
git commit -m "feat: add main activate/deactivate logic with mode detection"
```

---

### Task 9: Plugin Entry Point

**Files:**
- Create: `client-entry.tsx`

- [ ] **Step 1: Create client-entry.tsx**

```typescript
// client-entry.tsx

import { activate, deactivate } from './src/activate';

const PLUGIN_NAME = 'growi-plugin-fold-details';

if ((window as any).pluginActivators == null) {
  (window as any).pluginActivators = {};
}

(window as any).pluginActivators[PLUGIN_NAME] = { activate, deactivate };
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: `dist/` directory created with `manifest.json` and bundled JS.

- [ ] **Step 3: Commit**

```bash
git add client-entry.tsx
git commit -m "feat: add plugin entry point"
```

---

### Task 10: Integration Testing on GROWI

- [ ] **Step 1: Build the plugin**

Run: `npm run build`

- [ ] **Step 2: Install in GROWI**

Copy or symlink the plugin into GROWI's plugin directory, or install via the admin panel if using a git repository.

- [ ] **Step 3: Verify in browser**

1. Open a GROWI page with `<details>` content
2. Enter edit mode (`#edit`)
3. Open DevTools console — check for `[growi-plugin-fold-details] Editor fold extension activated`
4. Verify fold gutters appear next to `<details>` lines in the editor
5. Click a gutter marker — the `<details>` content should fold
6. In the preview, close a `<details>` — the editor should fold the corresponding block
7. In the preview, open a `<details>` — the editor should unfold it

- [ ] **Step 4: If CM6 module extraction fails**

Check console for `Could not find @codemirror/state in webpack cache`. See Fallback Plan below.

---

## Fallback Plan: If Webpack Module Extraction Fails

If CM6 modules cannot be extracted from the webpack runtime (Task 3 fails), there are three options:

### Option A: Contribute to GROWI Core

Submit a PR to [weseek/growi](https://github.com/weseek/growi) that exposes CM6 modules on `growiFacade`:

```typescript
// In growi-facade-utils.ts
registerGrowiFacade({
  markdownRenderer: { ... },
  react: React,
  codemirror: {
    state: require('@codemirror/state'),
    view: require('@codemirror/view'),
    language: require('@codemirror/language'),
  },
});
```

This is the **cleanest long-term solution** and would enable a whole ecosystem of editor plugins.

### Option B: GROWI Fork / Patch

Maintain a fork of GROWI with the above change. Apply as a patch when updating GROWI.

### Option C: Reduced-Scope Plugin (Preview-Only)

Build a preview-only plugin using the official `customGeneratePreviewOptions` API:
- Wrap rendered `<details>` elements with enhanced toggle behavior
- Add visual indicators (e.g., line count badges)
- No editor folding — the editor shows full source at all times

This uses only the supported plugin API and won't break across GROWI versions.
