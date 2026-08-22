// 3D globe rendering for the Map Overview page. A real WebGL sphere,
// not a CSS/SVG approximation - textured with the world map drawn via
// an equirectangular D3 projection onto a canvas, which maps directly
// and simply to sphere UV coordinates (u = longitude, v = latitude).
//
// Hover detection: raycast from the pointer into the scene, find where
// it hits the sphere, convert that 3D point back to latitude/longitude
// (the exact inverse of the UV mapping below - verified by round-trip
// testing against many reference points before this was written), then
// reuse the same GeoJSON country polygons the flat map already has via
// d3.geoContains to find which country (if any) contains that point.
// This avoids needing separate, complex 3D country meshes just for
// hit-testing - one flat data source drives both views.

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
function buildGlobeTexture(geojson, statsByName) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");

  const oceanColor = cssVar("--panel-raised", "#221e1a");
  const landColor = cssVar("--border", "#33302a");
  const huntedColor = cssVar("--accent", "#ff6a3d");

  ctx.fillStyle = oceanColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const projection = d3.geoEquirectangular().fitSize([canvas.width, canvas.height], { type: "Sphere" });
  const path = d3.geoPath(projection, ctx);

  geojson.features.forEach((feature) => {
    const isHunted = !!statsByName[feature.properties.name];
    ctx.beginPath();
    path(feature);
    ctx.fillStyle = isHunted ? huntedColor : landColor;
    ctx.fill();
  });

  return canvas;
}

// The exact inverse of Three.js's SphereGeometry vertex formula
// (theta = u*2pi, phi = v*pi; x=-cos(theta)sin(phi), y=cos(phi),
// z=sin(theta)sin(phi)) combined with this texture's own u/v <-> lon/lat
// mapping above. Verified by round-trip testing against reference
// points (poles, equator, several real cities) before being used here.
function xyzToLatLon(x, y, z) {
  const phi = Math.acos(Math.max(-1, Math.min(1, y)));
  let theta = Math.atan2(z, -x);
  if (theta < 0) theta += 2 * Math.PI;
  const v = phi / Math.PI;
  const u = theta / (2 * Math.PI);
  return { lat: 90 - v * 180, lon: u * 360 - 180 };
}

let scene, camera, renderer, controls, globeMesh, animationId;
let currentGeojson, currentStatsByName, onHoverCb, onLeaveCb;
let resizeObserver;

function initGlobe(container, geojson, statsByName, { onHover, onLeave } = {}) {
  currentGeojson = geojson;
  currentStatsByName = statsByName;
  onHoverCb = onHover;
  onLeaveCb = onLeave;

  const width = container.clientWidth || 900;
  const height = container.clientHeight || 640;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 0, 2.6);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.innerHTML = "";
  container.appendChild(renderer.domElement);

  const texture = new THREE.CanvasTexture(buildGlobeTexture(geojson, statsByName));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const geometry = new THREE.SphereGeometry(1, 64, 64);
  // Unlit material - deliberate choice, matches the flat, theme-driven
  // aesthetic used everywhere else rather than simulating planetary
  // lighting, which would fight with an arbitrary user-chosen theme.
  const material = new THREE.MeshBasicMaterial({ map: texture });
  globeMesh = new THREE.Mesh(geometry, material);
  scene.add(globeMesh);

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

  function findCountryAtPointer(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(globeMesh);
    if (!hits.length) return null;

    const localPoint = globeMesh.worldToLocal(hits[0].point.clone());
    const { lat, lon } = xyzToLatLon(localPoint.x, localPoint.y, localPoint.z);
    const feature = currentGeojson.features.find((f) => currentStatsByName[f.properties.name] && d3.geoContains(f, [lon, lat]));
    return feature ? currentStatsByName[feature.properties.name] : null;
  }

  function onPointerMove(event) {
    if (!userInteracted) {
      userInteracted = true;
      controls.autoRotate = false; // stop auto-rotating the moment the person shows interest
    }
    const stat = findCountryAtPointer(event.clientX, event.clientY);
    if (stat && onHoverCb) onHoverCb(event, stat);
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
      renderer.dispose();
    },
  };
}

window.MapGlobe = { initGlobe, xyzToLatLon };
