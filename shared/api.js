/**
 * api.js — 統一的 Graph / SharePoint REST 呼叫層
 *
 * 設計原則
 * 1. 所有函式都透過 getToken() 自動取得 token，呼叫端不需自行處理
 * 2. 啟動時呼叫 initSite() 一次，後續呼叫自動使用快取的 siteId / driveId
 * 3. 上傳檔案只需呼叫 uploadFile()，函式內部判斷大小走不同路徑
 *
 * 使用方式：
 *   import * as API from '../shared/api.js';
 *   await API.initSite();
 *   const items = await API.listItems(LIST_NAME);
 */

import { getToken }                           from './auth.js?v=4';
import { GRAPH_BASE, SP_HOST, SP_SITE_PATH }  from './config.js?v=4';

// ─── 內部快取 ─────────────────────────────────────────────────────────────────
let _siteId         = null;   // SP site GUID
let _siteAssetsId   = null;   // SiteAssets document library drive ID
let _listCache      = {};     // listName → listId

// ─── 低階 fetch 工具 ──────────────────────────────────────────────────────────

/**
 * 帶 Bearer token 的 fetch 封裝
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<Response>}
 */
async function authFetch(url, opts = {}) {
  const token = await getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(opts.headers ?? {}),
  };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    let errBody = '';
    try { errBody = await res.text(); } catch (_) { /* ignore */ }
    throw new Error(`[api] HTTP ${res.status} ${res.statusText} — ${url}\n${errBody}`);
  }
  return res;
}

/**
 * authFetch + JSON 解析
 */
async function graphGet(url) {
  const res = await authFetch(url);
  return res.json();
}

// ─── 初始化（必須在使用前呼叫一次）──────────────────────────────────────────

/**
 * 解析 siteId 與 SiteAssets driveId，結果快取。
 * 建議在 app 進入點呼叫：await API.initSite();
 */
export async function initSite() {
  if (_siteId) return; // 已初始化

  // 1. 取得 siteId
  const siteData = await graphGet(
    `${GRAPH_BASE}/sites/${SP_HOST}:${SP_SITE_PATH}`
  );
  _siteId = siteData.id;

  // 2. 取得 SiteAssets drive ID
  // 注意：SP 中 SiteAssets 的 list 名稱為 "Site Assets"（含空格），
  // 且不會出現在 /drives 清單中，必須直接用 lists/Site%20Assets/drive 存取。
  const siteAssetsData = await graphGet(
    `${GRAPH_BASE}/sites/${_siteId}/lists/Site%20Assets/drive`
  );
  if (!siteAssetsData?.id) throw new Error('[api] 找不到 SiteAssets library');
  _siteAssetsId = siteAssetsData.id;
}

function requireInit() {
  if (!_siteId) throw new Error('[api] 請先呼叫 initSite()');
}

// ─── SharePoint List CRUD ─────────────────────────────────────────────────────

/**
 * 解析 listId（結果快取）
 * @param {string} listName SP 清單顯示名稱
 */
async function resolveListId(listName) {
  if (_listCache[listName]) return _listCache[listName];
  requireInit();
  const data = await graphGet(
    `${GRAPH_BASE}/sites/${_siteId}/lists/${encodeURIComponent(listName)}`
  );
  _listCache[listName] = data.id;
  return data.id;
}

/**
 * 查詢清單項目
 * @param {string} listName
 * @param {object} [opts] - { filter, select, orderby, top, expand }
 * @returns {Promise<object[]>} items
 */
export async function listItems(listName, opts = {}) {
  requireInit();
  const listId = await resolveListId(listName);
  const params = new URLSearchParams();
  if (opts.filter)  params.set('$filter',  opts.filter);
  if (opts.select)  params.set('$select',  opts.select);
  if (opts.orderby) params.set('$orderby', opts.orderby);
  if (opts.top)     params.set('$top',     opts.top);
  if (opts.expand)  params.set('$expand',  opts.expand);

  const qs = params.toString() ? `?${params}` : '';
  const url = `${GRAPH_BASE}/sites/${_siteId}/lists/${listId}/items${qs}`;
  const data = await graphGet(url);
  return data.value ?? [];
}

