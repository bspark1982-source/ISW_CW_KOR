/* 러시아의 인지전 인프라 — Korean edition of ISW's interactive map.
 * Plain D3 + SVG in the Robinson projection (as in ISW's web map, WKID 54030). */
(() => {
  "use strict";

  // ISW layer symbology (FeatureServer drawingInfo).
  const FREQ_CLASSES = [
    [0, "#fffcf8"], [1, "#f5e2dc"], [2, "#f0d6ce"], [3, "#edc4b9"], [4, "#dfa191"], [5, "#d38776"],
    [6, "#c5705c"], [7, "#b75946"], [8, "#a84331"], [10, "#992e1f"], [14, "#780708"],
  ];
  const FREQ_COLOR = new Map(FREQ_CLASSES);
  const FREQ_DEFAULT = "#828282"; // ISW "All Other Values"
  const PIE_COLORS = ["#c1ddeb", "#62a0ca", "#fcb8b7", "#70bc6b", "#c9e9ad", "#eb5e60"];
  const ICONS = {
    ru: { href: "assets/agreement-ru.png", w: 15, h: 23 },
    brics: { href: "assets/agreement-brics.png", w: 15, h: 23 },
    house: { href: "assets/russia-house.png", w: 16, h: 16 },
  };
  const NO_EVENTS = "기록된 러시아 국영 매체 교육 행사가 없습니다.";
  // ISW initial viewpoint (Robinson extent) expressed in degrees.
  const HOME_BOUNDS = { west: -78, east: 156, south: -41, north: 66 };
  // Portrait phones: a closer start on Europe, Africa and Asia.
  const HOME_BOUNDS_NARROW = { west: -15, east: 110, south: -36, north: 62 };
  const isNarrow = () => window.matchMedia("(max-width: 760px)").matches;

  // Layers, top to bottom as in ISW's Map Layers widget.
  const LAYERS = [
    { id: "agreements", name: "러시아 및 TV BRICS 언론 협력 협정" },
    { id: "houses", name: "러시아 하우스" },
    { id: "caspian", name: "카스피해" },
    { id: "taiwan", name: "대만" },
    { id: "training", name: "러시아 국영 매체 교육 행사" },
    { id: "countries", name: "국가" },
  ];
  const visible = Object.fromEntries(LAYERS.map((l) => [l.id, true]));

  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "style") node.style.cssText = v;
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null && c !== "") node.append(c);
    return node;
  };

  let data, geo, projection, path, zoom, svg, zoomLayer, markerLayer, homeTransform;
  let transform = d3.zoomIdentity;
  let selection = null; // { features, index }

  Promise.all([
    fetch("data/geo.topo.json").then((r) => r.json()),
    fetch("data/records.json").then((r) => r.json()),
  ]).then(([topo, records]) => {
    data = records;
    geo = {
      countries: topojson.feature(topo, topo.objects.countries).features,
      taiwan: topojson.feature(topo, topo.objects.taiwan).features,
      caspian: topojson.feature(topo, topo.objects.caspian).features,
    };
    init();
  }).catch((err) => {
    $("loading").textContent = "데이터를 불러오지 못했습니다. 페이지를 새로고침해 주세요.";
    console.error(err);
  });

  function freqOf(i) {
    return (data.events[i] || []).length;
  }
  function fillOf(i) {
    if (!visible.training) return "var(--land)";
    const n = freqOf(i);
    return FREQ_COLOR.get(n) || FREQ_DEFAULT;
  }

  function init() {
    $("loading").remove();
    svg = d3.select("#map");
    projection = d3.geoRobinson().precision(0.2);
    projection.fitExtent([[0, 0], [1000, 520]], { type: "Sphere" });
    path = d3.geoPath(projection);

    zoomLayer = svg.append("g");
    zoomLayer.append("g").attr("class", "l-countries")
      .selectAll("path").data(geo.countries).join("path")
      .attr("class", "country")
      .attr("d", path)
      .attr("data-i", (d) => d.properties.i);
    zoomLayer.append("g").attr("class", "l-taiwan")
      .selectAll("path").data(geo.taiwan).join("path").attr("class", "taiwan").attr("d", path);
    zoomLayer.append("g").attr("class", "l-caspian")
      .selectAll("path").data(geo.caspian).join("path").attr("class", "caspian").attr("d", path);
    recolor();

    markerLayer = svg.append("g");
    markerLayer.append("g").attr("class", "l-houses")
      .selectAll("g").data(data.houses).join("g").attr("class", "marker")
      .call(drawIcon, () => ICONS.house, true);
    markerLayer.append("g").attr("class", "l-agreements")
      .selectAll("g").data(data.agreements).join("g").attr("class", "marker")
      .call(drawIcon, (d) => ICONS[d.t], false);
    markerLayer.append("g").attr("class", "l-halo");

    zoom = d3.zoom().scaleExtent([1, 60])
      .on("zoom", (e) => {
        transform = e.transform;
        zoomLayer.attr("transform", transform);
        placeMarkers();
      });
    svg.call(zoom).on("dblclick.zoom", null);
    svg.on("click", onClick);
    svg.on("pointermove", onHover).on("pointerleave", () => ($("tooltip").hidden = true));

    window.addEventListener("resize", () => {
      const wasHome = homeTransform && transform.k === homeTransform.k
        && transform.x === homeTransform.x && transform.y === homeTransform.y;
      computeHome();
      updateExtent();
      if (wasHome) svg.call(zoom.transform, homeTransform);
    });
    computeHome();
    updateExtent();
    svg.call(zoom.transform, homeTransform);

    buildLayerList();
    wireUi();
  }

  function drawIcon(sel, icon, centered) {
    sel.append("image")
      .attr("href", (d) => icon(d).href)
      .attr("width", (d) => icon(d).w)
      .attr("height", (d) => icon(d).h)
      .attr("x", (d) => -icon(d).w / 2)
      // ISW pins are anchored at their tip; Russia House icons at their centre.
      .attr("y", (d) => (centered ? -icon(d).h / 2 : -icon(d).h));
  }

  function screenXY(d) {
    return transform.apply(projection([d.x, d.y]));
  }

  function placeMarkers() {
    markerLayer.selectAll(".marker").attr("transform", (d) => {
      const [x, y] = screenXY(d);
      return `translate(${x},${y})`;
    });
    drawHalo();
  }

  function recolor() {
    zoomLayer.selectAll(".country").style("fill", (d) => fillOf(d.properties.i));
  }

  function viewport() {
    const r = svg.node().getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  function computeHome() {
    const { w, h } = viewport();
    const { west, east, south, north } = isNarrow() && h > w ? HOME_BOUNDS_NARROW : HOME_BOUNDS;
    const pts = [];
    for (let lon = west; lon <= east; lon += 6) pts.push(projection([lon, north]), projection([lon, south]));
    for (let lat = south; lat <= north; lat += 6) pts.push(projection([west, lat]), projection([east, lat]));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min(w / (x1 - x0), h / (y1 - y0)) * 0.98;
    homeTransform = d3.zoomIdentity
      .translate(w / 2 - k * (x0 + x1) / 2, h / 2 - k * (y0 + y1) / 2).scale(k);
    zoom.scaleExtent([Math.min(k, 1), Math.max(60, k * 30)]);
  }

  function updateExtent() {
    const { w, h } = viewport();
    const pad = Math.max(w, h) / 3;
    const [[x0, y0], [x1, y1]] = path.bounds({ type: "Sphere" });
    zoom.extent([[0, 0], [w, h]]).translateExtent([[x0 - pad, y0 - pad], [x1 + pad, y1 + pad]]);
  }

  // ---------- Hit testing ----------
  function markerHits(px, py) {
    const hits = [];
    const near = (layerId, list, icon, centered) => {
      if (!visible[layerId]) return;
      list.forEach((d) => {
        const ic = icon(d);
        const [x, y] = screenXY(d);
        const top = centered ? y - ic.h / 2 : y - ic.h;
        if (px >= x - ic.w / 2 - 3 && px <= x + ic.w / 2 + 3 && py >= top - 3 && py <= top + ic.h + 3) {
          hits.push({ kind: layerId === "agreements" ? "agreement" : "house", d });
        }
      });
    };
    near("agreements", data.agreements, (d) => ICONS[d.t], false);
    near("houses", data.houses, () => ICONS.house, true);
    return hits;
  }

  function lonLatAt(px, py) {
    const p = projection.invert(transform.invert([px, py]));
    return p && Number.isFinite(p[0]) ? p : null;
  }

  function countryAt(lonlat) {
    if (!lonlat) return null;
    return geo.countries.find((f) => d3.geoContains(f, lonlat)) || null;
  }

  function onClick(event) {
    if (event.defaultPrevented) return;
    const [px, py] = d3.pointer(event, svg.node());
    const features = markerHits(px, py);
    const ll = lonLatAt(px, py);
    if (visible.taiwan && ll && geo.taiwan.some((f) => d3.geoContains(f, ll))) {
      features.push({ kind: "taiwan" });
    } else if (visible.training) {
      const c = countryAt(ll);
      if (c) {
        const i = c.properties.i;
        const evs = data.events[i];
        if (evs) evs.forEach((ev, n) => features.push({ kind: "event", i, ev, n, total: evs.length }));
        else features.push({ kind: "event", i, ev: null });
      }
    }
    if (!features.length) { clearSelection(); return; }
    select(features, 0);
    // On phones the popup is a bottom sheet: keep the clicked spot visible above it.
    if (isNarrow()) {
      const visibleBottom = viewport().h - $("popup").offsetHeight;
      if (py > visibleBottom - 30) {
        svg.transition().duration(300).call(zoom.translateBy, 0, (visibleBottom * 0.45 - py) / transform.k);
      }
    }
  }

  function onHover(event) {
    const tip = $("tooltip");
    if (event.pointerType !== "mouse" || event.buttons) { tip.hidden = true; return; }
    const [px, py] = d3.pointer(event, svg.node());
    const ll = lonLatAt(px, py);
    let html = null;
    if (ll && geo.taiwan.some((f) => d3.geoContains(f, ll))) {
      html = ["대만", ""];
    } else {
      const c = countryAt(ll);
      if (c) {
        const n = freqOf(c.properties.i);
        html = [data.countries[c.properties.i].n, visible.training ? `교육 행사 ${n}건` : ""];
      }
    }
    if (!html) { tip.hidden = true; return; }
    tip.replaceChildren(html[0], html[1] ? el("small", {}, html[1]) : "");
    tip.hidden = false;
    const { w } = viewport();
    const left = px + 14 + tip.offsetWidth > w ? px - 14 - tip.offsetWidth : px + 14;
    tip.style.left = `${left}px`;
    tip.style.top = `${py + 14}px`;
  }

  // ---------- Selection & popup ----------
  function select(features, index) {
    selection = { features, index };
    renderPopup();
  }

  function clearSelection() {
    selection = null;
    $("popup").hidden = true;
    highlight(null);
  }

  function highlight(f) {
    zoomLayer.selectAll(".country").classed("selected", (d) => f?.kind === "event" && d.properties.i === f.i);
    zoomLayer.selectAll(".taiwan").classed("selected", f?.kind === "taiwan");
    drawHalo();
  }

  function drawHalo() {
    const f = selection && selection.features[selection.index];
    const pts = f && (f.kind === "agreement" || f.kind === "house") ? [f] : [];
    markerLayer.select(".l-halo").selectAll("circle").data(pts).join("circle")
      .attr("class", "marker-halo").attr("r", 13)
      .attr("transform", (p) => {
        const [x, y] = screenXY(p.d);
        return `translate(${x},${p.kind === "agreement" ? y - 11 : y})`;
      });
  }

  function renderPopup() {
    const { features, index } = selection;
    const f = features[index];
    $("pager").hidden = features.length < 2;
    $("pageLabel").textContent = `${index + 1} / ${features.length}`;
    $("prevBtn").disabled = index === 0;
    $("nextBtn").disabled = index === features.length - 1;
    const body = $("popupBody");
    body.replaceChildren(...contentFor(f));
    body.scrollTop = 0;
    $("popup").hidden = false;
    highlight(f);
  }

  function fields(rows) {
    const dl = el("dl", { class: "fields" });
    for (const [label, value, cls] of rows) {
      if (!value) continue;
      const dd = el("dd", cls ? { class: cls } : {});
      if (cls === "src") {
        // Source strings are kept exactly as ISW publishes them (deliberately non-clickable).
        value.split(/\s;\s?|;\s/).forEach((s, n) => { if (n) dd.append(el("br")); dd.append(s.trim()); });
      } else dd.append(value);
      dl.append(el("div", {}, el("dt", {}, label), dd));
    }
    return dl;
  }

  function contentFor(f) {
    if (f.kind === "agreement") {
      const d = f.d;
      return [
        el("h3", {}, "협력 협정"),
        el("div", { class: "sub" }, d.t === "brics" ? "TV BRICS" : "러시아 국영 매체 협정"),
        el("p", {}, d.b || ""),
        fields([
          ["국가", d.country], ["러시아 기관", d.org], ["협력 기관", d.partner],
          ["협정 체결일", d.date], ["출처", d.src, "src"],
        ]),
      ];
    }
    if (f.kind === "house") {
      const d = f.d;
      return [
        el("h3", {}, `${d.country} 내 러시아 하우스 위치`),
        el("p", { class: "center", style: "margin-top:10px" }, d.addr || ""),
        fields([["출처", d.src, "src"], ["러시아 하우스 계정/URL", d.url, "src"]]),
      ];
    }
    if (f.kind === "taiwan") {
      return [el("h3", {}, "대만"), el("p", { class: "center", style: "margin-top:12px" }, NO_EVENTS)];
    }
    const country = data.countries[f.i];
    const out = [el("h3", {}, "러시아 국영 매체 교육"), el("div", { class: "sub" }, country.n)];
    if (!f.ev) {
      out.push(el("p", { class: "center" }, NO_EVENTS));
      return out;
    }
    const ev = f.ev;
    out.push(el("p", {}, ev.b));
    if (ev.ap) out.push(el("p", { class: "extra" }, el("b", {}, "관련 인물"), ev.ap));
    if (ev.ac) out.push(el("p", { class: "extra" }, el("b", {}, "추가 설명"), ev.ac));
    const chart = pieChart(f.i, ev.tc || country.n);
    if (chart) out.push(chart);
    out.push(fields([
      ["러시아 기관", ev.org], ["프로그램", ev.prog], ["협력 기관(해당 시)", ev.partner],
      ["행사 개최일", ev.date], ["장소", ev.loc], ["진행 방식", ev.fmt], ["출처", ev.src, "src"],
    ]));
    return out;
  }

  function pieChart(i, regionName) {
    const counts = data.programCounts[i];
    if (!counts) return null;
    const size = 112, r = size / 2;
    const arcs = d3.pie().sort(null)(counts);
    const arc = d3.arc().innerRadius(0).outerRadius(r - 1);
    const ns = "http://www.w3.org/2000/svg";
    const svgEl = document.createElementNS(ns, "svg");
    svgEl.setAttribute("width", size);
    svgEl.setAttribute("height", size);
    svgEl.setAttribute("viewBox", `${-r} ${-r} ${size} ${size}`);
    svgEl.setAttribute("role", "img");
    svgEl.setAttribute("aria-label", "프로그램별 행사 수 원형 차트");
    arcs.forEach((a, n) => {
      if (!a.value) return;
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", arc(a));
      p.setAttribute("fill", PIE_COLORS[n]);
      p.setAttribute("stroke", "#fff");
      p.setAttribute("stroke-width", "1");
      const t = document.createElementNS(ns, "title");
      t.textContent = `${data.programs[n]}: ${a.value}건`;
      p.append(t);
      svgEl.append(p);
    });
    const list = el("ul", {}, data.programs.map((name, n) =>
      el("li", counts[n] ? {} : { class: "zero" },
        el("i", { style: `background:${PIE_COLORS[n]}` }), name, el("b", {}, `${counts[n]}건`))));
    const total = counts.reduce((a, b) => a + b, 0);
    return el("div", { class: "chart" },
      el("h4", {}, `지역별 총 행사 수 (${regionName}) · ${total}건`),
      el("div", { class: "chart-row" }, svgEl, list));
  }

  // ---------- Layer list ----------
  function legendFor(id) {
    const row = (...c) => el("div", { class: "legend-row" }, ...c);
    switch (id) {
      case "agreements":
        return el("div", { class: "legend" },
          el("div", {}, "기관"),
          row(el("img", { src: ICONS.ru.href, alt: "" }), "러시아 국영 매체 협정"),
          row(el("img", { src: ICONS.brics.href, alt: "" }), "TV BRICS"));
      case "houses":
        return el("div", { class: "legend" }, row(el("img", { src: ICONS.house.href, alt: "" }), "러시아 하우스 위치"));
      case "caspian":
        return el("span", { class: "swatch inline", style: "background:#f0f9ff;border-color:#828282" });
      case "taiwan":
      case "countries":
        return el("span", { class: "swatch inline", style: "background:#fffdfa" });
      case "training":
        return el("div", { class: "legend" },
          el("div", {}, "국가별 행사 수"),
          el("div", { class: "ramp" }, FREQ_CLASSES.map(([, c]) => el("span", { style: `background:${c}` }))),
          el("div", { class: "ramp-labels" }, FREQ_CLASSES.map(([v]) => el("span", {}, String(v)))));
      default:
        return null;
    }
  }

  function buildLayerList() {
    const list = $("layerList");
    for (const layer of LAYERS) {
      const input = el("input", { type: "checkbox" });
      input.checked = true;
      input.addEventListener("change", () => setVisible(layer.id, input.checked));
      const legend = legendFor(layer.id);
      const inline = legend.classList.contains("inline");
      list.append(el("div", { class: "layer" },
        el("label", {}, input, el("span", { class: "layer-name" }, layer.name), inline ? legend : null),
        inline ? null : legend));
    }
  }

  function setVisible(id, on) {
    visible[id] = on;
    const sel = { agreements: ".l-agreements", houses: ".l-houses", caspian: ".l-caspian", taiwan: ".l-taiwan", countries: ".l-countries" }[id];
    if (sel) svg.selectAll(sel).classed("hidden-layer", !on);
    if (id === "training") recolor();
    // Drop popup entries from layers that are now hidden.
    if (selection) {
      const kindLayer = { agreement: "agreements", house: "houses", taiwan: "taiwan", event: "training" };
      const keep = selection.features.filter((f) => visible[kindLayer[f.kind]]);
      if (!keep.length) clearSelection();
      else {
        const cur = selection.features[selection.index];
        select(keep, Math.max(0, keep.indexOf(cur)));
      }
    }
  }

  // ---------- UI wiring ----------
  function wireUi() {
    $("prevBtn").onclick = () => { if (selection.index > 0) { selection.index--; renderPopup(); } };
    $("nextBtn").onclick = () => {
      if (selection.index < selection.features.length - 1) { selection.index++; renderPopup(); }
    };
    $("closeBtn").onclick = clearSelection;
    $("clearSel").onclick = clearSelection;
    $("zoomIn").onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1.6);
    $("zoomOut").onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.6);
    $("zoomHome").onclick = () => svg.transition().duration(400).call(zoom.transform, homeTransform);
    document.addEventListener("keydown", (e) => {
      if (!selection || document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") clearSelection();
      else if (e.key === "ArrowLeft") $("prevBtn").click();
      else if (e.key === "ArrowRight") $("nextBtn").click();
    });

    const layersBtn = $("layersToggle");
    const setLayersOpen = (open) => {
      layersBtn.setAttribute("aria-expanded", String(open));
      $("layerList").hidden = !open;
    };
    layersBtn.onclick = () => setLayersOpen(layersBtn.getAttribute("aria-expanded") !== "true");
    if (isNarrow() || window.innerHeight < 700) setLayersOpen(false);

    const sb = $("sidebar"), sbBtn = $("sidebarToggle");
    sbBtn.onclick = () => {
      const open = !sb.classList.contains("open");
      sb.classList.toggle("open", open);
      sbBtn.setAttribute("aria-expanded", String(open));
      sbBtn.textContent = open ? "닫기" : "소개";
    };

    document.querySelectorAll("[data-open]").forEach((b) => {
      b.addEventListener("click", () => $(b.dataset.open).showModal());
    });
    $("introDialog").showModal();
  }
})();
