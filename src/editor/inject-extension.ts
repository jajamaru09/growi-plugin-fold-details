/**
 * Inject a CM6 extension into an existing EditorView
 * using StateEffect.appendConfig.
 *
 * Note: Without Compartment, we cannot cleanly remove the extension.
 * This is acceptable because the extension is only active during edit mode,
 * and leaving edit mode reconstructs the editor.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { CM6Modules } from './cm6-modules';
import type { EditorViewLike } from './get-editor-view';

/**
 * Inject an extension into the editor.
 *
 * IMPORTANT: The cm6 modules must be extracted from the same EditorView
 * instance (via extractCM6Modules). Using separately bundled modules will
 * silently fail due to identity-based matching.
 */
export function injectExtension(
  view: EditorViewLike,
  cm6: CM6Modules,
  extension: any,
): void {
  view.dispatch({
    effects: cm6.StateEffect.appendConfig.of(extension),
  });
}
