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

import { loginIfNeeded, getCurrentUser } from '../shared/auth.js?v=10';
import * as API                          from '../shared/api.js?v=12';
import * as UI                           from '../shared/ui.js?v=11';
import { SOCIAL }                        from '../shared/config.js?v=10';

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

    loadMyApplications();               // 非同步載入申請紀錄（不阻塞主流程）

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
    // 讀勞工名冊，指定 Sheet 名稱（另存的純值 sheet 為「工作表1」）
    const rows = await API.readExcel(SOCIAL.ROSTER_PATH, '工作表1');

    // 以姓名比對（名冊無 Email 欄）
    const myRecord = rows.find(r =>
      String(r['姓名'] || '').trim() === String(user.name || '').trim()
    );

    const dept = String(myRecord?.['部門'] || '').trim();

    // 1. 先查 LOCATION_MAP（廠 / 所 名稱正規化）
    let location = LOCATION_MAP[dept] || '';

    // 2. LOCATION_MAP 沒有對應時，直接用部門名稱去路由表查
    //    （例如「銘勁總經理」部門在路由表有專屬一行）
    if (!location && _routeTable.find(r => r['據點'] === dept)) {
      location = dept;
    }

    if (!location) {
      // 路由表也找不到 → fallback 手動下拉
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
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</span>
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
    [SOCIAL.FIELD.PUBLISH_DATE]:    getVal('post-date'),
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

  const reviewLink = document.getElementById('confirm-review-link');
  if (reviewLink) reviewLink.href = `review.html?id=${itemId}`;

  const tracker = document.getElementById('confirm-tracker');
  if (tracker) {
    UI.renderTracker(tracker, SOCIAL.STAGE.STAGE2, SOCIAL.STAGE.PENDING, {}, {
      applicant: getVal('applicant-name'),
      reviewer2: getVal('reviewer2-name-val'),
      reviewer3: getVal('reviewer3-name-val'),
      reviewer4: getVal('reviewer4-name-val'),
    });
  }

  // 送出後重新整理紀錄清單（帶入最新一筆）
  loadMyApplications();
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

// ─── 我的申請紀錄 ──────────────────────────────────────────────────────────────

/**
 * 從 SP 查詢目前登入者的申請紀錄，渲染至 #my-apps-card。
 * 非同步執行，不阻塞主表單初始化。
 */
async function loadMyApplications() {
  const card   = document.getElementById('my-apps-card');
  const list   = document.getElementById('my-apps-list');
  const outer  = document.getElementById('myAppsOuter');
  const scroll = document.getElementById('myAppsScroll');
  const countEl = document.getElementById('my-apps-count');
  if (!card || !list) return;

  // 顯示卡片（skeleton 已在 HTML 裡）
  card.style.display = '';

  try {
    const { getCurrentUser } = await import('../shared/auth.js?v=11');
    const user = getCurrentUser();
    if (!user?.email) return;          // 尚未登入則跳過

    const email = user.email;
    const items = await API.listItems(SOCIAL.LIST_NAME, {
      filter:  `fields/ApplicantEmail eq '${email}'`,
      expand:  'fields($select=Title,Platform,Stage,Status,SubmittedAt)',
      orderby: 'fields/SubmittedAt desc',
      top:     '20',
      prefer:  'HonorNonIndexedQueriesWarningMayFailRandomly',
    });

    // 更新筆數
    if (countEl) countEl.textContent = items.length ? `${items.length} 筆` : '';

    // 空狀態
    if (!items.length) {
      list.innerHTML = `
        <div style="text-align:center;padding:24px 0;color:var(--sub);font-size:13px;">
          <div style="font-size:28px;margin-bottom:8px;">📭</div>
          目前沒有申請紀錄
        </div>`;
      if (outer) outer.classList.add('no-more');
      return;
    }

    // 渲染紀錄
    list.innerHTML = items.map(item => {
      const f       = item.fields || {};
      const stage   = f.Stage  ?? '';
      const status  = f.Status ?? '';
      const title   = f.Title  ?? '（無標題）';
      const platform = f.Platform ?? '';
      const dateStr  = f.SubmittedAt
        ? f.SubmittedAt.slice(0, 10).replace(/-/g, '/')
        : '';

      // badge 判斷
      let badgeClass, badgeText, dotClass, desc;
      if (status === SOCIAL.STAGE.APPROVED || stage === SOCIAL.STAGE.APPROVED) {
        badgeClass = 'badge-approved'; badgeText = '✅ 已核准'; dotClass = 'dot-approved';
        desc = '已核准';
      } else if (status === SOCIAL.STAGE.REJECTED || stage === SOCIAL.STAGE.REJECTED) {
        badgeClass = 'badge-rejected'; badgeText = '❌ 已退回'; dotClass = 'dot-rejected';
        desc = '已退回，請重新填寫';
      } else {
        badgeClass = 'badge-pending'; badgeText = '⏳ 審核中'; dotClass = 'dot-pending';
        const stageDesc = {
          [SOCIAL.STAGE.STAGE2]: '等待 第一關（所長）審核',
          [SOCIAL.STAGE.STAGE3]: '等待 第二關（行銷）審核',
          [SOCIAL.STAGE.STAGE4]: '等待 第三關（部長）審核',
        };
        desc = stageDesc[stage] ?? '送審中';
      }

      return `
        <a class="my-app-item" href="review.html?id=${item.id}">
          <div class="my-app-dot ${dotClass}"></div>
          <div class="my-app-body">
            <div class="my-app-title">${title}</div>
            <div class="my-app-meta">
              <span>#${item.id}</span>
              ${platform ? `<span class="sep">·</span><span>${platform}</span>` : ''}
              ${dateStr  ? `<span class="sep">·</span><span>${dateStr}</span>` : ''}
              <span class="sep">·</span><span>${desc}</span>
            </div>
          </div>
          <span class="app-badge ${badgeClass}">${badgeText}</span>
          <span class="my-app-arrow">›</span>
        </a>`;
    }).join('');

    // 捲動偵測：捲到底移除漸層遮罩
    if (scroll && outer) {
      // 若全部內容都在可見範圍內，直接隱藏遮罩
      if (scroll.scrollHeight <= scroll.clientHeight + 4) {
        outer.classList.add('no-more');
      }
      scroll.addEventListener('scroll', () => {
        const atBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 4;
        outer.classList.toggle('no-more', atBottom);
      }, { passive: true });
    }

  } catch (err) {
    console.warn('[myApps] 載入失敗', err);
    list.innerHTML = `
      <div style="text-align:center;padding:16px;color:var(--sub);font-size:12px;">
        載入申請紀錄失敗
      </div>`;
    if (outer) outer.classList.add('no-more');
  }
}
