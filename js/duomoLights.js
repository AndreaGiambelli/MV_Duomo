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

d3.csv("logos.csv", type).then(function (data) {
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
      d3.select("#value").text(val);
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
  const startYear = YEAR_START;
  const endYear = 2000; // one year past the data extent, matches the original animation range
  let currentYear = startYear;

  const mapStart = new Map();
  const mapEnd = new Map();

  dataset.forEach(function (d) {
    const key = normalizeLogoKey(d.logoName);
    mapStart.set(key, +d.logoStart);
    mapEnd.set(key, +d.logoEnd);
  });

  playButton.on("click", function () {
    const button = d3.select(this);
    if (button.text() == "Pause") {
      moving = false;
      clearInterval(timer);
      button.text("Play");
    } else {
      moving = true;
      timer = setInterval(step, 3500);
      button.text("Pause");
    }
  });

  //////// SVG PROSPETTO ////////

  d3.xml("svg/CARMINATI_REAL_forSVG copy_210213.svg").then(function (xml) {
    const mapHeight = 600;
    const loghiSvg = d3
      .select("#map")
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", "0 0 " + window.innerWidth + " " + mapHeight);

    const svgMap = xml.getElementsByTagName("g")[0];

    loghiSvg.node().appendChild(svgMap);
    applyNeonGlow(svgMap.querySelector("#Logos"));
    groups = d3.select("#Logos").selectAll("[data-logo]");

    warnAboutUnmatchedLogos(dataset, groups);

    groups.style("display", function () {
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

  // Gives each logo a neon-style glow in its own accent color, derived from
  // the artwork itself (the most common non-neutral fill/stroke in it) so
  // every logo stays coherent without being colored by hand. Only applied to
  // the direct children of #Logos, so a multi-part logo glows as one shape
  // rather than once per part. A randomized flicker delay keeps logos from
  // pulsing in sync, like independent neon tubes.
  function applyNeonGlow(logosGroup) {
    if (!logosGroup) return;
    Array.from(logosGroup.children).forEach((group) => {
      if (group.tagName !== "g" || !group.dataset.logo) return;
      const color = pickAccentColor(group);
      if (color) group.style.setProperty("--glow-color", color);
      group.style.setProperty("--flicker-delay", `${(-Math.random() * 9).toFixed(2)}s`);
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
    updateProspetto(currentYear);
    radialTimeline();

    slider.value(currentYear);
    currentYear = currentYear + 1;

    if (currentYear > endYear) {
      moving = false;
      currentYear = startYear;
      clearInterval(timer);
      playButton.text("Play");
    }
  }

  function updateProspetto(h) {
    groups.style("display", function () {
      const key = normalizeLogoKey(this.dataset.logo);
      return mapStart.get(key) <= h && mapEnd.get(key) >= h ? "block" : "none";
    });
  }

  const timelineCenter = { x: 500, y: 250 };

  function radialTimeline() {
    const arc = d3.arc();

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
      d.endAngle = angleScale(currentYear - YEAR_START);
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
        if (d.logoStart <= currentYear && d.logoEnd >= currentYear) {
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
