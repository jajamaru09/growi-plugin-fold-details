# エディタ（CodeMirror 6）操作プラグインの実装パターン

GROWIの公式プラグインAPIにはエディタ操作の機能がない。EditorViewをDOM経由で取得し、CM6クラスをランタイムから抽出して拡張を注入する必要がある。

**前提**: この手法はGROWI/CM6の内部構造に依存するため、バージョンアップで壊れるリスクがある。必ずエラーハンドリングとgraceful degradationを実装すること。

---

## 1. EditorViewの取得

```typescript
interface EditorViewLike {
  state: {
    doc: { toString(): string; length: number; lineAt(pos: number): any; line(n: number): any; lines: number };
    update(spec: any): any;
    field(field: any, required?: boolean): any;
    config: { base: any[]; compartments: Map<any, any>; dynamicSlots: any[] };
    constructor: any;
    values: any[];
  };
  dispatch(spec: any): void;
  dom: HTMLElement;
  contentDOM: HTMLElement;
  docView: { decorations: any[] };
  constructor: any;
}

function getEditorView(): EditorViewLike | null {
  const content = document.querySelector('.cm-content');
  if (!content) return null;
  const tile = (content as any).cmTile;
  if (!tile) return null;
  return tile.parent?.view ?? tile.view ?? null;
}

function waitForEditorView(timeoutMs = 10000): Promise<EditorViewLike> {
  return new Promise((resolve, reject) => {
    const view = getEditorView();
    if (view) { resolve(view); return; }

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error('EditorView not found'));
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

**注意**: `cmTile` はCM6の内部プロパティ。`tile.parent?.view` で取得できない場合は `tile.view` を試す。

---

## 2. CM6クラスのランタイム抽出

### なぜ必要か

CM6は `StateEffect.define()` でユニークなeffect typeを作成し、`effect.is(type)` でidentity比較する。別バンドルの `@codemirror/state` からimportした `StateEffect` は異なるオブジェクトIDを持つため、`StateEffect.appendConfig` が拡張の注入時に**静かに無視される**。

### 抽出方法

```typescript
function extractCM6Modules(view: EditorViewLike) {
  const EditorView = view.constructor;

  // StateEffect: scrollIntoView() が返すインスタンスのコンストラクタ
  const scrollEffect = EditorView.scrollIntoView(0);
  const StateEffect = scrollEffect.constructor;
  // 検証: StateEffect.appendConfig?.of が存在すること

  // Decoration: docView.decorations のイテレータから取得
  // エディタ初期化直後はデコレーションが空の場合がある → リトライが必要
  let Decoration = null;
  for (const decoSet of view.docView.decorations) {
    if (decoSet && typeof decoSet.iter === 'function') {
      const iter = decoSet.iter();
      if (iter.value) {
        Decoration = iter.value.constructor;
        // 静的メソッド(replace, mark等)は親クラスにある場合がある
        const parent = Object.getPrototypeOf(Decoration);
        if (typeof parent?.replace === 'function') Decoration = parent;
        break;
      }
    }
  }

  // StateField: config.baseをフラット化して、createF + updateFプロパティを持つものを検索
  const StateField = findClassInBase(view.state.config.base, (ext) =>
    typeof ext.constructor?.define === 'function' && 'createF' in ext && 'updateF' in ext
  );

  // Facet: EditorState.tabSize のコンストラクタ
  const Facet = view.state.constructor.tabSize.constructor;

  // ViewPlugin: config.baseからdomEventHandlersプロパティを持つものを検索
  const ViewPlugin = findClassInBase(view.state.config.base, (ext) =>
    typeof ext.constructor?.define === 'function' && 'domEventHandlers' in ext
  );

  return { StateEffect, Decoration, StateField, Facet, ViewPlugin, EditorView };
}

