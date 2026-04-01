/**
 * Custom fold system for <details> blocks in the CodeMirror editor.
 *
 * Since we can't import from @codemirror/language (module identity issues),
 * we build our own fold state management using the CM6 primitives
 * extracted from the runtime (StateEffect, StateField, Decoration).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { CM6Modules } from './cm6-modules';
import type { EditorViewLike } from './get-editor-view';

export interface FoldEffects {
  fold: any;   // StateEffectType<{from: number, to: number}>
  unfold: any; // StateEffectType<{from: number, to: number}>
}

export interface DetailsFoldExtension {
  extension: any;
  effects: FoldEffects;
  foldState: any; // StateField reference for reading fold state
}

/** Callback when a fold is toggled from the editor (e.g. clicking placeholder) */
export type EditorFoldToggleCallback = (index: number, isOpen: boolean) => void;

/**
 * Create the complete fold extension for <details> blocks.
 * Returns the extension to inject and the effect types for programmatic control.
 *
 * @param onEditorFoldToggle Called when a fold is toggled FROM the editor side
 *        (clicking the placeholder). Used for reverse-sync to preview.
 */
export function createDetailsFoldExtension(
  cm6: CM6Modules,
  onEditorFoldToggle?: EditorFoldToggleCallback,
): DetailsFoldExtension {
  // Define fold/unfold effects
  const foldEffect = cm6.StateEffect.define({ map: mapRange });
  const unfoldEffect = cm6.StateEffect.define({ map: mapRange });

  // StateField to track folded ranges as replace decorations
  const foldState = cm6.StateField.define({
    create(): any {
      return cm6.Decoration.none;
    },

    update(folded: any, tr: any): any {
      // Map existing decorations through document changes
      folded = folded.map(tr.changes);

      for (const effect of tr.effects) {
        if (effect.is(foldEffect)) {
          const { from, to } = effect.value;
          const deco = cm6.Decoration.replace({
            widget: new FoldWidget(),
            block: false,
          });
          folded = folded.update({
            add: [deco.range(from, to)],
          });
        } else if (effect.is(unfoldEffect)) {
          const { from, to } = effect.value;
          folded = folded.update({
            filter: (decoFrom: number, decoTo: number) => {
              return decoFrom !== from || decoTo !== to;
            },
          });
        }
      }
      return folded;
    },

    provide(field: any): any {
      return cm6.EditorView.decorations.from(field);
    },
  });

  // Click handler: clicking placeholder unfolds and syncs to preview
  const foldClickHandler = cm6.EditorView.domEventHandlers({
    click(event: MouseEvent, view: any) {
      const target = event.target as HTMLElement;
      if (target.classList.contains('cm-details-fold-placeholder')) {
        const pos = view.posAtDOM(target);
        const folded = view.state.field(foldState);
        let foldRange: { from: number; to: number } | null = null;
        folded.between(0, view.state.doc.length, (from: number, to: number) => {
          if (from <= pos && pos <= to) {
            foldRange = { from, to };
          }
        });
        if (foldRange) {
          view.dispatch({ effects: unfoldEffect.of(foldRange) });

          // Reverse-sync: find which <details> index this range corresponds to
          if (onEditorFoldToggle) {
            const ranges = findDetailsRanges(view);
            const match = ranges.find(
              (r) => r.from === foldRange!.from && r.to === foldRange!.to,
            );
            if (match) {
              onEditorFoldToggle(match.index, true); // true = now open
            }
          }
          return true;
        }
      }
      return false;
    },
  });

  // Styles for fold placeholder
  const foldTheme = cm6.EditorView.baseTheme({
    '.cm-details-fold-placeholder': {
      cursor: 'pointer',
      backgroundColor: '#f0f0f0',
      border: '1px solid #ddd',
      borderRadius: '3px',
      padding: '0 4px',
      marginLeft: '4px',
      fontSize: '0.85em',
      color: '#666',
      '&:hover': {
        backgroundColor: '#e0e0e0',
      },
    },
  });

  return {
    extension: [foldState, foldClickHandler, foldTheme],
    effects: { fold: foldEffect, unfold: unfoldEffect },
    foldState,
  };
}

/**
 * Map a {from, to} range through document changes.
 */
function mapRange(value: { from: number; to: number }, changes: any): { from: number; to: number } | undefined {
  const from = changes.mapPos(value.from, 1);
  const to = changes.mapPos(value.to, -1);
  return from >= to ? undefined : { from, to };
}

/**
 * Widget that replaces folded content with a clickable placeholder.
 * Implements the full CM6 WidgetType interface.
 */
class FoldWidget {
  eq(_other: FoldWidget): boolean {
    return true;
  }

  compare(other: FoldWidget): boolean {
    return this.constructor === other.constructor && this.eq(other);
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-details-fold-placeholder';
    span.textContent = '\u25B6 ...';
    span.title = 'Click to unfold';
    return span;
  }

  updateDOM(_dom: HTMLElement): boolean {
    return false;
  }

  coordsAt(): null {
    return null;
  }

  get estimatedHeight(): number {
    return -1;
  }

  get lineBreaks(): number {
    return 0;
  }

  ignoreEvent(): boolean {
    return false;
  }

  destroy(): void {
    // noop
  }
}

/**
 * Find all <details> blocks in the document and return their fold ranges.
 * Each range maps to the nth <details> occurrence (0-indexed) for preview sync.
 */
export function findDetailsRanges(
  view: EditorViewLike,
): Array<{ index: number; from: number; to: number; lineFrom: number; hasOpen: boolean }> {
  const doc = view.state.doc;
  const ranges: Array<{ index: number; from: number; to: number; lineFrom: number; hasOpen: boolean }> = [];
  let detailsIndex = 0;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text.trimStart();

    if (/<details(\s[^>]*)?>/.test(text)) {
      const hasOpen = /open/.test(text);
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
            hasOpen,
          });
          break;
        }
      }
      detailsIndex++;
    }
  }

  return ranges;
}
