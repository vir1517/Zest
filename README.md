# ZEST

ZEST is a QR-paired local multiplayer web arcade:

- Open the host display on a laptop, monitor, or TV browser
- Players scan the QR code on their phones
- Each phone becomes a controller
- `Pulse Pit` is the fast 1v1 shooter
- `UNO` is the 2-4 player card table

## Tech

- Node.js
- Express
- Socket.IO
- HTML Canvas

## Run locally

1. `npm install`
2. `npm run dev`
3. Open `http://localhost:3000`

## Free Deploy

This project includes [render.yaml](/Users/vpsingh/Documents/New project/render.yaml) for Render.

1. Push this folder to GitHub.
2. In Render, choose `New +` -> `Blueprint`.
3. Connect the repo and deploy.
4. Set `PUBLIC_BASE_URL` to your live Render URL, for example `https://your-app.onrender.com`.

Render is a good fit for ZEST because it supports public Node apps and Socket.IO-style real-time connections. Free hosting plans can change, so check Render’s current free-tier limits before treating it as permanent production infrastructure.

## Product note

This build is intentionally original and does not copy Overwatch 2 assets, characters, maps, or exact mechanics.
