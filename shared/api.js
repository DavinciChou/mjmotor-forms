/**
 * api.js ??蝯曹???Graph / SharePoint REST ?澆撅? *
 * 閮剛???
 * 1. ??撘?? getToken() ?芸??? token嚗?怎垢銝??芾???
 * 2. ?????initSite() 銝甈∴?敺??澆?芸?雿輻敹怠???siteId / driveId
 * 3. 銝瑼??芷??澆 uploadFile()嚗撘?典?瑕之撠粥銝?頝臬?
 *
 * 雿輻?孵?嚗? *   import * as API from '../shared/api.js';
 *   await API.initSite();
 *   const items = await API.listItems(LIST_NAME);
 */

import { getToken }                           from './auth.js?v=4';
import { GRAPH_BASE, SP_HOST, SP_SITE_PATH }  from './config.js?v=4';

// ??? ?折敹怠? ?????????????????????????????????????????????????????????????????
let _siteId         = null;   // SP site GUID
let _siteAssetsId   = null;   // SiteAssets document library drive ID
let _listCache      = {};     // listName ??listId

// ??? 雿? fetch 撌亙 ??????????????????????????????????????????????????????????

/**
 * 撣?Bearer token ??fetch 撠?
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
    throw new Error(`[api] HTTP ${res.status} ${res.statusText} ??${url}\n${errBody}`);
  }
  return res;
}

/**
 * authFetch + JSON 閫??
 */
async function graphGet(url, extraHeaders = {}) {
  const res = await authFetch(url, { headers: extraHeaders });
  return res.json();
}

// ??? ????敹??其蝙?典??澆銝甈∴???????????????????????????????????????????

/**
 * 閫?? siteId ??SiteAssets driveId嚗??翰?? * 撱箄降??app ?脣暺?恬?await API.initSite();
 */
export async function initSite() {
  if (_siteId) return; // 撌脣?憪?

  // 1. ?? siteId
  const siteData = await graphGet(
    `${GRAPH_BASE}/sites/${SP_HOST}:${SP_SITE_PATH}`
  );
  _siteId = siteData.id;

  // 2. ?? SiteAssets drive ID
  // 瘜冽?嚗P 銝?SiteAssets ??list ?迂??"Site Assets"嚗蝛箸嚗?
  // 銝???曉 /drives 皜銝哨?敹??湔??lists/Site%20Assets/drive 摮???
  const siteAssetsData = await graphGet(
    `${GRAPH_BASE}/sites/${_siteId}/lists/Site%20Assets/drive`
  );
  if (!siteAssetsData?.id) throw new Error('[api] ?曆???SiteAssets library');
  _siteAssetsId = siteAssetsData.id;
}

function requireInit() {
  if (!_siteId) throw new Error('[api] 隢??澆 initSite()');
}

/** 靘??冽芋蝯?敺歇敹怠???siteId */
export function getSiteId() { requireInit(); return _siteId; }

/** 靘??冽芋蝯?亙?敺?Graph auth token */
export async function getAuthToken() { return getToken(); }

// ??? SharePoint List CRUD ?????????????????????????????????????????????????????

