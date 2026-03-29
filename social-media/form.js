/**
 * social-media/form.js — 自媒體素材審核申請表單（申請人端）
 *
 * 職責：
 *  1. 初始化 → SSO 登入 → 從 Excel 讀取審核路由表 + 勞工名冊
 *  2. 自動帶入姓名、Email、據點（依勞工名冊 Column C）
 *  3. 據點確定後自動帶出三關審核人
 *  4. 驗證 → 上傳媒體（照片/影片/附件）→ 寫入 SP List → 確認畫面
 *
 * 審核路由表格式（審核路由表.xlsx，Sheet1）：
 *   | 據點 | 所長 | 所長信箱 | 行銷 | 行銷信箱 | 部長 | 部長信箱 |
 *
 * 勞工名冊格式（勞工名冊.xlsx）：
 *   Column A = 姓名, Column B = Email（或同類欄位）, Column C = 部門（據點）
 *
 * 媒體命名規則：
 *   照片  → p1.{ext} / p2.{ext}（最多 2 張）
 *   影片  → 保留原檔名
 *   附件  → 保留原檔名
 *
 * 目錄結構（SiteAssets/）：
 *   自媒體素材審核/{YYYY-MM}/{itemId}/p1.jpg
 *                                    /p2.png
 *                                    /video.mp4
 *                                    /attachment.pdf
 */

import { loginIfNeeded, getCurrentUser } from '../shared/auth.js?v=5';
import * as API                          from '../shared/api.js?v=5';
import * as UI                           from '../shared/ui.js?v=5';
import { SOCIAL }                        from '../shared/config.js?v=5';

// ─── 全域狀態 ──────────────────────────────────────────────────────────────────
let _routeTable  = [];   // 審核路由表（從 Excel 載入）
let _photoFiles  = [];   // 已選取的照片 File[]（最多 2）
let _videoFiles  = [];   // 已選取的影片 File[]
let _attachFiles = [];   // 已選取的附件 File[]

// ─── 進入點 ───────────────────────────────────────────────────────────────────

(async () => {
  try {
    UI.showLoading('登入中…');
    await loginIfNeeded();               // 若未登入則 redirect（不會繼續執行）

    UI.showLoading('初始化中…');
    await API.initSite();                // 解析 siteId / driveId

    UI.showLoading('載入審核資料…');
    await loadRouteTable();              // 讀取路由表

    fillApplicantInfo();                 // 填入 SSO 使用者資料（姓名、Email）
    await autoFillLocation();            // 從勞工名冊帶入據點
    bindEvents();                        // 綁定表單事件
    UI.hideLoading();

  } catch (err) {
    UI.hideLoading();
    UI.showError(`初始化失敗：${err.message}`);
    console.error('[form] init error', err);
  }
})();

// ─── 載入路由表 ───────────────────────────────────────────────────────────────

async function loadRouteTable() {
  const rows = await API.readExcel(SOCIAL.ROUTE_TABLE_PATH);
  _routeTable = rows.filter(r => r['據點']);  // 過濾空行
}

// ─── 自動填入申請人資訊 ───────────────────────────────────────────────────────

function fillApplicantInfo() {
  const user = getCurrentUser();
  if (!user) return;

  // 更新顯示用 div
  setAutoField('applicant-name-display',  user.name);
  setAutoField('applicant-email-display', user.email, true);

  // 更新隱藏 input（供 collectFields 讀取）
  setVal('applicant-name',  user.name);
  setVal('applicant-email', user.email);

  // 第一關申請人名稱
  setText('stage1-person', user.name);
}

// ─── 部門 → 路由表據點名稱對映 ──────────────────────────────────────────────
// 勞工名冊 Column C（部門）可能出現廠或所，統一對映到路由表的據點名稱
const LOCATION_MAP = {
  '銘勁八德廠': '銘勁八德所',
  '銘勁八德所': '銘勁八德所',
  '銘勁中壢廠': '銘勁中壢所',
  '銘勁中壢所': '銘勁中壢所',
  '銘勁桃園廠': '銘勁桃園所',
  '銘勁桃園所': '銘勁桃園所',
};

// ─── 據點自動帶入（從勞工名冊 Excel 的「勞工名冊」Sheet 查詢）────────────────

