# ER-Predict

ER-Predict is a full-stack Express app that helps users find nearby hospitals and compare estimated emergency room wait times in a clean, fast interface, even without API keys.

## Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js with Express

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Install and run:

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

- Without `API_KEY`, the app geocodes locations with OpenStreetMap Nominatim and finds nearby hospitals with Overpass.
- With `API_KEY`, the app uses Google Geocoding API and Google Places Nearby Search instead.
- Wait time estimates are shaped by time of day and a location-based seed so different hospitals can surface different results.
- This project expects Node.js 18+ because it uses the built-in `fetch` API.
