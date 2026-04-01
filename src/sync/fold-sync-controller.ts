/**
 * Synchronize fold state between the preview pane's <details> elements
 * and the CodeMirror editor.
 *
 * When a preview <details> is closed → fold the corresponding block in the editor.
 * When a preview <details> is opened → unfold the corresponding block in the editor.
 *
 * Matching is done by 0-based index (nth <details> in preview = nth <details> in source).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { EditorViewLike } from '../editor/get-editor-view';
import { findDetailsRanges, type FoldEffects } from '../editor/details-fold-extension';

export class FoldSyncController {
  constructor(
    private effects: FoldEffects,
    private foldState: any,
  ) {}

  /**
   * Handle a preview <details> toggle event.
   * @param view Fresh EditorView reference (must be re-acquired each call)
   * @param index 0-based index of the <details> element in the preview
   * @param isOpen Whether the <details> is now open
   */
  onPreviewToggle(view: EditorViewLike, index: number, isOpen: boolean): void {
    const ranges = findDetailsRanges(view);
    const range = ranges.find((r) => r.index === index);
    if (!range) return;

    if (isOpen) {
      this.unfoldRange(view, range.from, range.to);
    } else {
      this.foldRange(view, range.from, range.to);
    }
  }

  private foldRange(view: EditorViewLike, from: number, to: number): void {
    if (this.isRangeFolded(view, from, to)) return;

    view.dispatch({
      effects: this.effects.fold.of({ from, to }),
    });
  }

  private unfoldRange(view: EditorViewLike, from: number, to: number): void {
    if (!this.isRangeFolded(view, from, to)) return;

    view.dispatch({
      effects: this.effects.unfold.of({ from, to }),
    });
  }

  private isRangeFolded(view: EditorViewLike, from: number, to: number): boolean {
    try {
      const folded = view.state.field(this.foldState, false);
      if (!folded) return false;

      let found = false;
      folded.between(from, to, (f: number, t: number) => {
        if (f === from && t === to) found = true;
      });
      return found;
    } catch {
      return false;
    }
  }
}
