# ER-Predict

ER-Predict includes:

- A static GitHub Pages-ready app at the repository root
- An Express version kept in `/public` + [server.js](C:/Users/kusha/Documents/Codex/2026-04-18-build-a-full-stack-web-app/server.js)

The static version works without API keys and is the one to deploy to GitHub Pages.

## Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js with Express

## GitHub Pages

Deploy these root files directly:

- [index.html](C:/Users/kusha/Documents/Codex/2026-04-18-build-a-full-stack-web-app/index.html)
- [styles.css](C:/Users/kusha/Documents/Codex/2026-04-18-build-a-full-stack-web-app/styles.css)
- [app.js](C:/Users/kusha/Documents/Codex/2026-04-18-build-a-full-stack-web-app/app.js)
- [404.html](C:/Users/kusha/Documents/Codex/2026-04-18-build-a-full-stack-web-app/404.html)

If you use GitHub Pages, make sure Pages is serving from the repo root on your selected branch.

## Express Version

1. Install dependencies:

```bash
npm install
```

2. Start the local Express app:

```bash
npm start
```

3. Optional: add `API_KEY` only if you want Google Maps Geocoding + Places instead of the built-in no-key public data mode:

```bash
set API_KEY=your_key_here
npm start
```

   PowerShell alternative:

   ```powershell
   $env:API_KEY="your_key_here"
   npm start
   ```

4. Open `http://localhost:3000`

If you do not set `API_KEY`, the app uses public OpenStreetMap-based lookup instead.

## API

`GET /hospitals?location=USER_INPUT`

Returns:

- `name`
- `address`
- `place_id`
- `estimatedWait`
- `status`
- `mapUrl`

## Notes

- The GitHub Pages version runs entirely in the browser and uses public OpenStreetMap services.
- Without `API_KEY`, the Express version geocodes locations with OpenStreetMap Nominatim and finds nearby hospitals with Overpass.
- With `API_KEY`, the app uses Google Geocoding API and Google Places Nearby Search instead.
- Wait time estimates are shaped by time of day and a location-based seed so different hospitals can surface different results.
- This project expects Node.js 18+ because it uses the built-in `fetch` API.
