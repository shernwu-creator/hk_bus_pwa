# 香港巴士實時到站｜HK Bus ETA (PWA)

以 GPS 定位查詢香港 **九巴 (KMB)**、**城巴 (CTB)** 與 **專線小巴 (GMB)** 站點的 PWA：附近站點、路線搜尋、票價與最近三班車到站倒數，支援離線開啟（App Shell）與深色模式。

首頁頂部是互動式地圖（Leaflet + OpenStreetMap 圖磚，免 API Key、免計費），站點列表與地圖雙向聯動：附近站點一載入就預設展開最近一站並把地圖移過去；點列表中的站點會 `flyTo` 該站，點地圖圖釘則會展開並捲動到對應的站點卡片。地圖會**置頂常駐**，往下滑時平滑縮小約 1/3，地圖底部的毛玻璃膠囊顯示定位狀態與重新定位／展開全圖。

站點內點選任一路線，會在**原視窗**直接切換到該方向的全線站序：自動標示你開啟時所在的站點並展開最近三班車，其他站點可逐一展開查看，也可一鍵**反轉方向**查另一邊的車；只有 Google Maps 外部連結仍會另開新頁／喚醒 App。

全站提供 `[中 | EN]` 單語切換（預設繁體中文，記在 localStorage 的 `hkb:lang`）：站名、目的地與介面文案只顯示目前語言，不再中英上下堆疊。視覺採用款式 B：冰藍／午夜漸層背景＋環境光暈、毛玻璃膠囊 Header 與底部懸浮島 Dock。

