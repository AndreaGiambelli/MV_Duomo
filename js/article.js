"use strict";

// articolo.html: the article's own scrollytelling around the viz. The facade,
// logo wall and round timeline are drawn by js/duomoLights.js; this file only
// decides which year they show (through window.duomoLights.setYear) as the
// reader scrolls, and runs the parts that are the article's alone (gallery,
// lightbox, top bar).

// Archive photos in img/gallery, named <year>-<n>.jpg. Captions to be written.
const GALLERY = [
  { src: "1946-01.jpg", year: 1946, caption: "" },
  { src: "1948-02.jpg", year: 1948, caption: "" },
  { src: "1949-03.jpg", year: 1949, caption: "" },
  { src: "1950-04.jpg", year: 1950, caption: "" },
  { src: "1951-05.jpg", year: 1951, caption: "Sul set di Miracolo a Milano" },
  { src: "1951-06.jpg", year: 1951, caption: "" },
  { src: "1954-07.jpg", year: 1954, caption: "" },
  { src: "1956-08.jpg", year: 1956, caption: "" },
  { src: "1960-09.jpg", year: 1960, caption: "" },
  { src: "1961-10.jpg", year: 1961, caption: "" },
  { src: "1969-11.jpg", year: 1969, caption: "" },
  { src: "1975-12.jpg", year: 1975, caption: "" },
  { src: "1979-13.jpg", year: 1979, caption: "" },
  { src: "1980-14.jpg", year: 1980, caption: "" },
  { src: "1985-15.jpg", year: 1985, caption: "" },
  { src: "1990-16.jpg", year: 1990, caption: "" },
  { src: "1994-17.jpg", year: 1994, caption: "" },
  { src: "1996-18.jpg", year: 1996, caption: "" },
];

// duomoLights.js sets its API up once logos.csv has loaded; anything that
// needs it waits for this.
const lightsReady = new Promise((resolve) => {
  if (window.duomoLights) resolve(window.duomoLights);
  else document.addEventListener("duomolights:ready", () => resolve(window.duomoLights), { once: true });
});

function setYear(year) {
  lightsReady.then((lights) => lights.setYear(year));
}

/// Facade steps ///

// Each .step[data-year] sets its year when it crosses the middle of the
// screen; an empty data-year is the dark piazza before 1945.
const steps = document.querySelectorAll("#viz .step[data-year]");
const stepObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      steps.forEach((s) => s.classList.toggle("is-active", s === entry.target));
      const year = entry.target.dataset.year;
      setYear(year === "" ? null : +year);
    });
  },
  { rootMargin: "-50% 0px -50% 0px" }
);
steps.forEach((step) => stepObserver.observe(step));

// The tall scrub step maps its own scroll progress onto a year range.
const scrubStep = document.querySelector("#viz .step--scrub");
if (scrubStep) {
  const from = +scrubStep.dataset.scrubFrom;
  const to = +scrubStep.dataset.scrubTo;
  const card = scrubStep.querySelector(".card");
  let pending = false;
  function updateScrub() {
    pending = false;
    const rect = scrubStep.getBoundingClientRect();
    const travel = rect.height - innerHeight;
    // started once its top reaches mid-screen, like the other steps
    const progress = Math.min(1, Math.max(0, (innerHeight / 2 - rect.top) / travel));
    const inside = rect.top < innerHeight / 2 && rect.bottom > innerHeight / 2;
    scrubStep.classList.toggle("is-active", inside);
    card.style.setProperty("--scrub", progress);
    if (inside) {
      steps.forEach((s) => s.classList.remove("is-active"));
      setYear(Math.round(from + progress * (to - from)));
    }
  }
  addEventListener(
    "scroll",
    () => {
      if (!pending) requestAnimationFrame(updateScrub);
      pending = true;
    },
    { passive: true }
  );
}

// "N insegne accese" on each step card, counted from the same CSV.
d3.csv("logos.csv").then((rows) => {
  const logos = rows.filter((d) => d.logoStart && d.logoEnd);
  document.querySelectorAll("[data-total-logos]").forEach((el) => (el.textContent = logos.length));
  steps.forEach((step) => {
    const year = +step.dataset.year;
    const count = step.querySelector("[data-active-count]");
    if (!count) return;
    count.textContent = logos.filter((d) => +d.logoStart <= year && +d.logoEnd >= year).length;
  });
  drawTreemap(logos);
});

