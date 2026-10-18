# TeamUp

Smart team formation for college projects. Node.js + Express backend, plain HTML/CSS/JS frontend.

## Run it on your laptop

1. Install Node.js (LTS version) from https://nodejs.org
2. Open a terminal inside this folder (`teamup`)
3. Run `npm install`
4. Run `npm start`
5. Open http://localhost:3000

Demo login: `aarav@demo.com` / `demo1234` (also isha@, rohan@, sneha@, kabir@, meera@ demo.com)

## Folder map

- `server.js`: the backend (API, login, matching logic, saves data to `data/db.json`)
- `public/index.html`: the page shell
- `public/style.css`: the look
- `public/app.js`: the frontend (screens, forms, calls to the API)
- `data/db.json`: created on first run. Delete it to reset the demo data.

## Host it free on Render

1. Put the folder on GitHub (`git init`, `git add .`, `git commit -m "TeamUp"`, push to a new repo)
2. On https://render.com choose New > Web Service and connect the repo
3. Build command: `npm install`  Start command: `npm start`
4. Click Deploy. You get a public link in about 2 minutes.

Note: on Render's free plan the saved data resets when the app restarts. That's fine for a demo. For a real product, swap the JSON file for MongoDB or PostgreSQL.
