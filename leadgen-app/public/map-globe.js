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
function buildGlobeTexture(geojson, statsByName) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");

  const oceanColor = cssVar("--panel-raised", "#221e1a");
  const landColor = cssVar("--border", "#33302a");
  const huntedColor = cssVar("--accent", "#ff6a3d");
  const borderColor = oceanColor;
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
    ctx.fillStyle = isHunted ? huntedColor : landColor;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
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
let currentGeojson, currentStatsByName, onHoverCb, onCityHoverCb, onLeaveCb;
let resizeObserver;
let cityMarkers = []; // [{ mesh, city }]
let cityMarkerGeometry, cityMarkerMaterial;

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

function initGlobe(container, geojson, statsByName, cities, { onHover, onCityHover, onLeave } = {}) {
  currentGeojson = geojson;
  currentStatsByName = statsByName;
  onHoverCb = onHover;
  onCityHoverCb = onCityHover;
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

  const texture = new THREE.CanvasTexture(buildGlobeTexture(geojson, statsByName));
  texture.colorSpace = THREE.SRGBColorSpace;
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
    const feature = currentGeojson.features.find((f) => currentStatsByName[f.properties.name] && d3.geoContains(f, [lon, lat]));
    return feature ? { type: "country", data: currentStatsByName[feature.properties.name] } : null;
  }

  function onPointerMove(event) {
    if (!userInteracted) {
      userInteracted = true;
      controls.autoRotate = false; // stop auto-rotating the moment the person shows interest
    }
    const target = findHoverTargetAtPointer(event.clientX, event.clientY);
    if (target && target.type === "city" && onCityHoverCb) onCityHoverCb(event, target.data);
    else if (target && target.type === "country" && onHoverCb) onHoverCb(event, target.data);
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
      if (!cityMarkers.length) return;
      const maxLeads = Math.max(1, ...cityMarkers.map((m) => m.city.leadsScraped));
      cityMarkers.forEach((m) => {
        const scale = active ? 0.6 + (m.city.leadsScraped / maxLeads) * 2.2 : 1;
        m.mesh.scale.setScalar(scale);
      });
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
      if (cityMarkerGeometry) cityMarkerGeometry.dispose();
      if (cityMarkerMaterial) cityMarkerMaterial.dispose();
      cityMarkerGeometry = null;
      cityMarkerMaterial = null;
      cityMarkers = [];
      renderer.dispose();
    },
  };
}

window.MapGlobe = { initGlobe, xyzToLatLon, latLonToXYZ };
