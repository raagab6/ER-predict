const form = document.getElementById("search-form");
const locationInput = document.getElementById("location-input");
const searchButton = document.getElementById("search-button");
const resultsContainer = document.getElementById("results");
const statusMessage = document.getElementById("status-message");
const meta = document.getElementById("meta");

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

function getTimeRange(hour) {
  if (hour >= 6 && hour < 12) {
    return { min: 20, max: 40, label: "Morning" };
  }

  if (hour >= 12 && hour < 18) {
    return { min: 40, max: 70, label: "Afternoon" };
  }

  return { min: 60, max: 100, label: "Night" };
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

function getStatusLabel(waitTime) {
  if (waitTime < 40) {
    return "Fast";
  }

  if (waitTime <= 70) {
    return "Moderate";
  }

  return "Busy";
}

function setStatus(message, type = "") {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`.trim();
}

function estimateWaitTime(hospital, coordinates) {
  const hour = new Date().getHours();
  const range = getTimeRange(hour);
  const latDiff = Math.abs(hospital.lat - coordinates.lat);
  const lngDiff = Math.abs(hospital.lng - coordinates.lng);
  const distanceBias = Math.round((latDiff + lngDiff) * 120);
  const locationSeed = createSeed(`${hospital.placeId}:${hospital.lat}:${hospital.lng}:${hour}`);
  const randomOffset = locationSeed % (range.max - range.min + 1);
  const weightedAverage = range.min + randomOffset + Math.floor(distanceBias / 2);
  const estimatedWait = clamp(weightedAverage, range.min, range.max);

  return {
    estimatedWait,
    status: getStatusLabel(estimatedWait),
    period: range.label
  };
}

function renderHospitals(hospitals) {
  if (!hospitals.length) {
    resultsContainer.innerHTML =
      '<div class="empty-state">No hospitals were found within 5 km of that location.</div>';
    return;
  }

  resultsContainer.innerHTML = hospitals
    .map(
      (hospital) => `
        <a class="hospital-card" href="${hospital.mapUrl}" target="_blank" rel="noreferrer">
          <div>
            <h3>${hospital.name}</h3>
            <div class="hospital-location">${hospital.address}</div>
          </div>

          <div class="wait-row">
            <div class="wait-time">
              <strong>${hospital.estimatedWait}</strong>
              <span>minutes</span>
            </div>
            <span class="status-badge ${getStatusClass(hospital.status)}">${hospital.status}</span>
          </div>

          <div class="hospital-footer">
            <span>${hospital.period} traffic pattern applied</span>
            <span class="card-link">Open in Maps</span>
          </div>
        </a>
      `
    )
    .join("");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}

async function geocodeLocation(location) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(location)}`;
  const data = await fetchJson(url);

  if (!Array.isArray(data) || !data.length) {
    throw new Error("Location could not be resolved.");
  }

  return {
    lat: Number(data[0].lat),
    lng: Number(data[0].lon)
  };
}

async function findHospitals(coordinates) {
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="hospital"](around:5000,${coordinates.lat},${coordinates.lng});
      way["amenity"="hospital"](around:5000,${coordinates.lat},${coordinates.lng});
      relation["amenity"="hospital"](around:5000,${coordinates.lat},${coordinates.lng});
    );
    out center tags 15;
  `;

  const data = await fetchJson("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8"
    },
    body: query
  });

  const hospitals = Array.isArray(data.elements) ? data.elements : [];

  return hospitals
    .map((hospital) => {
      const lat = hospital.lat ?? hospital.center?.lat;
      const lng = hospital.lon ?? hospital.center?.lon;

      if (typeof lat !== "number" || typeof lng !== "number") {
        return null;
      }

      const tags = hospital.tags || {};
      const address = [
        tags["addr:housenumber"],
        tags["addr:street"],
        tags["addr:city"] || tags["addr:town"] || tags["addr:village"]
      ]
        .filter(Boolean)
        .join(", ");

      return {
        name: tags.name || "Hospital",
        address: address || "Address unavailable",
        placeId: `osm-${hospital.type}-${hospital.id}`,
        lat,
        lng,
        mapUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
      };
    })
    .filter(Boolean)
    .sort((a, b) => createSeed(`${a.name}:${a.placeId}`) - createSeed(`${b.name}:${b.placeId}`))
    .slice(0, 5)
    .map((hospital) => {
      const waitInfo = estimateWaitTime(hospital, coordinates);

      return {
        ...hospital,
        estimatedWait: waitInfo.estimatedWait,
        status: waitInfo.status,
        period: waitInfo.period
      };
    });
}

async function searchHospitals(location) {
  setStatus("Looking up nearby hospitals and estimating ER wait times...", "loading");
  searchButton.disabled = true;
  resultsContainer.innerHTML = "";

  try {
    const coordinates = await geocodeLocation(location);
    const hospitals = await findHospitals(coordinates);

    meta.textContent = `Public no-key hospital data. Showing the top ${hospitals.length} hospitals near ${location}.`;
    setStatus("Search complete. Compare speed, status, and map access below.");
    renderHospitals(hospitals);
  } catch (error) {
    setStatus(error.message || "Unable to load hospitals.", "error");
    resultsContainer.innerHTML =
      '<div class="empty-state">Try another city or address. Public map services can also rate-limit busy requests on free hosting.</div>';
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
