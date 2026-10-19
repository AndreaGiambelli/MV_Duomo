"use strict";

const scroller = scrollama();

/// SVG ///
const margin = { left: 50, right: 50 };
const width = 960 - margin.left - margin.right;

const YEAR_START = 1945;
const YEAR_END = 1999;
const YEAR_SPAN = YEAR_END - YEAR_START;

// CSV logoName and SVG data-logo values are matched as free text, so both
// sides are normalized the same way before being compared or used as a Map key.
function normalizeLogoKey(value) {
  return (value || "").trim().toLowerCase();
}

// Timeline generator set-up
const timeline = d3
  .timeline()
  .size([YEAR_SPAN, 200])
  .bandStart(function (d) {
    return d.logoStart;
  })
  .bandEnd(function (d) {
    return d.logoEnd;
  })
  .dateFormat(function (d) {
    return parseInt(d);
  })
  .padding(5)
  .extent([YEAR_START, YEAR_END]);

let groups;

// Both logos.csv and the facade SVG get edited directly on disk as new
// logos are drawn, so every load must fetch them fresh rather than risk the
// browser silently serving a stale cached copy of either one.
const CACHE_BUST = "?t=" + Date.now();

d3.csv("logos.csv" + CACHE_BUST, type).then(function (data) {
  const dataset = data;

  /// Date slider set-up
  const slider = d3
    .sliderHorizontal()
    .min(YEAR_START)
    .max(YEAR_END)
    .step(1)
    .width(width)
    .tickFormat(d3.format(""))
    .displayValue(false)
    .on("onchange", (val) => {
      currentYear = val;
      updateProspetto(val);
      radialTimeline();
    });

  // Appending date slider
  d3.select("#slider")
    .append("svg")
    .attr("class", "slider-svg")
    .attr("width", 1000)
    .attr("height", 100)
    .append("g")
    .attr("transform", "translate(30,30)")
    .call(slider);

  d3.select("#slider").selectAll(".tick").select("line").attr("y2", "4");
  d3.select("#slider").selectAll(".tick").select("text").attr("y", "16");

  let moving = false;
  let timer;
  const playButton = d3.select("#play-button");
  const song = document.getElementById("song");
  setUpKaraoke(song);
  const startYear = YEAR_START;
  const endYear = 2000; // one year past the data extent, matches the original animation range
  // null = nothing shown yet (just the facade video with its crowd) -- the
  // state before 1945's first appearance, both on initial load and during
  // the pre-roll below.
  let currentYear = null;

  // Two fixed landmarks in the audio track drive every other year's timing:
  // 1946 at 22s and 2000 (the last year) at 3:00. The per-year step is
  // whatever makes those two exact, and 1945 sits one step before 1946 --
  // nothing shows before that.
  const YEAR_1946_AUDIO_SEC = 22;
  const YEAR_2000_AUDIO_SEC = 3 * 60;
  const STEP_INTERVAL_MS =
    ((YEAR_2000_AUDIO_SEC - YEAR_1946_AUDIO_SEC) * 1000) / (endYear - 1946);
  const PREROLL_MS = YEAR_1946_AUDIO_SEC * 1000 - STEP_INTERVAL_MS;

  const mapStart = new Map();
  const mapEnd = new Map();

  dataset.forEach(function (d) {
    const key = normalizeLogoKey(d.logoName);
    mapStart.set(key, +d.logoStart);
    mapEnd.set(key, +d.logoEnd);
  });

  let prerollTimer = null;

  function startYearStepping() {
    currentYear = startYear;
    updateProspetto(currentYear);
    radialTimeline();
    slider.value(currentYear);
    timer = setInterval(step, STEP_INTERVAL_MS);
  }

  function togglePlay() {
    if (playButton.text() == "Pause") {
      moving = false;
      clearInterval(timer);
      clearTimeout(prerollTimer);
      playButton.text("Play");
      song.pause();
    } else {
      moving = true;
      playButton.text("Pause");
      // Scrollama's own preview (see handleStepEnter) may already have set
      // a year while idle, with the audio still untouched -- audio at 0:00
      // means this press is a genuinely fresh start (or a replay after a
      // full cycle), so re-hide everything and wait out the pre-roll again
      // rather than trusting whatever year is currently on screen.
      if (song.currentTime === 0 && currentYear !== null) {
        currentYear = null;
        updateProspetto(currentYear);
        radialTimeline();
      }
      song.play();
      // On a fresh start wait out the pre-roll so 1945/1946 land on the
      // facade in sync with the track; resuming after a mid-sequence pause
      // skips straight back into the regular per-year cadence.
      if (currentYear === null) {
        prerollTimer = setTimeout(startYearStepping, PREROLL_MS);
      } else {
        timer = setInterval(step, STEP_INTERVAL_MS);
      }
    }
  }

  playButton.on("click", togglePlay);

  // "A" toggles play/pause from anywhere on the page, same as the button.
  // e.repeat guards against the key firing continuously while held down.
  window.addEventListener("keydown", function (e) {
    if (!e.repeat && e.key.toLowerCase() === "a") togglePlay();
  });

  //////// SVG PROSPETTO ////////

  d3.xml("svg/CARMINATI_REAL_forSVG copy_210213.svg" + CACHE_BUST).then(function (xml) {
    const mapHeight = 600;

    // The facade in the source artwork's own coordinates starts at x=164 and
    // is 801 wide, with 164 of margin intended on each side. Cropping the
    // viewBox to exactly that region (rather than the full window width)
    // centers the facade and hides the rest of the artwork -- the browser
    // then scales this fixed crop to fit #map (preserveAspectRatio defaults
    // to "xMidYMid meet"), so no extra side content is ever revealed.
    const FACADE_START_X = 164;
    const FACADE_WIDTH = 801;
    const FACADE_MARGIN = 164;
    const viewBoxX = FACADE_START_X - FACADE_MARGIN;
    const viewBoxWidth = FACADE_MARGIN + FACADE_WIDTH + FACADE_MARGIN;

    const loghiSvg = d3
      .select("#map")
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", viewBoxX + " 0 " + viewBoxWidth + " " + mapHeight);

    // fill (and other presentation attributes) on the source file's root
    // <svg> are inherited by every path that doesn't set its own -- moving
    // only the inner <g> into our wrapper drops that inheritance, so paths
    // meant to be unfilled (fill:none, e.g. outline-only shapes) fall back
    // to SVG's true default fill, black. Carry the root's own attributes
    // over so the same cascade applies here.
    const sourceRoot = xml.documentElement;
    ["fill", "stroke", "color"].forEach((attr) => {
      const value = sourceRoot.getAttribute(attr);
      if (value !== null) loghiSvg.attr(attr, value);
    });

    const svgMap = xml.getElementsByTagName("g")[0];
    // <defs> (gradients, clip-paths) can sit as a sibling of the main <g>
    // rather than inside it -- grab it too, or every url(#...) reference
    // inside svgMap (e.g. window gradients) points at nothing once moved.
    const svgDefs = Array.from(xml.getElementsByTagName("defs"));

    loghiSvg.node().appendChild(svgMap);
    svgDefs.forEach((defs) => loghiSvg.node().appendChild(defs));
    hideDrawnFacade(svgMap);
    applyNeonGlow(svgMap.querySelector("#Logos"));
    groups = d3.select("#Logos").selectAll("[data-logo]");

    warnAboutUnmatchedLogos(dataset, groups);

    groups.style("display", function () {
      if (currentYear === null) return "none";
      const key = normalizeLogoKey(this.dataset.logo);
      return mapStart.get(key) <= currentYear && mapEnd.get(key) >= currentYear
        ? "block"
        : "none";
    });
  });

  // Surfaces mismatches between the CSV and the artwork instead of letting
  // them fail silently as a permanently hidden element.
  function warnAboutUnmatchedLogos(dataset, svgGroups) {
    const svgKeys = new Set(
      svgGroups.nodes().map((node) => normalizeLogoKey(node.dataset.logo))
    );
    const csvKeys = new Set(dataset.map((d) => normalizeLogoKey(d.logoName)));

    for (const d of dataset) {
      const key = normalizeLogoKey(d.logoName);
      if (!svgKeys.has(key)) {
        console.warn(`[duomoLights] "${d.logoName}" è nel CSV ma nessun nodo SVG ha data-logo="${key}"`);
      }
    }
    svgGroups.each(function () {
      const key = normalizeLogoKey(this.dataset.logo);
      if (!csvKeys.has(key)) {
        console.warn(`[duomoLights] il nodo SVG con data-logo="${this.dataset.logo}" non ha nessuna riga corrispondente in logos.csv`);
      }
    });
  }

  // The source artwork's drawn facade is replaced on screen by the looping
  // piazza video sitting behind this SVG (see #piazza-bg in index.html) --
  // these groups are hidden rather than deleted from the file, so the
  // original illustration stays recoverable if the video approach changes.
  // "Layer 1" / "Group 11" are guide layers that sit outside #viewport
  // entirely (siblings of #layout, found while prototyping the swap in
  // test_overlay.html), and the embedded photo rect was a static stand-in
  // used to check logo alignment before the video existed.
  const HIDDEN_FACADE_IDS = [
    "Background",
    "Pavement",
    "Sides",
    "Fondo Prospetto",
    "Layer2",
    "Generated Image October 15, 2026 - 7_46AM 1",
  ];
  const HIDDEN_ROOT_IDS = ["Layer 1", "Group 11"];

  function hideDrawnFacade(svgMap) {
    const viewport = svgMap.querySelector("#viewport");
    HIDDEN_FACADE_IDS.forEach((id) => {
      const el = viewport && viewport.querySelector(`[id="${id}"]`);
      if (el) el.style.display = "none";
    });
    HIDDEN_ROOT_IDS.forEach((id) => {
      const el = svgMap.querySelector(`[id="${id}"]`);
      if (el) el.style.display = "none";
    });
  }

  // Gives each logo a neon-style glow in its own accent color, derived from
  // the artwork itself (the most common non-neutral fill/stroke in it) so
  // every logo stays coherent without being colored by hand. A sign drawn as
  // several color-distinct parts (e.g. a white frame around a red name) gets
  // the glow applied per direct sub-group instead of once for the whole
  // sign, so each part glows its own color rather than the sign's single
  // most-common color. Signs with no such sub-structure (flat artwork, no
  // nested <g>) fall back to glowing as one piece. --flicker-delay is set
  // once per sign and inherits down to every part, so a multi-color sign
  // still flickers as a single unit, just tinted differently per part.
  function applyNeonGlow(logosGroup) {
    if (!logosGroup) return;
    Array.from(logosGroup.children).forEach((group) => {
      if (group.tagName !== "g" || !group.dataset.logo) return;
      group.style.setProperty("--flicker-delay", `${(-Math.random() * 9).toFixed(2)}s`);

      const parts = Array.from(group.children).filter((c) => c.tagName === "g");
      const glowUnits = parts.length > 0 ? parts : [group];
      glowUnits.forEach((unit) => {
        unit.classList.add("glow-unit");
        const color = pickAccentColor(unit);
        if (color) unit.style.setProperty("--glow-color", color);
      });
    });
  }

  function pickAccentColor(group) {
    const counts = new Map();
    group.querySelectorAll("*").forEach((el) => {
      ["fill", "stroke"].forEach((attr) => {
        const value = el.getAttribute(attr);
        if (!value || value === "none" || isNeutralColor(value)) return;
        counts.set(value, (counts.get(value) || 0) + 1);
      });
    });
    if (counts.size === 0) return null;
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  function isNeutralColor(hex) {
    const h = hex.replace("#", "").toLowerCase();
    if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/.test(h)) return true;
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    // near-white, near-black, and low-saturation greys aren't accent colors
    if (max > 235 && min > 200) return true;
    if (max < 45) return true;
    if (saturation < 0.12) return true;
    return false;
  }

  function step() {
    // Advance before displaying: the first interval tick after Play is
    // pressed fires one STEP_INTERVAL_MS in, so if it re-displayed the
    // already-current year (as before) that year would sit on screen for
    // double every other year's dwell time before the second tick moved it
    // on. Incrementing first keeps every year's dwell time equal.
    currentYear = currentYear + 1;

    if (currentYear > endYear) {
      moving = false;
      currentYear = startYear;
      clearInterval(timer);
      playButton.text("Play");
      song.pause();
      song.currentTime = 0;
      return;
    }

    updateProspetto(currentYear);
    radialTimeline();
    slider.value(currentYear);
  }

  function updateProspetto(h) {
    d3.select("#value").text(h === null ? "" : h);
    d3.select("#year-display").text(h === null ? "" : h);
    groups.style("display", function () {
      if (h === null) return "none";
      const key = normalizeLogoKey(this.dataset.logo);
      return mapStart.get(key) <= h && mapEnd.get(key) >= h ? "block" : "none";
    });
  }

  const timelineCenter = { x: 500, y: 250 };

  function radialTimeline() {
    const arc = d3.arc();

    // Before 1945 first appears (currentYear is null) there's no progress
    // to show yet -- treat the overlay as sitting at the very start.
    const progressYear = currentYear === null ? YEAR_START : currentYear;

    d3.selectAll(".timeBand").remove();
    d3.selectAll(".timeBand__overlay").remove();

    const timelineBands = timeline(dataset);
    const overlayBands = timeline(dataset);

    const angleScale = d3
      .scaleLinear()
      .domain([0, YEAR_SPAN])
      .range([0, 1.5 * Math.PI]);

    timelineBands.forEach(function (d) {
      d.startAngle = angleScale(d.logoStart - YEAR_START);
      d.endAngle = angleScale(d.logoEnd - YEAR_START);
      d.y = d.y + 50;
    });

    overlayBands.forEach(function (d) {
      d.startAngle = angleScale(d.logoStart - YEAR_START);
      d.endAngle = angleScale(progressYear - YEAR_START);
      d.y = d.y + 50;
    });

    const timelineGrid = d3
      .select("#timelineSvg")
      .append("g")
      .classed("timeline-grid", true)
      .attr(
        "transform",
        `translate(${timelineCenter.x},${timelineCenter.y})`
      );

    const gridData = [4, 14, 24, 34, 44];

    timelineGrid
      .selectAll(".gridline")
      .data(gridData)
      .enter()
      .append("line")
      .attr("class", "gridLine")
      .attr("x1", 0)
      .attr("y1", -255)
      .attr("x2", 0)
      .attr("y2", -260)
      .attr("transform", (d) => `rotate(${angleScale(d) * (180 / Math.PI)})`)
      .style("stroke", "white");

    d3.select("#timelineSvg")
      .selectAll(".timeBand")
      .data(timelineBands)
      .enter()
      .append("path")
      .attr("class", "timeBand")
      .attr("transform", `translate(${timelineCenter.x},${timelineCenter.y})`)
      .attr("d", function (d) {
        return arc.innerRadius(d.y).outerRadius(d.y + d.dy)(d);
      })
      .style("fill", "#b0909d")
      .on("mouseover", function () {
        d3.select(this).style("fill", "teal");
      })
      .on("mouseout", function () {
        d3.select(this).style("fill", "#b0909d");
      });

    d3.select("#timelineSvg")
      .selectAll(".timeBand__overlay")
      .data(overlayBands)
      .enter()
      .append("path")
      .attr("class", "timeBand__overlay")
      .attr("transform", `translate(${timelineCenter.x},${timelineCenter.y})`)
      .attr("d", function (d) {
        return arc.innerRadius(d.y).outerRadius(d.y + d.dy)(d);
      })
      .style("fill", "green")
      .style("display", (d) => {
        if (d.logoStart <= progressYear && d.logoEnd >= progressYear) {
          return "block";
        } else {
          return "none";
        }
      });
  }
  radialTimeline();

  // Set up scrollama
  scroller
    .setup({
      step: "#scrolly .scroll-p",
      offset: 0.75,
    })
    .onStepEnter(handleStepEnter);

  // On step enter
  function handleStepEnter(response) {
    if (response.index === 0) {
      currentYear = 1989;
      updateProspetto(currentYear);
      radialTimeline();
    }
    if (response.index === 1) {
      currentYear = startYear;
      updateProspetto(startYear);
      radialTimeline();
    }
  }
});

