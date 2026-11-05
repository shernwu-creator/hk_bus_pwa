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
├─ App.jsx            # LanguageProvider＋Router（basename 跟隨 BASE_URL）＋毛玻璃膠囊 Header 與版面；/route/* 為路線站序頁（不經 AppShell）
├─ pages/             # Nearby / Search / Favorites / RouteSequence（路線站序頁，原視窗導覽）
├─ components/        # BusCard、StopSection、EtaSlots、StateViews…（純呈現）
├─ hooks/             # useBusData（ETA 30 秒輪詢）、useLanguage（語言 Context）、useLocation、useFavorites、useTheme
├─ services/api.js    # 唯一資料層：快取、站點、路線站序、票價、ETA（KMB/CTB/GMB）
├─ services/staticData.js # public/data/*.json + IndexedDB 快取
├─ utils/             # format.js、routeLinks.js（站序頁的站內路徑組裝）
└─ data/fares.json    # 由 sync:data 產生，勿手改
```

### 關鍵資料規則

- **單一資料層**：所有 HTTP、快取、業者差異（KMB/CTB/GMB）都集中在 `src/services/api.js`；
  UI 只呼叫其匯出函式，不要在元件內直接 `fetch` 或自己組官方 URL。
- **三班車**：每條路線固定顯示最近三班（`ETA_PER_ROUTE = 3`）；合併月台時 60 秒內視為同一班。
- **業者差異**：KMB 用 `stop-eta`（一站查全部路線）；CTB 主要用批次端點
  `https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/{stopId}?lang=zh-hant`（一次拿該站全部路線），
  失敗才退回逐路線 `.../eta/CTB/{stopId}/{route}`——**注意路徑順序是「站點 → 路線」**，
  寫成 `{route}/{stopId}` 官方會回 200 但 `data` 永遠是空陣列（曾造成「有站點沒有到站時間」的 bug）。
  GMB 用 `routeId + routeSeq` 對照路線與方向（缺這兩個值查不到站序／反轉方向）。
- **城巴／小巴索引**：城巴站點、小巴站點與路線索引來自 `public/data/*.json`（`npm run sync:data` 產生，
  勿手改），前端透過 IndexedDB 延遲載入。
- **子路徑部署**：`vite.config.js` 的 `base`、Router 的 `basename`、manifest 的 `start_url/scope`
  三處必須一致（GitHub Pages 為 `/hk_bus_pwa/`）；站內導覽一律用 react-router 的 `<Link>`／`useNavigate()`
  （basename 由 Router 處理，不可再手動拼 `BASE_URL` 或 `window.open`）；只有外部連結（例如 Google Maps）
  使用 `target="_blank" rel="noopener noreferrer"`。
- **路線站序頁**：路徑 `/route/:operator/:route/:direction`，query 參數
  `stop`（要高亮／展開的站）、`name`、`siblings`、`serviceType`、`routeId`、`routeSeq`、`orig`、`dest`。
  由站點卡以 `navigate()` 原視窗切換（`buildRouteSequencePath()`，見 `src/utils/routeLinks.js`）。
  「反轉序列」按鈕會切到同路線的另一方向（GMB 需重新對照 `routeId/routeSeq`）。
  「返回」按鈕：`history.state.idx > 0`／`history.length > 1` 時 `navigate(-1)`，否則 `navigate('/')`；
  不要恢復 `window.opener`／`window.close()` 邏輯。站序列可以收藏站點（與主 App 共用 `hkb:favorites:v1`）。
- **附近站點排序**：小巴（GMB）一律排在最後；同組內已收藏站點優先於距離，其餘依距離。
  不要為「統一排序」而改動路線站序（站序必須保持官方 seq 次序）。
- **站點展開行為**：附近／搜尋／收藏／站序頁的站點卡都可以**同時展開多個**；不要改回
  「一次只展開一個」的 accordion（會令打開下面站點時上面收起、版面高度改變造成畫面跳動）。
  展開狀態用 component state（Set）管理；站序頁 URL 的 `stop` 只作來源站／分享用途。
- **定位記憶**：`useLocation` 以 `hkb:location-consent`（只存 `'granted'`）與 `hkb:last-location`
  （`{ lat, lng, accuracy, updatedAt }`）記憶授權與座標，讀寫一律 `try / catch`；初始化先用快取座標渲染再背景更新，
  不要改回「每次都要使用者手動點定位」。被拒（`error.code === 1`）時清除授權記憶並保留 iOS 的 Safari 設定提示。
- **語言切換**：UI 文案一律經 `useLanguage()` 的 `t('key')`（字典在 `src/hooks/useLanguage.js`），
  站名／目的地用 `pickLang(nameTc, nameEn)` 只顯示單一語言；**不要**再新增中英上下堆疊。新增文案要同時補齊字典的
  `zh`／`en` 兩欄。語言存 `hkb:lang`（只接受 `'zh'`／`'en'`，預設 `'zh'`），讀寫包 `try / catch`。
- **字級**：站點名稱用 `text-lg`（18px）；路線號碼在卡片／標題用 `text-xl`（20px）、
  在搜尋結果與站序面板標題用 `text-lg`（18px）。改版面時保持這組層級。

## 3. 程式風格

- UI 文案與註解以**繁體中文**為主；程式碼使用 2 空格、單引號、無分號（現有風格）。
- 樣式一律 Tailwind utility class，共用外觀用 `index.css` 的 `.card`、`.chip`、`.skeleton`。
- 顏色需同時支援 `dark:`；不要新增全域 CSS 除非必要。
- 視覺為「款式 B」：毛玻璃膠囊 Header／懸浮島 Dock、藍紫漸層選中態；沿用現有 Tailwind class，不要改回全寬實色導覽列。
- 元件保持「呈現」與「資料抓取」分離：抓資料放 hook 或 page，純呈現放 components。
- 不要新增依賴，除非能明確說明 bundle／維護成本；優先使用現有 `lucide-react` 圖示。
- 所有非同步資料載入要有 loading／error／empty 狀態（`StateViews.jsx`）。
- 維持可存取性：按鈕用 `<button>`／`aria-*`、可點擊區域要有文字標籤。

## 4. AI 開發工作流（Matt Pocock 風格）

> 參考 [mattpocock/skills](https://github.com/mattpocock/skills)：小步驟、快速回饋、保持設計清晰。
> 每次任務都照下列迴圈走；本節與第 5 節 DoD 同屬完成條件，任一項沒做到就視同未完成。

**任務迴圈**：定位（codegraph）→ 讀懂（component → hook → service）→ 小步修改 → `lint` ＋ `build` → 檢查 diff 是否最小 → 回報驗證結果。

### 4.1 Context-First（先讀後寫）

規則：修改任何邏輯前，必須先讀取相關的 component、hook 與 service 檔案，確認資料流與型別結構。

- 用第 1 節的 codegraph 指令定位（`explore` → `node`／`callers`），再用 `read` 讀取命中的具體檔案，不要憑檔名猜測。
- 動手前先回答三題：
  1. **資料流**：畫面元件呼叫哪個 hook，hook 又呼叫 `services/api.js` 的哪個函式？
  2. **型別結構**：回傳物件有哪些欄位、哪些可能為 `null` 或空陣列？
  3. **影響範圍**：`codegraph callers`／`impact` 顯示誰在用這個函式？簽名一改會不會壞掉其他頁？
- 讀完才動手；**不准「先改再回頭看」**，也不准在未確認資料形狀前改 `services/api.js` 的函式簽名或回傳結構。

### 4.2 Atomic Changes（原子化修改）

規則：一次只專注解決一個任務，不順手重構無關的程式碼，保持最小 diff。

- 一次修改只對應一個目的；途中發現的相鄰 bug、可改的命名、想抽的共用函式，**先記下來另開任務**，不要塞進本次 diff。
- 不改與任務無關的排版、import 順序、文案；不要讓格式化工具順手改動整檔。
- 先做最小可運作切片（tracer bullet），端到端通了再擴充；不要一次改五個檔案再一起除錯。
- 送出前看一次 `git diff`：每一行都要能說明「為何而改」，說不出來的就還原。

### 4.3 Verification Loop（強制驗證迴圈）

規則：每次完成程式碼修改後，必須自動執行 `npm run lint`（oxlint）與 `npm run build`，確保零警告、零錯誤且打包成功後，才算完成任務。

```bash
npm run lint && npm run build
```

- 任一失敗就立即修正並重跑，直到兩者都乾淨；不可把紅燈留給下一個人。
- 零警告是真的零警告：warning 也要清掉，不要用 disable 註解把問題藏起來。
- 只改文件（`*.md`）或純資料時，至少跑 `npm run lint`；一旦動到 `vite.config.js`、`tailwind.config.js`、`index.html`、`public/` 等會影響打包的檔案，`lint` 與 `build` 兩者都要跑。
- 有行為變更要附驗證方式（例如 `npm run preview` 掛在 `/hk_bus_pwa/` 子路徑、實際操作步驟、預期結果），不要只說「應該可以」。

### 4.4 Backward Compatibility（向下相容）

規則：修改 `localStorage` 相關邏輯（如收藏、主題）時，必須相容舊有已儲存的資料格式。

- 現有 key（改資料格式時**不可直接換 key 或覆寫舊資料**）：
  - 收藏：`hkb:favorites:v1`（`src/hooks/useFavorites.js`）
  - 主題：`hkb:theme`（`src/hooks/useTheme.js`，只接受 `'dark'`／`'light'`）
- 舊資料可能缺欄位（例如沒有 `savedAt`、`routes`、`siblingIds`）：讀取時補預設值或逐筆過濾，不可因一筆壞資料就清空全部收藏。
- 解析失敗（JSON 壞掉、不是陣列、值不在允許範圍）要退回預設值繼續運作，不要 `throw`。
- 真要改格式，流程是「讀舊格式 → 轉換 → 寫回新格式」，保留至少一版遷移路徑，並在 `README.md` 記錄 key 與格式。
- 跨分頁的 `storage` 事件也走同一套讀取邏輯，確保舊分頁寫入的舊格式不會被新分頁當成垃圾丟掉。

## 5. 完成工作的定義（DoD）

1. 改動範圍內 `npm run lint` 無錯誤；`npm run build` 成功。
2. 行為變更同步更新 `README.md`（資料流、程式結構、已知限制等章節）。
3. 執行 `codegraph sync` 更新圖譜。
4. 不要提交 `dist/`、`.codegraph/`、`node_modules/`、`public/data/*.json`（除非是 `sync:data` 的刻意更新）。
5. commit message 用 conventional commits（`feat:`／`fix:`／`perf:`／`docs:`／`refactor:`），
   描述用繁體中文，例如 `feat: 站內路由改為原視窗導覽並優化 iOS 定位記憶`。
