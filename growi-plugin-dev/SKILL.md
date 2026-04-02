---
name: growi-plugin-dev
description: >
  GROWIプラグイン（Scriptタイプ）の開発ガイド。プレビュー側のremark/rehypeプラグインやコンポーネント差し替えから、エディタ（CodeMirror 6）への拡張注入、DOM操作、API連携まで対応する。
  リポジトリ名が growi-plugin で始まるとき、GROWIプラグインの新規作成・修正・デバッグ時に使用する。
  GROWIのプラグイン開発に関する質問や、package.jsonにgrowiPluginフィールドがあるプロジェクトでも発動する。
---

# GROWIプラグイン開発スキル

GROWIのScriptタイプのプラグインを開発するためのガイド。公式API（GrowiFacade）を使うプレビュー/閲覧側プラグインと、DOM経由で内部コンポーネントにアクセスする高度なプラグインの両方に対応する。

## プラグインの2つのカテゴリ

開発するプラグインがどのカテゴリに該当するかを最初に判断する。複数カテゴリにまたがることもある。

### カテゴリA: プレビュー/閲覧側プラグイン（公式API）
- remarkプラグインでmarkdown AST変換
- rehypeプラグインでHTML変換
- Reactコンポーネント差し替え（code, a, img等のHOCラップ）
- GrowiFacadeの `customGenerateViewOptions` / `customGeneratePreviewOptions` を使用

### カテゴリB: エディタ操作プラグイン（非公式・DOMハック）
- CodeMirror 6エディタへの拡張注入（折りたたみ、装飾、キーバインド等）
- エディタ⇔プレビュー間の状態同期

### カテゴリC: UI拡張/API連携プラグイン（DOM操作）
- サイドメニューへのボタン追加（例: 閲覧者一覧、バックリンク）
- ページ遷移に連動したデータ取得・UI更新
- GROWI APIの呼び出しとモーダル表示
- Navigation APIによるSPAページ遷移の検知

カテゴリB/Cは公式APIでサポートされていないため、GROWIのバージョンアップで壊れるリスクがある。常にフォールバックやエラーハンドリングを備えること。

---

## 開発フロー

### Phase 1: プロジェクトセットアップ

1. `package.json` を作成（`growiPlugin` フィールド必須）
2. `vite.config.ts` を作成（`manifest: true` 必須）
3. `tsconfig.json` を作成
4. `client-entry.tsx` を作成（`window.pluginActivators` に登録）

詳細なテンプレートは `references/scaffolding.md` を参照。

### Phase 2: 機能実装

**カテゴリAの場合**: `references/preview-plugin-patterns.md` を参照。
- `customGenerateViewOptions` で閲覧モードをカスタマイズ
- `customGeneratePreviewOptions` でエディタプレビューをカスタマイズ
- remarkPlugins / components の差し替え

**カテゴリBの場合**: `references/editor-plugin-patterns.md` を参照。
- CM6 EditorViewのDOM経由取得
- CM6クラスのランタイム抽出（モジュール同一性問題の回避）
- 拡張の動的注入
- editモード検知とライフサイクル管理

**カテゴリCの場合**: `references/dom-manipulation-patterns.md` を参照。
- Navigation APIによるページ遷移検知（SPAルーティング対応）
- pageIdの取得方法（`__NEXT_DATA__` またはAPI経由）
- サイドメニューへのボタン追加（DOM出現待ち + 二重追加防止）
- GROWI API呼び出し（`/_api/v3/*`、セッションCookie認証）
- Bootstrapベースのモーダル表示

### Phase 3: DOM操作が必要な場合の調査フェーズ

GROWIの内部DOM構造に依存する機能を実装する場合、実装前にユーザーのGROWI環境で以下を確認する。GROWIのバージョンやCSS Modulesの設定によってクラス名やDOM構造が異なるため、推測で実装すると動作しない可能性が高い。

**ユーザーに確認を依頼する項目:**

1. **対象要素のCSSクラス名**: DevToolsで対象要素を検証し、実際のクラス名を確認する。GROWIはCSS Modulesを使用しているため、クラス名にハッシュが付加される（例: `Preview_page-editor-preview-body__3Poyo`）。セレクタは `[class*="元のクラス名"]` の部分一致で書く。

2. **DOM階層構造**: 対象要素の親子関係を確認する。以下のスクリプトで調査可能:
```js
document.querySelectorAll('対象セレクタ').forEach((el, i) => {
  const parents = [];
  let p = el.parentElement;
  while (p && parents.length < 5) {
    parents.push(p.tagName + '.' + p.className.trim().replace(/\s+/g, '.'));
    p = p.parentElement;
  }
  console.log(`[${i}]:`, parents.join(' > '));
});
```

3. **CM6 EditorViewの取得確認**（エディタ操作プラグインの場合）:
```js
const tile = document.querySelector('.cm-content')?.cmTile;
const view = tile?.parent?.view ?? tile?.view;
console.log('EditorView:', view);
console.log('doc:', view?.state?.doc?.toString()?.substring(0, 100));
```

4. **同名要素の重複**: GROWIの画面には閲覧モード用とエディタプレビュー用の2つのレンダリングコンテナが同時にDOMに存在することがある。`querySelector`は最初にヒットした要素を返すため、意図しない要素を操作してしまう。`querySelectorAll`で全候補を確認すること。

