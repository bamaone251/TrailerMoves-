# Yard Door Board

Shared real-time communication board for Yard Drivers and the Load Desk.

## Workflow

1. **Yard Driver:** select an Empty door (10–45), enter the Trailer #, and tap **Make Available**.
2. **Load Desk:** switch to **Load Desk View**, assign an Available trailer to a **Run #**, and start Loading.
3. **Load Desk:** tap **Loading Complete** when the trailer is finished.
4. **Yard Driver:** switch to **Yard Driver View** and mark the trailer **Pooled** or **Dispatched** when it leaves the door.
5. The door automatically returns to **Empty** and can receive the next trailer.

All connected users receive updates live through Socket.IO.

## Out of Service doors

- The **Load Desk** can mark any door **Out of Service** and optionally enter a reason.
- Out of Service is stored separately from the trailer/loading status, so existing trailer and Run information is preserved.
- The **Yard Driver View** shows a large red **OUT OF SERVICE — DO NOT USE** warning and will not allow a new trailer to be placed on that door.
- A Load Desk user can **Return to Service** at any time.
- Out-of-service flags persist across the midnight daily reset until someone returns the door to service.


## PWA

The app is installable on supported mobile and desktop browsers. It includes:

- Web app manifest
- 192px and 512px app icons
- Service worker
- Standalone display mode
- Offline app-shell fallback
- Live operational/API data is never served from cache
- An **Install App** button appears when the browser exposes the PWA install prompt

> For PWA installation outside localhost, serve the app through HTTPS (for example with Nginx + Certbot).

## Daily archive

The container runs in `America/Chicago`. Shortly after the Central Time date changes, the completed day's board and activity log are saved to:

`./archives/DAILY_YARD_BOARD_MM-DD-YY.pdf`

The board then resets Doors 10–45 to Empty for the new day.

## Exports

- Excel: **Export Excel**
- PDF: **Export PDF**

## Docker deployment

```bash
docker compose up -d --build
```

Open:

```text
http://YOUR-SERVER-IP:3030
```

Persistent data:

- SQLite database: `./data/yard-board.db`
- Daily PDF archives: `./archives/`

## Reverse proxy example

Proxy your HTTPS domain to port `3030`. WebSocket upgrade headers are required for live Socket.IO updates.

## Quick edit
Double-click any door card on desktop, or double-tap it on a touch device, to open the manual edit window. Trailer #, Run #, status, and Out of Service can be corrected directly. Manual edits are written to the daily activity history.


## Card editing gestures
- Desktop: double-click any door card to edit it.
- Phone/tablet/PWA: press and hold a door card for about 0.65 seconds, or tap the visible **Edit** button.
- The service-worker cache version was bumped so installed PWAs receive the updated JavaScript/CSS after deployment.

## September 2026 display update
- Door range: 10–47.
- Board uses the full browser width and automatically adds columns as the browser is zoomed out.
- Load Desk view: Available doors flash green.
- Yard Driver view: Loading Complete doors flash blue.
- Out of Service doors remain solid red and never flash.
# TrailerMoves-
