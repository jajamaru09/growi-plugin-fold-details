# GROWI プラグイン開発リファレンス

## 1. プラグインシステム概要

### プラグインタイプ

| タイプ | 説明 |
|---|---|
| `script` | クライアントサイドJS/TS。レンダリングやDOM操作が可能 |
| `template` | 再利用可能なページテンプレート（meta.json + markdownファイル） |
| `style` | カスタムCSS |
| `theme` | ビジュアルテーマのオーバーライド |

エディタ専用のプラグインタイプは存在しない。エディタ操作が必要な場合は `script` タイプでDOM経由のハック的実装が必要。

### package.json 構造

```json
{
  "name": "growi-plugin-example",
  "version": "1.0.0",
  "description": "Plugin description",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@growi/pluginkit": "^1.1.0",
    "@vitejs/plugin-react": "^2.1.0",
    "typescript": "^4.6.4",
    "vite": "^3.1.0"
  },
  "growiPlugin": {
    "schemaVersion": "4",
    "types": ["script"]
  }
}
```

**重要**: `growiPlugin.schemaVersion` は `"4"` が最新。`types` は配列で複数指定可能。

### vite.config.ts

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
    rollupOptions: {
      input: ['/client-entry.tsx'],
    },
  },
});
```

**重要**: `manifest: true` が必須。GROWIはViteのマニフェストファイル（`dist/.vite/manifest.json`）からエントリポイントを解決する。

---

## 2. プラグイン読み込みライフサイクル

### 読み込みフロー

```
1. サーバー起動時
   └─ GrowiPlugin.findEnabledPlugins() でDBから有効プラグインを取得
   └─ 各プラグインのViteマニフェスト (dist/.vite/manifest.json) を読み取り
   └─ <script type="module" src="..."> タグを <head> に挿入

2. ブラウザでページ読み込み時
   └─ プラグインスクリプトが即座に実行
   └─ window.pluginActivators にactivator登録

3. Reactマウント時 (GrowiPluginsActivator コンポーネント)
   └─ initializeGrowiFacade() で window.growiFacade を初期化
   └─ generateViewOptions / generatePreviewOptions をfacadeに登録
   └─ React インスタンスをfacadeに登録
   └─ pluginActivators の全activate()を呼び出し
```

### 重要な制約

- **activate() は初回マウント時に1回のみ呼ばれる**（`useEffect(() => {}, [])`）
- **ページ遷移やview/edit切り替えでは再実行されない**
- レイアウトコンポーネント内（`[[...path]]/index.page.tsx` の `getLayout`）に配置されており、**全ページで読み込まれる**
- editモード専用のフックは存在しない

### GrowiPluginsActivator.tsx の実装（参考）

```typescript
// apps/app/src/features/growi-plugin/client/components/GrowiPluginsActivator.tsx
import React, { type JSX, useEffect } from 'react';
import { initializeGrowiFacade, registerGrowiFacade } from '../utils/growi-facade-utils';

declare global {
  var pluginActivators: {
    [key: string]: {
      activate: () => void;
      deactivate: () => void;
    };
  };
}

async function activateAll(): Promise<void> {
  initializeGrowiFacade();
  const { generateViewOptions, generatePreviewOptions } = await import(
    '~/client/services/renderer/renderer'
  );
  registerGrowiFacade({
    markdownRenderer: {
      optionsGenerators: { generateViewOptions, generatePreviewOptions },
    },
    react: React,
  });
  if (!('pluginActivators' in window)) return;
  Object.entries(pluginActivators).forEach(([, activator]) => {
    activator.activate();
  });
}

export const GrowiPluginsActivator = (): JSX.Element => {
  useEffect(() => { activateAll(); }, []);
  return <></>;
};
```

---

## 3. GrowiFacade API

### インターフェース定義

```typescript
// packages/core/src/interfaces/growi-facade.ts
export type GrowiFacade = {
  markdownRenderer?: {
    optionsGenerators?: {
      generateViewOptions?: any;          // 閲覧モードのレンダリングオプション生成
      customGenerateViewOptions?: any;    // カスタマイズ用（プラグインが上書き）
      generatePreviewOptions?: any;       // エディタプレビューのオプション生成
      customGeneratePreviewOptions?: any; // カスタマイズ用（プラグインが上書き）
    };
    optionsMutators?: any;
  };
  react?: any;  // 共有Reactインスタンス
};
```

### 公式にできること

| 操作 | 方法 |
|---|---|
| remarkプラグイン追加 | `options.remarkPlugins.push(myPlugin)` |
| React描画コンポーネント差し替え | `options.components.code = MyCodeComponent` |
| マークダウンAST変換 | remarkプラグインで実装 |
| プレビューオプション変更 | `customGeneratePreviewOptions` を上書き |
| 閲覧オプション変更 | `customGenerateViewOptions` を上書き |

### 公式にできないこと

- CodeMirrorエディタインスタンスへのアクセス
- エディタツールバーボタンの追加
- エディタ⇔プレビュー間の状態同期API
- editモード切り替えのフック

---

## 4. 標準的なプラグインパターン（プレビュー/閲覧側）

### client-entry.tsx の基本構造

```typescript
declare const growiFacade: {
  markdownRenderer?: {
    optionsGenerators: {
      customGenerateViewOptions: (...args: any[]) => any;
      generateViewOptions: (...args: any[]) => any;
      customGeneratePreviewOptions: (...args: any[]) => any;
      generatePreviewOptions: (...args: any[]) => any;
    };
  };
};

