// Google Apps Script (script.google.com > New project). Paste, set the two values, then
// Triggers > Add trigger: scan, time-driven, every 5 minutes. Add a second: insights, daily.
const BASE = "https://srivaruni-review.vercel.app"; // your Vercel URL
const PASSWORD = "PASTE_APP_PASSWORD";

function scan() {
  UrlFetchApp.fetch(BASE + "/api/scan", { method: "post", headers: { "x-app-password": PASSWORD }, muteHttpExceptions: true });
}
function insights() {
  UrlFetchApp.fetch(BASE + "/api/insights", { method: "post", headers: { "x-app-password": PASSWORD }, muteHttpExceptions: true });
}
