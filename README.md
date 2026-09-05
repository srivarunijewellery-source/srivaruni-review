# Sri Varuni reel review

Editors drop a draft reel in a Drive folder. Five minutes later a verdict sits next to the file and on the dashboard: time to product, price on screen, Telugu line, sharpness, cut rate, length, caption, three hook rewrites. Ready reels move to "3. Ready to post", the rest to "2. Fix".

## How it runs

```
Drive "1. To review"  →  /api/scan (every 5 min via Apps Script)
                          ├ ffmpeg: 4 frames/sec, audio
                          ├ sharp: sharpness, brightness, scene cuts   (lib/metrics.mjs)
                          ├ Groq Whisper: Telugu/English transcript    (optional)
                          ├ Claude: time-to-product, price, Telugu, hooks, caption
                          └ Supabase row + report.txt in Drive + move file
Dashboard (Vercel)     ←  reads Supabase
/api/insights (daily)  ←  Instagram Graph API saves/reach/watch time for posted reels
```

Videos are never stored by the app. They live in the editor's Drive; the app keeps 20 small frames and the numbers.

## Setup, once

1. **Supabase**: SQL editor → run `supabase/schema.sql`.
2. **Drive**: create a folder "Sri Varuni Reel Review". Copy its id from the URL. Share it (Editor) with the service account email from step 3. Subfolders are created automatically.
3. **Google service account**: console.cloud.google.com → project → enable Google Drive API → IAM → Service Accounts → create → Keys → JSON. Paste the JSON on one line into `GOOGLE_SERVICE_ACCOUNT_JSON`.
4. **Vercel**: import this repo, set the variables from `.env.example`, deploy.
5. **Apps Script**: paste `scripts/apps-script.gs`, set BASE and PASSWORD, add the two time triggers.
6. **Meta (week two)**: developers.facebook.com → your app → Graph API Explorer → token with `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement` → exchange for a long-lived token. `IG_USER_ID` is the Instagram Business Account id (Business Suite → settings, or `/me/accounts?fields=instagram_business_account`).

## Editor workflow

1. Export the reel at 1080p (keeps files under ~60 MB so the 60 s function limit holds).
2. Upload to "1. To review". Put the caption in the file's Description (right-click → File information → Details).
3. Wait for the report. Fix what it lists, re-upload. When it says ready, post.
4. Paste the Instagram link on the reel's dashboard page. Insights start flowing the next day.

## Tuning

- `SHARPNESS_MIN`: 0-100. Start at 55, raise it once your best reels sit comfortably above.
- Everything else lives in `RULES` in `lib/score.ts`.
- `npm run check` runs the pixel-math self-test.

## Not built yet, on purpose

- Per-person logins. One team password for now.
- Automatic rubric re-weighting from insights. First collect 30 posted reels, then decide which thresholds actually predict saves.
