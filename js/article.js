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
});

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
