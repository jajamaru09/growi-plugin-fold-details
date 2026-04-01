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
    private view: EditorViewLike,
    private effects: FoldEffects,
    private foldState: any,
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
    // Check if already folded at this range
    if (this.isRangeFolded(from, to)) return;

    this.view.dispatch({
      effects: this.effects.fold.of({ from, to }),
    });
  }

  private unfoldRange(from: number, to: number): void {
    // Check if actually folded before dispatching
    if (!this.isRangeFolded(from, to)) return;

    this.view.dispatch({
      effects: this.effects.unfold.of({ from, to }),
    });
  }

  private isRangeFolded(from: number, to: number): boolean {
    try {
      const folded = this.view.state.field(this.foldState, false);
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
