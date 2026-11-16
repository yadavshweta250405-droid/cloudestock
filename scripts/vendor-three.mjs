// Downloads the pinned Three.js build into frontend/vendor/three so the app works offline (no CDN).
// The server automatically switches its importmap to the local copy when these files exist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.160.0';
const BASE = `https://cdn.jsdelivr.net/npm/three@${VERSION}`;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'vendor', 'three');
const files = [['build/three.module.js', 'three.module.js'], ['examples/jsm/controls/OrbitControls.js', 'addons/controls/OrbitControls.js'], ['examples/jsm/geometries/RoundedBoxGeometry.js', 'addons/geometries/RoundedBoxGeometry.js']];

for (const [remote, local] of files) {
  const res = await fetch(`${BASE}/${remote}`);
  if (!res.ok) { console.error(`Failed to download ${remote}: HTTP ${res.status}`); process.exit(1); }
  const dest = path.join(out, local); fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer())); console.log(`  saved ${local}`);
}
console.log(`Three.js ${VERSION} vendored. Restart the server (or just reload the page).`);
