// 3D globe rendering for the Map Overview page. A real WebGL sphere,
// not a CSS/SVG approximation - textured with the world map drawn via
// an equirectangular D3 projection onto a canvas, which maps directly
// and simply to sphere UV coordinates (u = longitude, v = latitude).
//
// Country hover detection: raycast from the pointer into the scene,
// find where it hits the sphere, convert that 3D point back to
// latitude/longitude (the exact inverse of the UV mapping below -
// verified by round-trip testing against many reference points before
// this was written), then reuse the same GeoJSON country polygons the
// flat map already has via d3.geoContains to find which country (if
// any) contains that point. This avoids needing separate, complex 3D
// country meshes just for hit-testing - one flat data source drives
// both views.
//
// City markers are real small 3D meshes (not part of the texture),
// positioned with the forward version of that same verified formula,
// and raycast directly - checked before the country surface, since
// they're the smaller, more specific target sitting on top of it.

import * as THREE from "./vendor/three/three.module.min.js";
import { OrbitControls } from "./vendor/three/OrbitControls.js";

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Draws the world map onto a canvas using D3's equirectangular
// projection - u (0..1) maps linearly to longitude (-180..180), v
// (0..1) maps linearly to latitude (+90..-90), which is exactly what
// this texture needs to align correctly with the sphere geometry.
// Borders are stroked after every country is filled, deliberately more
// prominent than the city marker styling below - establishes the same
// visual hierarchy (country outline >> city dot) the flat map uses.
function buildGlobeTexture(geojson, statsByName, densityActive) {
  const canvas = document.createElement("canvas");
  canvas.width = 4096;
  canvas.height = 2048;
  const ctx = canvas.getContext("2d");

  const oceanColor = cssVar("--panel-raised", "#221e1a");
  const landColor = cssVar("--border", "#33302a");
  const huntedColor = cssVar("--accent", "#ff6a3d");
  const graticuleColor = cssVar("--text-muted", "#948d80");

  ctx.fillStyle = oceanColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const projection = d3.geoEquirectangular().fitSize([canvas.width, canvas.height], { type: "Sphere" });
  const path = d3.geoPath(projection, ctx);

  // Graticule (lat/lon grid) drawn first, under the country fills - shows
  // through over open ocean, matching the reference's classic globe look.
  ctx.beginPath();
  path(d3.geoGraticule10());
  ctx.lineWidth = 1;
  ctx.strokeStyle = graticuleColor;
  ctx.globalAlpha = 0.35;
  ctx.stroke();
  ctx.globalAlpha = 1;

  geojson.features.forEach((feature) => {
    const isHunted = !!statsByName[feature.properties.name];
    ctx.beginPath();
    path(feature);
    ctx.fillStyle = isHunted && !densityActive ? huntedColor : landColor;
    ctx.fill();
  });

  return canvas;
}

// Forward: lat/lon -> XYZ on a unit sphere. The exact inverse of
// xyzToLatLon below - both verified together by round-trip testing
// against many reference points (poles, equator, several real cities)
// before either was used here.
function latLonToXYZ(lat, lon, radius = 1) {
  const u = (lon + 180) / 360;
  const v = (90 - lat) / 180;
  const theta = u * 2 * Math.PI;
  const phi = v * Math.PI;
  return new THREE.Vector3(-radius * Math.cos(theta) * Math.sin(phi), radius * Math.cos(phi), radius * Math.sin(theta) * Math.sin(phi));
}

// Inverse: XYZ -> lat/lon.
function xyzToLatLon(x, y, z) {
  const phi = Math.acos(Math.max(-1, Math.min(1, y)));
  let theta = Math.atan2(z, -x);
  if (theta < 0) theta += 2 * Math.PI;
  const v = phi / Math.PI;
  const u = theta / (2 * Math.PI);
  return { lat: 90 - v * 180, lon: u * 360 - 180 };
}

const DEFAULT_CAMERA_POS = { x: 0, y: 0, z: 2.6 };

let scene, camera, renderer, controls, globeMesh, animationId;
let currentGeojson, currentStatsByName, currentCities, onHoverCb, onCityHoverCb, onCountryEmptyHoverCb, onLeaveCb;
let resizeObserver;
let cityMarkers = []; // [{ mesh, city }]
let cityMarkerGeometry, cityMarkerMaterial;

let borderLines = null;
let stateBorderLines = null;

