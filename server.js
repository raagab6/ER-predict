const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

app.use(express.static(path.join(__dirname, "public")));

function createSeed(input) {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function getTimeRange(hour) {
  if (hour >= 6 && hour < 12) {
    return { min: 20, max: 40, label: "Morning" };
  }

  if (hour >= 12 && hour < 18) {
    return { min: 40, max: 70, label: "Afternoon" };
  }

  return { min: 60, max: 100, label: "Night" };
}

function getStatusLabel(waitTime) {
  if (waitTime < 40) {
    return "Fast";
  }

  if (waitTime <= 70) {
    return "Moderate";
  }

  return "Busy";
}

function estimateWaitTime(hospital, coordinates) {
  const hour = new Date().getHours();
  const range = getTimeRange(hour);
  const latDiff = Math.abs((hospital.geometry?.location?.lat || 0) - coordinates.lat);
  const lngDiff = Math.abs((hospital.geometry?.location?.lng || 0) - coordinates.lng);
  const distanceBias = Math.round((latDiff + lngDiff) * 120);
  const locationSeed = createSeed(
    `${hospital.place_id}:${hospital.geometry?.location?.lat}:${hospital.geometry?.location?.lng}:${hour}`
  );
  const randomOffset = locationSeed % (range.max - range.min + 1);
  const weightedAverage = range.min + randomOffset + Math.floor(distanceBias / 2);
  const estimatedWait = clamp(weightedAverage, range.min, range.max);

  return {
    estimatedWait,
    status: getStatusLabel(estimatedWait),
    period: range.label
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ER-Predict/1.0",
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}

async function geocodeLocation(location) {
  if (API_KEY) {
    const geocodeUrl =
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}` +
      `&key=${API_KEY}`;
    const geocodeData = await fetchJson(geocodeUrl);

    if (geocodeData.status !== "OK" || !geocodeData.results?.length) {
      throw new Error(geocodeData.error_message || "Location could not be resolved.");
    }

    return {
      lat: geocodeData.results[0].geometry.location.lat,
      lng: geocodeData.results[0].geometry.location.lng,
      source: "Google Geocoding"
    };
  }

  const nominatimUrl =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(location)}`;
  const nominatimData = await fetchJson(nominatimUrl);

  if (!Array.isArray(nominatimData) || !nominatimData.length) {
    throw new Error("Location could not be resolved.");
  }

  return {
    lat: Number(nominatimData[0].lat),
    lng: Number(nominatimData[0].lon),
    source: "OpenStreetMap Nominatim"
  };
}

async function findHospitals(lat, lng) {
  if (API_KEY) {
    const placesUrl =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}` +
      `&radius=5000&type=hospital&key=${API_KEY}`;
    const placesData = await fetchJson(placesUrl);

    if (placesData.status !== "OK" && placesData.status !== "ZERO_RESULTS") {
      throw new Error(placesData.error_message || "Hospital lookup failed.");
    }

    return placesData.results.map((hospital) => ({
      name: hospital.name,
      address: hospital.vicinity || hospital.formatted_address || "Address unavailable",
      place_id: hospital.place_id,
      geometry: hospital.geometry,
      mapUrl: `https://www.google.com/maps/place/?q=place_id:${hospital.place_id}`
    }));
  }

  const overpassQuery = `
    [out:json][timeout:25];
    (
      node["amenity"="hospital"](around:5000,${lat},${lng});
      way["amenity"="hospital"](around:5000,${lat},${lng});
      relation["amenity"="hospital"](around:5000,${lat},${lng});
    );
    out center tags 15;
  `;

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "User-Agent": "ER-Predict/1.0"
    },
    body: overpassQuery
  });

  if (!response.ok) {
    throw new Error(`Hospital lookup failed with status ${response.status}`);
  }

  const overpassData = await response.json();
  const hospitals = Array.isArray(overpassData.elements) ? overpassData.elements : [];

  return hospitals
    .map((hospital) => {
      const hospitalLat = hospital.lat ?? hospital.center?.lat;
      const hospitalLng = hospital.lon ?? hospital.center?.lon;

      if (typeof hospitalLat !== "number" || typeof hospitalLng !== "number") {
        return null;
      }

      const tags = hospital.tags || {};
      const addressParts = [
        tags["addr:housenumber"],
        tags["addr:street"],
        tags["addr:city"] || tags["addr:town"] || tags["addr:village"]
      ].filter(Boolean);
      const name = tags.name || "Hospital";

      return {
        name,
        address: addressParts.join(", ") || "Address unavailable",
        place_id: `osm-${hospital.type}-${hospital.id}`,
        geometry: {
          location: {
            lat: hospitalLat,
            lng: hospitalLng
          }
        },
        mapUrl: `https://www.google.com/maps/search/?api=1&query=${hospitalLat},${hospitalLng}`
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aSeed = createSeed(`${a.name}:${a.place_id}`);
      const bSeed = createSeed(`${b.name}:${b.place_id}`);
      return aSeed - bSeed;
    });
}

app.get("/hospitals", async (req, res) => {
  const location = req.query.location?.trim();

  if (!location) {
    return res.status(400).json({
      error: "Please provide a location using /hospitals?location=USER_INPUT"
    });
  }

  try {
    const geocodeResult = await geocodeLocation(location);
    const coordinates = {
      lat: geocodeResult.lat,
      lng: geocodeResult.lng
    };
    const hospitals = await findHospitals(coordinates.lat, coordinates.lng);

    const topHospitals = hospitals.slice(0, 5).map((hospital) => {
      const waitInfo = estimateWaitTime(hospital, coordinates);

      return {
        name: hospital.name,
        address: hospital.address || "Address unavailable",
        place_id: hospital.place_id,
        estimatedWait: waitInfo.estimatedWait,
        status: waitInfo.status,
        period: waitInfo.period,
        mapUrl: hospital.mapUrl
      };
    });

    return res.json({
      searchedLocation: location,
      coordinates,
      hospitals: topHospitals,
      mode: API_KEY ? "live" : "public",
      source: API_KEY
        ? "Google Geocoding + Google Places"
        : `${geocodeResult.source} + OpenStreetMap Overpass`
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Unexpected server error."
    });
  }
});

app.listen(PORT, () => {
  console.log(`ER-Predict running at http://localhost:${PORT}`);
});
