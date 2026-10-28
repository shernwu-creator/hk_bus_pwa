# 香港巴士實時到站｜HK Bus ETA (PWA)

以 GPS 定位查詢香港九巴 (KMB) 與城巴 (CTB) 站點的 PWA：附近站點、路線搜尋、票價與最近三班車到站倒數，支援離線開啟（App Shell）與深色模式。

資料全部來自 [DATA.GOV.HK](https://data.gov.hk/) 的公開 API，本專案非官方產品。

---

## 1. 快速開始

```bash
npm install          # 或 pnpm install
npm run dev          # http://localhost:5173
npm run build        # 產出 dist/（含 sw.js、manifest.webmanifest）
npm run preview      # 以靜態伺服器驗證 PWA 行為
npm run lint         # oxlint
```

> 定位功能只在 `https` 或 `localhost` 下可用；其他來源會自動退回預設座標（尖沙咀天星碼頭）。

### 資料同步腳本

```bash
npm run sync:data      # 重建城巴站點索引 ＋ 票價表（需連線）
npm run sync:fares     # 只重建票價表
npm run generate:icons # 重新產生 public/ 內的 PNG 圖示（純 Node，無外部依賴）
```

`sync:data` 約需 1～3 分鐘（城巴 400 多條路線 × 2 方向逐一抓取）。建議每季或發現城巴站點有異動時執行一次。

---

## 2. 使用到的 API

| 用途 | 端點 |
| --- | --- |
| 九巴全部站點 | `https://data.etabus.gov.hk/v1/transport/kmb/stop` |
| 九巴路線清單 | `https://data.etabus.gov.hk/v1/transport/kmb/route/` |
| 九巴路線站序 | `https://data.etabus.gov.hk/v1/transport/kmb/route-stop/{route}/{direction}/{serviceType}` |
| 九巴站點 ETA（一次取全部路線） | `https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/{stopId}` |
| 城巴路線清單 | `https://rt.data.gov.hk/v2/transport/citybus/route/CTB` |
| 城巴路線站序 | `https://rt.data.gov.hk/v2/transport/citybus/route-stop/CTB/{route}/{outbound\|inbound}` |
| 城巴單一站點 | `https://rt.data.gov.hk/v2/transport/citybus/stop/{stopId}` |
| 城巴 ETA（一次一條路線） | `https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/{route}/{stopId}` |
| 票價（運輸署 XML） | `https://static.data.gov.hk/td/routes-fares-xml/ROUTE_BUS.xml` |

**兩個業者的資料模型差異（重要）**

- 九巴：有「全部站點」與「站點 → 全部路線 ETA」的端點，一個站一次請求就能拿到所有路線的到站時間。
- 城巴：**沒有**全部站點端點、**也沒有**站點層級的 ETA 端點。因此：
  - 站點清單與「站點 → 經過路線」由 `npm run sync:data` 先掃過所有路線的 `route-stop`，建成 `src/data/citybus-stops.json`；
  - 查 ETA 時只能逐條路線打，前端限制每次最多 8 條路線、併發 4 個請求（`getCitybusStopEtas`）。

---

## 3. 程式結構

```
src/
├─ main.jsx                  # 掛載 App、註冊 Service Worker（vite-plugin-pwa）
├─ App.jsx                   # Router + 版面（Header／BottomNav）
├─ index.css                 # Tailwind 進入點與共用樣式（.card / .chip）
├─ pages/
│  ├─ Nearby.jsx             # 附近站點：定位 → 半徑篩選 → 展開查 ETA
│  ├─ Search.jsx             # 路線搜尋：路線 → 方向 → 站序 → ETA
│  └─ Favorites.jsx          # 已收藏站點（localStorage）
├─ components/
│  ├─ BusCard.jsx            # 路線卡片：業者、目的地、票價、三班倒數
│  ├─ StopSection.jsx        # 可展開的站點區塊（收藏星星、站序徽章）
│  ├─ RouteStopsPanel.jsx    # 搜尋頁的站序清單
│  ├─ SearchBar.jsx / OperatorBadge.jsx / BottomNav.jsx
│  └─ StateViews.jsx         # Skeleton / ErrorState / EmptyState
├─ hooks/
│  ├─ useLocation.js         # Geolocation + 權限/錯誤狀態 + 預設座標
│  ├─ useBusData.js          # ETA 抓取與 30 秒輪詢（切到背景會暫停）
│  ├─ useFavorites.js        # localStorage「hkb:favorites:v1」
│  └─ useTheme.js            # 深色模式「hkb:theme」＋ html.dark
├─ services/api.js           # 快取、站點、路線、票價、ETA 全部集中在這裡
├─ data/
│  ├─ citybus-stops.json     # 由 sync:data 產生（請勿手改）
│  └─ fares.json             # 由 sync:data 產生（請勿手改）
└─ utils/format.js           # 距離／時間／分鐘／服務類型文字

scripts/
├─ sync-data.mjs             # 城巴站點索引 + 運輸署票價表
└─ generate-icons.mjs        # 產生 PWA PNG 圖示（自製 PNG 編碼器）
```

---

## 4. 資料流與規則

### 4.1 三層快取（`services/api.js`）

```
記憶體 Map → localStorage（key: hkb:cache:*）→ 網絡
```

- 站點／路線索引 TTL 12 小時；ETA 不快取（每次都打 API）。
- `withCache()` 會把結果寫回 localStorage，重新整理頁面仍可秒開站點清單。

### 4.2 附近站點

`getNearbyStops({ lat, lng, radius, limit })`：

1. 以 Haversine 計算九巴 6,700+ 站點與城巴索引站點的距離，取半徑內者。
2. 依距離排序後，**同業者 + 同站名 + 120 公尺內**的站牌視為同一車站（九巴一個總站常有多個月台編號，例如「尖沙咀碼頭,海港城 (YT905)」～`(YT915)`）。
   - 站名會去掉結尾的 `(YY123)` 月台代號再顯示；
   - 其餘月台編號存進 `siblingIds`，查 ETA 時一併合併（每站最多再多查 5 個站牌）。
3. 不同業者即使座標相同也**不合併**，因為 ETA 來源不同。

### 4.3 ETA 合併

`groupEtaRows()` 把 API 的「一列一班車」整理成「一條路線一筆」：

- key 為 `路線|方向`（刻意不含 `service_type`：部分路線如 5C 同時有 `service_type` 1 與 2、到站時間相同，若分開會重複顯示兩張卡片）。
- 每筆保留最多 3 班車（`ETA_PER_ROUTE`）與 `nextMinutes` 供排序。
- 合併多個月台時（`mergeEtaGroups`），同一路線＋方向只留一筆，依實際到站時間排序，時間差小於 60 秒者視為同一班車。

### 4.4 票價

`getFare(operator, route, serviceType)` 查 `fares.json`（key：`路線|service_type`），查不到回傳 `null`，UI 顯示「票價待查」而不是錯誤數字。共同營運的路線會同時提供 KMB 與 CTB 兩份資料。

---

## 5. PWA 設定

- `vite.config.js`：`registerType: 'autoUpdate'`、`injectRegister: null`（由 `src/main.jsx` 手動註冊）。
- 執行期快取：`data.etabus.gov.hk` 與 `rt.data.gov.hk` 皆為 `NetworkFirst`（8 秒逾時），斷網時仍能看到最後一次資料。
- 圖示：`public/pwa-192x192.png`、`pwa-512x512.png`、`pwa-maskable-512x512.png`、`apple-touch-icon.png`，皆由 `npm run generate:icons` 產生。
- 驗證方式：`npm run build && npm run preview`，在 DevTools → Application 檢查 Manifest 與 Service Worker。

---

## 6. 已知限制

- **城巴 ETA 可能整批空白**：`rt.data.gov.hk` 的城巴 ETA 回應偶爾回傳空的 `data`（此時 UI 顯示「暫無到站資料」）。九巴資料不受影響。
- 城巴站點索引是「快照」，新開辦的路線／新站點要重跑 `npm run sync:data` 才會出現。
- 城巴站點若在索引中缺少路線清單，`getCitybusStopEtas()` 會拋出「缺少路線資料」錯誤（重新同步即可）。
- 票價為運輸署提供的**全程收費**，非分段收費。
- 目前只支援九巴與城巴，未包含龍運、新大嶼山巴士與港鐵巴士。

---

## 7. 後續可延伸

- 站點／路線分享連結（`/stop/:operator/:id`）。
- 收藏路線（目前只收藏站點）與到站提醒通知（Notification API）。
- 以 `IntersectionObserver` 延遲載入長站序清單。
- 將 `src/data/*.json` 改為建置時遠端抓取，避免 repo 內含大檔（目前 `citybus-stops.json` 約 350 KB）。
