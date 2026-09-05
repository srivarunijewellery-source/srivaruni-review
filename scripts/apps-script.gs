// Google Apps Script (script.google.com > New project). Paste, set the two values, then
// Triggers > Add trigger: scan, every 5 minutes. insights, daily. importPosted, every 5 minutes for the first day, then delete it.
const BASE = "https://srivaruni-review.vercel.app"; // your Vercel URL
const PASSWORD = "PASTE_APP_PASSWORD";

function scan() {
  const h = { method: "post", headers: { "x-app-password": PASSWORD }, muteHttpExceptions: true };
  UrlFetchApp.fetch(BASE + "/api/scan", h);     // register new Drive drafts
  UrlFetchApp.fetch(BASE + "/api/analyze", h);  // analyse one pending reel
}
function insights() {
  UrlFetchApp.fetch(BASE + "/api/insights", { method: "post", headers: { "x-app-password": PASSWORD }, muteHttpExceptions: true });
}
function importPosted() {
  UrlFetchApp.fetch(BASE + "/api/import", { method: "post", headers: { "x-app-password": PASSWORD }, muteHttpExceptions: true });
}