/**
 * 閫?? listId嚗??翰??
 * @param {string} listName SP 皜憿舐內?迂
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
 * ?亥岷皜?
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
  const extra = opts.prefer ? { Prefer: opts.prefer } : {};
  const data = await graphGet(url, extra);
  return data.value ?? [];
}

/**
 * ???桃?皜?嚗 fields嚗? * @param {string} listName
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
 * ?啣?皜?
 * @param {string} listName
 * @param {object} fields  甈? key-value
 * @returns {Promise<object>} ?啣遣??item
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
 * ?湔皜?嚗ATCH嚗?湔?喳??雿?
 * @param {string} listName
 * @param {number|string} itemId
 * @param {object} fields  閬?啁?甈? key-value
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

// ??? 瑼?銝 ?????????????????????????????????????????????????????????????????

/**
 * 銝瑼???SiteAssets 銝???頝臬?
 * < 4 MB ???格活銝嚗UT嚗? * ??4 MB ????銝嚗pload session嚗? *
 * @param {string} remotePath  ?詨???SiteAssets ?對?靘? '?芸?擃??祟??2026-03/42/p1.jpg'
 * @param {File|Blob} file
 * @param {(pct: number) => void} [onProgress]  ?脣漲?嚗???00嚗? * @returns {Promise<string>} 銝敺? webUrl
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
  if (!res.ok) throw new Error(`[api] 銝憭望? (${res.status}) ??${remotePath}`);
  onProgress?.(100);
  const data = await res.json();
  return data.webUrl;
}

async function _uploadLarge(remotePath, file, onProgress) {
  const encoded = remotePath.split('/').map(encodeURIComponent).join('/');
  const sessionUrl = `${GRAPH_BASE}/drives/${_siteAssetsId}/root:/${encoded}:/createUploadSession`;
  const token = await getToken();

  // 撱箇? upload session
  const sessionRes = await fetch(sessionUrl, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
  });
  if (!sessionRes.ok) throw new Error('[api] ?⊥?撱箇? upload session');
  const { uploadUrl } = await sessionRes.json();

  // ??銝嚗???5 MB嚗?  const chunkSize = 5 * 1024 * 1024;
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
      throw new Error(`[api] ??銝憭望? (${chunkRes.status})`);

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

// ??? 蝣箔??桅?摮 ?????????????????????????????????????????????????????????????

/**
 * 蝣箔? SiteAssets 銝?鞈?憭曇楝敺??剁??芸??惜撱箇?嚗? * @param {string} folderPath  靘? '?芸?擃??祟??2026-03/42'
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
      // 撱箇?甇文惜鞈?憭?      const parentEncoded = current.includes('/')
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

// ??? 霈??Excel嚗祟?貉楝?梯” / ?極??嚗????????????????????????????????????????

/**
 * 霈??SiteAssets 銝? Excel嚗??單?摰?Sheet ?隞園??蝚砌??璅?嚗? *
 * 撖虫?嚗?乩?頛?.xlsx 鈭脖?嚗 SheetJS嚗??XLSX嚗?汗?函垢閫???? * ?踹?雿輻 Graph Excel Workbook API嚗? WAC token嚗???冽?⊥???嚗? *
 * @param {string} excelPath  ?詨???SiteAssets嚗?憒?'?芸?擃??祟??撖拇頝舐銵?xlsx'
 * @param {string} [sheetName]  Sheet ?迂嚗?閮剔洵銝??Sheet
 * @returns {Promise<object[]>}  瘥?頧 { 璅?: ??} ?隞園?? */
export async function readExcel(excelPath, sheetName) {
  requireInit();

  // 蝣箔? SheetJS 撌脰???  if (typeof XLSX === 'undefined') {
    await _loadSheetJS();
  }

  const token   = await getToken();
  const encoded = excelPath.split('/').map(encodeURIComponent).join('/');

  // 銝? xlsx 鈭脖?嚗?雿輻 Workbook API嚗??WAC token ??嚗?  const dlUrl = `${GRAPH_BASE}/drives/${_siteAssetsId}/root:/${encoded}:/content`;
  const res   = await fetch(dlUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`[api] ?⊥?銝? Excel: ${excelPath} (${res.status})`);

  const arrayBuf = await res.arrayBuffer();
  const workbook = XLSX.read(arrayBuf, { type: 'array' });

  const targetSheet = sheetName
    ? workbook.Sheets[sheetName]
    : workbook.Sheets[workbook.SheetNames[0]];
  if (!targetSheet) throw new Error(`[api] ?曆???Sheet: ${sheetName}`);

  // header: 1 ??鈭雁???嚗efval: '' ??蝛箸憛怎征摮葡
  const rows = XLSX.utils.sheet_to_json(targetSheet, { header: 1, defval: '' });
  if (!rows || rows.length < 2) return [];

  const headers = rows[0];
  return rows.slice(1)
    .filter(row => row.some(v => v !== ''))   // ?蕪?函征??    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
      return obj;
    });
}

/** ??頛 SheetJS嚗???芷????伐? */
function _loadSheetJS() {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload  = resolve;
    s.onerror = () => reject(new Error('[api] ?⊥?頛 SheetJS'));
    document.head.appendChild(s);
  });
}

// ??? 撌亙?賢? ?????????????????????????????????????????????????????????????????

/**
 * ?Ｙ??祆?鞈?憭曉?蝔梧??澆? YYYY-MM
 */
export function currentMonthFolder() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