/**
 * 取得單筆清單項目（含 fields）
 * @param {string} listName
 * @param {number|string} itemId
 * @returns {Promise<object>}
 */
export async function getItem(listName, itemId) {
  requireInit();
  const listId = await resolveListId(listName);
  const data = await graphGet(
    `${GRAPH_BASE}/sites/${_siteId}/lists/${listId}/items/${itemId}?expand=fields`
  );
  return data;
}

/**
 * 新增清單項目
 * @param {string} listName
 * @param {object} fields  欄位 key-value
 * @returns {Promise<object>} 新建的 item
 */
export async function createItem(listName, fields) {
  requireInit();
  const listId = await resolveListId(listName);
  const res = await authFetch(
    `${GRAPH_BASE}/sites/${_siteId}/lists/${listId}/items`,
    {
      method: 'POST',
      body: JSON.stringify({ fields }),
    }
  );
  return res.json();
}

/**
 * 更新清單項目（PATCH，只更新傳入的欄位）
 * @param {string} listName
 * @param {number|string} itemId
 * @param {object} fields  要更新的欄位 key-value
 */
export async function updateItem(listName, itemId, fields) {
  requireInit();
  const listId = await resolveListId(listName);
  await authFetch(
    `${GRAPH_BASE}/sites/${_siteId}/lists/${listId}/items/${itemId}/fields`,
    {
      method: 'PATCH',
      body: JSON.stringify(fields),
    }
  );
}

// ─── 檔案上傳 ─────────────────────────────────────────────────────────────────

/**
 * 上傳檔案到 SiteAssets 下的指定路徑
 * < 4 MB → 單次上傳（PUT）
 * ≥ 4 MB → 分片上傳（upload session）
 *
 * @param {string} remotePath  相對於 SiteAssets 根，例如 '自媒體素材審核/2026-03/42/p1.jpg'
 * @param {File|Blob} file
 * @param {(pct: number) => void} [onProgress]  進度回呼（0–100）
 * @returns {Promise<string>} 上傳後的 webUrl
 */
export async function uploadFile(remotePath, file, onProgress) {
  requireInit();
  const SIZE_LIMIT = 4 * 1024 * 1024; // 4 MB

  if (file.size < SIZE_LIMIT) {
    return _uploadSmall(remotePath, file, onProgress);
  }
  return _uploadLarge(remotePath, file, onProgress);
}

async function _uploadSmall(remotePath, file, onProgress) {
  const encoded = remotePath.split('/').map(encodeURIComponent).join('/');
  const url = `${GRAPH_BASE}/drives/${_siteAssetsId}/root:/${encoded}:/content`;
  const token = await getToken();
  const res = await fetch(url, {
    method:  'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body:    file,
  });
  if (!res.ok) throw new Error(`[api] 上傳失敗 (${res.status}) — ${remotePath}`);
  onProgress?.(100);
  const data = await res.json();
  return data.webUrl;
}

async function _uploadLarge(remotePath, file, onProgress) {
  const encoded = remotePath.split('/').map(encodeURIComponent).join('/');
  const sessionUrl = `${GRAPH_BASE}/drives/${_siteAssetsId}/root:/${encoded}:/createUploadSession`;
  const token = await getToken();

  // 建立 upload session
  const sessionRes = await fetch(sessionUrl, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
  });
  if (!sessionRes.ok) throw new Error('[api] 無法建立 upload session');
  const { uploadUrl } = await sessionRes.json();

  // 分片上傳（每片 5 MB）
  const chunkSize = 5 * 1024 * 1024;
  let offset = 0;
  let webUrl  = '';

  while (offset < file.size) {
    const chunk = file.slice(offset, offset + chunkSize);
    const end   = Math.min(offset + chunkSize - 1, file.size - 1);
    const chunkRes = await fetch(uploadUrl, {
      method:  'PUT',
      headers: {
        'Content-Range':  `bytes ${offset}-${end}/${file.size}`,
        'Content-Length': String(chunk.size),
      },
      body: chunk,
    });
    if (!chunkRes.ok && chunkRes.status !== 202)
      throw new Error(`[api] 分片上傳失敗 (${chunkRes.status})`);

    offset += chunkSize;
    onProgress?.(Math.min(99, Math.round((offset / file.size) * 100)));

    if (chunkRes.status === 200 || chunkRes.status === 201) {
      const data = await chunkRes.json();
      webUrl = data.webUrl;
    }
  }

  onProgress?.(100);
  return webUrl;
}

