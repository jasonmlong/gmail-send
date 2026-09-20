// ==========================================
// FILE: Api.gs
// gmail-send lightweight Apps Script API.
//
// Deploy this project as a web app (Execute as: me, Access: Anyone) inside
// any Google account. An agent then POSTs JSON to the /exec URL with the
// shared token and gets Gmail-identical drafts written straight into that
// account's Drafts folder. No Cloud OAuth client, no payments, no tiers.
//
// Protocol:  POST { token, action, ...params }  ->  { ok: true, result } | { ok: false, error }
// Actions are listed in ACTIONS below and documented in docs/APPS-SCRIPT-API.md.
//
// SECURITY POSTURE (see docs/SECURITY-REVIEW.md)
// The deployment is reachable by anyone on the internet and the token is the
// only guard, so the token is treated as "may read this mailbox and stage
// drafts in it" and nothing more. Three capabilities that a stolen token
// should not confer are switched off by default and can only be turned on
// from the Apps Script editor, never over the wire:
//   - sending                (setAllowSend)
//   - writing Gmail settings (setAllowSettingsWrite)
//   - deleting drafts this API did not create (never; there is no switch)
// ==========================================

var GMAIL_SEND_VERSION = '0.3.0';

/**
 * Unauthenticated probe. Deliberately says almost nothing: anyone who finds
 * the URL should not thereby learn whose mailbox is behind it, what version
 * is running, or whether sending is armed. Everything else needs the token.
 */
function doGet(e) {
  return json_({ ok: true, result: { name: 'gmail-send' } });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (parseError) {
    return json_({ ok: false, error: 'Bad request' });
  }
  // Authenticate before doing any work at all, so an unauthenticated caller
  // cannot make the script burn the owner's execution quota.
  if (!req || typeof req !== 'object') return json_({ ok: false, error: 'Bad request' });
  var token = getToken_();
  if (!token || !req.token || req.token !== token) return json_({ ok: false, error: 'Unauthorized' });

  if (typeof req.action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, req.action) || typeof ACTIONS[req.action] !== 'function') {
    // hasOwnProperty matters: a plain object literal also answers to
    // "constructor", "valueOf" and friends through its prototype, which would
    // make this allowlist not an allowlist.
    return json_({ ok: false, error: 'Unknown action' });
  }

  try {
    installFormatters_();
    return json_({ ok: true, result: ACTIONS[req.action](req) });
  } catch (err) {
    var message = String((err && err.message) || err);
    console.error('gmail-send action ' + req.action + ' failed: ' + message);
    return json_({ ok: false, error: message });
  }
}

var ACTIONS = {
  // ---- read ----
  profile: function () { return getProfile_(); },
  listThreads: function (r) { return listThreads_(r.query, r.max); },
  getThread: function (r) { return getThread_(r.threadId); },
  getMessage: function (r) { return getMessage_(r.messageId); },
  listSignatures: function () { return listSignatures_(); },
  listDrafts: function (r) { return listDrafts_(r.threadId); },
  getDraft: function (r) { return getDraft_(r.draftId); },

  // ---- write: drafts only ----
  createDraft: function (r) { return createDraftFromRaw_(r.raw, r.threadId); },
  updateDraft: function (r) { return updateDraftFromRaw_(r.draftId, r.raw, r.threadId); },
  deleteDraft: function (r) { return deleteOwnDraft_(r.draftId); },

  // ---- high-level: the script renders the Gmail-identical draft itself ----
  draftReply: function (r) { return draftReply_(r); },
  draftNew: function (r) { return draftNew_(r); },
  draftForward: function (r) { return draftForward_(r); },
  redraft: function (r) { return redraft_(r); },

  // ---- gated: off unless the owner enabled it in the editor ----
  saveSignature: function (r) { return saveSignature_(r.sendAsEmail, r.html); },
  sendDraft: function (r) { return sendDraft_(r.draftId); },
};

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getToken_() {
  return PropertiesService.getScriptProperties().getProperty('GMAIL_SEND_TOKEN') || '';
}

function allowSend_() {
  return PropertiesService.getScriptProperties().getProperty('GMAIL_SEND_ALLOW_SEND') === '1';
}

/** Writing the Gmail signature changes every message the owner types by hand, so it is gated too. */
function allowSettingsWrite_() {
  return PropertiesService.getScriptProperties().getProperty('GMAIL_SEND_ALLOW_SETTINGS_WRITE') === '1';
}

function signaturePlacement_() {
  return PropertiesService.getScriptProperties().getProperty('GMAIL_SEND_SIGNATURE_PLACEMENT') === 'before-quote' ? 'before-quote' : 'after-quote';
}

/** Optional Gmail search terms ANDed into every search, e.g. "-in:spam -in:trash newer_than:180d". */
function searchScope_() {
  return PropertiesService.getScriptProperties().getProperty('GMAIL_SEND_QUERY_SCOPE') || '';
}

/**
 * Apps Script's V8 Intl has no timezone database, so the renderer's date
 * formatting is routed through Utilities.formatDate, which does.
 */
function installFormatters_() {
  GmailSendCore.setDateTimeFormatter(function (date, tz) {
    var p = Utilities.formatDate(date, tz, 'EEE|MMM|d|yyyy|h|mm|a').split('|');
    return { weekday: p[0], month: p[1], day: p[2], year: p[3], hour: p[4], minute: p[5], dayPeriod: p[6] };
  });
  GmailSendCore.setRfc2822Formatter(function (date, tz) {
    return Utilities.formatDate(date, tz, 'EEE, dd MMM yyyy HH:mm:ss Z');
  });
}