function type(d) {
  d.logoStart = +d.logoStart;
  d.logoEnd = +d.logoEnd;
  return d;
}

function parseSrtTime(t) {
  const [, h, m, s, ms] = t.match(/(\d+):(\d+):(\d+),(\d+)/).map(Number);
  return h * 3600 + m * 60 + s + ms / 1000;
}

function parseSrt(text) {
  return text
    .trim()
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const [startStr, endStr] = lines[1].split("-->").map((s) => s.trim());
      return {
        start: parseSrtTime(startStr),
        end: parseSrtTime(endStr),
        text: lines.slice(2).join("\n"),
      };
    });
}

// Drives #karaoke-line off the song's own currentTime (rather than the
// year-advancing setInterval in step()) so the lyrics stay in sync with the
// audio even though the two timelines don't share the same duration.
function setUpKaraoke(song) {
  const karaokeLine = document.getElementById("karaoke-line");
  fetch("karaoke.srt" + CACHE_BUST)
    .then((response) => response.text())
    .then((text) => {
      const cues = parseSrt(text);
      song.addEventListener("timeupdate", () => {
        const t = song.currentTime;
        const cue = cues.find((c) => t >= c.start && t <= c.end);
        karaokeLine.textContent = cue ? cue.text : "";
      });
    });
}