const activate = (): void => {
  if (growiFacade == null || growiFacade.markdownRenderer == null) return;
  const { optionsGenerators } = growiFacade.markdownRenderer;

  // 閲覧モード用
  optionsGenerators.customGenerateViewOptions = (...args: any[]) => {
    const options = optionsGenerators.generateViewOptions(...args);
    // options.remarkPlugins にプラグイン追加
    // options.components.xxx にコンポーネント差し替え
    return options;
  };

  // エディタプレビュー用
  optionsGenerators.customGeneratePreviewOptions = (...args: any[]) => {
    const options = optionsGenerators.generatePreviewOptions(...args);
    return options;
  };
};

const deactivate = (): void => {};

if ((window as any).pluginActivators == null) {
  (window as any).pluginActivators = {};
}
(window as any).pluginActivators['my-plugin-name'] = { activate, deactivate };
```

### Reactインスタンス共有（本番環境で必須）

```typescript
import React from 'react';
import { growiReact } from '@growi/pluginkit/dist/v4/client/utils/growi-facade/growi-react';

// 本番環境ではGROWI本体のReactインスタンスを使用
const GrowiReact = growiReact(React);
```

### コンポーネント差し替えパターン（HOC）

```typescript
// 例: goofmint/growi-plugin-folding のパターン
const activate = (): void => {
  const { optionsGenerators } = growiFacade.markdownRenderer!;

  optionsGenerators.customGenerateViewOptions = (...args: any[]) => {
    const options = optionsGenerators.generateViewOptions(...args);
    const OriginalCode = options.components.code;

    // HOCでラップ
    options.components.code = (props: any) => {
      return (
        <details>
          <summary>Code</summary>
          <OriginalCode {...props} />
        </details>
      );
    };
    return options;
  };
};
```

---

## 5. エディタ（CodeMirror 6）へのアクセス（非公式・DOMハック）

### EditorViewの取得方法

```typescript
function getEditorView(): EditorView | null {
  const content = document.querySelector('.cm-content');
  if (!content) return null;
  const tile = (content as any).cmTile;
  if (!tile) return null;
  return tile.parent?.view || tile.view || null;
}
```

**注意**: `cmTile` はCM6の内部プロパティ。GROWIやCM6のバージョンアップで変更される可能性がある。

### CM6のDOM構造

```
div.cm-editor          ← 最外部コンテナ
  div.cm-scroller      ← スクロールコンテナ
    div.cm-content     ← ここに cmTile プロパティがある
      div.cm-line      ← 各行
```

### editモードの検知

```typescript
// URL hashによる検知
function isEditMode(): boolean {
  return window.location.hash === '#edit';
}