// ヘルパー: base拡張配列を再帰的にフラット化して検索
function findClassInBase(base: any[], predicate: (ext: any) => boolean, depth = 10): any | null {
  for (const item of base) {
    if (Array.isArray(item) && depth > 0) {
      const r = findClassInBase(item, predicate, depth - 1);
      if (r) return r;
    } else if (item && typeof item === 'object' && item.constructor !== Object) {
      if (predicate(item)) return item.constructor;
    }
  }
  return null;
}
```

### CM6クラス取得方法まとめ

| クラス | 取得パス | 利用可能メソッド |
|---|---|---|
| `StateEffect` | `EditorView.scrollIntoView(0).constructor` | `define()`, `appendConfig.of()` |
| `Decoration` | `docView.decorations` → iter → value.constructor (親クラス) | `replace()`, `mark()`, `widget()`, `set()`, `none` |
| `StateField` | `config.base` フラット検索 (`createF` + `updateF`) | `define({ create, update, provide })` |
| `Facet` | `EditorState.tabSize.constructor` | `define()` |
| `ViewPlugin` | `config.base` フラット検索 (`domEventHandlers`) | `define()` |
| `EditorView` | `view.constructor` | `theme()`, `baseTheme()`, `decorations`, `domEventHandlers()`, `updateListener` |

### Decorationの取得にはリトライが必要

エディタ初期化直後は `docView.decorations` が全て空の場合がある。500ms〜2500msのリトライで対応する:

```typescript
async function extractWithRetries(view, maxAttempts = 5) {
  for (let i = 1; i <= maxAttempts; i++) {
    try { return extractCM6Modules(view); }
    catch (e) {
      if (i === maxAttempts) throw e;
      await new Promise(r => setTimeout(r, 500 * i));
      const fresh = getEditorView();
      if (fresh) view = fresh;
    }
  }
}
```

---

## 3. 拡張の注入

```typescript
function injectExtension(view: EditorViewLike, cm6: CM6Modules, extension: any): void {
  view.dispatch({
    effects: cm6.StateEffect.appendConfig.of(extension),
  });
}
```

Compartmentを使えばクリーンアップが可能だが、Compartmentクラスの取得が不安定な場合がある。editモードから離脱するとエディタが再構築されるため、Compartment無しでも実用上問題ない。

---

## 4. editモード検知とライフサイクル

```typescript
let cleanups: Array<() => void> = [];
let editorSetupActive = false;

function cleanup(): void {
  cleanups.forEach(fn => { try { fn(); } catch {} });
  cleanups = [];
  editorSetupActive = false;
}

async function setupEditor(): Promise<void> {
  if (editorSetupActive) return;

  const view = await waitForEditorView(5000);
  
  // 二重注入ガード
  if ((view.dom as HTMLElement).dataset.myPluginInjected === 'true') {
    editorSetupActive = true;
    return;
  }

  const cm6 = await extractWithRetries(view);
  
  // ここで拡張を注入
  injectExtension(view, cm6, myExtension);
  (view.dom as HTMLElement).dataset.myPluginInjected = 'true';

  // イベントリスナー等のクリーンアップを登録
  // cleanups.push(removeListener);

  editorSetupActive = true;
}

export function activate(): void {
  const onHashChange = () => {
    if (window.location.hash === '#edit') {
      setupEditor();
    } else {
      cleanup();
    }
  };

  window.addEventListener('hashchange', onHashChange);
  cleanups.push(() => window.removeEventListener('hashchange', onHashChange));

  if (window.location.hash === '#edit') {
    setupEditor();
  }
}

export function deactivate(): void {
  cleanup();
}
```

---

## 5. WidgetTypeの実装

CM6の `Decoration.replace({ widget })` や `Decoration.widget({ widget })` で使うウィジェットは、WidgetTypeの全インターフェースを実装する必要がある。1つでも欠けるとランタイムエラーになる。

```typescript
class MyWidget {
  eq(other: MyWidget): boolean { return true; }
  compare(other: MyWidget): boolean {
    return this.constructor === other.constructor && this.eq(other);
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.textContent = 'placeholder';
    return el;
  }
  updateDOM(_dom: HTMLElement): boolean { return false; }
  coordsAt(): null { return null; }
  get estimatedHeight(): number { return -1; }
  get lineBreaks(): number { return 0; }
  ignoreEvent(): boolean { return false; }
  destroy(): void {}
}
```

---

## 6. プレビューDOMの操作

### エディタプレビューのコンテナ取得

GROWIはCSS Modulesを使用しているため、部分一致セレクタを使う:

```typescript
// editモードのプレビューペイン
document.querySelector('[class*="page-editor-preview-body"]')

// 閲覧モードのページコンテンツ
document.querySelector('.wiki')
```

### 重要: 同名コンテナの重複

editモードでは `.wiki`（閲覧モード用、非表示）と `[class*="page-editor-preview-body"]`（エディタプレビュー用）の**2つ**がDOMに存在する。`querySelector('.wiki')` は閲覧モード用を返すため、エディタプレビューへの操作が反映されないように見える。

```typescript
// NG: 閲覧モード用コンテナを操作してしまう
document.querySelector('.wiki')

// OK: エディタプレビュー用コンテナを明示的に取得
document.querySelector('[class*="page-editor-preview-body"]')
```

### toggleイベントの監視

`<details>` のtoggleイベントはバブリングしないため、capture phaseで監視する:

```typescript
document.addEventListener('toggle', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLDetailsElement)) return;
  
  const preview = target.closest('[class*="page-editor-preview-body"]');
  if (!preview) return;
  
  // index取得とハンドリング
}, true); // captureフェーズ
```