### Phase 4: ビルドとテスト

```bash
npm run build          # tsc && vite build
```

- `dist/.vite/manifest.json` と `dist/assets/client-entry-*.js` が生成される
- GROWIはこのmanifestからプラグインのエントリポイントを解決する
- `dist/` はGitリポジトリに含める（GROWIがビルド済みアセットを直接読み込むため）
- GROWIの管理画面からGitリポジトリURLを指定してインストール

---

## 堅牢な実装のための原則

これらはGROWIプラグイン開発で繰り返し発生する問題から得た教訓。

### 1. CSSセレクタは部分一致を使う

GROWIはCSS Modulesを使用しており、クラス名にハッシュが付加される。

```typescript
// NG: 完全一致 — CSS Modulesのハッシュで一致しない
document.querySelector('.page-editor-preview-body')

// OK: 部分一致
document.querySelector('[class*="page-editor-preview-body"]')
```

### 2. DOM要素の取得は毎回行う

GROWIはSPAのため、DOMが動的に変化する。EditorViewなどの参照をキャッシュするとstaleになる。

```typescript
// NG: 古い参照を使い続ける
const view = getEditorView();
someCallback(() => { view.dispatch(...) }); // viewが古い可能性

// OK: コールバック内で毎回取得
someCallback(() => {
  const freshView = getEditorView();
  if (freshView) freshView.dispatch(...);
});
```

### 3. タイミング依存の処理にはリトライを入れる

エディタの初期化タイミングによって、DOM要素やCM6の内部状態がまだ準備できていないことがある。

```typescript
async function withRetries<T>(fn: () => T, maxAttempts = 5): Promise<T> {
  for (let i = 1; i <= maxAttempts; i++) {
    try { return fn(); }
    catch (e) {
      if (i === maxAttempts) throw e;
      await new Promise(r => setTimeout(r, 500 * i));
    }
  }
  throw new Error('unreachable');
}
```

### 4. CM6モジュールは絶対に別途バンドルしない

`@codemirror/state` 等をnpm installしてimportすると、`StateEffect.appendConfig`のオブジェクト同一性が一致せず、拡張の注入が**静かに失敗する**。必ずEditorViewのインスタンスツリーからランタイムで取得する。詳細は `references/editor-plugin-patterns.md` を参照。

### 5. WidgetTypeの全インターフェースを実装する

CM6のDecoration.replace等でwidgetを使う場合、以下のメソッドが全て必要:
`eq`, `compare`, `toDOM`, `updateDOM`, `coordsAt`, `estimatedHeight`, `lineBreaks`, `ignoreEvent`, `destroy`

### 6. 二重注入を防ぐ

`activate()`は1回しか呼ばれないが、editモードへの再遷移でsetup処理が複数回走る可能性がある。DOM要素にマーカーを付けて防ぐ。

```typescript
if ((view.dom as HTMLElement).dataset.myPluginInjected === 'true') return;
(view.dom as HTMLElement).dataset.myPluginInjected = 'true';
```

### 7. エラーは握りつぶさず、gracefulに降格する

CM6クラスの取得失敗やDOM要素の不在は、GROWIのバージョン変更で起こりうる。`console.error`で記録し、プラグイン全体をクラッシュさせない。

### 8. デザインはBootstrap 5に準拠する

GROWIはBootstrap 5を使用している。プラグインのUIも同じフレームワークに準拠することで、GROWIのネイティブUIと違和感のない統一されたデザインを実現する。

- **ボタン**: `btn btn-outline-secondary`, `btn btn-primary` 等のBootstrapクラスを使う
- **バッジ**: `badge bg-primary`, `badge bg-secondary` 等
- **モーダル**: `modal`, `modal-dialog`, `modal-content` 等のBootstrap構造を使う
- **アイコン**: GROWIが使用しているアイコンライブラリ（Material Symbols等）に合わせる
- **スペーシング**: `m-1`, `p-2`, `ms-1`, `gap-2` 等のBootstrapユーティリティを使う
- **既存ボタンのクラスをコピー**: 隣接する既存ボタンからCSS Modulesのクラス名を動的取得してスタイルを完全に統一する（`references/dom-manipulation-patterns.md` の `getCssModuleClass` を参照）

カスタムCSSを書く場合は、プラグイン固有のプレフィックス（例: `.grw-plugin-xxx-`）を付けてスタイル衝突を避ける。

---

## 参考ファイル

- `references/scaffolding.md` — プロジェクトテンプレート（package.json, vite.config.ts, tsconfig.json, client-entry.tsx）
- `references/preview-plugin-patterns.md` — プレビュー/閲覧側プラグインの実装パターン
- `references/editor-plugin-patterns.md` — エディタ（CM6）操作プラグインの実装パターン（クラス抽出、拡張注入、ライフサイクル）
- `references/dom-manipulation-patterns.md` — UI拡張・API連携プラグインの実装パターン（Navigation API、サイドメニュー、モーダル、GROWI API）
- `references/growi-internals.md` — GROWIの内部構造（ソースパス、GrowiFacade、GrowiPluginsActivator）