async function autoFillLocation() {
  const user = getCurrentUser();
  if (!user) return;

  try {
    // 讀勞工名冊，指定 Sheet 名稱「勞工名冊」
    const rows = await API.readExcel(SOCIAL.ROSTER_PATH, '勞工名冊');

    // 以姓名比對（名冊無 Email 欄）
    const myRecord = rows.find(r =>
      String(r['姓名'] || '').trim() === String(user.name || '').trim()
    );

    const dept     = String(myRecord?.['部門'] || '').trim();
    const location = LOCATION_MAP[dept] || '';

    if (!location) {
      // 部門無法對映到單一據點（如銘勁總經理、銘勁服務部等）→ 讓使用者手動選
      showLocationDropdown();
      return;
    }

    // 成功 → 鎖定顯示
    setAutoField('location-display', location);
    setVal('location', location);
    applyLocation(location);

  } catch (err) {
    console.warn('[form] autoFillLocation failed', err);
    showLocationDropdown();
  }
}

/** 自動帶入失敗時，隱藏 auto-field，顯示手動 dropdown */
function showLocationDropdown() {
  const display = document.getElementById('location-display');
  const select  = document.getElementById('location-select');
  if (display) display.style.display = 'none';
  if (select)  select.style.display  = 'block';
  select?.addEventListener('change', e => {
    setVal('location', e.target.value);
    if (e.target.value) applyLocation(e.target.value);
    else clearReviewers();
  });
}

// ─── 根據據點帶出三關審核人 ───────────────────────────────────────────────────

function applyLocation(location) {
  const row = _routeTable.find(r => r['據點'] === location);
  if (!row) { clearReviewers(); return; }
  setReviewer(2, row['所長']  || '', row['所長信箱']  || '');
  setReviewer(3, row['行銷']  || '', row['行銷信箱']  || '');
  setReviewer(4, row['部長']  || '', row['部長信箱']  || '');
}

function setReviewer(n, name, email) {
  // 更新 stage chip 姓名（email 不顯示於畫面）
  setText(`reviewer${n}-name`, name || '—');
  // 隱藏 input（供 collectFields 讀取）
  setVal(`reviewer${n}-name-val`,  name);
  setVal(`reviewer${n}-email-val`, email);
}

function clearReviewers() {
  [2, 3, 4].forEach(n => setReviewer(n, '', ''));
}

// ─── 綁定事件 ─────────────────────────────────────────────────────────────────

function bindEvents() {
  // 照片上傳（最多 2 張）
  document.getElementById('photo-input')?.addEventListener('change', e => {
    handleFileSelect(e, 'photo', SOCIAL.PHOTO_EXTS, 2);
  });

  // 影片上傳（最多 1 支）
  document.getElementById('video-input')?.addEventListener('change', e => {
    handleFileSelect(e, 'video', SOCIAL.VIDEO_EXTS, 1);
  });

  // 附件上傳（最多 3 個）
  document.getElementById('attach-input')?.addEventListener('change', e => {
    handleFileSelect(e, 'attach', SOCIAL.ATTACH_EXTS, 3);
  });

  // 送出按鈕
  document.getElementById('submit-btn')?.addEventListener('click', onSubmit);

  // 清除各檔案的 input（點 × 按鈕）
  document.getElementById('photo-list')?.addEventListener('click', e => {
    if (e.target.dataset.remove) removeFile('photo', Number(e.target.dataset.remove));
  });
  document.getElementById('video-list')?.addEventListener('click', e => {
    if (e.target.dataset.remove) removeFile('video', Number(e.target.dataset.remove));
  });
  document.getElementById('attach-list')?.addEventListener('click', e => {
    if (e.target.dataset.remove) removeFile('attach', Number(e.target.dataset.remove));
  });
}

// ─── 檔案選取與驗證 ───────────────────────────────────────────────────────────

/**
 * @param {Event}    e
 * @param {'photo'|'video'|'attach'} type
 * @param {string[]} allowedExts
 * @param {number}   maxCount
 */
function handleFileSelect(e, type, allowedExts, maxCount) {
  const files = Array.from(e.target.files ?? []);
  const store = type === 'photo' ? _photoFiles
              : type === 'video' ? _videoFiles
              :                    _attachFiles;

  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!allowedExts.includes(ext)) {
      UI.showToast(`不支援的格式：${file.name}`, 'error');
      continue;
    }
    if (store.length >= maxCount) {
      UI.showToast(`最多 ${maxCount} 個${type === 'photo' ? '照片' : type === 'video' ? '影片' : '附件'}`, 'warning');
      break;
    }
    store.push(file);
  }

  // 重設 input 讓同樣檔案可以再次選取
  e.target.value = '';
  renderFileList(type);
}

