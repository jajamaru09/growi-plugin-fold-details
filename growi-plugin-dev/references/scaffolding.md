# プロジェクトテンプレート

## package.json

```json
{
  "name": "growi-plugin-xxx",
  "version": "0.1.0",
  "description": "プラグインの説明",
  "type": "module",
  "keywords": ["growi", "growi-plugin"],
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  },
  "growiPlugin": {
    "schemaVersion": "4",
    "types": ["script"]
  }
}
```

Reactを使う場合（コンポーネント差し替えなど）は以下も追加:
```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@growi/pluginkit": "^1.1.0",
    "@vitejs/plugin-react": "^4.3.0"
  }
}
```

**注意**: `@codemirror/*` パッケージは**絶対にdependenciesに入れない**。モジュール同一性問題で動作しない。

## vite.config.ts

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    manifest: true,
    rollupOptions: {
      input: ['/client-entry.tsx'],
    },
  },
});
```

Reactを使う場合:
```typescript
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

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src", "client-entry.tsx"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

## tsconfig.node.json

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

## client-entry.tsx

```typescript
import { activate, deactivate } from './src/activate';

const PLUGIN_NAME = 'growi-plugin-xxx';

if ((window as any).pluginActivators == null) {
  (window as any).pluginActivators = {};
}

(window as any).pluginActivators[PLUGIN_NAME] = { activate, deactivate };
```

## .gitignore

```
node_modules
```

`dist/` は**含めない**（GROWIがビルド済みアセットを直接読み込むため、Gitに含める必要がある）。

## ディレクトリ構成例

```
growi-plugin-xxx/
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── client-entry.tsx
├── src/
│   ├── activate.ts          # メインのactivate/deactivateロジック
│   └── ...                  # 機能モジュール
└── dist/                    # ビルド出力（Gitに含める）
    └── .vite/
        └── manifest.json
```
