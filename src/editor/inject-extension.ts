/**
 * Inject a CM6 extension into an existing EditorView
 * using StateEffect.appendConfig with Compartment isolation.
 *
 * Returns a cleanup function that removes the extension.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { CM6Modules } from './cm6-modules';
import type { EditorViewLike } from './get-editor-view';

/**
 * Inject an extension into the editor. Returns a cleanup function.
 *
 * IMPORTANT: The cm6 modules must be extracted from the same EditorView
 * instance (via extractCM6Modules). Using separately bundled modules will
 * silently fail due to identity-based matching.
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

  return () => {
    view.dispatch({
      effects: compartment.reconfigure([]),
    });
  };
}
