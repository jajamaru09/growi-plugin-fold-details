/**
 * Observe <details> toggle events in GROWI's preview pane.
 *
 * The preview renders markdown <details> tags as native HTML <details> elements.
 * We listen for the 'toggle' event (which fires when open state changes)
 * and report the 0-based index of the toggled element.
 */

export type DetailsToggleCallback = (index: number, isOpen: boolean) => void;

/**
 * Start observing <details> toggle events in the preview pane.
 * Returns a cleanup function that removes the listener.
 *
 * @param callback Called with (index, isOpen) when any preview <details> toggles.
 *                 index is the 0-based position among all <details> in the preview.
 */
export function observePreviewDetailsToggle(callback: DetailsToggleCallback): () => void {
  const handleToggle = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLDetailsElement)) return;

    // Only care about <details> inside the editor preview pane
    // CSS Modules generates hashed class names, so use partial match
    const preview = target.closest('[class*="page-editor-preview-body"]');
    if (!preview) return;

    // Determine the 0-based index of this <details> among siblings in the preview
    const allDetails = preview.querySelectorAll('details');
    const index = Array.from(allDetails).indexOf(target);
    if (index === -1) return;

    callback(index, target.open);
  };

  // 'toggle' events don't bubble, so we must use capture phase
  document.addEventListener('toggle', handleToggle, true);

  return () => {
    document.removeEventListener('toggle', handleToggle, true);
  };
}
