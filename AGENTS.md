# AGENTS.md — hk_bus_pwa 開發指引（給 AI 代理）

本檔適用於所有在此 repo 工作的 AI 代理（Claude Code、Codex、Cursor、DSH 等）。
**開始任何探索或修改前，請先讀完本檔。**

## 0. 專案速覽

香港巴士實時到站 PWA（React 19 + Vite + Tailwind + React Router + vite-plugin-pwa）。
資料來源為 DATA.GOV.HK：九巴 KMB、城巴 CTB、專線小巴 GMB，加上運輸署票價表。

```bash
npm ci             # 安裝依賴（與 CI 相同）
npm run dev        # 開發伺服器 http://localhost:5173
npm run lint       # oxlint（提交前必跑）
npm run build      # 產出 dist/（含 sw.js、manifest.webmanifest、404.html）
npm run preview    # 驗證 PWA（掛在 /hk_bus_pwa/ 子路徑）
npm run sync:data  # 重建城巴／小巴站點索引與票價表（需連線，數分鐘）
```

## 1. 探索規則：CodeGraph 優先（強制）

本 repo 已建立 CodeGraph 代碼圖譜（索引在 `.codegraph/`，已加入 `.gitignore`，**不要提交**）。
所有結構探索、符號定位、影響分析，**必須先用 codegraph CLI**，再用 read 讀取「已定位的具體檔案與行號」。

### 1.1 建議順序

```bash
codegraph status                          # 索引狀態／是否需 sync
codegraph files                           # 專案檔案樹（先看有哪些檔案）
codegraph explore "站點 ETA 資料流"        # 一次取得相關符號原始碼＋呼叫路徑（最常用）
codegraph query <symbol>                  # 以名稱搜尋符號
codegraph node <symbol>                   # 單一符號原始碼＋caller/callee
codegraph context "新增功能描述"           # 為任務建立上下文
codegraph callers <symbol>                # 誰呼叫它（改函式前必查）
codegraph callees <symbol>                # 它呼叫誰
codegraph impact <symbol>                 # 改動影響範圍（改 API／hook 前必查）
```

探索時請用**中文或英文的自然語言**描述意圖（例：`codegraph explore "路線站序 反轉方向"`），
比逐檔閱讀快得多。codegraph 回傳的原始碼等同已讀取，可直接依行號 edit。

### 1.2 禁止事項（違反視同未完成工作）

- ❌ **禁止大範圍 grep／ripgrep**：不得對整個 repo 執行 `grep -r`、`rg`、`grep` 掃目錄來「找東西」。
  需要搜尋時先用 `codegraph query` / `codegraph explore`；真的需要文字搜尋時，
  限縮到「codegraph 已定位的單一檔案」且只搜尋該檔。
- ❌ **禁止大範圍讀檔**：不得用 `cat`／`read` 一次讀整個 `src/`、`public/data/`、`node_modules/`、
  `package-lock.json`、`pnpm-lock.yaml`、`dist/`。`public/data/*.json` 是同步產生的大檔，不要讀進上下文。
- ❌ **禁止用 `find` 掃描**：用 `codegraph files` 或 `glob` 限定 pattern。
- ❌ 不要在回覆中貼出整份檔案；只引用需要修改的行號區間。

### 1.3 例外（可少量直接讀取）

- `package.json`、`vite.config.js`、`tailwind.config.js`、`.gitignore`、`.oxlintrc.json`、`index.html` 等小型設定檔。
- codegraph 回報「找不到符號」時，可退回 `glob` 限定目錄，再讀取單一檔案。
- 修改完成後執行 `codegraph sync`，讓隊友（含人類）看到最新圖譜。

## 2. 架構地圖（高層次）

```
src/
├─ App.jsx            # Router（basename 跟隨 BASE_URL）＋ 版面；/route/* 為獨立視窗頁
├─ pages/             # Nearby / Search / Favorites / RouteSequence（新視窗站序頁）
├─ components/        # BusCard、StopSection、EtaSlots、StateViews…（純呈現）
├─ hooks/             # useBusData（ETA 30 秒輪詢）、useLocation、useFavorites、useTheme
├─ services/api.js    # 唯一資料層：快取、站點、路線站序、票價、ETA（KMB/CTB/GMB）
├─ services/staticData.js # public/data/*.json + IndexedDB 快取
├─ utils/             # format.js、routeLinks.js（開新視窗 URL 組裝）
└─ data/fares.json    # 由 sync:data 產生，勿手改
```

### 關鍵資料規則

- **單一資料層**：所有 HTTP、快取、業者差異（KMB/CTB/GMB）都集中在 `src/services/api.js`；
  UI 只呼叫其匯出函式，不要在元件內直接 `fetch` 或自己組官方 URL。
- **三班車**：每條路線固定顯示最近三班（`ETA_PER_ROUTE = 3`）；合併月台時 60 秒內視為同一班。
- **業者差異**：KMB 用 `stop-eta`（一站查全部路線）；CTB 只能逐路線查 ETA，站點需帶 `routes`；
  GMB 用 `routeId + routeSeq` 對照路線與方向（缺這兩個值查不到站序／反轉方向）。
- **城巴／小巴索引**：城巴站點、小巴站點與路線索引來自 `public/data/*.json`（`npm run sync:data` 產生，
  勿手改），前端透過 IndexedDB 延遲載入。
- **子路徑部署**：`vite.config.js` 的 `base`、Router 的 `basename`、manifest 的 `start_url/scope`
  三處必須一致（GitHub Pages 為 `/hk_bus_pwa/`）；新增 `window.open` URL 時務必以
  `import.meta.env.BASE_URL` 組路徑，不可寫死 `/`。
- **新視窗站序頁**：路徑 `/route/:operator/:route/:direction`，query 參數
  `stop`（要高亮／展開的站）、`name`、`siblings`、`serviceType`、`routeId`、`routeSeq`、`orig`、`dest`。
  「反轉序列」按鈕會切到同路線的另一方向（GMB 需重新對照 `routeId/routeSeq`）。

## 3. 程式風格

- UI 文案與註解以**繁體中文**為主；程式碼使用 2 空格、單引號、無分號（現有風格）。
- 樣式一律 Tailwind utility class，共用外觀用 `index.css` 的 `.card`、`.chip`、`.skeleton`。
- 顏色需同時支援 `dark:`；不要新增全域 CSS 除非必要。
- 元件保持「呈現」與「資料抓取」分離：抓資料放 hook 或 page，純呈現放 components。
- 不要新增依賴，除非能明確說明 bundle／維護成本；優先使用現有 `lucide-react` 圖示。
- 所有非同步資料載入要有 loading／error／empty 狀態（`StateViews.jsx`）。
- 維持可存取性：按鈕用 `<button>`／`aria-*`、可點擊區域要有文字標籤。

## 4. 完成工作的定義（DoD）

1. 改動範圍內 `npm run lint` 無錯誤；`npm run build` 成功。
2. 行為變更同步更新 `README.md`（資料流、程式結構、已知限制等章節）。
3. 執行 `codegraph sync` 更新圖譜。
4. 不要提交 `dist/`、`.codegraph/`、`node_modules/`、`public/data/*.json`（除非是 `sync:data` 的刻意更新）。
5. commit message 用 conventional commits（`feat:`／`fix:`／`perf:`／`docs:`／`refactor:`），
   描述用繁體中文，例如 `feat: 站點路線改以新視窗顯示站序與反轉方向`。