function removeFile(type, idx) {
  const store = type === 'photo' ? _photoFiles
              : type === 'video' ? _videoFiles
              :                    _attachFiles;
  store.splice(idx, 1);
  renderFileList(type);
}

function renderFileList(type) {
  const store  = type === 'photo' ? _photoFiles
               : type === 'video' ? _videoFiles
               :                    _attachFiles;
  const listId = `${type}-list`;
  const list   = document.getElementById(listId);
  if (!list) return;

  list.innerHTML = store.map((f, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;
      background:#f7fafc;border-radius:5px;font-size:12px;">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</span>
      <span style="color:#718096;font-size:11px;">${formatBytes(f.size)}</span>
      <button data-remove="${i}" style="
        border:none;background:none;color:#e53e3e;cursor:pointer;
        font-size:15px;line-height:1;padding:0 3px;">×</button>
    </div>`).join('');
}

function formatBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── 表單驗證 ─────────────────────────────────────────────────────────────────

function validate() {
  const errors = [];

  // 據點（隱藏 input，自動帶入）
  if (!getVal('location')) {
    errors.push('無法取得據點資訊，請重新整理頁面');
  }

  // 必填欄位
  const required = [
    ['platform',   '請選擇發布平台'],
    ['post-title', '請填寫貼文標題'],
    ['post-date',  '請選擇預計發布日期'],
  ];
  for (const [id, msg] of required) {
    const el = document.getElementById(id);
    if (!el?.value?.trim()) {
      errors.push(msg);
      UI.markInvalid(el, msg);
    } else {
      UI.clearInvalid(el);
    }
  }

  // 審核人 Email 必須有（由路由表自動填入）
  if (!getVal('reviewer2-email-val')) {
    errors.push('找不到所長 Email，請確認據點設定');
  }

  return errors;
}

// ─── 送出 ─────────────────────────────────────────────────────────────────────

async function onSubmit() {
  const errors = validate();
  if (errors.length > 0) {
    UI.showError(errors[0]);
    return;
  }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;

  try {
    UI.showLoading('建立申請紀錄…');

    // 1. 先建立 SP List 項目（取得 itemId）
    const fields  = collectFields();
    const newItem = await API.createItem(SOCIAL.LIST_NAME, {
      ...fields,
      [SOCIAL.FIELD.STAGE]:        SOCIAL.STAGE.STAGE2,   // 等待所長審核
      [SOCIAL.FIELD.STATUS]:       SOCIAL.STAGE.PENDING,  // 送審中
      [SOCIAL.FIELD.SUBMITTED_AT]: new Date().toISOString(),
    });
    const itemId = newItem.id;

    // 2. 確保媒體目錄存在
    const monthFolder = API.currentMonthFolder();
    const mediaFolder = `${SOCIAL.MEDIA_ROOT}/${monthFolder}/${itemId}`;
    await API.ensureFolder(mediaFolder);

    // 3. 上傳媒體檔案
    UI.showLoading('上傳媒體檔案…');
    const mediaPaths = await uploadMedia(mediaFolder, itemId);

    // 4. 回寫媒體路徑到 List
    await API.updateItem(SOCIAL.LIST_NAME, itemId, {
      [SOCIAL.FIELD.MEDIA_PATHS]: JSON.stringify({
        photos:      mediaPaths.photos,
        attachments: mediaPaths.attachments,
      }),
      [SOCIAL.FIELD.VIDEO_PATHS]: JSON.stringify(mediaPaths.videos),
    });

    UI.hideLoading();
    showConfirmScreen(itemId);

  } catch (err) {
    UI.hideLoading();
    UI.showError(`送出失敗：${err.message}`);
    console.error('[form] submit error', err);
    btn.disabled = false;
  }
}

// ─── 收集表單欄位 ─────────────────────────────────────────────────────────────

function collectFields() {
  return {
    [SOCIAL.FIELD.TITLE]:           getVal('post-title'),
    [SOCIAL.FIELD.APPLICANT_NAME]:  getVal('applicant-name'),
    [SOCIAL.FIELD.APPLICANT_EMAIL]: getVal('applicant-email'),
    [SOCIAL.FIELD.LOCATION]:        getVal('location'),
    [SOCIAL.FIELD.PLATFORM]:        getVal('platform'),
    [SOCIAL.FIELD.SHOOT_DATE]:      getVal('post-date'),
    [SOCIAL.FIELD.CONTENT]:         getVal('caption'),
    // reviewer 資料讀取隱藏 input（-val 後綴）
    [SOCIAL.FIELD.REVIEWER2_NAME]:  getVal('reviewer2-name-val'),
    [SOCIAL.FIELD.REVIEWER2_EMAIL]: getVal('reviewer2-email-val'),
    [SOCIAL.FIELD.REVIEWER3_NAME]:  getVal('reviewer3-name-val'),
    [SOCIAL.FIELD.REVIEWER3_EMAIL]: getVal('reviewer3-email-val'),
    [SOCIAL.FIELD.REVIEWER4_NAME]:  getVal('reviewer4-name-val'),
    [SOCIAL.FIELD.REVIEWER4_EMAIL]: getVal('reviewer4-email-val'),
  };
}

// ─── 上傳媒體 ─────────────────────────────────────────────────────────────────

/**
 * 依序上傳照片（p1/p2）、影片、附件
 * @returns {Promise<object>} { photos: [...], videos: [...], attachments: [...] }
 */
async function uploadMedia(mediaFolder, itemId) {
  const result = { photos: [], videos: [], attachments: [] };

  // 照片：重新命名為 p1.{ext} / p2.{ext}
  for (let i = 0; i < _photoFiles.length; i++) {
    const file = _photoFiles[i];
    const ext  = file.name.split('.').pop().toLowerCase();
    const remoteName = `p${i + 1}.${ext}`;
    UI.showLoading(`上傳照片 ${i + 1}/${_photoFiles.length}…`);
    const url = await API.uploadFile(
      `${mediaFolder}/${remoteName}`,
      file,
      pct => UI.showLoading(`上傳照片 ${i + 1}… ${pct}%`)
    );
    result.photos.push({ name: remoteName, url });
  }

  // 影片：保留原檔名
  for (let i = 0; i < _videoFiles.length; i++) {
    const file = _videoFiles[i];
    UI.showLoading(`上傳影片 ${i + 1}/${_videoFiles.length}…`);
    const url = await API.uploadFile(
      `${mediaFolder}/${file.name}`,
      file,
      pct => UI.showLoading(`上傳影片 ${i + 1}… ${pct}%`)
    );
    result.videos.push({ name: file.name, url });
  }

  // 附件：保留原檔名
  for (let i = 0; i < _attachFiles.length; i++) {
    const file = _attachFiles[i];
    UI.showLoading(`上傳附件 ${i + 1}/${_attachFiles.length}…`);
    const url = await API.uploadFile(
      `${mediaFolder}/${file.name}`,
      file,
      pct => UI.showLoading(`上傳附件 ${i + 1}… ${pct}%`)
    );
    result.attachments.push({ name: file.name, url });
  }

  return result;
}

// ─── 確認畫面 ─────────────────────────────────────────────────────────────────

function showConfirmScreen(itemId) {
  const form    = document.getElementById('form-section');
  const confirm = document.getElementById('confirm-section');
  if (form)    form.style.display    = 'none';
  if (confirm) confirm.style.display = 'block';

  const idEl = document.getElementById('confirm-item-id');
  if (idEl) idEl.textContent = `#${itemId}`;

  const tracker = document.getElementById('confirm-tracker');
  if (tracker) {
    UI.renderTracker(tracker, SOCIAL.STAGE.STAGE2, SOCIAL.STAGE.PENDING);
  }
}

// ─── 工具函式 ─────────────────────────────────────────────────────────────────

function getVal(id) {
  return document.getElementById(id)?.value?.trim() ?? '';
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** 更新 .auto-field div 並移除 loading 狀態 */
function setAutoField(id, text, smallFont = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('loading');
  el.innerHTML = `<span${smallFont ? ' style="font-size:11px;"' : ''}>${text}</span> <span class="lock">🔒</span>`;
}

/** 設為錯誤狀態（保留 loading 樣式，顯示提示） */
function setAutoFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('loading');
  el.textContent = msg;
}
