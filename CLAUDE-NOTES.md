# 40th Floor — Project Brief for Claude Cowork

Save this file as `CLAUDE-NOTES.md` in the repo, same as the All5Starz project, so it carries over between sessions.

## What This Is
40th Floor is a suite of web-based productivity apps for small local businesses. Businesses pick and choose which apps they want — no forced bundle, no app store. Around $20/month per app, with bundle pricing to be worked out later. Every app gets a 15–30 day free trial, no credit card required to start.

Domain is purchased and live: **40thFloor.com**

## Site Structure
- **40thFloor.com is the "lobby"** — one home page listing every app, with pricing and a "start free trial" button on each.
- **Each app lives in its own folder off the main domain** (example: 40thFloor.com/mark-it-done), not on a separate domain. Keeps everything under one roof, one login, one place to manage.
- **Exception: All5Starz stays on its own domain** (all5starz.com). It already has customers and search ranking under that name — don't migrate it, just link to it from the 40th Floor hub page as part of the suite.
- **One shared login across every app.** Someone who buys two apps should sign in once, not twice.

## Critical Design Rule for the Hub Page
The homepage needs to look and feel like a finished, professional product **whether there's 1 app live or 10.** Build the layout so it scales cleanly — no "coming soon" placeholders that make it look empty, no obvious gaps. A visitor on day one with just Mark It Done live should get the same confident, complete feeling as a visitor a year from now with the full suite live.

## The 6 Launch Apps

1. **Tapin** — QR-based contact sharing (new build, full spec below)
2. **All5Starz** — reputation management, already live at all5starz.com, link in only
3. **Mark It Done** — checklist / to-do app, already built
4. **Invoice & Estimate Builder** — new build
5. **Mileage & Expense Tracker** — new build
6. **Contact Manager (CRM)** — new build

Note: Time Tracker and Renter Screener already exist too but are intentionally not part of this initial 6 — revisit later.

**Cross-app synergy to build toward:** when someone connects with John through Tapin, that contact should be able to flow straight into the Contact Manager, instead of living in just one app. Worth designing the data model with this in mind from the start, even if the connection isn't built in phase one.

## Tapin — Full Concept

**One-line idea:** A web app that lets someone share a QR code instead of their phone number. Scan it, send a request, chat through the app. No number, no photos, no forced follow.

**How it works:**
1. Person signs up, gets their own QR code tied to their account.
2. They show the code to someone in person. That person scans it with their regular phone camera — no app needed to scan.
3. The scan opens a web page that already knows whose code it is.
   - If the scanner already has an account, they're signed in and a connection request goes out right there.
   - If they're brand new, they sign up on the spot, and the same request goes out the moment they finish — no app store, no separate download step.
4. The code owner gets a notification: "So-and-so wants to connect. Approve?" Nothing opens up until they say yes.
5. Once approved, they can message each other. **Text only, no photos, ever — not even as a future upgrade.**
6. Either person can delete the connection anytime, no explanation needed.

**Core features:**
- Text-only messaging, no photos or video, ever.
- Default profile shows just a name, a selfie, and a message button.
- Optional bio and contact info, only visible if the person turns it on.
- QR code can be reset for a fresh one anytime.

**Safety rules — build these in from day one, not later:**
- Age at signup, 13 and up (under 13 triggers COPPA, too much overhead for this project).
- Flag adult accounts and minor accounts differently — when an adult tries to connect with a minor, show a little extra context so the minor knows.
- No location data anywhere, ever — not on profiles, not in the QR code.
- One-tap block and report that actually gets reviewed, not ignored.
- Blocked/removed accounts shouldn't be able to just make a new one in five minutes.
- Optional parent visibility — a parent's account can get notified when their teen makes a new connection.

**Technical approach:**
- Build as a **PWA** (progressive web app), not a native app. No App Store or Play Store listing, which also means skipping their review process for messaging apps involving minors.
- To get message notifications, the user needs to add the site to their phone's home screen. Android can prompt this automatically. iPhone requires a manual Share → Add to Home Screen step — build a short walkthrough into onboarding for this, especially for iPhone users, or they won't get notified when someone messages them.
- Account verification will likely still need a phone number at signup for login purposes only — this is never shown to other users, and is different from the number-sharing problem the app is solving.

**Suggested build order for Tapin specifically:**
1. Core loop: sign up, get a QR code, scan, approve, text.
2. Safety layer: age gate, adult/minor flagging, block/report, no-location enforcement. Don't skip this even for a small test group.
3. Onboarding polish: home screen walkthrough, notification prompts.
4. Growth extras: optional bio fields, QR refresh, parent visibility.

## Working Style for This Project
- Plain English, no jargon or tech-speak dropped without explaining it.
- Short sentences, easy reading level.
- One step at a time — confirm with John before anything touches a live system.
- Sound like a knowledgeable friend, not a sales pitch.
- Avoid these words entirely: leverage, dive into, game-changer, robust, streamline.

## Suggested Tech Stack
All5Starz already runs on Netlify, GitHub, Stripe, and Resend, and that setup works. Recommend reusing the same stack here for consistency, unless there's a clear reason not to for a specific app.

## Recommended First Steps
1. Set up a GitHub repo and a Netlify site for 40thFloor.com.
2. Save this file as `CLAUDE-NOTES.md` in that repo.
3. Build the lobby/hub page first, designed to look complete even before every app is live.
4. Get Mark It Done and All5Starz linked in under the shared login.
5. Then build in this order: Tapin → Invoice & Estimate Builder → Mileage & Expense Tracker → Contact Manager.
