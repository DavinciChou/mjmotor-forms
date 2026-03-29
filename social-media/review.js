/**
 * social-media/review.js — 自媒體素材審核（審核人端）
 *
 * 職責：
 *  1. 從 URL query string 取得 itemId（?id=42）
 *  2. SSO 登入 → 讀取 SP List 項目
 *  3. 渲染：申請內容、媒體預覽、四階段進度條、審核意見輸入
 *  4. 判斷目前登入者是哪一關的審核人
 *  5. 「核准」/ 「退回」按鈕 → PATCH 欄位 → 通知（PA 觸發）
 *
 * 審核狀態機（與 Power Automate 搭配）：
 *   第二階段（所長）核准 → ReviewStage = 第三階段
 *   第三階段（行銷）核准 → ReviewStage = 第四階段
 *   第四階段（部長）核准 → ReviewStage = 已核准  ReviewStatus = 已核准
 *   任何一關退回         → ReviewStatus = 已退回  （PA 通知申請人）
 *
 * PA 僅負責 Email 通知；狀態機更新由此頁面直接 PATCH SP List。
 */

import { loginIfNeeded, getCurrentUser } from '../shared/auth.js?v=9';
import * as API                          from '../shared/api.js?v=9';
import * as UI                           from '../shared/ui.js?v=9';
import { SOCIAL }                        from '../shared/config.js?v=9';

// ─── 進入點 ───────────────────────────────────────────────────────────────────

let _item   = null;   // 完整的 SP List 項目
let _fields = null;   // _item.fields 的捷徑

(async () => {
  try {
    UI.showLoading('登入中…');
    await loginIfNeeded();

    UI.showLoading('載入中…');
    await API.initSite();

    const itemId = getItemIdFromUrl();
    if (!itemId) {
      showError('URL 缺少 ?id=… 參數');
      return;
    }

    _item   = await API.getItem(SOCIAL.LIST_NAME, itemId);
    _fields = _item.fields;

    renderPage();
    UI.hideLoading();

  } catch (err) {
    UI.hideLoading();
    showError(`載入失敗：${err.message}`);
    console.error('[review] init error', err);
  }
})();

// ─── 渲染整個審核頁面 ─────────────────────────────────────────────────────────

function renderPage() {
  renderMeta();
  renderTracker();
  renderMedia();
  renderReviewPanel();
}

// 申請資訊區
function renderMeta() {
  setText('r-title',          _fields[SOCIAL.FIELD.TITLE]          ?? '—');
  setText('r-applicant',      _fields[SOCIAL.FIELD.APPLICANT_NAME]  ?? '—');
  setText('r-location',       _fields[SOCIAL.FIELD.LOCATION]        ?? '—');
  setText('r-platform',       _fields[SOCIAL.FIELD.PLATFORM]        ?? '—');
  setText('r-post-date',      UI.formatDate(_fields[SOCIAL.FIELD.PUBLISH_DATE]));
  setText('r-caption',        _fields[SOCIAL.FIELD.CONTENT]         ?? '—');
  setText('r-submitted-at',   UI.formatDateTime(_fields[SOCIAL.FIELD.SUBMITTED_AT]));
  setText('r-item-id',        `#${_item.id}`);

  // 審核人員區塊
  setText('r2-name',  _fields[SOCIAL.FIELD.REVIEWER2_NAME]  ?? '—');
  setText('r2-email', _fields[SOCIAL.FIELD.REVIEWER2_EMAIL] ?? '—');
  setText('r3-name',  _fields[SOCIAL.FIELD.REVIEWER3_NAME]  ?? '—');
  setText('r3-email', _fields[SOCIAL.FIELD.REVIEWER3_EMAIL] ?? '—');
  setText('r4-name',  _fields[SOCIAL.FIELD.REVIEWER4_NAME]  ?? '—');
  setText('r4-email', _fields[SOCIAL.FIELD.REVIEWER4_EMAIL] ?? '—');
}

// 進度條（含各關完成時間）
function renderTracker() {
  UI.renderTracker(
    'r-tracker',
    _fields[SOCIAL.FIELD.STAGE]  ?? '',
    _fields[SOCIAL.FIELD.STATUS] ?? '',
    {
      submit:   _fields[SOCIAL.FIELD.SUBMITTED_AT],
      stage2:   _fields[SOCIAL.FIELD.REVIEWED_AT2],
      stage3:   _fields[SOCIAL.FIELD.REVIEWED_AT3],
      stage4:   _fields[SOCIAL.FIELD.REVIEWED_AT4] || _fields[SOCIAL.FIELD.APPROVED_AT],
    }
  );
}

