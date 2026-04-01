/**
 * Extract CM6 class references from GROWI's runtime EditorView instance.
 *
 * CM6 uses identity-based matching for StateEffect, Facet, etc.
 * A separately bundled copy of @codemirror/* will NOT work with the editor.
 * We must use the exact same class instances that GROWI's editor uses.
 *
 * Strategy: traverse the EditorView's object graph to find the classes
 * by their known characteristics (static methods, property shapes).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { EditorViewLike } from './get-editor-view';

/**
 * CM6 class references extracted from GROWI's runtime.
 * These are the SAME instances used by the editor — not separately bundled copies.
 */
export interface CM6Modules {
  /** StateEffect class — has define(), appendConfig */
  StateEffect: {
    define(spec?: any): any;
    appendConfig: { of(value: any): any };
  };

  /** Compartment class — has of(), reconfigure() */
  Compartment: new () => {
    of(extension: any): any;
    reconfigure(extension: any): any;
  };

  /** Decoration class — has replace(), mark(), widget(), set(), none */
  Decoration: {
    replace(spec?: any): any;
    mark(spec: any): any;
    widget(spec: any): any;
    line(spec: any): any;
    set(ranges: any, sort?: boolean): any;
    none: any;
  };

  /** Facet class — has define() */
  Facet: {
    define(config?: any): any;
  };

  /** StateField class — has define() */
  StateField: {
    define(config: any): any;
  };

  /** ViewPlugin class — has define() */
  ViewPlugin: {
    define(create: any, spec?: any): any;
  };

  /** EditorView class (the constructor itself) */
  EditorView: any;
}

/**
 * Extract all required CM6 module references from a live EditorView instance.
 * Throws if any critical class cannot be found.
 */
export function extractCM6Modules(view: EditorViewLike): CM6Modules {
  const EditorView = view.constructor;

  // --- StateEffect ---
  // EditorView.scrollIntoView(pos) returns a StateEffect instance
  const scrollEffect = EditorView.scrollIntoView(0);
  const StateEffect = scrollEffect.constructor;
  if (!StateEffect.appendConfig?.of) {
    throw new Error('[fold-details] StateEffect.appendConfig not found');
  }

  // --- Compartment ---
  // Primary: state.config.compartments is a Map<Compartment, Extension[]>
  // Fallback: base extensions contain CompartmentExtension objects with a `compartment` property
  let Compartment: any = null;
  const compartments: Map<any, any> | undefined = view.state.config.compartments;
  if (compartments && compartments.size > 0) {
    const firstCompartment = compartments.keys().next().value;
    if (firstCompartment) {
      Compartment = firstCompartment.constructor;
    }
  }
  if (!Compartment) {
    // Fallback: find CompartmentExtension in base (has {compartment, inner} shape)
    const compartmentExt = findInBaseFlat(view.state.config.base, (ext) => {
      return ext && typeof ext === 'object'
        && 'compartment' in ext && 'inner' in ext
        && ext.compartment
        && typeof ext.compartment.of === 'function'
        && typeof ext.compartment.reconfigure === 'function';
    });
    if (compartmentExt) {
      Compartment = compartmentExt.compartment.constructor;
    }
  }
  if (!Compartment) {
    throw new Error('[fold-details] Compartment class not found');
  }

  // --- Decoration ---
  // Extract from existing decorations in the docView
  let Decoration: any = null;
  for (const decoSet of view.docView.decorations) {
    if (decoSet && typeof decoSet.iter === 'function') {
      const iter = decoSet.iter();
      if (iter.value) {
        Decoration = iter.value.constructor;
        break;
      }
    }
  }
  if (!Decoration) {
    // Fallback: try Decoration.none which is a static property
    // Search through all DecorationSets (even empty ones have a constructor)
    for (const decoSet of view.docView.decorations) {
      if (decoSet && decoSet.constructor && typeof decoSet.constructor.prototype?.iter === 'function') {
        // This is a RangeSet/DecorationSet, not a Decoration itself
        // We need to find the Decoration class another way
        break;
      }
    }
  }
  if (!Decoration) {
    throw new Error('[fold-details] Decoration class not found (no existing decorations in editor)');
  }
  // Decoration static methods might be on the parent class
  const DecoParent = Object.getPrototypeOf(Decoration);
  const DecoClass = (typeof Decoration.replace === 'function') ? Decoration
    : (typeof DecoParent?.replace === 'function') ? DecoParent
    : null;
  if (!DecoClass?.replace) {
    throw new Error('[fold-details] Decoration.replace not found');
  }

  // --- Facet ---
  // EditorState.tabSize is a Facet instance
  const Facet = view.state.constructor.tabSize.constructor;
  if (typeof Facet.define !== 'function') {
    throw new Error('[fold-details] Facet.define not found');
  }

  // --- StateField ---
  // Search flattened base extensions for objects whose constructor has define()
  // and whose instances have createF, updateF, compareF properties (StateField shape)
  const StateField = findClassInBase(view.state.config.base, (ext) => {
    return typeof ext.constructor?.define === 'function'
      && 'createF' in ext
      && 'updateF' in ext;
  });
  if (!StateField || typeof StateField.define !== 'function') {
    throw new Error('[fold-details] StateField.define not found');
  }

  // --- ViewPlugin ---
  const ViewPlugin = findClassInBase(view.state.config.base, (ext) => {
    return typeof ext.constructor?.define === 'function'
      && 'domEventHandlers' in ext;
  });
  if (!ViewPlugin || typeof ViewPlugin.define !== 'function') {
    throw new Error('[fold-details] ViewPlugin.define not found');
  }

  return {
    StateEffect,
    Compartment,
    Decoration: DecoClass,
    Facet,
    StateField,
    ViewPlugin,
    EditorView,
  };
}

/**
 * Recursively flatten an extension array and find the constructor
 * of the first element matching a predicate.
 */
function findClassInBase(
  base: any[],
  predicate: (ext: any) => boolean,
  depth = 10,
): any | null {
  for (const item of base) {
    if (Array.isArray(item) && depth > 0) {
      const result = findClassInBase(item, predicate, depth - 1);
      if (result) return result;
    } else if (item && typeof item === 'object' && item.constructor !== Object) {
      if (predicate(item)) {
        return item.constructor;
      }
    }
  }
  return null;
}

/**
 * Recursively flatten an extension array and find the first element
 * (not constructor) matching a predicate.
 */
function findInBaseFlat(
  base: any[],
  predicate: (ext: any) => boolean,
  depth = 10,
): any | null {
  for (const item of base) {
    if (Array.isArray(item) && depth > 0) {
      const result = findInBaseFlat(item, predicate, depth - 1);
      if (result) return result;
    } else if (item && typeof item === 'object') {
      if (predicate(item)) {
        return item;
      }
    }
  }
  return null;
}