資料全部來自 [DATA.GOV.HK](https://data.gov.hk/) 的公開 API，本專案非官方產品；地圖圖磚由 [OpenStreetMap](https://www.openstreetmap.org/) 提供（使用政策：<https://operations.osmfoundation.org/policies/tiles/>）。
開發規範（AI 代理必讀）見 [`AGENTS.md`](./AGENTS.md)：優先使用 CodeGraph 探索程式結構，禁止大範圍 grep 與讀檔。

- 線上版本：<https://shernwu-creator.github.io/hk_bus_pwa/>（GitHub Pages，子路徑 `/hk_bus_pwa/`）

---

## 1. 快速開始

```bash
npm ci               # 依 package-lock.json 安裝（CI 相同）
npm run dev          # http://localhost:5173
npm run build        # 產出 dist/（含 sw.js、manifest.webmanifest、404.html、_redirects）
npm run preview      # 以靜態伺服器驗證 PWA（注意：會掛在 /hk_bus_pwa/ 子路徑）
npm run lint         # oxlint
```

> 定位功能只在 `https` 或 `localhost` 下可用；其他來源會自動退回預設座標（尖沙咀天星碼頭）。
> 成功定位後會以 `hkb:location-consent`／`hkb:last-location` 記住授權與座標，下次開啟先顯示上次位置再背景更新（見 6.10）。
> `npm run preview` 預設會開啟 `http://localhost:4173/hk_bus_pwa/`，因為建置時的 `base` 是子路徑。

### 資料同步腳本

```bash
npm run sync:data      # 重建城巴 + 小巴站點索引 ＋ 運輸署票價表（需連線，約 3～6 分鐘）
npm run sync:fares     # 只重建票價表（數秒）
node scripts/sync-data.mjs --gmb-only   # 只重建小巴索引
node scripts/sync-data.mjs --ctb-only   # 只重建城巴索引
npm run generate:icons # 重新產生 public/ 內的 PNG 圖示（純 Node，無外部依賴）
```

`sync:data` 會掃描 409 條城巴路線 × 2 方向、573 條小巴路線與其站序，並逐一查詢站點座標。
建議每季或發現站點有異動時執行一次；小巴座標會沿用既有快照，重跑時只補新站。

GitHub Actions 的 [`sync-data.yml`](./.github/workflows/sync-data.yml) 會每週日 04:00（香港時間）自動執行
`node scripts/sync-data.mjs`，並把 `public/data/`（站點索引）與 `src/data/`（票價表）一起 commit／push，
再觸發 Pages 部署，因此不必手動更新大檔。

---

## 2. 部署（GitHub Pages／Cloudflare Pages）

### 2.1 GitHub Pages

| 項目 | 設定 |
| --- | --- |
| 站台網址 | `https://shernwu-creator.github.io/hk_bus_pwa/` |
| 建置 base | `vite.config.js` 的 `DEFAULT_BASE = '/hk_bus_pwa/'`（可用 `VITE_BASE_PATH` 覆寫） |
| CI | `.github/workflows/deploy.yml`（push `main` → build → `actions/deploy-pages`） |
| Source | Repo → Settings → Pages → Source: **GitHub Actions**（workflow 內 `configure-pages` 的 `enablement: true` 會自動啟用） |
| SPA 深層連結 | 建置後自動複製 `dist/index.html` → `dist/404.html`，`/hk_bus_pwa/search` 也能直接開啟 |

**子路徑必須三處一致**，否則會出現「白屏」或資源 404：

1. `vite.config.js` 的 `base`（影響 JS/CSS/圖示/manifest 路徑）；
2. `src/App.jsx` 的 `<BrowserRouter basename={import.meta.env.BASE_URL}>`；
3. `vite.config.js` manifest 的 `start_url` / `scope`（安裝成 App 後從正確路徑啟動）。

> manifest 的 `id`（PWA 專屬身分，`APP_ID = '/hk-bus-eta/'`）**刻意不跟隨 `base`**：
> 它只是「這個 App 的識別字串」，不指向實際資源；固定住才能讓本專案與其他 PWA
> 同時安裝在同一部裝置，且日後改網域時仍被視為同一個 App 的升級。

改用自己的網域（或部署到 `<user>.github.io` 根目錄）時，只要在 CI 設定 `VITE_BASE_PATH=/`，其餘設定會自動跟隨。

### 2.2 Cloudflare Pages（準備過渡）

- 建置指令：`npm run build`；輸出目錄：`dist`。部署在根目錄時設定環境變數 `VITE_BASE_PATH=/`，
  Router 的 `basename` 與 manifest 的 `start_url`/`scope` 會自動跟隨（子路徑規則見 2.1）。
- **SPA 深層連結**：`public/_redirects`（建置後位於 `dist/_redirects`）內容為單行
  `/* /index.html 200`，讓 `/search`、`/route/...` 等 React Router 路徑直接開啟時仍回傳 App；
  Cloudflare Pages 會自動讀取此檔，不需要另外設定 Functions。
- `public/` 內的靜態資源會原樣複製到 `dist/`，因此本機 `npm run build` 後可直接確認
  `dist/_redirects` 存在；GitHub Pages 仍使用 `dist/404.html` fallback，兩種部署方式可並存。

---

## 3. 使用到的 API

| 業者 | 用途 | 端點 |
| --- | --- | --- |
| KMB | 全部站點 | `https://data.etabus.gov.hk/v1/transport/kmb/stop` |
| KMB | 路線清單 | `.../route/` |
| KMB | 路線站序 | `.../route-stop/{route}/{outbound\|inbound}/{serviceType}` |
| KMB | 站點 ETA（一站查全部路線） | `.../stop-eta/{stopId}` |
| CTB | 路線清單 | `https://rt.data.gov.hk/v2/transport/citybus/route/CTB` |
| CTB | 路線站序 | `.../route-stop/CTB/{route}/{outbound\|inbound}` |
| CTB | 單一站點 | `.../stop/{stopId}` |
| CTB | 站點全部路線 ETA（批次，前端主要使用） | `https://rt.data.gov.hk/v1/transport/batch/stop-eta/CTB/{stopId}?lang=zh-hant` |
| CTB | ETA（單一路線，批次失敗時備援） | `.../eta/CTB/{stopId}/{route}`（**順序是站點→路線**） |
| GMB | 路線清單 | `https://data.etagmb.gov.hk/route/`（`data.routes.{HKI,KLN,NT}`） |
| GMB | 路線細節（route_id / route_seq / 起訖站） | `.../route/{region}/{routeCode}` |
| GMB | 路線站序 | `.../route-stop/{routeId}/{routeSeq}` |
| GMB | 站點座標 | `.../stop/{stopId}` |
| GMB | 站點 ETA（一站查全部路線） | `.../eta/stop/{stopId}` |
| TD | 票價（KMB / CTB 全程收費） | `https://static.data.gov.hk/td/routes-fares-xml/ROUTE_BUS.xml` |

**三個業者的資料模型差異（重要）**

- **九巴**：有「全部站點」與「站點 → 全部路線 ETA」端點，一個站一次請求就拿到所有路線到站時間。
- **城巴**：沒有全站點端點，也**沒有**站點層級 ETA。站點清單由 `sync:data` 掃 `route-stop` 建索引；查 ETA 只能逐條路線打（前端上限 8 條、併發 4）。
- **小巴**：沒有全站點端點，但**有**站點層級 ETA（`/eta/stop/{id}`）。回應只帶 `route_id` / `route_seq`，
  路線號碼、方向與目的地要用 `public/data/gmb-routes.json` 對照，因此小巴的路線／站點索引同樣由 `sync:data` 產生。
- **小巴票價**：運輸署 `ROUTE_BUS.xml` 只含專營巴士，UI 對小巴一律顯示「票價待查」。

---

## 4. 靜態資料策略（public/data + IndexedDB）

城巴＋小巴的站點索引約 1 MB，若用 `import ... from './data/*.json'` 打包，會直接拖慢首次繪製 (FCP)。
因此改成「建置前產生、執行時延遲載入」：

```
npm run sync:data
      │
      ├─ public/data/citybus-stops.json   [[stopId, name_tc, name_en, lat, lng, [route...]], ...]
      ├─ public/data/gmb-routes.json      [[route_id, route_seq, route_code, region, orig_tc, dest_tc, ...], ...]
      ├─ public/data/gmb-stops.json       [[stopId, name_tc, name_en, lat, lng, [routeCode...]], ...]
      └─ src/data/fares.json              { generatedAt, operators: { KMB: { "1A|1": 8.2 }, CTB: {...} } }
```

`src/services/staticData.js` 提供 `loadStaticData(name)`：

```
記憶體 Map → IndexedDB（hkb-static / assets，6 小時 TTL）→ fetch(public/data/…)
```

- 只有「附近」或「搜尋」頁真的需要時才下載，主 JS bundle 不含站點索引。
- 抓到的內容寫入 IndexedDB，有效期內重新整理、離線開啟都不必再連網。
- 網路失敗但有舊快照時會沿用舊資料（寧可顯示略舊的站點，也不要整頁失敗）。
- Service Worker 另外以 `StaleWhileRevalidate` 快取 `/data/*.json`，形成第二層保險。
- 票價表體積小（約 13 KB）且需要同步查表，仍維持打包進 bundle。

---

## 5. 程式結構

```
src/
├─ main.jsx                  # 掛載 App、註冊 Service Worker（vite-plugin-pwa）
├─ App.jsx                   # LanguageProvider＋Router（basename 跟隨 BASE_URL）＋版面；毛玻璃膠囊 Header（語言／日夜切換）；Header 高度寫入 --app-header-h 供頁內 sticky 工具列使用
├─ index.css                 # Tailwind 進入點與共用樣式（.card / .chip；body 漸層背景）
├─ pages/
│  ├─ Nearby.jsx             # 附近站點：定位 → 500 公尺內篩選 → 展開查 ETA
│  ├─ Search.jsx             # 路線搜尋：路線 → 方向 → 置頂全線軌跡地圖 → 站序 → ETA
│  ├─ Favorites.jsx          # 收藏頁：毛玻璃雙分頁（收藏站點／收藏路線）；站點同名分組、路線顯示最近候車站 ETA
│  └─ RouteSequence.jsx      # 路線站序頁（原視窗導覽）：置頂全線軌跡地圖、全線站序、各站三班 ETA、反轉方向（URL 可分享）
├─ components/
│  ├─ BusCard.jsx            # 路線卡片：業者、目的地、票價、三班倒數（點擊在原視窗開啟站序）
│  ├─ StopMap.jsx            # Leaflet 地圖（附近站點＋全線軌跡模式；置頂／collapsed 高度動畫、內嵌定位膠囊、Google Maps 按鈕、focus flyTo）
│  ├─ StopSection.jsx        # 可展開的站點區塊（收藏星星、站序徽章、各路線 ETA；路線卡依剩餘距離長途優先排序、終點站與已收班最後）
│  ├─ EtaSlots.jsx           # 最近三班車的 ETA 格（BusCard 與站序頁共用；可切換成推算基準按鈕）
│  ├─ TravelPlan.jsx         # 站序推算：切換鈕、基準說明列、「+X 分／HH:mm 到達」膠囊
│  ├─ RouteStopsPanel.jsx    # 搜尋頁的站序清單（返回列與推算切換鈕固定在 Header／置頂地圖下方）
│  ├─ SearchBar.jsx / OperatorBadge.jsx
│  ├─ BottomNav.jsx          # 底部懸浮島 Dock（毛玻璃膠囊、選中 Tab 藍紫漸層）
│  └─ StateViews.jsx         # Skeleton / ErrorState / EmptyState
├─ hooks/
│  ├─ useLanguage.js         # 語言 Context：localStorage「hkb:lang」、t() 字典、pickLang() 單語站名／目的地
│  ├─ useLocation.js         # Geolocation + 權限/錯誤狀態＋localStorage 授權記憶與座標快取
│  ├─ useMapCollapse.js      # 置頂地圖捲動收起（window 或容器 onScroll、>36 收起／<=12 展開、手動展開後 >120 才再收起）
│  ├─ useBusData.js          # ETA 抓取與 30 秒輪詢（Promise.allSettled；切到背景停止、回前景立即更新）＋路線卡排序用的剩餘距離
│  ├─ useFavorites.js        # localStorage「hkb:favorites:v1」（站點）＋「hkb:favorite-routes:v1」（路線）
│  └─ useTheme.js            # 深色模式「hkb:theme」＋ html.dark
├─ services/
│  ├─ api.js                 # 快取、站點、路線、票價、ETA（KMB / CTB / GMB）集中在這裡
│  └─ staticData.js          # public/data/*.json + IndexedDB 快取
├─ data/
│  └─ fares.json             # 由 sync:data 產生（請勿手改）
└─ utils/
   ├─ format.js              # 距離／時間／分鐘／服務類型文字（距離與服務類型可依語言輸出）；normalizeStopName()／stopPlatformCode() 清理站名代號
   ├─ travelPlan.js          # 車程／預計到達推算（幾何估算＋實時 ETA 校準；車速、繞行係數、停站時間等參數集中在這裡）
   ├─ routeOrder.js          # 站點內路線卡排序（剩餘距離長途優先、終點站最後）
   └─ routeLinks.js          # 路線站序頁的站內路徑組裝（交給 useNavigate；basename 由 Router 處理）

public/
├─ data/                     # 由 sync:data 產生（請勿手改）
├─ _redirects                # Cloudflare Pages SPA fallback：/* /index.html 200（會原樣複製到 dist/）
└─ pwa-*.png / favicon.svg / apple-touch-icon.png

scripts/
├─ sync-data.mjs             # 城巴 + 小巴站點索引、運輸署票價表
└─ generate-icons.mjs        # 產生 PWA PNG 圖示（自製 PNG 編碼器）

.github/workflows/deploy.yml # GitHub Pages 建置與部署
```

---

## 6. 資料流與規則

### 6.1 快取層級

| 資料 | 來源 | 快取 |
| --- | --- | --- |
| 九巴全部站點 | 官方 API | 記憶體 → localStorage（`hkb:cache:kmb-stops`，12 小時） |
| 城巴／小巴站點索引 | `public/data/*.json` | 記憶體 → IndexedDB（`hkb-static`，6 小時）＋ SW `hkbus-static-data` |
| 路線索引（KMB/CTB 官方 + 小巴靜態） | API + `gmb-routes.json` | 記憶體 → localStorage（`hkb:cache:route-index-v2`，12 小時） |
| 票價 | `src/data/fares.json` | 打包進 bundle |
| ETA | 官方 API | 不快取，每 30 秒輪詢（切到背景暫停） |

### 6.2 附近站點

`getNearbyStops({ lat, lng, limit })`：搜尋半徑固定為 **500 公尺**（`DEFAULT_RADIUS`），不開放使用者調整。

1. `Promise.allSettled` 同時取得九巴站點、城巴索引、小巴索引；任一業者失敗仍會顯示其他業者。
2. Haversine 計算距離，取 500 公尺內站點。
3. **同業者 + 同站名 + 120 公尺內**視為同一車站的不同站牌/月台：
   - 站名去掉結尾的 `(YY123)` 月台代號再顯示；
   - 其餘站牌編號存進 `siblingIds`，查 ETA 時一併合併（每站最多再多查 5 個站牌）。
4. 不同業者即使座標相同也**不合併**，因為 ETA 來源不同。

### 6.3 ETA 合併

- **多目的地分組**：`groupEtaRows()` 把「一列一班車」整理成「一條路線（＋方向＋目的地）一筆」，key 為 `路線|方向|目的地`（`destinationKey()` 會忽略尾端「(循環線)」寫法差異與多餘空白，避免同一終點被拆成兩張時間相同的卡）——
  同一站點同一路線可能同時有不同目的地的班次（例如 13M 正線往寶達(循環線)、特別班次往觀塘站），
  不同目的地必須分成不同卡片，避免把相反方向／不同終點的班次混在同一組時間內；相同目的地仍合併多個 `service_type`（避免 5C 這種多服務類型重複顯示）。
  收集該路線全部班次後交給 `normalizeEtaList()` 排序、去重、取最近三班。
- `normalizeEtaList()`：依實際到站時間排序後去重——相鄰兩筆時間差 < 45 秒，或顯示的 `HH:mm` 與剩餘分鐘完全相同時只保留一筆；`getStopEtas(stop)` 有帶 `stop.seq` 時，重複班次優先保留 `stopSeq` 相符的那筆。
- `mergeEtaGroups()`：合併多個站牌的回應，同路線＋方向＋目的地只留一筆（不因 `service_type` 不同重複出卡）；合併後才由 `finishEtaGroups()` 排序、去重並取最近三班。九巴流程會先收集原始班次 → 合併月台 → 拆分循環線 → 合併重複目的地，最後才取最近三班，確保同一個站牌（同一站點 ID）在循環線兩次經過時，去程／回程各自都能保留最多三班。
- **循環線去程／回程**：九巴循環線（`dest_tc` 含「循環」）的同一站名會在路線中出現兩次（例如 26M 順天總站：去程 seq 8 往觀塘、回程 seq 18 往彩虹），
  但官方 `stop-eta` 兩次都回 `dest_tc`「觀塘(循環線)」。合併同名月台後，`splitCircularPasses()` 會用 ETA 的站序（`stopSeq`）把兩次經過拆成兩組：
  站序較前的一組維持官方目的地，較後的一組（回程）改以九巴 `/route/{route}/{bound}/{service_type}` 的 `orig_tc` 作目的地。
  為避免把「同一目的地的特別班次站序偏移」或「路線末段折返兩次經過」誤標方向，拆分必須同時滿足：
  所有 ETA 屬**同一個 service_type**、該 service_type 內**恰好兩個站序**、並以 `/route-stop` 站序清單驗證兩個站序分別在路線**前半／後半**且相距至少 **1/3 條路線**；
  兩個路線資料請求都會以記憶體快取（失敗不留在快取，下次輪詢可重試），且取不到資料時保持原狀（寧可少拆，不可標錯方向）。
  拆分後若回程目的地與同站同方向既有的分組相同（例如 78A：回程往皇后山，剛好另一個 variant 的目的地也是皇后山），會再合併成一張卡，避免重複。
- **城巴**：`getCitybusStopEtas()` 先打批次端點（一站一次拿全部路線，含索引未收錄的新路線），失敗才逐路線查詢備援；批次回應的 `dest`／`rmk` 會正規化成 `dest_tc`／`rmk_tc` 後併入 `groupEtaRows()`。
- 小巴以 `route_id|route_seq` 對照路線號碼與方向（`route_seq` 1 = 去程、2 = 回程）。
- 每個站點的 ETA 都包在 `Promise.allSettled` 裡，單一 API timeout 只會讓那一張卡片顯示錯誤，不會讓整頁崩潰。
- **UI**：`StopSection` 統計同一站點同一路線的目的地分組；超過一個目的地時，`BusCard` 的 ETA 三格上方會顯示彩色的「往 [目的地]」chip
  並用同色調為路線號碼框與 ETA 格上色，讓使用者一眼分辨方向；只有單一目的地時維持原本簡潔的 UI、不顯示額外標籤。

### 6.4 票價

`getFare(operator, route, serviceType)` 查 `fares.json`（key：`路線|service_type`），查不到回傳 `null`，UI 顯示「票價待查」。
共同營運的路線會同時提供 KMB 與 CTB 兩份資料；小巴沒有官方票價來源。

### 6.5 路線站序（RouteSequence，原視窗導覽）

站點展開後，每一張路線卡片都是「查看全線站序」的按鈕：

1. `StopSection` 不再行內展開，改以 `buildRouteSequencePath(entry, stop)` 組出站內路徑
   `/route/:operator/:route/:direction?stop=…`（query 可帶 `name`／`siblings`／`serviceType`／`routeId`／`routeSeq`／`orig`／`dest`），
   再用 react-router 的 `navigate()` **在原視窗**切換，不再 `window.open()`。路徑不含 `BASE_URL`，
   `BrowserRouter` 的 basename 會自動處理子路徑；只有 Google Maps 這類外部連結維持
   `target="_blank" rel="noopener noreferrer"`（手機可喚醒 App 或另開新分頁，不影響站內原視窗狀態）。
2. 站序頁 `RouteSequence.jsx` 註冊在 `App.jsx` 的 `/route/:operator/:route/:direction`（不經 AppShell，全螢幕、無底部導覽），
   所有狀態都從 URL 還原，因此**可直接分享、重新整理、上一頁**；站內切換頁面（PUSH／REPLACE）會自動捲回頂部，
   瀏覽器上一頁／下一頁（POP）則還原原本的捲動位置。站序載入後，標題下方會出現置頂的**全線軌跡地圖**（見 6.8）。
3. 頁面以 `getRouteStops()` 取得全線站序（KMB／CTB 用 `route + direction + serviceType`；GMB 需要 `routeId + routeSeq`）。
4. 來源站（query `stop`，並同時比對 `siblings` 月台 ID）會自動高亮並展開：
   - 以 `getStopEtas()` 查該站 ETA，再以「路線＋方向」過濾；若同一方向有多個目的地分組（循環線去程／回程），
     優先選 ETA `stopSeq` 與本站站序相符的一組，並在 `EtaSlots` 上方顯示「往 X」標示（城巴一次批次請求即可）；
   - 每一列都會先用 `findSiblingStopIds()` 找出站序中「同名且相距 ≤ 120 公尺」的月台（只在站名重複出現時才查，
     例如循環線的順天總站 seq8／seq18），展開時一併合併查詢，因此非來源站也能拆對方向；九巴站點清單讀取失敗、
     缺少座標時會退回單一月台查詢（不影響顯示，只是方向標示會回到原狀）；
   - 若合併後仍混合兩個站序（幾何門檻不成立而未拆分時），面板只顯示與本站站序相符的班次，避免把反方向的車混進來；
   - `EtaSlots` 與站點卡片共用同一套三班車 UI；這個展開面板每 30 秒自動更新，也可手動刷新；
   - 站序載入後會把來源站捲到清單中央。
5. **其他站點也可以點開**：任一列都是按鈕，點擊後展開該站的最近三班車；**可同時展開多站**，
   打開下面的站不會收起上面的站（避免版面高度變化令畫面跳動），再點同一站才收合。
   展開狀態記在 component state；URL 的 `stop` 只作「來源站」與分享用途，重新整理時只會展開該站。
6. **站點收藏**：每一列右側（摺疊箭頭左邊）都有星號，可即時收藏／取消收藏站點；收藏與主 App 共用
   `hkb:favorites:v1`，靠 `storage` 事件跨分頁同步（站序頁收藏後，主 App 的「收藏」頁立即出現）。
7. **返回**：標題列左上角「← 返回」不再使用 `window.opener`／`window.close()`，改為：
   - `window.history.state?.idx > 0` 或 `window.history.length > 1` → `navigate(-1)` 回到上一頁
     （由站點卡切換過來時，原本展開的站點與捲動位置仍在）；
   - 直接貼網址／重新整理開啟（沒有上一頁）→ `navigate('/')` 回首頁。
8. **反轉方向**：`getRouteIndex()` 找出同路線的另一方向（KMB 沿用 serviceType、優先 1；GMB 以起訖站對照＋相反 routeSeq 選出折返路線），
   以 `navigate(..., { replace: true })` 更新 URL（不新增瀏覽紀錄）並重新抓站序。
   反向站點 ID 通常不同，因此會先用站名、再用座標在反向站序中找回最接近的站點並自動展開；
   若另一方向不停靠附近位置，就只顯示站序、不標示「本站」。

### 6.6 推算各站到站時間（類似 App 1933）

路線站序頁（`RouteSequence`）與搜尋頁站序面板（`RouteStopsPanel`）都有「推算各站到站時間」切換鈕
（時鐘圖示）。開啟後，以目前基準站「最近一班車」的 ETA 為起點，推算後續每一站的累計車程與預計到達時間。
純計算集中在 `src/utils/travelPlan.js`，UI 共用 `src/components/TravelPlan.jsx`。

演算法（不額外發 API）：

1. **幾何車程**：相鄰站點用 Haversine 直線距離 × 道路繞行係數 `1.3` 換算道路里程，
   除以香港市區巴士平均車速 `19 km/h` 得到行駛時間，再累加「每經過一站 `35` 秒」的停靠時間：
   `車程分鐘 = round(累計道路里程 ÷ 19 000 × 60 + 經過站數 × 35 ÷ 60)`（最少 1 分）。
   缺少座標的相鄰站以平均站距 450 公尺代替，banner 會提示「部分站點缺少座標」。
2. **實時 ETA 校準（優先策略）**：頁面上已展開的站點會取得官方實時 ETA。配對「同一班車」的規則：
   候選班次必須晚於上一個錨點（有官方時間的站）至少 1 分鐘、且不晚於「幾何預測 + 容許誤差」
   （依車程長短在 **4～15 分鐘**之間縮放）；符合條件者取「加權後最接近幾何預測」的一班
   （偏早的誤差權重較低，因為 19 km/h 的幾何估算偏保守、容易高估車程）。採用後以該站為新錨點，
   之後的站改用「錨點時間 + 幾何車程」推算，讓上遊的實際延誤往下游傳遞；超過 90 秒沒有更新的 ETA
   不再採用，若被夾回成單調遞增的推算值也不會標成官方資料。
3. **預計到達**：`基準班次時間 + 累計車程`，以 `formatClock()` 顯示成 `HH:mm`；各站車程與時間都強制遞增
   （實時資料抖動或四捨五入時也不會出現「後站比前站早」）。
4. **沒有實時班次時**：只顯示純車程（`+X 分鐘車程`）並給出友善提示，不顯示 `HH:mm`。

互動：

- **站序頁**：開啟推算時會自動展開基準站，banner 標示「基準站 · 第 N 班 · `HH:mm`」；
  點擊任一站展開面板中的第 1～3 班 ETA 格，即可把「那一站的這一班」切換成推算基準
  （`EtaSlot` 在推算模式下才變成按鈕）。基準站列顯示「推算基準」chip，其後每一站顯示 `+X 分` 與 `HH:mm 到達`。
- **搜尋頁站序面板**：以「已展開且取得實時 ETA 的最前面站點」為基準（都沒有時退回第一站做純車程推算）；
  `useBusData()` 的 `updatedAt` 會傳入面板，用來判斷 ETA 是否新鮮（不使用已過期的背景資料）。
  路線資訊列（含「返回路線搜尋」）與「推算各站到站時間」切換鈕會 **sticky 固定在主殼 Header 下方**
  （`top-[var(--app-header-h)]`；Header 高度由 `App.jsx` 量測後寫入 CSS 變數），站序很長時不論滑到哪裡
  都能隨時返回或開關推算，與首頁 sticky Header 同一套邏輯。開啟面板時畫面捲回頂端，返回清單時還原
  原本的路線清單捲動位置。
- 推算結果只是**估算**（路況、站距、燈位、上落客都會影響），UI 一律以「推算／約」呈現，不代表官方承諾。

### 6.7 收藏雙分頁：收藏站點分組與收藏路線

收藏頁頂部是款式 B 毛玻璃分段切換器（Segmented Control）：「◎ 收藏站點 (N)」與「★ 收藏路線 (M)」，
選中的分頁套用 `rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 text-white font-extrabold shadow-sm`；
兩個分頁各自有統計卡、清除按鈕與空狀態。

**收藏站點**沿用舊格式：把「同一個車站的多個站位」合併成一張卡片，但 **localStorage 格式完全不變**：仍只寫入
`hkb:favorites:v1`，每筆為 `operator`／`id`／`nameTc`／`nameEn`／`lat`／`lng`／`routes`／`siblingIds`／`savedAt`
（見 `src/hooks/useFavorites.js`）。分組只發生在顯示層（`Favorites.jsx` 的 `groupFavorites()`），
不會改寫或搬移已儲存的資料；舊收藏缺少 `lat`／`lng`、`routes`、`siblingIds` 時只靠站名分組，
JSON 損壞則沿用原本的容錯讀取（退回空清單、不 `throw`）。

分組規則（`canJoinGroup()`）：

1. 先以 `normalizeStopName()` 清掉站名尾端的站牌代號（例如 `(YT123)`）與「- 3號月台」後綴，再比對站名
   （忽略大小寫、空白與標點）。代號格式要求「英文字母＋數字」，才不會把英文站名尾端的地名括號
   （例如 `Lam Tin (North)`、`… (WEST)`）誤當代號刪掉。
2. **同名**：合併；但若兩個收藏都有座標且相距 **> 500 公尺**，視為不同地點而分開。舊收藏沒有座標時
   只靠同名，無法判斷距離。
3. **不同站名**：必須與群組內某個站位相距 **≤ 100 公尺**，且站名「高度相符」——去掉空白與標點後
   完全相同、一方是另一方的完整子字串（至少 4 字，例如 `東九龍總區警察總部` vs `… , 協調道`），
   或編輯距離相似度 **≥ 0.95**。門檻太低會把 F 座／G 座、碧海樓／金碧樓這類鄰近但不同的站位誤併。

顯示與操作：

- 標題使用 `normalizeStopName()` 後的乾淨中英文站名；月台代號（例如 `YT123`／`YT124`；單一站位但
  原名含代號時也會顯示，方便分辨同名不同地點）以低調 chip 排在下方，副標示「N 個站位」與各業者 badge；
  收藏頁頂部統計在 M < N 時顯示「已收藏 N 個站點（整合為 M 個車站）」（N 為去重後的站點數）。
- 展開時一次以 `useBusData()` 抓取群組內**所有站位**的 ETA，再以
  `operator + route + direction + serviceType` 為 key 合併：同一條路線只保留最近一班較早的卡片，
  並記住該班次來自哪個站位，點路線卡開站序時會高亮正確的月台（`group.routeStops`）。
- 群組內部分站位抓取失敗時顯示警示，全部失敗才顯示錯誤；展開狀態用 `Set` 管理，可同時展開多個群組。
- 標題右側星星＝**移除整個群組**（群組內所有站位一起取消收藏）；展開後「此群組站位」區塊中每個 chip
  右側的 X＝**只移除該站位**，其餘站位保持展開。

**收藏路線**（獨立 key `hkb:favorite-routes:v1`，不會影響站點收藏）：

- 在 `Search` 的搜尋結果卡右側、以及 `RouteSequence` 頂部控制列的星號按鈕，可一鍵收藏／取消收藏該路線；
  唯一鍵為 `operator:route:direction:serviceType`（同一路線去／回程、特別班次各自獨立）。
- 每筆記錄 `operator`／`route`／`direction`／`serviceType`／`orig`／`origEn`／`destination`／`destinationEn`／
  `routeId`／`routeSeq`／`stop`（可選來源站）／`savedAt`。舊版 App 只會讀寫站點 key，不會覆蓋路線收藏。
- 收藏路線卡以 `getRouteStops()` 取得該路線全線站序，配合目前 GPS（`useLocation()`；使用預設位置時不計算）
  找出**直線距離最近的候車站**，再用 `useBusData()` 取得該站最近三班車（30 秒輪詢、切背景暫停），
  顯示成「⚡ 即將到站 · 30 分 · 44 分」與距離；沒有定位時提示開啟定位。
- 卡片右下「查看全線站序」以 `buildRouteSequencePath()` 原視窗進入 `/route/...`（帶入最近候車站作高亮／展開），
  同一個站序頁可看到全線軌跡地圖與各站 ETA。

### 6.8 附近站點互動地圖（Leaflet）

首頁頂部的地圖刻意不用 Google Maps SDK（需要 API Key 與計費、載入較慢），改用 **Leaflet 1.9 + 官方 OpenStreetMap 圖磚**
（`https://tile.openstreetmap.org/{z}/{x}/{y}.png`）：免 Key，但須遵守
[OSM Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)（可見的版權標示、不大量下載／不提供離線下載功能）。
官方 OSM 只有淺色圖磚，本專案的深色地圖以 CSS filter 反轉，不需要第二套圖磚來源。

- `src/components/StopMap.jsx` 以純 React `useRef` 直接封裝 Leaflet（不使用 `react-leaflet`，避免 React 19 的
  peer dependency 衝突），並由 `Nearby.jsx` 以 `React.lazy` 動態載入；Leaflet 與圖磚 CSS 自成一包
  （約 154 kB raw／46 kB gzip），不影響首屏定位與站點列表。
- **主題連動**：深色模式在 tile layer 加上 `map-tiles-dark` class（`src/index.css` 內以
  `filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%)` 把淺色 OSM 圖磚轉成深色），
  切換主題時重建圖層。由於頁首的 `useTheme` 是獨立 hook 實例，`StopMap` 另外以 `MutationObserver`
  監聽 `<html class="dark">`，在標題列切換主題時即時換底圖。
- **標記**：使用者位置為藍點（外圈淡藍光暈）；附近站點為天藍色圓點圖釘，目前選中的站點換成琥珀色並顯示站名標籤。
  圖釘只用 `divIcon`（inline style 畫圓點）而非 Leaflet 預設圖片，避免 bundler 找不到 `marker-icon.png`。
- **預設展開第一站**：`Nearby` 在 `getNearbyStops()` 回來後以 `nearbyStops[0]` 設定展開狀態與地圖聚焦點，
  地圖會 `flyTo` 到該站；同一時間只保留一個「選中」站點（可同時展開多張卡片，最近互動的那張為選中）。
- **雙向聯動**：點列表站點 → 展開 ETA 並 `flyTo`；點地圖圖釘 → 展開該站（已展開則保持）並以
  `scrollIntoView({ behavior: 'smooth', block: 'center' })` 捲到對應卡片。卡片 DOM 以 `ref` Map 依
  `favoriteKey(stop)` 對應。
- **置頂與高度縮放**：`Nearby` 把地圖包在 `sticky top-2` 容器（以 `top: calc(var(--app-header-h) + 0.5rem)` 貼在
  毛玻璃 Header 下緣，避免被蓋住），往下瀏覽站點時地圖永遠留在畫面上。`StopMap` 新增 `collapsed` prop：
  高度由 `h-[210px]` 平滑縮至 `h-[138px]`（約 1/3，`transition-[height] duration-300 ease-out`）；
  高度改變後在 `transitionend` 與 320ms 保險計時器觸發 `map.invalidateSize()`，圖磚與中心點不會跑位。
- **捲動門檻**：`Nearby` 以 passive scroll + `requestAnimationFrame` 防抖，`window.scrollY > 36` 收起地圖、
  `<= 12` 展開；地圖膠囊的「展開全圖 ▼」會暫時解除自動收起，要再往下滑 >120px 才重新收起。
- **全線軌跡模式（route mode）**：`StopMap` 新增 `routeStops`／`focusedStopId`／`onClearFocus`。傳入路線站序後改以
  `L.polyline`（顏色 `#0ea5e9`、線寬 `4`）串起所有有座標的站點：起點綠、終點琥珀、沿途天藍圓點；
  未聚焦任何站點時以 `fitBounds(polyline.getBounds(), { padding: [24, 24] })` 顯示全線，聚焦單站時
  `flyTo([lat, lng], 17)`、顯示該站站名，右上 Google Maps 連結同步指向該站；左上角出現「◎ 顯示全線軌跡」
  可按 `onClearFocus` 回到全線總覽（聚焦時暫時隱藏 Leaflet 縮放鈕避免重疊）。route mode 不顯示定位膠囊。
- **搜尋頁與站序頁的置頂軌跡地圖**：`Search` 選定路線後、`RouteSequence` 站序載入後，都在內容頂部以
  `sticky` 常駐 `StopMap`（React.lazy 載入，免把 Leaflet 塞進搜尋／站序 chunk）。點列表站點會設定
  `focusedStopId` 讓地圖立即飛去該站；搜尋頁監聽 `window` 捲動、站序頁監聽清單 `<ol onScroll>`，
  兩者共用 `useMapCollapse()`（>36 收起至 138px、<=12 展開）。搜尋頁的 `RouteStopsPanel` 透過
  `topOffset`（146px／218px）把 sticky 返回列貼在置頂地圖下緣，不會被地圖蓋住。
- **輔助操作**：右上角「在 Google Maps 開啟 ↗」毛玻璃膠囊常駐（優先目前選中站點，其次使用者位置／地圖中心；
  以 `target="_blank" rel="noopener noreferrer"` 另開分頁或喚醒 Google Maps App）；地圖底部內嵌單行定位膠囊
  （綠點、狀態文字、誤差／更新時間、重新定位、更新附近站點；收起時顯示「展開全圖 ▼」）。Leaflet 版權列
  以 `.hkb-map .leaflet-bottom { bottom: 3rem; }` 抬高，避免被膠囊遮擋；縮放鈕與版權列在深色模式另有配色。
- 圖磚由 Workbox `CacheFirst` 快取（見 7. PWA 設定）：只快取使用者正常瀏覽過的圖磚（7 天 TTL），不 prefetch、不提供離線下載功能。

### 6.9 路線卡排序（長途優先）

站點卡片內的各路線，除了到站時間，還會依「本站到該路線終點」的剩餘距離排序：

1. **沒有到站時間一律最後**：`nextMinutes` 為 `null`（已過終班／沒有可顯示班次）的路線，不論剩餘距離長短都排到最後；30 秒 ETA 輪詢後若有新班次，會自動回到正常位置。
2. **長途方向優先**：剩餘距離（沿線站距 Haversine 加總）由長到短；最後一站或倒數幾站的方向自然排在後面。
3. **終點站最後**：本站就是該方向的終點時，該路線卡排在「有到站時間」路線的最後面（沒有到站時間的路線仍然更後面）。
4. 同距離時再依最近一班到站時間、路線號碼排序；有 `progress` 但缺座標（算不出實際距離）時改以剩餘站數比較；完全沒有 `progress`（站序讀取失敗或逾時）則退回以到站時間排序，並排在「有 progress 的路線」之後、「終點站」之前。

計算方式：以 ETA 的站序（KMB／CTB 為 `seq`、GMB 為 `stop_seq`）對應 `getRouteStops()` 回傳的站序，
取「目前站序 → 路線終點」逐段 Haversine 加總；循環線同一站名會出現兩次，必須用站序分辨。
`src/services/api.js` 的 `attachRouteProgress()` 會批次補上
`progress: { remainingStops, remainingDistance, isTerminus }`（同時最多抓 6 條路線；單條最多等 6 秒、整批上限 8 秒，
路線站序在同一次瀏覽工作階段以 `routeStopsCache` 快取，30 秒輪詢不會重複請求）。
`useBusData` 先顯示 ETA、再於背景補上剩餘距離，補到後只重排一次，不會為了等路線站序而卡住 loading。
排序規則集中在 `src/utils/routeOrder.js` 的 `sortRoutes()`，由 `StopSection` 使用，附近／搜尋／收藏頁共用。
個別路線站序讀取失敗或逾時就沒有 `progress`，該卡退回以到站時間排序
（排在「有 progress 的路線」之後、「終點站」之前）；缺座標時仍有 `progress`，只是改用剩餘站數排序。兩者都不影響 ETA 顯示。

### 6.10 定位授權記憶與座標快取（useLocation）

iOS Safari 不支援 `navigator.permissions.query({ name: 'geolocation' })`，而且「加入主畫面」後的 PWA
有時不會再顯示系統定位授權視窗；因此 `src/hooks/useLocation.js` 另外用 `localStorage` 記憶
（全部以 `try / catch` 包覆，無痕模式寫入失敗只會失去記憶、不影響定位）：

| Key | 格式 | 說明 |
| --- | --- | --- |
| `hkb:location-consent` | `'granted'` | 成功取得定位時寫入；`PERMISSION_DENIED` 時清除 |
| `hkb:last-location` | `{"lat":22.3,"lng":114.1,"accuracy":20,"updatedAt":1730000000000}` | 上次成功的座標；JSON 壞掉／欄位缺漏／數值不合理時忽略 |

行為：

1. **初始化**：有 `hkb:last-location` 就立即用快取座標渲染附近站點（不必等 GPS 讓畫面空白），同時背景靜默更新最新定位。
2. **自動定位**：有 `hkb:location-consent = 'granted'`，或 Chromium 的 `navigator.permissions` 回報 `granted`／`prompt` 時，
   掛載後直接呼叫 `getCurrentPosition`，不必再手動點「重新定位」；已被明確拒絕時不自動請求，改顯示提示。
3. **成功**：寫入 `hkb:location-consent = 'granted'` 與 `hkb:last-location`。
4. **拒絕（`error.code === 1`）**：清除 `hkb:location-consent`，錯誤訊息附上 iOS 操作提示
   （Safari 網址列左側「網站設定 › 位置 › 允許」，或把本站「加入主畫面」後重新允許）。

### 6.11 語言切換與單語顯示（useLanguage）

`[中 | EN]` 切換由 `src/hooks/useLanguage.js` 的 React Context 提供（`LanguageProvider` 包住 Router），
切換後全站即時更新，並持久化在 localStorage 的 `hkb:lang`（只接受 `'zh'`／`'en'`，預設 `'zh'`）。

| Key | 值 | 說明 |
| --- | --- | --- |
| `hkb:lang` | `'zh'`／`'en'` | 其他值一律退回 `'zh'`；讀寫以 `try / catch` 包覆 |

- **單語顯示**：站名與目的地一律用 `pickLang(nameTc, nameEn)`（中文模式回傳 `tcText || enText`、英文模式回傳
  `enText || tcText`），`StopSection`／`BusCard`／`RouteStopsPanel`／`RouteSequence`／`Search` 不再顯示英文小字行。
- **UI 字典**：`t('key', params)` 集中管理導覽（附近／搜尋／收藏）、票價、分鐘、Google Maps、反轉方向、
  推算各站到站時間、錯誤與空狀態等文案；`{name}` 會被 params 取代。新增文案時必須同時補中英兩欄。
- **動態資料**：目的地用 API 的 `dest_tc`／`dest_en`（KMB／CTB／GMB 皆有），站名用 `nameTc`／`nameEn`；
  路線卡、站序頁標題與 ETA「往 X」標籤都會跟隨語言。
- **尚未翻譯**：服務層產生的動態錯誤訊息（例如網絡錯誤）仍是繁體中文，切換語言不會改寫已產生的錯誤字串（見第 8 節）。

### 6.12 視覺規範：款式 B 毛玻璃（Glassmorphism Modern）

- **共用卡片**：`index.css` 的 `.card` 為 `rounded-[22px] border border-white/80 bg-white/85 backdrop-blur-xl`
  ＋柔和陰影（深色 `dark:border-slate-700/70 dark:bg-slate-800/80`），所有頁面卡片（附近、搜尋、收藏、站序面板、
  路線卡容器）共用；不要在元件內另寫一套白底卡片外觀。
- **業者膠囊**：`OperatorBadge` 為 `rounded-full px-2.5 py-0.5 text-[11px] font-extrabold`：
  九巴玫瑰紅（`bg-rose-100 text-rose-700`）、城巴琥珀（`bg-amber-100 text-amber-800`）、
  小巴薄荷綠（`bg-emerald-100 text-emerald-800`），深色模式用半透明同色底（見 `BADGE_STYLES`）。
- **路線卡**：`BusCard` 的路線號碼框為 `rounded-[14px]` 徽章；聯營／焦點路線（同一站同路線號碼由多於一個業者
  提供）使用 `bg-gradient-to-r from-sky-500 to-indigo-500` 藍紫漸層（`StopSection` 以 `featured` 傳入）。
- **即時倒數**：`EtaSlots` 每格為 `rounded-[14px]` 膠囊；≤ 3 分鐘或三班中的首班使用薄荷綠高光
  （`border-emerald-500/60 bg-emerald-500/15 font-black`），其餘為柔和內嵌毛玻璃塊。
- **站點卡互動**：`StopSection` 的展開／收合鈕改為 28px 圓形玻璃按鈕（`h-7 w-7 rounded-full`）。
- Header／BottomNav／置頂地圖沿用毛玻璃膠囊；頁面背景是冰藍（日）／午夜藍紫（夜）漸層＋環境光暈。

---

## 7. PWA 設定

- `vite.config.js`：`registerType: 'autoUpdate'`、`injectRegister: null`（由 `src/main.jsx` 手動註冊，每小時檢查更新）。
- **PWA 專屬 ID**：manifest `id` 固定為 `APP_ID = '/hk-bus-eta/'`（`vite.config.js`），**刻意不跟隨 `base`**。
  瀏覽器判斷「是否同一個 App」只看 `id`，所以同一 origin（如 `shernwu-creator.github.io`）下的多個 PWA 專案
  各有自己的 `id`，即使本站改用自訂網域或部署到根目錄（`VITE_BASE_PATH=/`）也不會撞身分，
  **多個 PWA 可以同時安裝在同一部裝置**；`id` 不變時 SW 更新也會視為同一 App 的升級。
  ⚠️ 發佈後不要修改 `APP_ID`，否則使用者會被要求重新安裝（舊圖示不會自動更新）。
- Manifest：`start_url` / `scope` 為建置 base（`/hk_bus_pwa/`）、`id` 為上述固定值，安裝後從正確路徑啟動。
- 執行期快取（`CacheStorage` 以 origin 為單位共用，故全部加上 `hkbus-` 專屬前綴，避免與同 origin 的其他 PWA 專案互相覆蓋）：
  - `data.etabus.gov.hk`（九巴）、`rt.data.gov.hk`（城巴）、`data.etagmb.gov.hk`（小巴）→ `NetworkFirst`（8 秒逾時），
    快取名稱 `hkbus-kmb-api` / `hkbus-citybus-api` / `hkbus-gmb-api`，斷網時仍能看到最後一次資料；
  - 自家 `/data/*.json` 索引 → `StaleWhileRevalidate`，快取名稱 `hkbus-static-data`；
  - `tile.openstreetmap.org`（OSM 圖磚）→ `CacheFirst`（7 天、最多 240 張），快取名稱 `hkbus-map-tiles`；只快取正常瀏覽過的圖磚，符合 OSM 的本機快取要求，不做 prefetch／大量下載。
- 圖示：`public/pwa-192x192.png`、`pwa-512x512.png`、`pwa-maskable-512x512.png`、`apple-touch-icon.png`，皆由 `npm run generate:icons` 產生。
- 驗證方式：`npm run build && npm run preview`，開啟 `http://localhost:4173/hk_bus_pwa/`，在 DevTools → Application 檢查 Manifest 與 Service Worker；`dist/404.html` 與 `dist/_redirects` 都應存在。

---

## 8. 已知限制

- **城巴 ETA 已改走批次端點**：`/v1/transport/batch/stop-eta/CTB/{stopId}` 一次回傳該站所有路線的到站時間，請求數由最多 8 次降為 1 次；批次端點失敗時才退回逐路線查詢。**注意 v2 逐路線端點的正確順序是 `eta/CTB/{stopId}/{route}`，若寫反會回 200 但 `data` 永遠是空陣列**（這是舊版「城巴有站點卻沒有到站時間」的根因，已修正）。
- **九巴全站點清單偶爾讀取失敗**：`data.etabus.gov.hk/.../stop`（約 1 MB）少數情況下會因官方限流／WAF 而回 403，站名會退回站點編號（ETA、站序、反轉方向仍可運作）；站點清單成功後會快取 12 小時。重新整理或稍後再試通常可恢復。
- **多目的地分組與循環線拆分是「盡力而為」**：同站同路線的班次以官方 `dest_tc`（忽略尾端「(循環線)」寫法）分組；循環線回程的目的地改用 `/route/{route}/{bound}/{service_type}` 的 `orig_tc` 補上。
  拆分只會在「同一個 service_type、恰好兩個站序、且 `/route-stop` 驗證兩個站序分別在路線前半／後半並相距 ≥ 1/3 條路線」時進行，因此以下情況維持原狀（不拆、不標錯方向）：
  官方 `dest_tc` 未含「循環」字樣、同一站名出現三次以上、兩次經過都在路線末段（例如 78A 皇后山總站的折返）、特別班次造成同一目的地站序偏移、或路線資料請求失敗。
  城巴沒有 service_type 與循環線拆分（同站同路線同方向但站序不同、`dest` 相同者仍可能混在同一張卡）。官方 `dest_tc` 尾端若有額外備註（例如「粉嶺站 (循環線) [不經山麗]」）仍視為不同目的地、可能與同終點的另一張卡重複顯示；此類情況只影響標示，不會合併成錯誤方向。
  幾何門檻（相距 ≥ 1/3 條路線）會讓部分循環線的中段重複站名不拆分，例如 26M 聯合醫院 seq11／16、和樂邨 seq13／15（相距 < 26÷3 站），卡片仍會混方向且無「往 X」標示（保守策略，避免標錯方向）。若九巴站點清單（`/stop`，約 1 MB）暫時 403，站序頁拿不到站名／座標就無法自動帶入同名月台，循環線方向標示會退回原狀（ETA 仍正常顯示）。
- **路線卡「長途優先」排序需要額外抓路線站序**：展開站點時會先以到站時間顯示路線卡，再於背景為該站各路線抓取 `/route-stop`（同時最多 6 條；單條最多等 6 秒、整批上限 8 秒），補到剩餘距離後重排一次，因此路線順序可能在展開後約 1～2 秒內變動。繁忙站點（城巴實測一站可達 25 條路線）若在 8 秒內算不完，未完成的路線這輪先維持到站時間排序，下一次 30 秒輪詢或站序快取命中後會補上。同一路線站序在同一瀏覽工作階段只抓一次（記憶體快取，重新載入頁面後失效）。站序讀取失敗或逾時的路線這輪沒有 `progress`、退回以到站時間排序；有 `progress` 但缺座標（例如九巴 `/stop` 暫時 403）時改以剩餘站數排序（仍長途優先），ETA 仍正常顯示。
- **iOS 定位授權**：Safari 沒有 Permissions API，`hkb:location-consent`／`hkb:last-location` 只存在本機瀏覽器；清除網站資料、換瀏覽器或換裝置後會重新詢問一次。若使用者在系統層拒絕定位，站內只能顯示提示與預設／上次位置，需到 Safari 網站設定或系統設定重新允許（見 6.10）。
- **語言只涵蓋介面與站名／目的地**：`useLanguage` 的字典覆蓋所有靜態 UI 文案與 API 提供的 `nameTc`／`nameEn`、`dest_tc`／`dest_en`；服務層動態錯誤訊息（例如網絡失敗）仍以繁體中文顯示，切換語言不會翻譯已產生的錯誤字串（見 6.11）。
- **`hkb:lang`**：只接受 `'zh'`／`'en'`，其他值退回 `'zh'`；與 `hkb:theme`、`hkb:favorites:v1`、`hkb:favorite-routes:v1` 一樣只存在本機。
- **站序地圖只畫有座標的站點**：`routeStops` 若缺少座標就不會出現在折線與圖釘中（例如小巴靜態索引與官方 `route-stop` 的站點 ID 未必完全對應；實測 1A 西貢方向 12 站只有 1 站命中），全線軌跡可能只剩少數點甚至無法顯示；站序與 ETA 仍正常。九巴站點清單（`/stop`）暫時 403 時同理。
- **反轉方向的站點對應是「盡力而為」**：本車站（含月台）以站名、再用 200 公尺內座標在反向站序中找回；若另一方向不停靠附近位置，只顯示站序、不標示「本站」。九巴反轉後該站 ETA 只查單一月台（原方向仍會合併 `siblingIds` 月台）。
- **收藏站點分組是「盡力而為」**：同名但相距 > 500 公尺的收藏會分開（實測九巴同名站點約 0.9% 屬於此類，最遠可達 50 公里）；判定方式是「與群組內任一站位距離 ≤ 500 公尺」，所以同名站點可能透過中間站位串成一組（A–B 400m、B–C 400m、A–C 800m 仍同組）。舊收藏沒有座標時只靠同名合併，無法判斷是否同一地點；站名尾端的代號／月台後綴只處理常見格式（`(YT123)`、`- 3號月台` 等），代號須含數字、其他寫法可能仍被視為不同站名。名稱相似度門檻（0.95）仍可能把同站不同座數／出口當成同一組（例如上水站 D1／D2 出口），反向也可能漏併命名差異大或順序顛倒的跨業者同站（例如「賽西湖大廈, 寶馬山道」與「寶馬山道, 賽西湖大廈外」）。展開群組會多打幾個站位的 ETA 請求：每個站位各自最多再多查 5 個月台，跨站位重複的站牌不會再去重（群組 k 個站位最多約 k×6 次站點請求），且沿用 `Promise.allSettled`，單一站失敗不影響其他站位。
- **小巴反向 variant**：同一路線號碼可能有多個 `route_id`（不同班次描述），反轉時以起訖站互換＋相反 `route_seq` 評分挑選；單向行駛的 variant 會顯示「找不到另一方向」。
- **靜態索引是快照**：新開辦的路線／新站點要重跑 `npm run sync:data` 才會出現（前端 IndexedDB 6 小時後也會重新抓取）；GitHub Actions 每週日 04:00（香港時間）自動同步並提交 `public/data/` 與 `src/data/`。
- 小巴 ETA 只回傳 `route_id`，若靜態索引尚未收錄該路線，該班次會被略過（重跑 `sync:data` 即可）。
- 票價為運輸署提供的**全程收費**，非分段收費；小巴無票價。
- **地圖底圖是官方 OSM 免費圖磚**：`tile.openstreetmap.org` 由 OSM 社群捐款維護、容量有限且**沒有 SLA**，須遵守
  [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)：不大量下載／不預抓、不提供離線地圖、保留可見的版權標示。
  本專案只在使用者正常瀏覽時請求目前視窗的圖磚，`hkbus-map-tiles` 僅快取這些看過的圖磚（7 天 TTL）以減少重複請求；未快取區域離線時會空白
  （站點清單與 ETA 快取仍然有效）。若日後需要大量或離線使用，應改用自架圖磚或明確允許的商用供應商。Google Maps 按鈕只是外部連結，
  沒有嵌入 SDK，也沒有即時路線導航。
- 只支援九巴、城巴與專線小巴，未包含龍運、新大嶼山巴士、港鐵巴士與居民巴士。
- **「各站到站時間」是推算而非官方資料**：`src/utils/travelPlan.js` 以直線距離 × 1.3 繞行係數、
  19 km/h 平均車速與每站 35 秒停靠估算，實際受路況、燈位與上落客人數影響，長距離與繁忙時段誤差會放大。
  只有「已展開站點」的實時 ETA 會被採用（靠進站順序推測同一班車；班距很小的路線、官方漏班或前車嚴重
  誤點時仍可能配到相鄰班次），其餘仍是幾何估算；小巴站點索引偶有缺少座標，會以平均站距代替
  （banner 會標示），數值僅供參考，請以官方 App／站牌顯示為準。

---

## 9. 後續可延伸

- 站點層級的分享連結（`/stop/:operator/:id`）；路線站序已可用 `/route/...` 直接分享。
- 收藏路線（目前只收藏站點）與到站提醒通知（Notification API）。
- 讓站序頁的 `useStopEtas` 與 `useBusData` 共用同一套背景暫停／可見性邏輯（目前各自實作）。
- Search 頁站序帶入同名月台 `siblingIds`（可重用 `findSiblingStopIds()`），並把推算資料的 key 改為「站點 ID＋站序」，
  讓循環線同一站點 ID 出現兩列時（例如 26M 彩虹總站 seq1／26）各自使用正確方向的 ETA。
- 把 `src/services/api.js` 內私有的 `normalizeStopName()` 改為共用 `src/utils/format.js` 版本
  （目前 API 版只處理九巴尾端代號，兩者規則略有不同；合併時需一併評估附近站點 120 公尺的 `siblingIds` 合併行為）。
- 以 `IntersectionObserver` 延遲載入長站序清單。
- 小巴票價：改接運輸署「綠色專線小巴收費」資料集，補上 `getFare('GMB', route)`。
- `sync-data` workflow 已會自動提交 `public/data/`＋`src/data/` 並觸發部署；可再補上失敗通知或改以 PR 審核資料變動。

---

## 10. 修正與功能摘要

| 問題／需求 | 處理 |
| --- | --- |
| **多個 PWA 要能同時安裝在同一部裝置** | manifest `id` 改為固定值 `APP_ID = '/hk-bus-eta/'`（不再等於 `base`，避免改用自訂網域／根路徑部署時與同 origin 的其他 PWA 撞身分）；Workbox 執行期快取名稱加上 `hkbus-` 前綴（`CacheStorage` 以 origin 共用）；`index.html` 補 `application-name` meta。 |
| **城巴有站點但沒有到站時間** | 根因：v2 逐路線 ETA 路徑順序寫反（`eta/CTB/{route}/{stopId}`），官方回 200 但 `data` 永遠是空陣列。已改為主要使用批次端點 `batch/stop-eta/CTB/{stopId}`（一次取全站所有路線），備援路徑修正為 `eta/CTB/{stopId}/{route}`。 |
| **站序頁沒有返回方法（按 X 直接退出程式）** | 站序頁改為「返回」按鈕：站內已改為原視窗導覽，`history.state?.idx > 0`／`history.length > 1` 時 `navigate(-1)` 回上一頁（保留原本站點展開狀態），直接貼網址開啟則回首頁。 |
| **路線站序也要能收藏站點** | 站序每一列加星號收藏按鈕（`useFavorites`，與主 App 共用 localStorage／storage 事件同步）。 |
| **附近站點排序：收藏優先、小巴最後** | `Nearby` 以「GMB 一律排最後 → 已收藏優先 → 距離」排序，收藏狀態改變即時重排。 |
| **參考 App 1933：站點內點路線要看完整站序** | 新增 `RouteSequence` 頁（`/route/:operator/:route/:direction`，URL 可分享）與 `routeLinks.js`；`StopSection`／`BusCard` 點路線卡即在原視窗開啟完整站序。 |
| **從哪個車站開啟就標示哪一站，並顯示三班即將到站** | 由 URL 帶入 `stop`／`siblings`／`name`，站序頁自動高亮「本站」、捲到清單中央並展開最近三班 ETA（`EtaSlots` 共用三格 UI、30 秒自動更新）。 |
| **其他車站也要可以點開** | 站序每一列都是按鈕，可逐一展開該站的最近三班車（一次展開一站，切站會取消舊請求與計時器）。 |
| **要有反轉序列按鈕查反方向** | 站序頁「反轉方向」以 `getRouteIndex()` 找同路線反向（KMB 沿用 serviceType、GMB 以起訖站＋routeSeq 評分），`replace` 更新 URL 並重新抓站序；再以站名／座標找回反向站點自動展開。 |
| **自動同步 workflow 只 commit 票價** | `sync-data.yml` 改為同時 `git add public/data/`（站點索引）並移除 `[skip ci]`，資料更新會觸發 Pages 重新部署。 |
| **效能：主程式一次載入所有頁面** | `App.jsx` 改為 `React.lazy` 分頁 chunk（主 chunk 約 330 kB → 272 kB raw／gzip 約 105 → 88 kB），站序頁獨立 chunk（約 18 kB）。 |
| **效能：重複的網絡請求** | `withCache()`／`loadStaticData()` 加入進行中請求去重（同 key 併發只 fetch 一次，失敗可重試）；城巴 ETA 改批次端點；`useBusData` 修正切到背景仍輪詢的漏洞，回前景立即更新。 |
| **AI 協作規範** | 新增 `AGENTS.md`（CodeGraph 優先探索、禁止大範圍 grep／讀檔）與 `codegraph init` 圖譜（`.codegraph/` 已列入 `.gitignore`）；刪除重複 JSDoc 並同步 README 快取 key。 |
| 展開站點後名稱變成站點編號 | 展開時傳給 `useBusData` 的 refs 只帶 `operator/id/routes`，`StopSection` 拿不到 `nameTc`。改為傳完整站點物件（Nearby / Search / Favorites 三處），並還原被臨時加上的 `name_tc` 猜測欄位。 |
| 小巴 ETA 端點錯 | `eta/route-stop/{routeId}/{stopId}` 並不存在（404）。正確用法是站點層級 `eta/stop/{stopId}`（一次拿全部路線），或 `eta/route-stop/{route_id}/{route_seq}/{stop_seq}`。 |
| 小巴索引是空的 | 舊腳本把 `route/` 的巢狀結構當成陣列、`route_id` 當路線號碼、錯誤全部吞掉，產出 `[]`。重寫為 `route/ → route/{region}/{code} → route-stop → stop` 四段流程，並統計失敗數。 |
| 小巴沒有進入 UI | `getNearbyStops` / `getStopInfo` / `getRouteIndex` / `getRouteStops` 都只認 KMB/CTB。已全部補上 GMB 分支，小巴可出現在附近站點、路線搜尋與收藏。 |
| GitHub Pages 白屏 | 建置未設定 `base`，資源全指向網站根目錄；Router 也沒有 basename。已補上 `base`、Router basename、manifest `start_url/scope`、`404.html` 與部署 workflow。 |
| 靜態 JSON 拖慢 FCP | 城巴索引（350 KB）原本打包進主 chunk。已搬到 `public/data/`，改由 IndexedDB 延遲載入，主 bundle 不再包含站點索引。 |
| 單一 ETA 失敗拖垮整頁 | `useBusData` 原本即使用 `Promise.allSettled`，本次補上站點索引的 `allSettled` 與更明確的錯誤訊息，確保部分失敗仍能顯示其他業者資料。 |
| **同一路線出現兩個相同到站時間** | `src/services/api.js` 新增 `normalizeEtaList()`：ETA 先依實際到站時間排序，相鄰班次時間差 < 45 秒或 `HH:mm`＋剩餘分鐘相同時去重；合併月台時優先保留目標 `seq` 的班次，最近三班不再重複。 |
| **站點名稱只有中文** | 站點資料層沿用 `nameEn`（KMB `name_en`；城巴／小巴靜態索引每筆第 3 欄）；`StopSection`／`RouteSequence` 在中文站名下方以 `text-[11px]` 顯示英文站名，`RouteStopsPanel` 標題補上英文起訖站，方便外籍人士查看。 |
| **同一車站多個站位代號各自佔一個收藏區塊** | 顯示時以 `normalizeStopName()`（移除尾端 `(YT123)` 與「- 3號月台」後綴）把同名／座標 ≤ 100 公尺且站名高度相符（相似度 ≥ 0.95、一方包含另一方，或順序無關地完全相同）的收藏分組，同名但相距 > 500 公尺則分開；`hkb:favorites:v1` 格式完全不變。展開時合併群組各站位 ETA（同 `operator+route+direction+serviceType` 只留最近一班較早的卡片）並記住來源月台；標題星星移除整組，「此群組站位」chip 的 X 只移除該站位。 |
| **首頁上方要有互動地圖，並與站點列表聯動** | 新增 `StopMap.jsx`：Leaflet 1.9 + OpenStreetMap 圖磚（免 API Key；深色以 CSS filter 反轉），以 `React.lazy` 動態載入避免拖慢首屏；依 `useTheme`／`<html class="dark">` 即時換底圖。站點載入後預設展開 `nearbyStops[0]` 並 `flyTo`，點列表站點 → 地圖 `flyTo`，點圖釘 → 展開卡片並平滑捲動到該卡片；右上「在 Google Maps 開啟此站」（街景／步行導航）、右下重新定位；圖磚以 `hkbus-map-tiles` 的 `CacheFirst` 快取。 |
| **CartoDB 圖磚被換成「API KEY REQUIRED」浮水印** | CartoDB 圖磚 HTTP 仍回 200，但內容已變成要求 API Key 的浮水印圖（只檢查狀態碼不會發現）。改用官方 OSM `https://tile.openstreetmap.org/{z}/{x}/{y}.png` 與標準 `© OpenStreetMap contributors` 版權標示；深色模式不再依賴 `dark_all`，改在 tile layer 加上 `.map-tiles-dark`，以 `filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%)` 反轉，維持免 API Key；SW 圖磚快取改為只快取 `tile.openstreetmap.org` 正常瀏覽過的圖磚（7 天 TTL）。 |
| **參考 App 1933：以目前班次推算後續各站的到達時間** | 新增 `src/utils/travelPlan.js`：以直線距離 × 1.3 繞行係數、19 km/h 平均車速與每站 35 秒停靠累加出「到第 N 站的累計車程」，再以已展開站點的實時 ETA 校準（以「錨點後最早出現、且不晚於幾何預測＋容許誤差 4～15 分鐘」的班次推測為同一班車，採用後以該站為新錨點），最後顯示 `HH:mm` 預計到達；無實時班次時只顯示 `+X 分鐘車程`。UI 為 `src/components/TravelPlan.jsx`（切換鈕／基準說明列／膠囊），`EtaSlots` 新增 `selectable`／`selected`，可在站序頁點 ETA 格切換推算基準班次；`RouteSequence` 與 `RouteStopsPanel`（搜尋頁站序）皆可使用。 |
| **同一站點同路線不同目的地混在同一張卡（例如 26M 順天總站：去程往觀塘、回程往彩虹）** | `groupEtaRows()` 的 key 由「路線\|方向」改為「路線\|方向\|目的地」（`destinationKey()` 忽略尾端「(循環線)」寫法差異），不同目的地分成不同卡片；`mergeEtaGroups()` 同步把目的地納入合併 key。九巴循環線（`dest_tc` 含「循環」）合併同名月台後，新增 `splitCircularPasses()` 以 ETA `stopSeq` 拆出去程／回程：只有「同一個 service_type、恰好兩個站序、`/route-stop` 驗證兩站位於路線前半／後半且相距 ≥ 1/3 條路線」才拆（兩個路線資料請求皆有記憶體快取），回程改以 `orig_tc` 標示；避免特別班次站序偏移與末段折返造成誤拆。`StopSection` 只在同站同路線有多個目的地時傳 `destinationVariant`，`BusCard`／`EtaSlots` 顯示彩色「往 X」chip 並以同色調為路線號碼框與 ETA 格上色；單一目的地維持原 UI。`routeEntryKey()`（`StopSection`／`Favorites`）與站序頁 `useStopEtas` 的群組選取同步加入了目的地與 `stopSeq` 比對，避免重複 key、選錯方向；循環線回程卡的站序頁連結仍用官方終點（`routeDestination`）。九巴改為「先收集原始班次 → 合併月台 → 拆分 → 合併重複目的地 → 最後才取三班」，同一站牌兩次經過不會被提前截斷；`findSiblingStopIds()` 讓站序頁只在同名站重複出現時才合併月台查詢，非來源站也能標示正確方向；色調順序改依目的地字串固定，30 秒更新不會換色。 |
| **車站路線卡要「長途方向優先、終點站最後」** | 新增 `src/utils/routeOrder.js` 的 `sortRoutes()`：依「本站到路線終點」剩餘距離由長到短排序，終點站最後，同距離再依到站時間／路線號碼；`src/services/api.js` 新增 `attachRouteProgress()`（以 ETA 站序對應 `/route-stop` 站序、沿線 Haversine 加總，站序快取＋最多 6 條併發、單條 6 秒／整批 8 秒逾時），`useBusData` 先顯示 ETA、背景補上 `progress` 後重排一次，`StopSection` 改用 `sortRoutes()`，附近／搜尋／收藏頁共用；沒有到站時間（已過終班）的路線一律排最後，不影響其他排序規則。 |
| **搜尋車號搜出站序後，往下滑就找不到「返回」與「推算各站到站時間」** | `RouteStopsPanel` 把「路線資訊＋返回按鈕」與「推算切換鈕」包成 sticky 工具列（`top-[var(--app-header-h)]`、`z-10`、半透明背景＋backdrop blur），貼在主殼 sticky Header 下緣，長站序滑到任何位置都能直接返回或開關推算；Header 高度由 `App.jsx` 以 `ResizeObserver` 量測後寫入 `--app-header-h`（`index.css` 有量測前的後備值），改 Header 版面不必同步改其他頁。`Search` 開啟站序面板時捲回頂端，返回清單時（`requestAnimationFrame` 後）還原原本的捲動位置。 |
| **站內導覽應在原視窗切換** | `routeLinks.js` 的 `openRouteSequence()`（`window.open`）改為 `buildRouteSequencePath()`；`StopSection` 以 `useNavigate()` 原視窗切換站序頁，`BusCard` 提示改為「查看全線站序」，`App.jsx` 新增 `ScrollToTop`（PUSH／REPLACE 捲回頂部，POP 保留瀏覽器還原的捲動位置）。Google Maps 外部連結維持 `target="_blank" rel="noopener noreferrer"`。`RouteSequence` 移除 `window.opener`／`window.close()`，返回改以 `history.state.idx`／`history.length` 判斷。 |
| **iOS 每次開啟都要重新點定位** | `useLocation` 新增 `hkb:location-consent`／`hkb:last-location` 記憶：成功定位即寫入，初始化先用快取座標渲染並背景更新；已授權或 Permissions API 回報 `granted` 時自動 `getCurrentPosition`；`PERMISSION_DENIED` 清除授權記憶並提示 iOS 的 Safari「網站設定 › 位置 › 允許」或「加入主畫面」（見 6.10）。 |
| **站名與目的地中英上下堆疊太亂** | 新增 `useLanguage`（`hkb:lang`）：`pickLang()` 只輸出目前語言，`StopSection`／`BusCard`／`RouteStopsPanel`／`RouteSequence`／`Search` 移除英文小字行；UI 文案改用 `t()` 字典（導覽、票價、分鐘、Google Maps、反轉方向、推算、錯誤按鈕等）。 |
| **改成款式 B 毛玻璃設計** | 全站冰藍／午夜漸層背景＋`pointer-events-none` 光暈；頂部改毛玻璃膠囊 Header（`rounded-[22px]`、`bg-white/85 backdrop-blur-xl`），右側 `[中 | EN]` 分段切換與日夜按鈕；`BottomNav` 改底部懸浮島 Dock（`fixed bottom-3 inset-x-4 mx-auto max-w-sm rounded-full`、選中 Tab 藍紫漸層）。 |
| **首頁地圖要置頂，往下滑自動縮小** | `Nearby` 以 `sticky` 容器把地圖貼在 Header 下方常駐（`top: calc(var(--app-header-h) + 0.5rem)`）；`StopMap` 新增 `collapsed`／`onToggleCollapse`，高度 210px↔138px（約 1/3）配 `transition-[height] duration-300 ease-out`，並以 `transitionend`＋保險計時器觸發 `invalidateSize()`。scroll 門檻：`>36` 收起、`<=12` 展開；手動「展開全圖」後要再下滑 >120px 才重新收起。Google Maps 按鈕改為右上常駐毛玻璃膠囊，地圖底部的定位資訊濃縮成單行毛玻璃膠囊（綠點、狀態、重新定位／更新／展開全圖）。 |
| **搜尋／站序頁要有全線軌跡地圖** | `StopMap` 新增 route mode（`routeStops`／`focusedStopId`／`onClearFocus`）：`L.polyline`（#0ea5e9、weight 4）、起點綠終點琥珀、未聚焦時 `fitBounds` 全線、聚焦時 `flyTo` 17 並顯示站名、Google Maps 連結跟隨聚焦站、左上「◎ 顯示全線軌跡」清除聚焦（聚焦時隱藏縮放鈕）。`Search`／`RouteSequence` 以 `React.lazy` 置頂 sticky 顯示地圖；新增 `useMapCollapse` 統一捲動收起（Search 監聽 window、站序頁監聽清單 `onScroll`），`RouteStopsPanel` 以 `topOffset` 把返回列貼在地圖下緣。 |
| **收藏頁要分成站點與路線雙分頁** | `useFavorites` 擴充為站點（沿用 `hkb:favorites:v1`）＋路線（新 key `hkb:favorite-routes:v1`，舊資料逐筆正規化、不覆寫舊 key）兩組 API（`favoriteStops`／`favoriteRoutes`、`isFavoriteStop`／`toggleFavoriteStop`、`isFavoriteRoute`／`toggleFavoriteRoute`，舊名稱保留）。`Search` 搜尋結果卡與 `RouteSequence` 頂部控制列加入星號收藏。`Favorites` 改為款式 B 毛玻璃分段切換器；收藏路線卡以 `getRouteStops`＋目前 GPS 找最近候車站，用 `useBusData` 顯示最近三班車，並可原視窗進入全線站序頁。 |
| **全站視覺統一為款式 B 毛玻璃** | `.card` 改為 `rounded-[22px] border-white/80 bg-white/85 backdrop-blur-xl`＋柔和陰影（深色 slate）；`OperatorBadge` 改玫瑰／琥珀／薄荷圓角膠囊；`BusCard` 路線號碼框 `rounded-[14px]`（聯營／焦點路線用藍紫漸層）；`EtaSlots` 改 14px 膠囊，≤3 分鐘或首班用薄荷綠高光、其餘柔和內嵌玻璃塊；`StopSection` 展開鈕改 28px 圓形玻璃按鈕。 |
| **準備過渡至 Cloudflare Pages** | 移除 Tailwind 已無人使用的 `kmb`／`ctb` 品牌色與 `shadow-card`（改用原生 arbitrary shadow），新增 `public/_redirects`（`/* /index.html 200`）作 SPA fallback；建置後會複製到 `dist/_redirects`，與 GitHub Pages 的 `404.html` 並存。 |

