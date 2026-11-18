---
apps: leads,board
servers: TinyFish, Keenest Morning
minutes: 55
---
Build today's morning lead list for Keenest's leads site. If today is Friday or Saturday in Israel, stop.

{{include:leads_rules}}

1. List "leads" (fields name, website, stage, reason, foundBy, origin, toBoard, movedToBoard) and note every existing business — never add a duplicate (see DUPLICATES).

2. Find exactly 10 NEW, real, current Israeli leads in this run's sectors/regions (ROTATION), plus national companies. At least 6 of the 10 must be medium-to-large companies (roughly 50+ employees, or a chain/brand) — Keenest especially wants large companies; the rest may be small businesses, startups or public bodies. Aim for at least 4 of the 10 to come with a DIRECT mobile of the marketing decision maker (PHONE PHRASES). Signals, strongest first:
   - a NEW marketing leader appointed in the last ~3 months — appointment columns on shivuk.me (מנהלי שיווק מצייצים – מינויים) and ice.co.il/positions;
   - a new event in the last ~30 days: funding round, new branch/store/clinic, product launch, rebrand, expansion, big contract (Globes, Calcalist, TheMarker, Geektime, ynet business, ice.co.il, local news, press releases);
   - hiring a marketing / content / social media manager (job posts);
   - advertising on Facebook/Instagram with static images only, or a website/social presence with no video;
   - an open public tender for video production (mr.gov.il, municipalities) with a deadline not passed;
   - a company that publishes its marketing decision maker's direct mobile (signal "נייד ישיר של מנהל/ת השיווק" when there is no fresher event).
   Open each page you rely on to confirm the person, title and number are current; skip government ministries and tiny one-person businesses. Every lead needs the DECISION MAKER and a DIRECT CHANNEL.

3. Write the 10 leads (one batch, ops "set"), doc ids "m-<YYYYMMDD>-<n>" (if an id already exists, use the next free n), LEAD DOC with stage:"new", origin:"morning". Then write the searchlog doc (by:"morning").

4. Requests waiting in "requests" (status "pending") are handled by another job on this Mac — do not handle them here.

5. Clean up old searches: for every request whose type is NOT "person" and NOT "ask" and whose createdAt (epoch ms) is more than 14 days ago, delete the request doc and delete every lead with reqId equal to that request's id AND stage "found" (results nobody added). Never delete leads in any other stage, and never delete "person" or "ask" requests. Also delete searchlog docs older than 180 days.

6. Leads for the work board: leads with toBoard true and no movedToBoard (normally stage "won"). The work board's data is app "board" in the same command ({{KDB}} list board mtasks). Copy the exact field shape of an existing mtasks doc and create one new doc per lead (id "lead-<lead id>"): title "לקוח חדש: <name> – <next step from the lead's latest log note, or 'לפתוח פרויקט'>" (for a stage other than "won": "ליד: <name> – <next step or 'לחזור אליהם'>"), status "לא התחלתי", owners ["צפריר אלבז"], projectIds [], and any other required fields with the same defaults existing docs use. Then merge the lead with {movedToBoard:true, updatedAt:<now ms>}. If the board's shape is unclear, skip this step.

7. Today's search ideas (the pill bubbles under "את מי מחפשים היום?" on the site's search page, two per row on a phone): write exactly 6 fresh Hebrew search ideas, each 2–4 words and at most 20 characters including spaces (good: "מלונות בצפון לחורף", "גייסו כסף השבוע", "קניונים אחרי שיפוץ"), phrased as a search for businesses that likely need video now. Base them on this week's Israeli business news you saw, the season and upcoming holidays/shopping events, sectors/regions the searchlog shows we haven't covered lately, and what produced good leads (foundBy of leads now in stage called/meeting/quote/won). Mix: ~2 news-driven, ~2 seasonal, ~2 untouched sectors/regions; no repeats of the previous day's items (get meta ideas). Set meta/ideas to {at:<now ms>, items:[6 strings]}.

Finish with one Hebrew line, e.g. "רשימת הבוקר מוכנה: 10 לידים חדשים, 4 עם נייד ישיר, 6 עם מייל".