/// Categories treemap ///

// logos.csv's categoria values, as the article names them
const CATEGORY_LABELS = {
  alcool: "Alcolici",
  drinks: "Bibite",
  fashion: "Moda",
  tech: "Tecnologia",
  health: "Salute",
  office: "Ufficio",
  food: "Alimentari",
  bank: "Banche",
  beauty: "Bellezza",
  appl: "Elettrodomestici",
  clothes: "Abbigliamento",
  media: "Media",
  insu: "Assicurazioni",
  school: "Scuole",
  arredo: "Arredamento",
  travel: "Viaggi",
  "": "Da classificare",
};
// The treemap paints each cell in its sign's color on the facade, and each
// category in the color of its longest-lived sign. Until the facade SVG has
// loaded, and for the few signs with no artwork, the round timeline's muted
// base color.
const SIGN_FALLBACK_COLOR = "#b0909d";
const UNCLASSIFIED_COLOR = "#8a8a96";
const signColorsReady = new Promise((resolve) =>
  document.addEventListener("duomolights:colors", resolve, { once: true })
);

// A sign's color: its facade glow color where it has one (duomoLights.js
// leaves neutral colors out of that, so white signs have none), else the
// most used bright stroke/fill in its artwork, white included. unlit: a
// painted sign, which doesn't glow on the facade either.
function signLook(name) {
  const key = name.trim().toLowerCase();
  const sign = Array.from(document.querySelectorAll("#Logos [data-logo]")).find(
    (el) => el.dataset.logo.trim().toLowerCase() === key
  );
  if (!sign) return null;
  const unlit = sign.classList.contains("unlit") || !!sign.querySelector(".unlit");
  const glow = window.duomoLights && window.duomoLights.accentColor(name);
  if (glow) return { color: glow, unlit };
  const counts = new Map();
  sign.querySelectorAll("*").forEach((el) => {
    ["stroke", "fill"].forEach((attr) => {
      const value = el.getAttribute(attr);
      if (!value || value === "none" || value.startsWith("url")) return;
      const { r, g, b } = d3.rgb(value);
      // dark backing panels aren't light
      if (Math.max(r, g, b) < 70) return;
      counts.set(value, (counts.get(value) || 0) + 1);
    });
  });
  const top = d3.greatest(counts, ([, n]) => n);
  return top ? { color: top[0], unlit } : null;
}

