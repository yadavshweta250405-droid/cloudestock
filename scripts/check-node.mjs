const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\nWareTrack 3D needs Node.js 22.13 or newer (found ${process.versions.node}).\nIt uses the built-in node:sqlite module so that no native packages have to be compiled.\nInstall the current LTS from https://nodejs.org and try again.\n`);
  process.exit(1);
}