// hashchange イベントで監視
window.addEventListener('hashchange', () => {
  if (isEditMode()) {
    // editモードに入った
  } else {
    // editモードから出た
  }
});
```

### .cm-content の出現を待つ

```typescript
function waitForEditor(): Promise<EditorView> {
  return new Promise((resolve) => {
    // 既に存在する場合
    const view = getEditorView();
    if (view) { resolve(view); return; }

    // MutationObserverで監視
    const observer = new MutationObserver(() => {
      const view = getEditorView();
      if (view) {
        observer.disconnect();
        resolve(view);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}
```

### CM6拡張の動的注入（モジュール同一性問題の回避）

**重要**: `@codemirror/state` 等を別途バンドルすると、`StateEffect.appendConfig` のオブジェクト同一性が一致せず動作しない。EditorViewのインスタンスツリーからランタイムで同じクラス参照を取得する必要がある。

```typescript
// NG: 別バンドルのimportは動作しない
// import { StateEffect, Compartment } from '@codemirror/state';

// OK: ランタイムからクラス参照を取得
function extractCM6Classes(view: EditorView) {
  const EditorView = view.constructor;
  
  // StateEffect: scrollIntoView() が返すインスタンスのコンストラクタ
  const StateEffect = EditorView.scrollIntoView(0).constructor;
  // → StateEffect.appendConfig, StateEffect.define() が使える
  
  // Compartment: state.config.compartments (Map) のキーのコンストラクタ
  const Compartment = view.state.config.compartments.keys().next().value.constructor;
  // → new Compartment(), compartment.of(), compartment.reconfigure() が使える
  
  // Decoration: docView.decorations のイテレータから
  let Decoration = null;
  for (const decoSet of view.docView.decorations) {
    if (decoSet?.iter) {
      const iter = decoSet.iter();
      if (iter.value) {
        Decoration = iter.value.constructor;
        // 静的メソッドは親クラスにある場合がある
        const parent = Object.getPrototypeOf(Decoration);
        if (typeof parent?.replace === 'function') Decoration = parent;
        break;
      }
    }
  }
  // → Decoration.replace(), Decoration.mark(), Decoration.set() が使える

  // Facet: EditorState.tabSize のコンストラクタ
  const Facet = view.state.constructor.tabSize.constructor;
  // → Facet.define() が使える

  // StateField: base拡張配列からcreateF, updateFプロパティを持つもの
  // (フラット化して検索)
  const StateField = findInBase(base, ext =>
    ext.constructor?.define && 'createF' in ext && 'updateF' in ext
  )?.constructor;
  // → StateField.define({ create, update, provide }) が使える

  // ViewPlugin: base拡張配列からdomEventHandlersプロパティを持つもの
  const ViewPlugin = findInBase(base, ext =>
    ext.constructor?.define && 'domEventHandlers' in ext
  )?.constructor;
  // → ViewPlugin.define() が使える
  
  return { StateEffect, Compartment, Decoration, Facet, StateField, ViewPlugin };
}

// 取得したクラスで拡張を注入
function injectExtension(view, cm6, extension) {
  const compartment = new cm6.Compartment();
  view.dispatch({
    effects: cm6.StateEffect.appendConfig.of(compartment.of(extension)),
  });
  return () => {
    view.dispatch({ effects: compartment.reconfigure([]) });
  };
}
```

### CM6クラス取得方法まとめ

| クラス | 取得パス | 利用可能メソッド |
|---|---|---|
| `StateEffect` | `EditorView.scrollIntoView(0).constructor` | `define()`, `appendConfig.of()` |
| `Compartment` | `state.config.compartments.keys().next().value.constructor` | `of()`, `reconfigure()` |
| `Decoration` | `docView.decorations` → iter → value.constructor (親クラス) | `replace()`, `mark()`, `widget()`, `set()`, `none` |
| `Facet` | `EditorState.tabSize.constructor` | `define()` |
| `StateField` | `config.base` フラット検索 (`createF` + `updateF`) | `define({ create, update, provide })` |
| `ViewPlugin` | `config.base` フラット検索 (`domEventHandlers`) | `define()` |
| `EditorView` | `view.constructor` | `theme()`, `baseTheme()`, `decorations`, `domEventHandlers()`, `updateListener` |

---

## 6. CodeMirror 6 折りたたみAPI

### 主要API（@codemirror/language）

| API | 説明 |
|---|---|
| `foldService` | カスタム折りたたみ領域を定義するFacet |
| `foldEffect` | 範囲を折りたたむStateEffect |
| `unfoldEffect` | 範囲を展開するStateEffect |
| `foldState` | 折りたたみ状態を管理するStateField |
| `codeFolding(config?)` | 折りたたみ機能のベース拡張 |
| `foldGutter(config?)` | ガターに折りたたみマーカーを表示 |
| `foldable(state, from, to)` | 指定行が折りたたみ可能か判定 |
| `foldKeymap` | デフォルトキーバインド（Ctrl-Shift-[ / ]） |

### foldService の実装パターン

```typescript
import { foldService } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

const myFoldService = foldService.of(
  (state: EditorState, lineStart: number, lineEnd: number) => {
    const line = state.doc.lineAt(lineStart);
    const text = line.text;

    // 折りたたみ可能なら { from, to } を返す
    // from: 折りたたみ開始位置（通常は開始行の末尾）
    // to: 折りたたみ終了位置（通常は終了行の末尾）
    if (someCondition(text)) {
      return { from: line.to, to: endPosition };
    }
    return null; // 折りたたみ不可
  }
);
```

### プログラムからの折りたたみ操作

```typescript
import { foldEffect, unfoldEffect } from '@codemirror/language';

// 折りたたむ
view.dispatch({ effects: foldEffect.of({ from, to }) });

// 展開する
view.dispatch({ effects: unfoldEffect.of({ from, to }) });

// 複数範囲を一括折りたたみ
view.dispatch({
  effects: ranges.map(r => foldEffect.of(r)),
});
```

### 折りたたみ状態の読み取り

```typescript
import { foldState } from '@codemirror/language';

const folded = view.state.field(foldState);
const foldedRanges: Array<{from: number, to: number}> = [];
folded.between(0, view.state.doc.length, (from, to) => {
  foldedRanges.push({ from, to });
});
```

---

## 7. プレビューDOMの構造

### 閲覧モード

```html
<div class="wiki">
  <!-- markdownがHTMLにレンダリングされる -->
  <details open="">
    <summary>タイトル</summary>
    内容
  </details>
</div>
```

### エディタプレビュー

エディタ横のプレビューペインも同様の構造。CSSクラスは `.page-editor-preview-body` など。

### `<details>` タグの扱い

GROWIはmarkdown内の `<details>` をそのままHTMLとしてレンダリングする。remarkの `allowDangerousHtml` 相当の設定による。`<details open="">` の `open` 属性でブラウザネイティブの開閉が動作する。

---

## 8. GROWIのエディタ内部構造（参考）

### 主要ソースパス（weseek/growi リポジトリ）

| パス | 説明 |
|---|---|
| `packages/editor/` | `@growi/editor` パッケージ |
| `packages/editor/src/client/components-internal/CodeMirrorEditor/CodeMirrorEditor.tsx` | メインエディタコンポーネント |
| `packages/editor/src/client/services/use-codemirror-editor/use-codemirror-editor.ts` | CM6ユーティリティフック |
| `packages/editor/src/client/services/use-codemirror-editor/utils/append-extensions.ts` | 動的拡張ローダー |
| `packages/editor/src/client/stores/use-default-extensions.ts` | デフォルトCM6拡張 |
| `packages/core/src/interfaces/growi-facade.ts` | GrowiFacadeの型定義 |
| `apps/app/src/features/growi-plugin/client/components/GrowiPluginsActivator.tsx` | プラグイン活性化 |
| `apps/app/src/features/growi-plugin/client/utils/growi-facade-utils.ts` | Facade初期化/登録 |

### CM6依存パッケージ

`@codemirror/state`, `@codemirror/view`, `@codemirror/lang-markdown`, `@codemirror/autocomplete`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/language-data`, `@codemirror/merge` + vim/emacs/vscodeキーマップ + 各種テーマ

GROWIは `@uiw/react-codemirror` (v4.23.8) をCM6ラッパーとして使用。

---

## 9. 参考プラグイン

| プラグイン | 作者 | 機能 | パターン |
|---|---|---|---|
| growi-plugin-copy-code-to-clipboard | growilabs（公式） | コードブロックにコピーボタン追加 | `components.code` 差し替え |
| growi-plugin-embed-site | goofmint | リンクをOGP埋め込みに変換 | `components.a` 差し替え |
| growi-plugin-folding | goofmint | コードブロックを折りたたみ可能に | `components.code` HOCラップ |

### GitHubトピック

リポジトリに `growi-plugin` トピックを付けるとGROWIのプラグインリストに自動登録される。

---

## 10. 開発・デバッグTips

### プラグインのインストール方法

GROWIの管理画面からGitHubリポジトリURLを指定してインストール。または `npm` パッケージとして公開してインストール。

### ローカル開発

1. `npm install` で依存関係インストール
2. `npm run build` でビルド（`dist/` に出力）
3. GROWIの `node_modules` 配下にシンボリックリンクを張るか、直接ビルド結果をコピー
4. GROWIを再起動してプラグインを認識させる

### デバッグ

- ブラウザのDevConsoleで `window.growiFacade` を確認
- `window.pluginActivators` で登録済みプラグインを確認
- CM6の EditorView は `document.querySelector('.cm-content').cmTile` 経由で取得可能（前述）

### 注意事項

- CM6の内部プロパティ（`cmTile`等）はGROWI/CM6のバージョンアップで変更される可能性がある
- プラグインのReactインスタンスは本番環境では `growiReact()` で共有する必要がある
- `activate()` は1回しか呼ばれないため、画面遷移への対応は自分で実装が必要
