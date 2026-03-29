/**
 * social-media/review.js — 自媒體素材審核（查看端）
 *
 * 職責：
 *  1. 從 URL query string 取得 itemId（?id=42）
 *  2. SSO 登入 → 讀取 SP List 項目
 *  3. 渲染：申請內容、媒體預覽、四階段進度條
 *
 * 審核方式：由 Power Automate 透過 Teams / Outlook 核准卡進行。
 * 本頁面為唯讀，僅供查看申請狀態，不提供核准 / 退回操作。
 */

import { loginIfNeeded } from '../shared/auth.js?v=11';
import * as API                          from '../shared/api.js?v=11';
import * as UI                           from '../shared/ui.js?v=11';
import { SOCIAL }                        from '../shared/config.js?v=11';

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
    },
    {
      applicant: _fields[SOCIAL.FIELD.APPLICANT_NAME] ?? '',
      reviewer2: _fields[SOCIAL.FIELD.REVIEWER2_NAME] ?? '',
      reviewer3: _fields[SOCIAL.FIELD.REVIEWER3_NAME] ?? '',
      reviewer4: _fields[SOCIAL.FIELD.REVIEWER4_NAME] ?? '',
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

// ─── 審核狀態面板（唯讀）────────────────────────────────────────────────────

function renderReviewPanel() {
  const panel = document.getElementById('r-review-panel');
  if (!panel) return;

  const stage  = _fields[SOCIAL.FIELD.STAGE]  ?? '';
  const status = _fields[SOCIAL.FIELD.STATUS] ?? '';

  // 已結案
  if (status === SOCIAL.STAGE.APPROVED) {
    panel.innerHTML = `
      <div style="text-align:center;padding:20px 0;">
        <div style="font-size:42px;">✅</div>
        <p style="font-size:17px;font-weight:700;margin-top:10px;color:#38a169;">已核准</p>
      </div>`;
    return;
  }
  if (status === SOCIAL.STAGE.REJECTED) {
    panel.innerHTML = `
      <div style="text-align:center;padding:20px 0;">
        <div style="font-size:42px;">❌</div>
        <p style="font-size:17px;font-weight:700;margin-top:10px;color:#e53e3e;">已退回</p>
      </div>`;
    return;
  }

  // 審核進行中 — 顯示等待說明
  const stageLabels = {
    [SOCIAL.STAGE.STAGE2]: '第一關（所長）',
    [SOCIAL.STAGE.STAGE3]: '第二關（行銷）',
    [SOCIAL.STAGE.STAGE4]: '第三關（部長）',
  };
  const currentLabel = stageLabels[stage] ?? stage;
  const reviewerName = {
    [SOCIAL.STAGE.STAGE2]: _fields[SOCIAL.FIELD.REVIEWER2_NAME],
    [SOCIAL.STAGE.STAGE3]: _fields[SOCIAL.FIELD.REVIEWER3_NAME],
    [SOCIAL.STAGE.STAGE4]: _fields[SOCIAL.FIELD.REVIEWER4_NAME],
  }[stage] ?? '';

  panel.innerHTML = `
    <div style="text-align:center;padding:16px 0 8px;">
      <div style="font-size:36px;margin-bottom:12px;">📬</div>
      <p style="font-size:15px;font-weight:700;color:#2d3748;margin-bottom:8px;">
        等待 ${currentLabel} 審核${reviewerName ? `（${reviewerName}）` : ''}
      </p>
      <p style="font-size:13px;color:#718096;line-height:1.8;">
        核准請求已發送至審核人的
        <strong style="color:#2d3748;">Teams</strong> /
        <strong style="color:#2d3748;">Outlook</strong>，<br>
        請審核人直接在通知訊息中點擊 <strong>Approve</strong> 或 <strong>Reject</strong>。
      </p>
    </div>`;
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
                                                                                                                                                                                         