# プレビュー/閲覧側プラグインの実装パターン

GrowiFacade公式APIを使い、markdownのレンダリング結果をカスタマイズするプラグイン。

## activate() の基本構造

```typescript
// src/activate.ts
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

export const activate = (): void => {
  if (growiFacade == null || growiFacade.markdownRenderer == null) return;
  const { optionsGenerators } = growiFacade.markdownRenderer;

  // 閲覧モード（ページ表示時）のカスタマイズ
  optionsGenerators.customGenerateViewOptions = (...args: any[]) => {
    const options = optionsGenerators.generateViewOptions(...args);
    // ここでoptionsを変更
    return options;
  };

  // エディタプレビュー（編集中の右ペイン）のカスタマイズ
  optionsGenerators.customGeneratePreviewOptions = (...args: any[]) => {
    const options = optionsGenerators.generatePreviewOptions(...args);
    // ここでoptionsを変更
    return options;
  };
};

export const deactivate = (): void => {};
```

## パターン1: remarkプラグインの追加

markdown AST（mdast）を変換するremarkプラグインを追加する。

```typescript
import { visit } from 'unist-util-visit';

function myRemarkPlugin() {
  return (tree: any) => {
    visit(tree, 'text', (node) => {
      // テキストノードを変換
      node.value = node.value.replace(/foo/g, 'bar');
    });
  };
}

// activate内で:
options.remarkPlugins.push(myRemarkPlugin);
```

## パターン2: Reactコンポーネント差し替え（HOC）

レンダリング済みHTMLのReactコンポーネントを差し替える。`options.components` のキーは HTML要素名（`code`, `a`, `img`, `pre` 等）。

```typescript
// コードブロックを折りたたみ可能にする例
optionsGenerators.customGenerateViewOptions = (...args: any[]) => {
  const options = optionsGenerators.generateViewOptions(...args);
  const OriginalCode = options.components.code;

  options.components.code = (props: any) => {
    // inline codeは変更しない
    if (props.inline) {
      return <OriginalCode {...props} />;
    }
    return (
      <details open={true}>
        <summary>Code</summary>
        <OriginalCode {...props} />
      </details>
    );
  };

  return options;
};
```

## パターン3: リンクの差し替え

```typescript
const OriginalLink = options.components.a;

options.components.a = (props: any) => {
  const { href, children, ...rest } = props;
  
  // 特定のURLパターンを特別扱い
  if (href?.startsWith('https://example.com/embed/')) {
    return <iframe src={href} width="100%" height="400" />;
  }
  
  return <OriginalLink {...props} />;
};
```

## Reactインスタンスの共有

本番環境ではGROWI本体のReactインスタンスを使う必要がある。複数のReactインスタンスが存在するとhookが壊れる。

```typescript
import React from 'react';
import { growiReact } from '@growi/pluginkit/dist/v4/client/utils/growi-facade/growi-react';

// 本番環境ではGROWI本体のReactインスタンスが返る
const GrowiReact = growiReact(React);
```

`@growi/pluginkit` をdevDependenciesに追加しておくこと。

## optionsオブジェクトの構造

```typescript
interface Options {
  remarkPlugins: any[];       // remarkプラグインの配列
  rehypePlugins: any[];       // rehypeプラグインの配列
  components: {               // React描画コンポーネントのマッピング
    code: React.FC<any>;      // コードブロック / インラインコード
    a: React.FC<any>;         // リンク
    img: React.FC<any>;       // 画像
    pre: React.FC<any>;       // preタグ
    // ... 他のHTML要素名
  };
}
```
