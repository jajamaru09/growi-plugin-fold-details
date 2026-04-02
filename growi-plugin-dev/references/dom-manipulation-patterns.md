# DOM操作・UI拡張プラグインの実装パターン

GROWIの既存UIにボタンやパネルを追加し、GROWI APIと連携するプラグインのパターン。

---

## 1. GROWIのURL構造とpageId

GROWIのURLはページのpageId（MongoDBのObjectId）をパスとして直接使用する。

```
https://wiki.example.com/67830ce04b8a10ffba4775ed        ← pageIdがパスに直接入る
https://wiki.example.com/67830ce04b8a10ffba4775ed#edit    ← 編集モード
https://wiki.example.com/                                  ← トップページ（pageIdなし）
```

### pageIdの判定とモード検出

```typescript
const PAGE_ID_RE = /^\/([0-9a-f]{24})$/i;

function extractPageId(pathname: string): string | null {
  const m = pathname.match(PAGE_ID_RE);
  return m ? m[1] : null;
}

type PageMode = 'view' | 'edit';

function hashToMode(hash: string): PageMode {
  return hash === '#edit' ? 'edit' : 'view';
}
```

### 処理を発火させないパス

以下のパスはページではないため、ページ関連の処理をスキップする。

```typescript
const EXCLUDED_PATHS = ['/admin', '/trash', '/me', '/login', '/_search'];

function isExcludedPath(pathname: string): boolean {
  return EXCLUDED_PATHS.some(p => pathname.startsWith(p));
}
```

### トップページ（`/`）のpageId取得

トップページはURLにpageIdが含まれないため、APIで取得する。

```typescript
async function getPageIdForPath(path: string): Promise<string | null> {
  try {
    const data = await growiApiV3(`/page?path=${encodeURIComponent(path)}`);
    return data.page?._id ?? null;
  } catch { return null; }
}
```

---

## 2. ページ遷移の検知（Navigation API）

GROWIはNext.jsのSPAルーティングを使用するため、通常の`popstate`では全てのページ遷移を捕捉できない。Navigation APIの`navigatesuccess`イベントがページ遷移の完了を検知するのに適している。

`navigate`イベント + `intercept()` はナビゲーション処理に干渉するリスクがあるため、**`navigatesuccess`を使う**のが安全。

### ページ変更リスナーの実装パターン

重複発火の防止と、初回発火を含むライフサイクル管理を行う。

```typescript
interface PageContext {
  pageId: string;
  mode: PageMode;
  revisionId?: string;
}

type PageChangeCallback = (ctx: PageContext) => void;

function createPageChangeListener(callback: PageChangeCallback) {
  let lastKey: string | null = null;
  let isListening = false;

  function tryFire(pageId: string, mode: PageMode, revisionId?: string): void {
    const key = `${pageId}::${mode}::${revisionId ?? ''}`;
    if (key === lastKey) return; // 重複発火防止
    lastKey = key;
    callback({ pageId, mode, revisionId });
  }

  function onNavigate(e: any): void {
    const dest = new URL(e.destination.url);
    if (isExcludedPath(dest.pathname)) return;

    const mode = hashToMode(dest.hash);
    const pageId = extractPageId(dest.pathname);
    if (!pageId) {
      // トップページ等: pageIdなし
      if (dest.pathname === '/') tryFire('', mode);
      return;
    }
    const revisionId = dest.searchParams.get('revisionId') ?? undefined;
    tryFire(pageId, mode, revisionId);
  }

  return {
    start(): void {
      const nav = (window as any).navigation;
      if (!nav || isListening) return;
      isListening = true;
      nav.addEventListener('navigatesuccess', onNavigate);

      // 初回発火（現在のページ）
      const { pathname, hash } = location;
      if (isExcludedPath(pathname)) return;
      if (pathname === '/') {
        tryFire('', hashToMode(hash));
      } else {
        const pageId = extractPageId(pathname);
        if (pageId) {
          const rid = new URL(location.href).searchParams.get('revisionId') ?? undefined;
          tryFire(pageId, hashToMode(hash), rid);
        }
      }
    },
    stop(): void {
      const nav = (window as any).navigation;
      nav?.removeEventListener('navigatesuccess', onNavigate);
      isListening = false;
      lastKey = null;
    },
  };
}
```