// 媒體預覽
function renderMedia() {
  // ── 照片 + 附件（MEDIA_PATHS）
  const rawMedia = _fields[SOCIAL.FIELD.MEDIA_PATHS];
  let mediaPaths = {};
  try { if (rawMedia) mediaPaths = JSON.parse(rawMedia); } catch { /* ignore */ }

  const photoWrap = document.getElementById('r-photos');
  if (photoWrap) {
    if (mediaPaths.photos?.length) {
      photoWrap.innerHTML = mediaPaths.photos.map(p => `
        <div style="cursor:zoom-in;" onclick="window._openLightbox('${p.url}','${p.name}')">
          <img src="${p.url}" alt="${p.name}" style="
            width:160px;height:120px;object-fit:cover;border-radius:8px;
            border:2px solid #e2e8f0;" />
          <p style="font-size:11px;color:#718096;margin-top:4px;text-align:center;">${p.name}</p>
        </div>`).join('');
    } else {
      photoWrap.innerHTML = `<span style="color:#718096;font-size:13px;">（無）</span>`;
    }
  }

  // ── 影片（VIDEO_PATHS，獨立欄位）
  const rawVideo = _fields[SOCIAL.FIELD.VIDEO_PATHS];
  let videoPaths = [];
  try { if (rawVideo) videoPaths = JSON.parse(rawVideo); } catch { /* ignore */ }

  const videoWrap = document.getElementById('r-videos');
  if (videoWrap) {
    if (videoPaths.length) {
      videoWrap.innerHTML = videoPaths.map(v => `
        <div>
          <video src="${v.url}" controls style="
            max-width:100%;border-radius:8px;border:2px solid #e2e8f0;"></video>
          <p style="font-size:11px;color:#718096;margin-top:4px;">${v.name}</p>
        </div>`).join('');
    } else {
      videoWrap.innerHTML = `<span style="color:#718096;font-size:13px;">（無）</span>`;
    }
  }

  // ── 附件
  const attachWrap = document.getElementById('r-attachments');
  if (attachWrap) {
    if (mediaPaths.attachments?.length) {
      attachWrap.innerHTML = mediaPaths.attachments.map(a => `
        <a href="${a.url}" target="_blank" style="
          display:flex;align-items:center;gap:8px;padding:10px 14px;
          background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;
          text-decoration:none;color:#2d3748;font-size:13px;">
          📎 ${a.name}
        </a>`).join('');
    } else {
      attachWrap.innerHTML = `<span style="color:#718096;font-size:13px;">（無）</span>`;
    }
  }
}

// 掛到 window 供 onclick 使用
window._openLightbox = UI.openLightbox;

// ─── 審核面板（核准 / 退回）──────────────────────────────────────────────────

function renderReviewPanel() {
  const panel = document.getElementById('r-review-panel');
  if (!panel) return;

  const user   = getCurrentUser();
  const stage  = _fields[SOCIAL.FIELD.STAGE]  ?? '';
  const status = _fields[SOCIAL.FIELD.STATUS] ?? '';

  // 已結案（核准或退回）→ 顯示唯讀結果
  if (status === SOCIAL.STAGE.APPROVED || status === SOCIAL.STAGE.REJECTED) {
    panel.innerHTML = buildReadonlyResult(status);
    return;
  }

  // 判斷目前使用者是哪一關的審核人
  const myRole = detectRole(user?.email ?? '');
  if (!myRole) {
    panel.innerHTML = `<p style="color:#718096;font-size:14px;">您不是本申請的審核人。</p>`;
    return;
  }

  // 確認目前輪到這一關
  const stageForRole = {
    reviewer2: SOCIAL.STAGE.STAGE2,
    reviewer3: SOCIAL.STAGE.STAGE3,
    reviewer4: SOCIAL.STAGE.STAGE4,
  };
  if (stage !== stageForRole[myRole]) {
    panel.innerHTML = `<p style="color:#718096;font-size:14px;">
      尚未到您的審核關卡（目前：${stageLabel(stage)}）。</p>`;
    return;
  }

  // 顯示審核表單
  panel.innerHTML = buildReviewForm(myRole);
  document.getElementById('r-approve-btn')?.addEventListener('click', () => onReview('approve', myRole));
  document.getElementById('r-reject-btn')?.addEventListener('click',  () => onReview('reject',  myRole));
}

function detectRole(email) {
  const e = email.toLowerCase();
  const emailMap = {
    reviewer2: (_fields[SOCIAL.FIELD.REVIEWER2_EMAIL] ?? '').toLowerCase(),
    reviewer3: (_fields[SOCIAL.FIELD.REVIEWER3_EMAIL] ?? '').toLowerCase(),
    reviewer4: (_fields[SOCIAL.FIELD.REVIEWER4_EMAIL] ?? '').toLowerCase(),
  };
  // 優先比對當前 stage 對應的 reviewer（處理同一人擔任多關的情況）
  const stageRoleMap = {
    [SOCIAL.STAGE.STAGE2]: 'reviewer2',
    [SOCIAL.STAGE.STAGE3]: 'reviewer3',
    [SOCIAL.STAGE.STAGE4]: 'reviewer4',
  };
  const currentRole = stageRoleMap[_fields[SOCIAL.FIELD.STAGE] ?? ''];
  if (currentRole && emailMap[currentRole] === e) return currentRole;
  // 依序 fallback
  if (e === emailMap.reviewer2) return 'reviewer2';
  if (e === emailMap.reviewer3) return 'reviewer3';
  if (e === emailMap.reviewer4) return 'reviewer4';
  return null;
}

