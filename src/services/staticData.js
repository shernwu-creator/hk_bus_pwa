/**
 * 靜態資料載入層（IndexedDB 快取）
 * ------------------------------------------------------------------
 * 城巴／小巴的站點索引動輒數百 KB，若用 `import ... from './data/*.json'`
 * 打包進主程式，會直接拖慢首次繪製 (FCP)。因此：
 *
 *   1. 建置前由 `npm run sync:data` 產生 public/data/*.json（不進 JS bundle）；
 *   2. 前端第一次需要時才 fetch；
 *   3. 抓到的內容寫入 IndexedDB（`hkb-static` / `assets`），有效期內不再連網。
 *
 * IndexedDB 不可用（例如某些無痕模式）時會退回「只快取在記憶體」，
 * 功能仍可運作，只是每次開啟 App 都要重新下載。
 */

const DB_NAME = 'hkb-static'
const DB_VERSION = 1
const STORE_NAME = 'assets'

/** 靜態索引預設有效期：6 小時（站點異動不頻繁，過期後才重新下載） */
export const STATIC_DATA_TTL = 6 * 60 * 60 * 1000

/** 同一次瀏覽階段內的記憶體快取，避免重複解析 JSON */
const memory = new Map()

let dbPromise = null

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve) => {
    let request
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })

  return dbPromise
}

function readRecord(key) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) {
          resolve(null)
          return
        }
        try {
          const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
          request.onsuccess = () => resolve(request.result ?? null)
          request.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

function writeRecord(record) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) {
          resolve(false)
          return
        }
        try {
          const transaction = db.transaction(STORE_NAME, 'readwrite')
          transaction.objectStore(STORE_NAME).put(record)
          transaction.oncomplete = () => resolve(true)
          transaction.onerror = () => resolve(false)
          transaction.onabort = () => resolve(false)
        } catch {
          resolve(false)
        }
      }),
  )
}

/** public/data/ 內的檔案網址（會自動帶上部署子路徑，例如 /hk_bus_pwa/） */
export function staticDataUrl(name) {
  return `${import.meta.env.BASE_URL}data/${name}`
}

/**
 * 讀取靜態 JSON：記憶體 → IndexedDB（有效期內）→ 網絡
 *
 * @param {string} name public/data/ 內的檔名，例如 `citybus-stops.json`
 * @param {{maxAge?: number}} [options]
 * @returns {Promise<any>}
 */
export async function loadStaticData(name, { maxAge = STATIC_DATA_TTL } = {}) {
  if (memory.has(name)) return memory.get(name)

  const record = await readRecord(name)
  if (record && Date.now() - record.savedAt < maxAge) {
    memory.set(name, record.data)
    return record.data
  }

  try {
    const response = await fetch(staticDataUrl(name), { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    memory.set(name, data)
    // 寫入失敗（quota、私密模式）不影響本次使用
    await writeRecord({ key: name, savedAt: Date.now(), data })
    return data
  } catch (error) {
    // 網絡失敗但仍有舊快照時，寧可顯示舊站點資料也不要整頁失敗
    if (record) {
      memory.set(name, record.data)
      return record.data
    }
    throw new Error(`無法載入靜態資料 ${name}：${error.message}`)
  }
}