// "aperol2white" -> "Aperol", "burghyBanner" -> "Burghy Banner"
function prettyLogoName(key) {
  const base = key.replace(/\d.*$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function drawTreemap(logos) {
  const container = document.getElementById("treemap");
  const tooltip = document.getElementById("treemap-tooltip");
  if (!container) return;

  const byCategory = d3.group(logos, (d) => d.categoria || "");
  const root = d3
    .hierarchy({
      children: Array.from(byCategory, ([cat, items]) => ({ cat, children: items.map((logo) => ({ logo })) })),
    })
    .count()
    // categories by size (unclassified last), signs inside by first year
    .sort((a, b) =>
      a.data.logo
        ? a.data.logo.logoStart - b.data.logo.logoStart
        : (a.data.cat === "") - (b.data.cat === "") || b.value - a.value
    );
  function colorSigns() {
    root.leaves().forEach((leaf) => {
      const look = signLook(leaf.data.logo.logoName);
      leaf.color = look ? look.color : SIGN_FALLBACK_COLOR;
      leaf.unlit = look ? look.unlit : false;
      // its own offset in the facade signs' 9s flicker, so they don't
      // all dip together
      leaf.flickerDelay = -Math.random() * 9;
    });
    root.children.forEach((cat) => {
      const coloured = cat.leaves().filter((leaf) => leaf.color !== SIGN_FALLBACK_COLOR);
      const longest = d3.greatest(coloured, (leaf) => leaf.data.logo.logoEnd - leaf.data.logo.logoStart);
      cat.color = cat.data.cat === "" ? UNCLASSIFIED_COLOR : longest ? longest.color : SIGN_FALLBACK_COLOR;
    });
  }
  colorSigns();

  // only categories big enough get their name drawn inside; the rest are
  // listed in a legend under the treemap (thresholds set per width in render)
  let minLabelW = 130;
  let minLabelH = 110;
  const hasLabel = (d) => d.x1 - d.x0 > minLabelW && d.y1 - d.y0 > minLabelH;
  const legend = d3.select(container).append("ul").attr("class", "tm-legend");

  function render() {
    const style = getComputedStyle(container);
    const width = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const small = width < 600;
    const height = Math.round(small ? width * 1.7 : width * 0.56);
    minLabelW = small ? 96 : 130;
    minLabelH = small ? 86 : 110;
    const labelTop = small ? 50 : 60;

    d3
      .treemap()
      .size([width, height])
      .tile(d3.treemapSquarify.ratio(1.2))
      .paddingInner((d) => (d.depth === 0 ? 12 : 2))
      .paddingOuter((d) => (d.depth === 0 ? 0 : 7))
      .paddingTop((d) => (d.depth === 1 && hasLabel(d) ? labelTop : d.depth === 0 ? 0 : 7))
      .round(true)(root);

    const svg = d3
      .select(container)
      .selectAll("svg")
      .data([null])
      .join((enter) => enter.insert("svg", ".tm-legend"))
      .attr("viewBox", `0 0 ${width} ${height}`);

    const cats = svg
      .selectAll("g.tm-cat")
      .data(root.children, (d) => d.data.cat)
      .join("g")
      .attr("class", "tm-cat")
      .style("--c", (d) => d.color)
      .style("--i", (d, i) => i);

    cats.selectAll("*").remove();
    cats
      .append("rect")
      .attr("class", "tm-tube")
      .attr("x", (d) => d.x0)
      .attr("y", (d) => d.y0)
      .attr("width", (d) => d.x1 - d.x0)
      .attr("height", (d) => d.y1 - d.y0)
      .attr("rx", 10);

    cats
      .selectAll("rect.tm-leaf")
      .data((d) => d.leaves())
      .join("rect")
      .attr("class", (d) => (d.unlit ? "tm-leaf tm-leaf--unlit" : "tm-leaf"))
      .style("--lc", (d) => d.color)
      .style("--fd", (d) => d.flickerDelay + "s")
      .attr("x", (d) => d.x0)
      .attr("y", (d) => d.y0)
      .attr("width", (d) => Math.max(0, d.x1 - d.x0))
      .attr("height", (d) => Math.max(0, d.y1 - d.y0))
      .attr("rx", 3)
      .on("mousemove", (event, d) => {
        const logo = d.data.logo;
        tooltip.innerHTML =
          `<strong>${prettyLogoName(logo.logoName)}</strong><br>` +
          `${CATEGORY_LABELS[d.parent.data.cat] ?? d.parent.data.cat} · ${logo.logoStart}–${logo.logoEnd}`;
        // kept clear of the screen edges (it's centred on the pointer)
        tooltip.style.left = Math.min(innerWidth - 90, Math.max(90, event.clientX)) + "px";
        tooltip.style.top = event.clientY + "px";
        tooltip.style.opacity = "1";
      })
      .on("mouseleave", () => (tooltip.style.opacity = "0"));

    const labelled = cats.filter(hasLabel);
    labelled
      .append("text")
      .attr("class", "tm-name")
      .attr("x", (d) => d.x0 + 14)
      .attr("y", (d) => d.y0 + (small ? 27 : 32))
      .text((d) => CATEGORY_LABELS[d.data.cat] ?? d.data.cat);
    labelled
      .append("text")
      .attr("class", "tm-count")
      .attr("x", (d) => d.x0 + 15)
      .attr("y", (d) => d.y0 + (small ? 42 : 50))
      .text((d) => `${d.value} INSEGNE`);

    legend
      .selectAll("li")
      .data(root.children.filter((d) => !hasLabel(d)), (d) => d.data.cat)
      .join("li")
      .style("--c", (d) => d.color)
      .html((d) => `<i></i>${CATEGORY_LABELS[d.data.cat] ?? d.data.cat} <b>${d.value}</b>`);
  }

  render();
  signColorsReady.then(() => {
    colorSigns();
    render();
  });
  let lastWidth = container.clientWidth;
  new ResizeObserver(() => {
    if (container.clientWidth === lastWidth) return;
    lastWidth = container.clientWidth;
    render();
  }).observe(container);

  // the categories switch on one by one once the treemap is in view
  const lightUp = new IntersectionObserver(
    (entries) => {
      if (!entries[0].isIntersecting) return;
      container.classList.add("is-lit");
      lightUp.disconnect();
    },
    { threshold: 0.3 }
  );
  lightUp.observe(container);
}

/// Dock: scalable slider ///

lightsReady.then(() => {
  const sliderSvg = document.querySelector("#slider .slider-svg");
  if (sliderSvg) {
    sliderSvg.setAttribute("viewBox", "0 0 910 60");
    sliderSvg.removeAttribute("width");
    sliderSvg.removeAttribute("height");
  }
});

/// Round timeline's own year control ///

const timelineYear = document.getElementById("timeline-year");
const timelineYearOut = document.getElementById("timeline-year-out");
timelineYear.addEventListener("input", () => {
  timelineYearOut.textContent = timelineYear.value;
  setYear(+timelineYear.value);
});
// arriving at the section shows whatever the slider says
new IntersectionObserver(
  (entries) => {
    if (entries[0].isIntersecting) setYear(+timelineYear.value);
  },
  { threshold: 0.4 }
).observe(document.getElementById("cronologia"));

/// Gallery + lightbox ///

const gallery = document.getElementById("gallery");
GALLERY.forEach((photo, i) => {
  const fig = document.createElement("figure");
  fig.className = "gallery__item reveal";
  fig.tabIndex = 0;
  fig.innerHTML = `<img src="img/gallery/${photo.src}" alt="Piazza del Duomo, ${photo.year}" loading="lazy" decoding="async" /><figcaption>${photo.year}</figcaption>`;
  fig.addEventListener("click", () => openLightbox(i));
  fig.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openLightbox(i);
    }
  });
  gallery.appendChild(fig);
});

