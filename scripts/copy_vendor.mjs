// Copy browser bundles from node_modules into site/vendor so the published
// site has no CDN dependency.
import { copyFileSync, mkdirSync } from "node:fs";

const files = [
  "d3/dist/d3.min.js",
  "d3-geo-projection/dist/d3-geo-projection.min.js",
  "topojson-client/dist/topojson-client.min.js",
];
mkdirSync("site/vendor", { recursive: true });
for (const f of files) {
  copyFileSync(`node_modules/${f}`, `site/vendor/${f.split("/").pop()}`);
  console.log(`copied ${f}`);
}