### 使用例

```typescript
const { start, stop } = createPageChangeListener((ctx) => {
  if (ctx.mode === 'edit') {
    // 編集モードではUI非表示
    unmountMyUI();
    return;
  }
  updateMyUI(ctx.pageId);
});

export function activate(): void { start(); }
export function deactivate(): void { stop(); unmountMyUI(); }
```

---

## 3. UI要素の挿入（React or 素のDOM）

### アンカーポイントの探し方

GROWIの要素には `data-testid` 属性が付与されていることがある。CSSクラス（CSS Modulesでハッシュ化される）よりも安定したアンカーポイントになる。

```typescript
// data-testid属性を使って隣接要素を探す
const anchor =
  document.querySelector('[data-testid="pageListButton"]') ??
  document.querySelector('[data-testid="page-comment-button"]');
const container = anchor?.parentElement;
```

**調査フェーズで確認**: DevToolsで対象要素の `data-testid` 属性を確認する。
```js
document.querySelectorAll('[data-testid]').forEach(el => {
  console.log(el.getAttribute('data-testid'), el.tagName, el.className.substring(0, 50));
});
```

### CSSモジュールクラスの動的取得

既存ボタンと見た目を統一するため、隣接する既存ボタンからCSS Modulesのクラス名を取得してコピーする。

```typescript
function getCssModuleClass(prefix: string): string {
  // 既存ボタンからCSS Moduleクラスを見つける
  const btn = document.querySelector<HTMLButtonElement>(
    '[data-testid="pageListButton"] button, [data-testid="page-comment-button"] button',
  );
  return (
    Array.from(btn?.classList ?? []).find(cls => cls.startsWith(prefix)) ?? ''
  );
}
```

### パターンA: React createRoot でマウント

複雑なUIコンポーネント（モーダル、リスト表示等）にはReactが適している。

```typescript
import { createRoot, type Root } from 'react-dom/client';

const MOUNT_ID = 'growi-plugin-xxx-mount';
let root: Root | null = null;

function mountOrUpdate(pageId: string): void {
  const container = getContainer(); // 上記のアンカーポイント探索
  if (!container) return;

  const existing = document.getElementById(MOUNT_ID);
  // DOMから消えていた場合（SPAルーティングで再構築された場合）は再マウント
  if (!existing || !document.body.contains(existing) || !root) {
    root?.unmount();
    const el = document.createElement('div');
    el.id = MOUNT_ID;
    container.appendChild(el);
    root = createRoot(el);
  }

  root.render(<MyComponent pageId={pageId} />);
}

function unmount(): void {
  root?.unmount();
  root = null;
  document.getElementById(MOUNT_ID)?.remove();
}
```

Reactを使う場合は `package.json` に `react`, `react-dom` を追加し、`vite.config.ts` に `@vitejs/plugin-react` を設定する。本番環境では `growiReact()` で共有Reactインスタンスを使うこと。

### パターンB: 素のDOMでボタン追加

シンプルなボタン追加なら素のDOMで十分。

```typescript
function addButton(
  id: string,
  label: string,
  onClick: () => void,
): HTMLElement | null {
  if (document.getElementById(id)) return null; // 二重追加防止

  const container = getContainer();
  if (!container) return null;

  const btn = document.createElement('button');
  btn.id = id;
  btn.className = 'btn btn-outline-secondary';
  btn.textContent = label;
  btn.addEventListener('click', onClick);

  container.appendChild(btn);
  return btn;
}
```

### バッジ付きボタン（件数表示）

```typescript
function updateBadge(buttonId: string, count: number): void {
  const btn = document.getElementById(buttonId);
  if (!btn) return;

  let badge = btn.querySelector('.badge') as HTMLElement | null;
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'badge bg-primary ms-1';
      btn.appendChild(badge);
    }
    badge.textContent = String(count);
  } else {
    badge?.remove();
  }
}
```

---

## 4. モーダル表示

GROWIはBootstrap 5を使用しているため、Bootstrapのスタイルクラスを活用できる。