const lightbox = document.getElementById("lightbox");
const lightboxImg = lightbox.querySelector("img");
const lightboxCaption = lightbox.querySelector("figcaption");
let lightboxIndex = 0;

function showPhoto(i) {
  lightboxIndex = (i + GALLERY.length) % GALLERY.length;
  const photo = GALLERY[lightboxIndex];
  lightboxImg.src = `img/gallery/${photo.src}`;
  lightboxImg.alt = `Piazza del Duomo, ${photo.year}`;
  lightboxCaption.textContent = photo.caption ? `${photo.year} — ${photo.caption}` : photo.year;
}

function openLightbox(i) {
  showPhoto(i);
  lightbox.showModal();
}

lightbox.querySelector(".lightbox__close").addEventListener("click", () => lightbox.close());
lightbox.querySelector(".lightbox__nav--prev").addEventListener("click", () => showPhoto(lightboxIndex - 1));
lightbox.querySelector(".lightbox__nav--next").addEventListener("click", () => showPhoto(lightboxIndex + 1));
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) lightbox.close();
});
lightbox.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") showPhoto(lightboxIndex - 1);
  if (e.key === "ArrowRight") showPhoto(lightboxIndex + 1);
});

/// Top bar ///

const hero = document.querySelector(".hero");
new IntersectionObserver((entries) => {
  document.body.classList.toggle("is-past-hero", !entries[0].isIntersecting);
}).observe(hero);

const navLinks = document.querySelectorAll(".topbar__nav a");
const navObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((a) => a.classList.toggle("is-active", a.hash === "#" + entry.target.id));
    });
  },
  { rootMargin: "-45% 0px -45% 0px" }
);
navLinks.forEach((a) => {
  const target = document.querySelector(a.hash);
  if (target) navObserver.observe(target);
});
