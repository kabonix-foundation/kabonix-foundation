// maps.js — Location picker for M&E forms.
//
// Renders a Leaflet map for any .map-picker[data-field] element, lets the
// field officer click a point or use device GPS, and exposes the selected
// coordinates through window.__meMapPickers[fieldId] so app.js can read them
// at submit time. No MutationObserver — app.js calls window.__mapPickerScan()
// after rendering a form, keeping the render path explicit and cheap.
//
// Tiles: OpenStreetMap. Free, no API key. If you later want satellite imagery,
// add a second tileLayer from Mapbox/Sentinel and toggle between them.

(() => {
  if (window.__kabonixMapsLoaded) return;
  window.__kabonixMapsLoaded = true;

  // Tanzania centroid — sensible default when a field officer opens the form
  // before navigating to the actual site.
  const TZ_CENTER = [-6.369028, 34.888822];

  const pickers = new Map();   // fieldId -> { getValue, setValue, clear, invalidate }
  window.__meMapPickers = pickers;

  function makeMarkerIcon() {
    // Leaflet's default marker icons need explicit URLs when not bundled.
    return L.icon({
      iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize:      [25, 41],
      iconAnchor:    [12, 41],
      shadowSize:    [41, 41],
    });
  }

  function tileLayer() {
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
  }

  function initPicker(el) {
    if (!window.L) {
      console.warn('[maps] Leaflet not loaded — map picker skipped');
      return;
    }
    if (el.dataset.mpReady === '1') return;

    const fieldId = el.dataset.field;
    if (!fieldId) return;

    const field = el.closest('.field-map');
    const readout = field?.querySelector(`[data-map-readout]`);

    const map = L.map(el, {
      center: TZ_CENTER,
      zoom: 6,
      scrollWheelZoom: true,
      attributionControl: true,
    });
    tileLayer().addTo(map);

    let marker = null;
    let lat = null, lng = null;

    function updateReadout() {
      if (!readout) return;
      if (lat == null || lng == null) {
        readout.textContent = 'No location selected';
        readout.classList.remove('has-value');
      } else {
        readout.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        readout.classList.add('has-value');
      }
    }

    function setPoint(newLat, newLng, { pan = false } = {}) {
      lat = Number(newLat);
      lng = Number(newLng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (marker) {
        marker.setLatLng([lat, lng]);
      } else {
        marker = L.marker([lat, lng], { draggable: true, icon: makeMarkerIcon() }).addTo(map);
        marker.on('dragend', () => {
          const ll = marker.getLatLng();
          lat = ll.lat; lng = ll.lng;
          updateReadout();
        });
      }
      if (pan) map.setView([lat, lng], Math.max(map.getZoom(), 15));
      updateReadout();
    }

    function clearPoint() {
      if (marker) { map.removeLayer(marker); marker = null; }
      lat = null; lng = null;
      updateReadout();
    }

    map.on('click', e => setPoint(e.latlng.lat, e.latlng.lng));

    // Toolbar: locate me / clear
    field?.querySelector('[data-map-locate]')?.addEventListener('click', () => {
      if (!navigator.geolocation) {
        alert('Your browser does not support geolocation.');
        return;
      }
      const btn = field.querySelector('[data-map-locate]');
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = '📍 Locating…';
      navigator.geolocation.getCurrentPosition(
        pos => {
          setPoint(pos.coords.latitude, pos.coords.longitude, { pan: true });
          btn.disabled = false;
          btn.textContent = original;
        },
        err => {
          btn.disabled = false;
          btn.textContent = original;
          alert('Could not get your location: ' + err.message);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    });

    field?.querySelector('[data-map-clear]')?.addEventListener('click', clearPoint);

    pickers.set(fieldId, {
      getValue: () => (lat != null && lng != null ? { lat, lng } : null),
      setValue: (la, ln) => setPoint(la, ln, { pan: true }),
      clear: clearPoint,
      invalidate: () => map.invalidateSize(),
    });

    // If the container was hidden (e.g. inside a just-unhidden panel),
    // Leaflet needs a size hint after layout has settled.
    setTimeout(() => map.invalidateSize(), 60);

    el.dataset.mpReady = '1';
  }

  function scan() {
    document.querySelectorAll('.map-picker[data-field]').forEach(initPicker);
  }
  window.__mapPickerScan = scan;

  // Initial scan for any pickers that existed before this script loaded.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan, { once: true });
  } else {
    scan();
  }
})();