function buildCountryBorderLines(geojson) {
  const positions = [];

  function addRing(ring) {
    for (let i = 0; i < ring.length; i++) {
      const [lon1, lat1] = ring[i];
      const [lon2, lat2] = ring[(i + 1) % ring.length];
      const p1 = latLonToXYZ(lat1, lon1, 1.003);
      const p2 = latLonToXYZ(lat2, lon2, 1.003);
      positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
  }

  geojson.features.forEach((feature) => {
    const geom = feature.geometry;
    if (!geom) return;
    if (geom.type === "Polygon") {
      geom.coordinates.forEach(addRing);
    } else if (geom.type === "MultiPolygon") {
      geom.coordinates.forEach((polygon) => polygon.forEach(addRing));
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: cssVar("--map-border-color", "#ffffff") });
  return new THREE.LineSegments(geometry, material);
}

// Same line-segment technique as country borders, but deliberately
// lower opacity - WebGL doesn't reliably support variable line width
// across platforms (most browsers ignore linewidth > 1), so opacity is
// the reliable way to keep state borders visually subordinate to
// country borders, sitting fractionally further out to avoid z-fighting.
function buildStateBorderLines(statesGeojson) {
  const positions = [];

  function addRing(ring) {
    for (let i = 0; i < ring.length; i++) {
      const [lon1, lat1] = ring[i];
      const [lon2, lat2] = ring[(i + 1) % ring.length];
      const p1 = latLonToXYZ(lat1, lon1, 1.004);
      const p2 = latLonToXYZ(lat2, lon2, 1.004);
      positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
  }

  statesGeojson.features.forEach((feature) => {
    const geom = feature.geometry;
    if (!geom) return;
    if (geom.type === "Polygon") {
      geom.coordinates.forEach(addRing);
    } else if (geom.type === "MultiPolygon") {
      geom.coordinates.forEach((polygon) => polygon.forEach(addRing));
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: cssVar("--map-border-color", "#ffffff"), transparent: true, opacity: 0.4 });
  return new THREE.LineSegments(geometry, material);
}

function buildCityMarkers(cities) {
  cityMarkers.forEach((m) => globeMesh.remove(m.mesh));
  cityMarkers = [];
  if (!cities || !cities.length) return;

  cityMarkerGeometry = cityMarkerGeometry || new THREE.SphereGeometry(0.012, 12, 12);
  const markerColor = cssVar("--accent", "#ff6a3d");
  cityMarkerMaterial = cityMarkerMaterial || new THREE.MeshBasicMaterial({ color: markerColor });

  cities
    .filter((c) => c.lat != null && c.lng != null)
    .forEach((city) => {
      const mesh = new THREE.Mesh(cityMarkerGeometry, cityMarkerMaterial);
      const pos = latLonToXYZ(city.lat, city.lng, 1.01); // sits just above the surface - avoids z-fighting with the sphere itself
      mesh.position.copy(pos);
      mesh.userData.city = city;
      globeMesh.add(mesh);
      cityMarkers.push({ mesh, city });
    });
}

// Same deterministic pseudo-random generator the flat map uses, seeded
// on a city's own id - the same city always gets the same scattered
// dot pattern rather than reshuffling on every toggle.
function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

let densityDotMeshes = [];
let densityDotGeometry, densityDotMaterial;

function setDensityDots(cities, active) {
  densityDotMeshes.forEach((m) => globeMesh.remove(m));
  densityDotMeshes = [];
  if (!active) return;

  densityDotGeometry = densityDotGeometry || new THREE.SphereGeometry(0.006, 6, 6);
  densityDotMaterial = densityDotMaterial || new THREE.MeshBasicMaterial({ color: cssVar("--accent", "#ff6a3d"), transparent: true, opacity: 0.55 });

  cities
    .filter((c) => c.lat != null && c.lng != null)
    .forEach((city) => {
      const dotCount = Math.min(140, Math.max(6, city.leadsScraped));
      const rand = seededRandom(city.catchLogId * 7919);
      for (let i = 0; i < dotCount; i++) {
        const angle = rand() * Math.PI * 2;
        // Center-biased (sqrt of a uniform random) for an organic
        // stippled-area look rather than a hard-edged ring, matching
        // the same technique the flat map uses.
        const dist = Math.sqrt(rand()) * 3.2; // degrees
        const offsetLat = city.lat + Math.sin(angle) * dist;
        const offsetLon = city.lng + Math.cos(angle) * dist;
        const mesh = new THREE.Mesh(densityDotGeometry, densityDotMaterial);
        mesh.position.copy(latLonToXYZ(offsetLat, offsetLon, 1.008));
        globeMesh.add(mesh);
        densityDotMeshes.push(mesh);
      }
    });
}

function initGlobe(container, geojson, statesGeojson, statsByName, cities, { onHover, onCityHover, onCountryEmptyHover, onLeave } = {}) {
  currentGeojson = geojson;
  currentStatsByName = statsByName;
  currentCities = cities;
  onHoverCb = onHover;
  onCityHoverCb = onCityHover;
  onCountryEmptyHoverCb = onCountryEmptyHover;
  onLeaveCb = onLeave;

  const width = container.clientWidth || 900;
  const height = container.clientHeight || 640;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(DEFAULT_CAMERA_POS.x, DEFAULT_CAMERA_POS.y, DEFAULT_CAMERA_POS.z);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.innerHTML = "";
  container.appendChild(renderer.domElement);

  const texture = new THREE.CanvasTexture(buildGlobeTexture(geojson, statsByName, false));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.needsUpdate = true;

  const geometry = new THREE.SphereGeometry(1, 64, 64);
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 });
  globeMesh = new THREE.Mesh(geometry, material);
  scene.add(globeMesh);

  // Real lighting for genuine visible 3D depth (a soft shading gradient
  // toward the globe's edge), rather than a flat, unlit sphere. Ambient
  // is kept fairly strong so the theme's own colors stay clearly
  // recognizable rather than washing out into heavy shadow.
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
  keyLight.position.set(3, 2, 4);
  scene.add(keyLight);

  borderLines = buildCountryBorderLines(geojson);
  globeMesh.add(borderLines);

  if (statesGeojson) {
    stateBorderLines = buildStateBorderLines(statesGeojson);
    globeMesh.add(stateBorderLines);
  }

  buildCityMarkers(cities);

  controls = new OrbitControls(camera, renderer.domElement);
  window.__mapGlobeDebug = { mesh: globeMesh, controls, camera };
  controls.enablePan = false;
  controls.minDistance = 1.4;
  controls.maxDistance = 4;
  controls.rotateSpeed = 0.5;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  const raycaster = new THREE.Raycaster();
  raycaster.params.Mesh.threshold = 0.02; // slightly forgiving hit radius for the small city markers
  const pointer = new THREE.Vector2();
  let userInteracted = false;

  // City markers are checked first (smaller, more specific target sitting
  // on top of the country surface), falling back to the country lookup.
  function findHoverTargetAtPointer(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    if (cityMarkers.length) {
      const cityHits = raycaster.intersectObjects(cityMarkers.map((m) => m.mesh));
      if (cityHits.length) {
        const hitMesh = cityHits[0].object;
        const found = cityMarkers.find((m) => m.mesh === hitMesh);
        if (found) return { type: "city", data: found.city };
      }
    }

    const hits = raycaster.intersectObject(globeMesh);
    if (!hits.length) return null;
    const localPoint = globeMesh.worldToLocal(hits[0].point.clone());
    const { lat, lon } = xyzToLatLon(localPoint.x, localPoint.y, localPoint.z);
    const feature = currentGeojson.features.find((f) => d3.geoContains(f, [lon, lat]));
    if (!feature) return null;
    const stat = currentStatsByName[feature.properties.name];
    return stat ? { type: "country", data: stat } : { type: "country-empty", data: feature.properties.name };
  }

  function onPointerMove(event) {
    if (!userInteracted) {
      userInteracted = true;
      controls.autoRotate = false; // stop auto-rotating the moment the person shows interest
    }
    const target = findHoverTargetAtPointer(event.clientX, event.clientY);
    if (target && target.type === "city" && onCityHoverCb) onCityHoverCb(event, target.data);
    else if (target && target.type === "country" && onHoverCb) onHoverCb(event, target.data);
    else if (target && target.type === "country-empty" && onCountryEmptyHoverCb) onCountryEmptyHoverCb(event, target.data);
    else if (onLeaveCb) onLeaveCb();
  }
  function onPointerLeave() {
    if (onLeaveCb) onLeaveCb();
  }
  function onPointerDown() {
    userInteracted = true;
    controls.autoRotate = false;
  }

  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerleave", onPointerLeave);
  renderer.domElement.addEventListener("pointerdown", onPointerDown);

  function animate() {
    animationId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  resizeObserver.observe(container);

  return {
    resetView() {
      controls.autoRotate = true;
      userInteracted = false;
      camera.position.set(DEFAULT_CAMERA_POS.x, DEFAULT_CAMERA_POS.y, DEFAULT_CAMERA_POS.z);
      controls.target.set(0, 0, 0);
      globeMesh.rotation.set(0, 0, 0);
      controls.update();
    },
    setDensityFilter(active) {
      setDensityDots(currentCities || [], active);
      texture.image = buildGlobeTexture(currentGeojson, currentStatsByName, active);
      texture.needsUpdate = true;
    },
    destroy() {
      cancelAnimationFrame(animationId);
      if (resizeObserver) resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      if (borderLines) {
        borderLines.geometry.dispose();
        borderLines.material.dispose();
        borderLines = null;
      }
      if (stateBorderLines) {
        stateBorderLines.geometry.dispose();
        stateBorderLines.material.dispose();
        stateBorderLines = null;
      }
      if (cityMarkerGeometry) cityMarkerGeometry.dispose();
      if (cityMarkerMaterial) cityMarkerMaterial.dispose();
      cityMarkerGeometry = null;
      cityMarkerMaterial = null;
      cityMarkers = [];
      if (densityDotGeometry) densityDotGeometry.dispose();
      if (densityDotMaterial) densityDotMaterial.dispose();
      densityDotGeometry = null;
      densityDotMaterial = null;
      densityDotMeshes = [];
      renderer.dispose();
    },
  };
}

window.MapGlobe = { initGlobe, xyzToLatLon, latLonToXYZ };
