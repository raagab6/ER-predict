const form = document.getElementById("search-form");
const locationInput = document.getElementById("location-input");
const searchButton = document.getElementById("search-button");
const resultsContainer = document.getElementById("results");
const statusMessage = document.getElementById("status-message");
const meta = document.getElementById("meta");

function setStatus(message, type = "") {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`.trim();
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

function renderHospitals(hospitals) {
  if (!hospitals.length) {
    resultsContainer.innerHTML = `<div class="empty-state">No hospitals were found within 5 km of that location.</div>`;
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

async function searchHospitals(location) {
  setStatus("Looking up nearby hospitals and estimating ER wait times...", "loading");
  searchButton.disabled = true;
  resultsContainer.innerHTML = "";

  try {
    const response = await fetch(`/hospitals?location=${encodeURIComponent(location)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to load hospitals.");
    }

    const modeLabel =
      data.mode === "live"
        ? "Live Google hospital data"
        : "Public no-key hospital data";
    meta.textContent = `${modeLabel}. Showing the top ${data.hospitals.length} hospitals near ${data.searchedLocation}.`;
    setStatus(`Search complete. Compare speed, status, and map access below.`);
    renderHospitals(data.hospitals);
  } catch (error) {
    setStatus(error.message, "error");
    resultsContainer.innerHTML =
      '<div class="empty-state">Try another city or address. This app now works without API keys by using public geocoding and hospital data sources.</div>';
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
