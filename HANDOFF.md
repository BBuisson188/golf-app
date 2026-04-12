# Golf App Handoff

## Purpose
Green Caddie is a mobile-first golf round tracking web app designed to run as a static site on GitHub Pages. It lets a golfer track rounds hole-by-hole, capture GPS shot locations, estimate distance to pin, optionally use a map with MapTiler satellite or OpenStreetMap, save reusable course templates, review round history, export JSON, and keep a lightweight score-only card for other players.

The app is optimized for phone use during a round. Data is stored locally in the browser. There is no backend.

## Stack
- Static HTML/CSS/JavaScript
- Leaflet for map rendering
- Optional MapTiler satellite tiles via user-provided API key
- OpenStreetMap fallback when no MapTiler key is present
- Local browser storage
- Hosted as a plain static site, usually GitHub Pages

## Important files
- `index.html`
  - Main markup for all screens and overlays.
- `app.js`
  - Main application logic.
  - Navigation, storage, score tracking, shot flow, scorecard modes, history, course save/load, map switching, version string.
- `styles.css`
  - Main visual layout and responsive/mobile styling.
- `manifest.webmanifest`
  - PWA/home-screen metadata.
- `favicon.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`
  - App icons.
- Asset files used by the UI include names like:
  - `asset_background.png`
  - `asset_hit.png`
  - `asset_map.png`
  - `asset_quick_finish.png`
  - `asset_current_lie.png`
  - `asset_scorecard.png`
  - `asset_home.png`
  - `asset_start_round.png`

## How to run
### Locally
1. Put the app files in a folder.
2. Serve the folder with any static server, for example:
   - `python3 -m http.server 8000`
   - `npx serve .`
3. Open the local URL in a browser.

### GitHub Pages
1. Put the app files in the repo root.
2. Enable GitHub Pages for the branch/root.
3. Open the published URL.
4. Save to home screen on phone if desired.

## What already works
- Home screen, Start Round, Hole screen, Scorecard, History, Courses, Map, and Round Detail exist.
- Local browser storage of rounds and saved courses.
- Round JSON export.
- Reusable saved courses.
- Course creation flow exists.
- Hole-by-hole play flow exists.
- GPS start/end capture flow exists.
- `Hit From Here` and landing/result flow exists.
- `Next Shot` flow exists and has been iteratively improved.
- Optional MapTiler API key storage exists.
- OpenStreetMap fallback exists.
- OSM/SAT toggle exists when a MapTiler key is present.
- History / round recap screen exists.
- Scorecard has two modes:
  - Me
  - Other Players
- Home info button and informational overlays exist.
- Version badge exists on Home and should be incremented with every visible release.

## Known issues
- GIR has been problematic and was patched multiple times. It still needs real-device validation, especially when using `Next Shot` heavily.
- Estimated yards-to-pin logic has been under active iteration and still needs validation across all pin and landing workflows.
- Some older bundles had image transparency/shadow asset issues. Latest assets are acceptable but not perfect.
- Course loading previously failed because selected course state was lost when moving into Start Round. This was patched, but should be verified again end-to-end.
- `app.js` has been patched many times directly, so logic is functional but should be cleaned carefully rather than rewritten wholesale.
- Scorecard, history stats, and map interactions should all be regression-tested on both phone and desktop.

## Rules to preserve
- Keep mobile layout intact.
- Do not rewrite from scratch.
- Preserve current UI style.
- Preserve existing data/storage format.
- Increment version when making visible user-facing changes.
- Preserve the golf-themed custom artwork/buttons.
- Keep the app static and lightweight.
- Keep local-only storage behavior unless explicitly expanding the architecture.
- Keep the app usable with no MapTiler key.
- Keep course templates separate from round history data.
- Preserve the scorecard split between detailed personal tracking and simplified Other Players scoring.

## Next priorities
1. Validate and finish GIR / fairway-hit logic so history and stats overlays always match real play, especially when using `Next Shot` instead of GPS logging.
2. Finalize estimated yards-to-pin logic so it always updates correctly from pin placement, current location, landing spot updates, and official-yardage fallback when no pin exists.
3. Verify saved course loading end-to-end for pars, official yardages, and saved pin locations.
4. Regression-test the OSM/SAT toggle and MapTiler key behavior.
5. Continue tightening scorecard UX on mobile, including compact spacing and predictable scrolling behavior.
6. Polish the green/putting flow so it feels natural whether using GPS logging or `Next Shot` only.
7. Clean up and consolidate repeated logic in `app.js` without changing behavior.
8. Improve stats help text so users understand how each stat is calculated.
9. Improve course-builder UX after real-device testing.
10. Later: build a separate desktop analysis tool for exported JSON and possibly course creation/editing outside the phone app.
