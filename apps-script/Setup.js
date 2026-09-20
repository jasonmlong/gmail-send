// ==========================================
// FILE: Setup.gs
// One-time setup and self-tests. Run these from the Apps Script editor.
// ==========================================

/**
 * Run once after pasting the project in. Creates the API token (if missing),
 * triggers the OAuth consent for the scopes, and prints what to put in .env.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('GMAIL_SEND_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('GMAIL_SEND_TOKEN', token);
  }
  if (!props.getProperty('GMAIL_SEND_ALLOW_SEND')) props.setProperty('GMAIL_SEND_ALLOW_SEND', '0');
  if (!props.getProperty('GMAIL_SEND_ALLOW_SETTINGS_WRITE')) props.setProperty('GMAIL_SEND_ALLOW_SETTINGS_WRITE', '0');

  installFormatters_();
  var profile = getProfile_();
  var sigs = listSignatures_();
  Logger.log('gmail-send ' + GMAIL_SEND_VERSION + ' is set up for ' + profile.email);
  Logger.log('Timezone (from Calendar): ' + profile.timeZone);
  Logger.log('Signatures: ' + sigs.map(function (s) { return s.id + (s.isDefault ? ' (default)' : '') + (s.html ? '' : ' [empty]'); }).join(', '));
  Logger.log('');
  Logger.log('Now: Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone. Copy the /exec URL.');
  Logger.log('Then in gmail-send/.env:');
  Logger.log('  GMAIL_SEND_PROVIDER=appsscript');
  Logger.log('  GMAIL_SEND_APPS_SCRIPT_URL=<the /exec URL>');
  Logger.log('  GMAIL_SEND_APPS_SCRIPT_TOKEN=' + token);
}

/** Rotate the shared token (update .env afterwards). */
function rotateToken() {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('GMAIL_SEND_TOKEN', token);
  Logger.log('New token: ' + token);
}

/** Allow or forbid the sendDraft action for this deployment. Off by default. */
function setAllowSend(flag) {
  PropertiesService.getScriptProperties().setProperty('GMAIL_SEND_ALLOW_SEND', flag ? '1' : '0');
  Logger.log('sendDraft is now ' + (flag ? 'ENABLED' : 'disabled'));
}

/**
 * Allow or forbid writing the Gmail signature over the API. Off by default,
 * because that write changes every message you type by hand afterwards.
 */
function setAllowSettingsWrite(flag) {
  PropertiesService.getScriptProperties().setProperty('GMAIL_SEND_ALLOW_SETTINGS_WRITE', flag ? '1' : '0');
  Logger.log('saveSignature is now ' + (flag ? 'ENABLED' : 'disabled'));
}

/** Put back the signature that the last saveSignature call replaced. */
function restoreSignature() {
  Logger.log(JSON.stringify(restoreSignature_()));
}

/**
 * Narrow what the API can read. The value is Gmail search syntax ANDed into
 * every search, so it also binds anyone calling the endpoint directly.
 * Example: setSearchScope('-in:spam -in:trash newer_than:180d')
 */
function setSearchScope(query) {
  PropertiesService.getScriptProperties().setProperty('GMAIL_SEND_QUERY_SCOPE', query || '');
  Logger.log('Search scope is now: ' + (query || '(none)'));
}

/**
 * The editor's Run button cannot pass arguments, so this applies the
 * recommended scope in one click. Edit the string to change it, then Run.
 */
function applyRecommendedSearchScope() {
  setSearchScope('-in:spam -in:trash newer_than:180d');
}

/** Undo the above: let the API search the whole mailbox again. */
function clearSearchScope() {
  setSearchScope('');
}

/** Print the current switches without changing anything. */
function showSettings() {
  var p = PropertiesService.getScriptProperties();
  Logger.log('allowSend:            ' + (p.getProperty('GMAIL_SEND_ALLOW_SEND') === '1' ? 'ENABLED' : 'disabled'));
  Logger.log('allowSettingsWrite:   ' + (p.getProperty('GMAIL_SEND_ALLOW_SETTINGS_WRITE') === '1' ? 'ENABLED' : 'disabled'));
  Logger.log('searchScope:          ' + (p.getProperty('GMAIL_SEND_QUERY_SCOPE') || '(none, whole mailbox)'));
  Logger.log('signaturePlacement:   ' + (p.getProperty('GMAIL_SEND_SIGNATURE_PLACEMENT') || 'after-quote'));
}

/** Put the signature above the quoted text (Gmail's "insert signature before quoted text" setting). */
function setSignatureBeforeQuote(flag) {
  PropertiesService.getScriptProperties().setProperty('GMAIL_SEND_SIGNATURE_PLACEMENT', flag ? 'before-quote' : 'after-quote');
  Logger.log('Signature placement: ' + (flag ? 'before-quote' : 'after-quote'));
}

/** Self-test: profile, signature and a rendered (not stored) reply to the newest inbox thread. */
function selfTest() {
  installFormatters_();
  var profile = getProfile_();
  Logger.log(JSON.stringify(profile, null, 2));
  var ctx = context_();
  Logger.log('Signature in use: ' + (ctx.composeOptions.signature ? ctx.composeOptions.signature.id + ' (' + ctx.composeOptions.signature.html.length + ' chars)' : 'none'));
  var threads = GmailApp.search('in:inbox', 0, 1);
  if (!threads.length) {
    Logger.log('Inbox empty; nothing to render.');
    return;
  }
  var original = lastMessage_(threads[0].getId());
  var rendered = GmailSendCore.composeReply(original, { body: 'Hey,\n\nThis is a gmail-send self test. Nothing was saved.\n\nThank you!' }, ctx.composeOptions);
  Logger.log('Subject: ' + rendered.subject + ' | To: ' + rendered.to.map(GmailSendCore.formatAddress).join(', '));
  Logger.log(rendered.text);
}

/**
 * Creates a REAL draft (not sent) replying to the newest inbox thread, so you
 * can open Gmail and compare it with a hand-typed reply. Delete it afterwards.
 */
function testDraftLatestInbox() {
  installFormatters_();
  var threads = GmailApp.search('in:inbox', 0, 1);
  if (!threads.length) throw new Error('Inbox empty');
  var result = draftReply_({ threadId: threads[0].getId(), body: 'Hey,\n\nThis is a gmail-send test draft. It was not sent.\n\nThank you!' });
  Logger.log('Draft created: ' + result.draftId + ' in thread ' + result.threadId);
  Logger.log(result.text);
}