function stageLabel(stage) {
  const map = {
    [SOCIAL.STAGE.STAGE2]: '所長審核中',
    [SOCIAL.STAGE.STAGE3]: '行銷審核中',
    [SOCIAL.STAGE.STAGE4]: '部長審核中',
  };
  return map[stage] ?? stage;
}

function buildReviewForm(role) {
  const roleLabel = { reviewer2: '所長', reviewer3: '行銷', reviewer4: '部長' }[role];
  return `
    <h3 style="font-size:15px;font-weight:700;color:#2d3748;margin-bottom:12px;">
      ${roleLabel}審核意見</h3>
    <textarea id="r-comment" rows="4" placeholder="選填：填寫意見或退回原因" style="
      width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:8px;
      font-size:13px;font-family:'Microsoft JhengHei',sans-serif;resize:vertical;
      box-sizing:border-box;"></textarea>
    <div style="display:flex;gap:12px;margin-top:14px;">
      <button id="r-approve-btn" style="
        flex:1;padding:12px;background:#38a169;color:#fff;border:none;
        border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">
        ✓ 核准
      </button>
      <button id="r-reject-btn" style="
        flex:1;padding:12px;background:#e53e3e;color:#fff;border:none;
        border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">
        ✕ 退回
      </button>
    </div>`;
}

function buildReadonlyResult(status) {
  const isApproved = status === SOCIAL.STAGE.APPROVED;
  return `
    <div style="text-align:center;padding:20px 0;">
      <div style="font-size:42px;">${isApproved ? '✅' : '❌'}</div>
      <p style="font-size:17px;font-weight:700;margin-top:10px;
        color:${isApproved ? '#38a169' : '#e53e3e'};">
        ${isApproved ? '已核准' : '已退回'}
      </p>
    </div>`;
}

// ─── 送出審核結果 ─────────────────────────────────────────────────────────────

async function onReview(action, role) {
  const comment = document.getElementById('r-comment')?.value?.trim() ?? '';

  if (action === 'reject' && !comment) {
    UI.showError('退回時請填寫退回原因');
    return;
  }

  const approveBtn = document.getElementById('r-approve-btn');
  const rejectBtn  = document.getElementById('r-reject-btn');
  if (approveBtn) approveBtn.disabled = true;
  if (rejectBtn)  rejectBtn.disabled  = true;

  try {
    UI.showLoading('儲存審核結果…');

    const fields = buildPatchFields(action, role, comment);
    await API.updateItem(SOCIAL.LIST_NAME, _item.id, fields);

    // 更新本機資料並重繪
    Object.assign(_fields, fields);

    UI.hideLoading();
    UI.showToast(action === 'approve' ? '已核准！' : '已退回，申請人將收到通知', 'success');

    // 重新渲染
    renderTracker();
    renderReviewPanel();

  } catch (err) {
    UI.hideLoading();
    UI.showError(`儲存失敗：${err.message}`);
    console.error('[review] onReview error', err);
    if (approveBtn) approveBtn.disabled = false;
    if (rejectBtn)  rejectBtn.disabled  = false;
  }
}

/**
 * 根據審核動作計算要 PATCH 的欄位
 */
function buildPatchFields(action, role, comment) {
  const { FIELD, STAGE } = SOCIAL;

  // 寫入本關意見
  const commentField = {
    reviewer2: FIELD.COMMENT2,
    reviewer3: FIELD.COMMENT3,
    reviewer4: FIELD.COMMENT4,
  }[role];

  const now = new Date().toISOString();

  // 各關對應的審核時間戳欄位
  const reviewedAtField = {
    reviewer2: FIELD.REVIEWED_AT2,
    reviewer3: FIELD.REVIEWED_AT3,
    reviewer4: FIELD.REVIEWED_AT4,
  }[role];

  if (action === 'reject') {
    return {
      [commentField]:    comment,
      [reviewedAtField]: now,
      [FIELD.STATUS]:    STAGE.REJECTED,
      // stage 不變（停在退回關卡）
    };
  }

  // 核准 → 推進到下一階段
  const nextStage = {
    reviewer2: STAGE.STAGE3,    // 所長核准 → 行銷
    reviewer3: STAGE.STAGE4,    // 行銷核准 → 部長
    reviewer4: STAGE.APPROVED,  // 部長核准 → 完成
  }[role];

  const patch = {
    [commentField]:    comment,
    [reviewedAtField]: now,
    [FIELD.STAGE]:     nextStage,
  };

  if (role === 'reviewer4') {
    patch[FIELD.STATUS]      = STAGE.APPROVED;
    patch[FIELD.APPROVED_AT] = now;
  } else {
    patch[FIELD.STATUS] = STAGE.PENDING;  // 待下一關審核
  }

  return patch;
}

// ─── 工具函式 ─────────────────────────────────────────────────────────────────

function getItemIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function showError(msg) {
  UI.hideLoading();
  const main = document.getElementById('main-content');
  if (main) {
    main.innerHTML = `
      <div style="text-align:center;padding:60px 20px;">
        <div style="font-size:48px;">⚠️</div>
        <h2 style="margin-top:12px;color:#c53030;">${msg}</h2>
      </div>`;
  }
}
