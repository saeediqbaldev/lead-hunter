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
// Hover work is gated to once per animation frame rather than running
// on every raw pointermove event - pointermove can fire many times
// within a single frame during fast mouse movement, and re-running
// raycasting plus a country lookup on every one of those was the main
// source of feel-laggy interaction. This keeps the expensive part in
// step with the render loop instead of racing ahead of it.

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
// Country borders themselves are drawn separately as real 3D line
// geometry (see buildCountryBorderLines) rather than baked into this
// texture, since vector line geometry stays crisp at any zoom level
// while a rasterized texture stroke does not.
function buildGlobeTexture(geojson, statsByName) {
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
    ctx.fillStyle = isHunted ? huntedColor : landColor;
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
let currentGeojson, currentStatsByName, onHoverCb, onCountryEmptyHoverCb, onLeaveCb;
let resizeObserver;
let borderLines = null;

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

function initGlobe(container, geojson, statsByName, { onHover, onCountryEmptyHover, onLeave } = {}) {
  currentGeojson = geojson;
  currentStatsByName = statsByName;
  onHoverCb = onHover;
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

  const texture = new THREE.CanvasTexture(buildGlobeTexture(geojson, statsByName));
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
  const pointer = new THREE.Vector2();
  let userInteracted = false;

  // Hover work is gated to the render loop (see animate() below) rather
  // than running directly off the pointermove event - only the latest
  // pointer position is kept, and the actual raycast + country lookup
  // happens at most once per frame.
  let pendingPointer = null;
  let lastPointerEvent = null;

  function findCountryAtPointer(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const hits = raycaster.intersectObject(globeMesh);
    if (!hits.length) return null;
    const localPoint = globeMesh.worldToLocal(hits[0].point.clone());
    const { lat, lon } = xyzToLatLon(localPoint.x, localPoint.y, localPoint.z);
    const feature = currentGeojson.features.find((f) => d3.geoContains(f, [lon, lat]));
    if (!feature) return null;
    const stat = currentStatsByName[feature.properties.name];
    return stat ? { type: "country", data: stat } : { type: "country-empty", data: feature.properties.name };
  }

  function processPendingHover() {
    if (!pendingPointer) return;
    const { clientX, clientY } = pendingPointer;
    pendingPointer = null;
    const target = findCountryAtPointer(clientX, clientY);
    if (target && target.type === "country" && onHoverCb) onHoverCb(lastPointerEvent, target.data);
    else if (target && target.type === "country-empty" && onCountryEmptyHoverCb) onCountryEmptyHoverCb(lastPointerEvent, target.data);
    else if (onLeaveCb) onLeaveCb();
  }

  function onPointerMove(event) {
    if (!userInteracted) {
      userInteracted = true;
      controls.autoRotate = false; // stop auto-rotating the moment the person shows interest
    }
    lastPointerEvent = event;
    pendingPointer = { clientX: event.clientX, clientY: event.clientY };
  }
  function onPointerLeave() {
    pendingPointer = null;
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
    processPendingHover();
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
      renderer.dispose();
    },
  };
}

window.MapGlobe = { initGlobe, xyzToLatLon, latLonToXYZ };