// ─── 確保目錄存在 ─────────────────────────────────────────────────────────────

/**
 * 確保 SiteAssets 下的資料夾路徑存在（自動逐層建立）
 * @param {string} folderPath  例如 '自媒體素材審核/2026-03/42'
 */
export async function ensureFolder(folderPath) {
  requireInit();
  const token = await getToken();
  const parts  = folderPath.split('/').filter(Boolean);
  let current  = '';

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const encoded = current.split('/').map(encodeURIComponent).join('/');
    const checkUrl = `${GRAPH_BASE}/drives/${_siteAssetsId}/root:/${encoded}`;
    const res = await fetch(checkUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) {
      // 建立此層資料夾
      const parentEncoded = current.includes('/')
        ? current.split('/').slice(0, -1).map(encodeURIComponent).join('/')
        : '';
      const parentUrl = parentEncoded
        ? `${GRAPH_BASE}/drives/${_siteAssetsId}/root:/${parentEncoded}:/children`
        : `${GRAPH_BASE}/drives/${_siteAssetsId}/root/children`;
      await fetch(parentUrl, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: part, folder: {}, '@microsoft.graph.conflictBehavior': 'replace' }),
      });
    }
  }
}

// ─── 讀取 Excel（審核路由表 / 勞工名冊）────────────────────────────────────────

/**
 * 讀取 SiteAssets 下的 Excel，回傳指定 Sheet 的物件陣列（第一列為標題）
 *
 * 實作：直接下載 .xlsx 二進位，用 SheetJS（全域 XLSX）在瀏覽器端解析。
 * 避免使用 Graph Excel Workbook API（需 WAC token，部分租用戶無法取得）。
 *
 * @param {string} excelPath  相對於 SiteAssets，例如 '自媒體素材審核/審核路由表.xlsx'
 * @param {string} [sheetName]  Sheet 名稱，預設第一個 Sheet
 * @returns {Promise<object[]>}  每列轉為 { 標題: 值 } 的物件陣列
 */
export async function readExcel(excelPath, sheetName) {
  requireInit();

  // 確保 SheetJS 已載入
  if (typeof XLSX === 'undefined') {
    await _loadSheetJS();
  }

  const token   = await getToken();
  const encoded = excelPath.split('/').map(encodeURIComponent).join('/');

  // 下載 xlsx 二進位（不使用 Workbook API，避免 WAC token 問題）
  const dlUrl = `${GRAPH_BASE}/drives/${_siteAssetsId}/root:/${encoded}:/content`;
  const res   = await fetch(dlUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`[api] 無法下載 Excel: ${excelPath} (${res.status})`);

  const arrayBuf = await res.arrayBuffer();
  const workbook = XLSX.read(arrayBuf, { type: 'array' });

  const targetSheet = sheetName
    ? workbook.Sheets[sheetName]
    : workbook.Sheets[workbook.SheetNames[0]];
  if (!targetSheet) throw new Error(`[api] 找不到 Sheet: ${sheetName}`);

  // header: 1 → 二維陣列；defval: '' → 空格填空字串
  const rows = XLSX.utils.sheet_to_json(targetSheet, { header: 1, defval: '' });
  if (!rows || rows.length < 2) return [];

  const headers = rows[0];
  return rows.slice(1)
    .filter(row => row.some(v => v !== ''))   // 過濾全空列
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
      return obj;
    });
}

/** 動態載入 SheetJS（如頁面未預先引入） */
function _loadSheetJS() {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload  = resolve;
    s.onerror = () => reject(new Error('[api] 無法載入 SheetJS'));
    document.head.appendChild(s);
  });
}

// ─── 工具函式 ─────────────────────────────────────────────────────────────────

/**
 * 產生本月資料夾名稱，格式 YYYY-MM
 */
export function currentMonthFolder() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