```typescript
function showModal(title: string, content: HTMLElement | string): void {
  document.getElementById('grw-plugin-modal')?.remove();
  document.getElementById('grw-plugin-modal-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop fade show';
  backdrop.id = 'grw-plugin-modal-backdrop';

  const modal = document.createElement('div');
  modal.id = 'grw-plugin-modal';
  modal.className = 'modal fade show';
  modal.style.display = 'block';
  modal.setAttribute('role', 'dialog');

  modal.innerHTML = `
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">${title}</h5>
          <button type="button" class="btn-close" aria-label="Close"></button>
        </div>
        <div class="modal-body"></div>
      </div>
    </div>
  `;

  const body = modal.querySelector('.modal-body')!;
  if (typeof content === 'string') {
    body.innerHTML = content;
  } else {
    body.appendChild(content);
  }

  const closeModal = () => { modal.remove(); backdrop.remove(); };
  modal.querySelector('.btn-close')!.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  document.body.appendChild(backdrop);
  document.body.appendChild(modal);
}
```

---

## 5. GROWI APIの呼び出し

GROWI v5+ は REST API v3 と v1（レガシー）を提供する。同一オリジンの場合、セッションCookieが自動送信されるため追加の認証は不要。

APIリファレンス: https://docs.growi.org/en/api/rest-v3.html

### 基本的な呼び出し

```typescript
async function growiApiV3<T = any>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/_api/v3${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`GROWI API error: ${res.status}`);
  return res.json();
}

async function growiApiV1<T = any>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/_api/${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`GROWI API error: ${res.status}`);
  return res.json();
}
```

### 主要エンドポイント

**v3 API (`/_api/v3/...`)**

| エンドポイント | メソッド | 用途 |
|---|---|---|
| `/page` | GET | ページ情報（`pageId`または`path`指定） |
| `/page/info` | GET | ページメタデータ |
| `/page` | POST | ページ作成 |
| `/page` | PUT | ページ更新 |
| `/page-listing/children` | GET | 子ページ一覧 |
| `/page-listing/root` | GET | ルートページ取得 |
| `/pages/recent` | GET | 最近のページ |
| `/revisions/list` | GET | リビジョン一覧 |
| `/bookmarks` | GET/PUT | ブックマーク |
| `/page/likes` | PUT | いいね |
| `/pages/rename` | PUT | ページ名変更 |
| `/pages/delete` | POST | ページ削除 |
| `/pages/duplicate` | POST | ページ複製 |
| `/attachment` | various | 添付ファイル |

**v1 API (`/_api/...`)**

| エンドポイント | メソッド | 用途 |
|---|---|---|
| `search` | GET | 全文検索（`q`, `path`, `offset`, `limit`） |
| `comments.get` | GET | コメント取得 |
| `comments.add` | POST | コメント追加 |
| `tags.list` | GET | タグ一覧 |
| `tags.search` | GET | タグ検索 |
| `tags.update` | POST | タグ更新 |
| `pages.getPageTag` | GET | ページのタグ取得 |

---

## 6. DOM要素の出現を待つ

Reactのレンダリングは非同期のため、activate()時点でDOM要素が存在しない場合がある。MutationObserverで出現を監視し、タイムアウトで上限ガードする。

```typescript
function waitForElement(selector: string, timeoutMs = 10000): Promise<Element> {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) { resolve(el); return; }

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element "${selector}" not found within ${timeoutMs}ms`));
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}
```

---

## 7. 実装例: プラグインのactivate構成

```typescript
// client-entry.tsx — 全体の構成
const { start, stop } = createPageChangeListener(handlePageChange);

function handlePageChange(ctx: PageContext): void {
  if (ctx.mode === 'edit') {
    unmount();
    return;
  }
  // pageIdが空（トップページ等）の場合はAPIで取得
  if (!ctx.pageId) {
    getPageIdForPath('/').then(id => { if (id) mountOrUpdate(id); });
    return;
  }
  mountOrUpdate(ctx.pageId);
}

function activate(): void { start(); }
function deactivate(): void { stop(); unmount(); }

if (window.pluginActivators == null) window.pluginActivators = {};
window.pluginActivators['my-plugin'] = { activate, deactivate };
```
