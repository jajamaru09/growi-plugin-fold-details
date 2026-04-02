# GROWIの内部構造リファレンス

## GrowiFacade

プラグインがGROWI本体と通信する公式インターフェース。`window.growiFacade` でアクセス可能。

```typescript
type GrowiFacade = {
  markdownRenderer?: {
    optionsGenerators?: {
      generateViewOptions?: any;          // 閲覧モードのオプション生成（元の関数）
      customGenerateViewOptions?: any;    // プラグインが上書きするカスタム版
      generatePreviewOptions?: any;       // エディタプレビューのオプション生成
      customGeneratePreviewOptions?: any; // プラグインが上書きするカスタム版
    };
    optionsMutators?: any;
  };
  react?: any;  // 共有Reactインスタンス（本番環境で必須）
};
```

**公式にできること:**
- remarkプラグイン追加
- rehypeプラグイン追加
- React描画コンポーネント差し替え
- プレビュー/閲覧オプション変更

**公式にできないこと:**
- CodeMirrorエディタへのアクセス
- エディタツールバーの変更
- エディタ⇔プレビュー間の状態同期API
- editモード切り替えのフック

## プラグイン読み込みフロー

```
1. サーバー起動時
   └─ DB から有効プラグインを取得
   └─ 各プラグインの dist/.vite/manifest.json を読み取り
   └─ <script type="module"> を <head> に挿入

2. ブラウザ読み込み時
   └─ プラグインスクリプトが即座に実行
   └─ window.pluginActivators に { activate, deactivate } を登録

3. React マウント時 (GrowiPluginsActivator)
   └─ growiFacade を初期化
   └─ generateViewOptions / generatePreviewOptions を登録
   └─ 全プラグインの activate() を呼び出し
```

### 重要な制約

- `activate()` は useEffect(fn, []) で実行 → **1回のみ**
- ページ遷移や view/edit 切り替えでは **再実行されない**
- 全ページのレイアウトに含まれるため **editモード以外でも読み込まれる**

## GrowiPluginsActivator の実装

```typescript
// apps/app/src/features/growi-plugin/client/components/GrowiPluginsActivator.tsx
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

## 主要ソースパス（weseek/growi）

| パス | 説明 |
|---|---|
| `packages/core/src/interfaces/growi-facade.ts` | GrowiFacade型定義 |
| `packages/editor/src/client/components-internal/CodeMirrorEditor/` | CM6エディタコンポーネント |
| `packages/editor/src/client/services/use-codemirror-editor/` | CM6ユーティリティフック |
| `packages/editor/src/client/stores/use-default-extensions.ts` | デフォルトCM6拡張 |
| `packages/pluginkit/` | プラグイン開発キット |
| `apps/app/src/features/growi-plugin/` | プラグイン機能（活性化、ロード） |

## editモードの判定

GROWIは URL hash でモードを管理する:
- `#edit` → エディタモード
- ハッシュなし → 閲覧モード

```typescript
// apps/app/src/states/ui/editor/utils.ts
export const determineEditorModeByHash = (): EditorMode => {
  const { hash } = window.location;
  switch (hash) {
    case '#edit': return EditorMode.Editor;
    default: return EditorMode.View;
  }
};
```

## CM6のDOM構造

```
div.cm-editor          ← 最外部コンテナ (EditorViewのdom)
  div.cm-scroller      ← スクロールコンテナ (scrollDOM)
    div.cm-content     ← コンテンツ (contentDOM, cmTile がここにある)
      div.cm-line      ← 各行
```

## CM6依存パッケージ（GROWIが使用しているもの）

- `@uiw/react-codemirror` (v4.23.8) — CM6ラッパー
- `@codemirror/state`, `@codemirror/view` — コア
- `@codemirror/lang-markdown` — Markdown言語サポート
- `@codemirror/language` — 言語インフラ（折りたたみ等）
- `@codemirror/autocomplete` — 自動補完
- `@codemirror/commands` — コマンド
- vim/emacs/vscodeキーマップ + 各種テーマ

## 参考プラグイン

| プラグイン | 作者 | パターン |
|---|---|---|
| growi-plugin-copy-code-to-clipboard | growilabs | components.code 差し替え |
| growi-plugin-embed-site | goofmint | components.a 差し替え |
| growi-plugin-folding | goofmint | components.code HOCラップ |
