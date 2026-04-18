const form = document.getElementById("search-form");
const locationInput = document.getElementById("location-input");
const urgencySelect = document.getElementById("urgency-select");
const insuranceSelect = document.getElementById("insurance-select");
const transportSelect = document.getElementById("transport-select");
const searchButton = document.getElementById("search-button");
const resultsContainer = document.getElementById("results");
const statusMessage = document.getElementById("status-message");
const meta = document.getElementById("meta");
const heroHospitalCount = document.getElementById("hero-hospital-count");
const heroModeLabel = document.getElementById("hero-mode-label");
const bestMatchLabel = document.getElementById("best-match-label");
const bestMatchCopy = document.getElementById("best-match-copy");
const arrivalLabel = document.getElementById("arrival-label");
const arrivalCopy = document.getElementById("arrival-copy");
const costLabel = document.getElementById("cost-label");
const costCopy = document.getElementById("cost-copy");
const exampleChips = Array.from(document.querySelectorAll(".example-chip"));

const GEOCODE_ENDPOINTS = [
  {
    label: "OpenStreetMap Nominatim",
    buildUrl: (location) =>
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(location)}`,
    parse: (data) => {
      if (!Array.isArray(data) || !data.length) {
        return null;
      }

      return {
        lat: Number(data[0].lat),
        lng: Number(data[0].lon),
        label: data[0].display_name || "Matched location"
      };
    }
  },
  {
    label: "Photon",
    buildUrl: (location) =>
      `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(location)}`,
    parse: (data) => {
      const feature = data?.features?.[0];

      if (!feature?.geometry?.coordinates) {
        return null;
      }

      return {
        lng: Number(feature.geometry.coordinates[0]),
        lat: Number(feature.geometry.coordinates[1]),
        label:
          feature.properties?.name ||
          feature.properties?.city ||
          feature.properties?.country ||
          "Matched location"
      };
    }
  }
];

const HOSPITAL_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];

const cache = {
  geocode: new Map(),
  hospitals: new Map()
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function createSeed(input) {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function setStatus(message, type = "") {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`.trim();
}

function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function normalizeLocation(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function getApproxLocalHour(lng) {
  const utcHour = new Date().getUTCHours();
  const offset = Math.round(lng / 15);
  return (utcHour + offset + 24) % 24;
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

function getStatusClass(status) {
  if (status === "Fast") {
    return "status-fast";
  }

  if (status === "Moderate") {
    return "status-moderate";
  }

  return "status-busy";
}

function buildHospitalQuery(lat, lng, radiusMeters) {
  return `
    [out:json][timeout:18];
    (
      node["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
      way["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
      relation["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
      node["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
      way["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
      relation["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
      node["emergency"="yes"]["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
      way["emergency"="yes"]["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
      relation["emergency"="yes"]["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
    );
    out center tags 60;
  `;
}

async function fetchJson(url, options = {}, timeoutMs = 12000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}

async function geocodeLocation(location) {
  const cacheKey = normalizeLocation(location);

  if (cache.geocode.has(cacheKey)) {
    return cache.geocode.get(cacheKey);
  }

  for (const endpoint of GEOCODE_ENDPOINTS) {
    try {
      const data = await fetchJson(endpoint.buildUrl(location), {}, 10000);
      const parsed = endpoint.parse(data);

      if (parsed) {
        const result = { ...parsed, source: endpoint.label };
        cache.geocode.set(cacheKey, result);
        return result;
      }
    } catch (error) {
      continue;
    }
  }

  throw new Error("We could not resolve that location right now.");
}

async function queryHospitalsFromEndpoint(endpoint, query) {
  const url = `${endpoint}?data=${encodeURIComponent(query)}`;
  return fetchJson(url, {}, 14000);
}

function mapHospitalElements(elements, coordinates) {
  const seen = new Set();

  return elements
    .map((hospital) => {
      const lat = hospital.lat ?? hospital.center?.lat;
      const lng = hospital.lon ?? hospital.center?.lon;

      if (typeof lat !== "number" || typeof lng !== "number") {
        return null;
      }

      const tags = hospital.tags || {};
      const name = tags.name || tags.operator || "Hospital";
      const address = [
        tags["addr:housenumber"],
        tags["addr:street"],
        tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || tags["addr:suburb"]
      ]
        .filter(Boolean)
        .join(", ");
      const uniqueKey = `${name}:${lat.toFixed(4)}:${lng.toFixed(4)}`;

      if (seen.has(uniqueKey)) {
        return null;
      }

      seen.add(uniqueKey);

      return {
        name,
        address: address || tags["addr:full"] || "Address unavailable",
        placeId: `osm-${hospital.type}-${hospital.id}`,
        lat,
        lng,
        mapUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
        distanceKm: haversineKm(coordinates.lat, coordinates.lng, lat, lng),
        tags
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

async function findHospitals(coordinates) {
  const cacheKey = `${coordinates.lat.toFixed(3)},${coordinates.lng.toFixed(3)}`;

  if (cache.hospitals.has(cacheKey)) {
    return cache.hospitals.get(cacheKey);
  }

  const radii = [5000, 9000, 14000];

  for (const radius of radii) {
    const query = buildHospitalQuery(coordinates.lat, coordinates.lng, radius);

    for (const endpoint of HOSPITAL_ENDPOINTS) {
      try {
        const data = await queryHospitalsFromEndpoint(endpoint, query);
        const hospitals = mapHospitalElements(data?.elements || [], coordinates);

        if (hospitals.length) {
          cache.hospitals.set(cacheKey, hospitals);
          return hospitals;
        }
      } catch (error) {
        continue;
      }
    }
  }

  throw new Error("Hospital data is temporarily busy. Please retry in a moment.");
}

function estimateTravelMinutes(distanceKm, transport) {
  const speedByTransport = {
    walk: 4.7,
    car: 32,
    rideshare: 28,
    ambulance: 42
  };
  const baseMinutes = (distanceKm / speedByTransport[transport]) * 60;
  const cityBuffer = transport === "walk" ? 3 : 7;
  return Math.max(4, Math.round(baseMinutes + cityBuffer));
}

function estimateInsuranceCost(hospital, insurance, urgency) {
  const baseByInsurance = {
    private: [180, 650],
    basic: [260, 850],
    government: [70, 280],
    international: [220, 900],
    none: [900, 2600]
  };
  const urgencyFactor = {
    mild: 0.9,
    moderate: 1,
    serious: 1.22,
    critical: 1.48
  };
  const specialtyBoost = /university|trauma|medical center|teaching/i.test(hospital.name) ? 1.12 : 1;
  const [low, high] = baseByInsurance[insurance] || baseByInsurance.private;
  const estimatedLow = Math.round(low * urgencyFactor[urgency] * specialtyBoost);
  const estimatedHigh = Math.round(high * urgencyFactor[urgency] * specialtyBoost);

  return `$${estimatedLow}-$${estimatedHigh}`;
}

function estimateWaitTime(hospital, context) {
  const localHour = getApproxLocalHour(context.coordinates.lng);
  const range = getTimeRange(localHour);
  const nameSeed = createSeed(`${hospital.placeId}:${hospital.name}:${localHour}`);
  const urgencyAdjustment = {
    mild: 10,
    moderate: 0,
    serious: -8,
    critical: -18
  };
  const transportAdjustment = {
    walk: 6,
    car: 0,
    rideshare: 2,
    ambulance: -10
  };
  const traumaAdjustment = /trauma|university|medical center|emergency/i.test(hospital.name) ? 8 : 0;
  const denseAreaAdjustment = context.nearbyCount > 10 ? 7 : context.nearbyCount > 5 ? 4 : 0;
  const distanceAdjustment = Math.round(Math.min(hospital.distanceKm, 8) * 1.6);
  const randomOffset = nameSeed % (range.max - range.min + 1);

  const estimatedWait = clamp(
    range.min +
      randomOffset +
      urgencyAdjustment[context.urgency] +
      transportAdjustment[context.transport] +
      traumaAdjustment +
      denseAreaAdjustment +
      distanceAdjustment,
    range.min,
    range.max + 18
  );

  const confidence = clamp(
    82 - hospital.distanceKm * 4 - Math.max(0, context.nearbyCount - 5) * 1.1,
    56,
    91
  );

  return {
    estimatedWait,
    status: getStatusLabel(estimatedWait),
    period: range.label,
    confidence
  };
}

function enrichHospitals(hospitals, context) {
  return hospitals.slice(0, 5).map((hospital) => {
    const waitInfo = estimateWaitTime(hospital, context);
    const travelMinutes = estimateTravelMinutes(hospital.distanceKm, context.transport);

    return {
      ...hospital,
      estimatedWait: waitInfo.estimatedWait,
      status: waitInfo.status,
      period: waitInfo.period,
      confidence: waitInfo.confidence,
      travelMinutes,
      totalMinutes: travelMinutes + waitInfo.estimatedWait,
      costEstimate: estimateInsuranceCost(hospital, context.insurance, context.urgency)
    };
  });
}

function renderHospitals(hospitals) {
  if (!hospitals.length) {
    resultsContainer.innerHTML =
      '<div class="empty-state">No hospitals were found nearby for that search. Try a larger city, district, or street address.</div>';
    return;
  }

  resultsContainer.innerHTML = hospitals
    .map(
      (hospital) => `
        <a class="hospital-card" href="${hospital.mapUrl}" target="_blank" rel="noreferrer">
          <div class="card-top">
            <div>
              <h3>${hospital.name}</h3>
              <div class="hospital-location">${hospital.address}</div>
            </div>
            <span class="status-badge ${getStatusClass(hospital.status)}">${hospital.status}</span>
          </div>

          <div class="metric-grid">
            <div class="metric-card">
              <span class="metric-label">Predicted ER wait</span>
              <strong class="metric-value">${hospital.estimatedWait} min</strong>
              <span class="metric-subtext">${hospital.period} pattern</span>
            </div>

            <div class="metric-card">
              <span class="metric-label">Estimated arrival</span>
              <strong class="metric-value">${hospital.travelMinutes} min</strong>
              <span class="metric-subtext">${hospital.distanceKm.toFixed(1)} km away</span>
            </div>

            <div class="metric-card">
              <span class="metric-label">Expected total time</span>
              <strong class="metric-value">${hospital.totalMinutes} min</strong>
              <span class="metric-subtext">Travel + first ER wait</span>
            </div>

            <div class="metric-card">
              <span class="metric-label">Insurance cost</span>
              <strong class="metric-value">${hospital.costEstimate}</strong>
              <span class="metric-subtext">Estimated out-of-pocket</span>
            </div>
          </div>

          <div>
            <span class="metric-label">Prediction confidence</span>
            <div class="confidence-bar">
              <div class="confidence-fill" style="width: ${hospital.confidence}%"></div>
            </div>
            <span class="metric-subtext">${hospital.confidence}% confidence from location, density, and time patterns</span>
          </div>

          <div class="card-footer">
            <span class="result-source">Open route and hospital location</span>
            <span class="card-link">View in Maps</span>
          </div>
        </a>
      `
    )
    .join("");
}

function updateSummary(hospitals) {
  if (!hospitals.length) {
    bestMatchLabel.textContent = "Waiting for search";
    bestMatchCopy.textContent = "Your fastest nearby option will appear here.";
    arrivalLabel.textContent = "-";
    arrivalCopy.textContent = "Travel-aware timing appears after search.";
    costLabel.textContent = "-";
    costCopy.textContent = "Out-of-pocket estimate updates with your coverage.";
    return;
  }

  const best = hospitals[0];
  bestMatchLabel.textContent = best.name;
  bestMatchCopy.textContent = `${best.status} status with an estimated ${best.estimatedWait}-minute ER wait.`;
  arrivalLabel.textContent = `${best.travelMinutes} min`;
  arrivalCopy.textContent = `${best.distanceKm.toFixed(1)} km away with your selected arrival mode.`;
  costLabel.textContent = best.costEstimate;
  costCopy.textContent = "Estimated patient cost based on insurance and urgency profile.";
}

async function searchHospitals(location) {
  setStatus("Searching locations and nearby hospitals...", "loading");
  searchButton.disabled = true;
  resultsContainer.innerHTML = "";

  try {
    const geocoded = await geocodeLocation(location);
    const hospitals = await findHospitals(geocoded);
    const enriched = enrichHospitals(hospitals, {
      coordinates: geocoded,
      urgency: urgencySelect.value,
      insurance: insuranceSelect.value,
      transport: transportSelect.value,
      nearbyCount: hospitals.length
    }).sort((a, b) => a.totalMinutes - b.totalMinutes || a.estimatedWait - b.estimatedWait);

    heroHospitalCount.textContent = String(enriched.length);
    heroModeLabel.textContent = "Ready";
    meta.textContent = `Showing ${enriched.length} hospitals near ${geocoded.label || location}. Ranked by total predicted time to care.`;
    setStatus("Search complete. Compare speed, travel, and cost below.");
    renderHospitals(enriched);
    updateSummary(enriched);
  } catch (error) {
    heroModeLabel.textContent = "Retry";
    setStatus(error.message || "Unable to load hospital data.", "error");
    resultsContainer.innerHTML =
      '<div class="empty-state">Hospital search is temporarily overloaded on the public map network. Try the search again, use a larger nearby city, or tap an example chip to re-run quickly.</div>';
    updateSummary([]);
  } finally {
    searchButton.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const location = locationInput.value.trim();

  if (!location) {
    setStatus("Enter a city or address to start.", "error");
    return;
  }

  searchHospitals(location);
});

exampleChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    const location = chip.dataset.location || "";
    locationInput.value = location;
    searchHospitals(location);
  });
});

[urgencySelect, insuranceSelect, transportSelect].forEach((control) => {
  control.addEventListener("change", () => {
    const location = locationInput.value.trim();

    if (location && resultsContainer.children.length) {
      searchHospitals(location);
    }
  });
});
