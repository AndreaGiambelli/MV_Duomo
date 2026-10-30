"use strict";

// Offline render of the storyboard (index.html?render, driven frame by frame
// by render/render.mjs): the page shows only the viz, fills the window, and
// takes its clock from the (faked, paused) performance.now() instead of the
// song, so every frame lands exactly on time however slow it is to draw.
// ?from=<seconds> starts the storyboard part-way through; ?fit=width shows
// the viz at the window's full width instead of its full height (see
// body.render-fit in style.css).
const RENDER_PARAMS = new URLSearchParams(location.search);
const RENDER = RENDER_PARAMS.has("render");
const RENDER_FROM = +RENDER_PARAMS.get("from") || 0;
if (RENDER) document.body.classList.add("render-mode");
if (RENDER && RENDER_PARAMS.get("fit") === "width") document.body.classList.add("render-fit");
// ?vertical: the 9:16 cut for social (see body.render-vertical in style.css)
if (RENDER && RENDER_PARAMS.has("vertical")) document.body.classList.add("render-vertical");

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
  const playButton = d3.select("#play-button");
  const song = document.getElementById("song");
  // The scrub bar can only seek the song if the server answers byte-range
  // requests -- python3 -m http.server doesn't, and the bar then snaps back
  // on release. Ask for two bytes once and say so loudly if they come back
  // as the whole file (aborted as soon as the headers are in).
  if (!RENDER) {
    const probe = new AbortController();
    fetch(song.currentSrc || song.src, { headers: { Range: "bytes=0-1" }, signal: probe.signal })
      .then((response) => {
        probe.abort();
        if (response.status !== 206) {
          console.warn(
            "[duomoLights] this server ignores Range requests, so the scrub bar can't seek " +
              "the song -- serve the project with `python3 serve.py <port>` instead of " +
              "`python3 -m http.server`."
          );
        }
      })
      .catch(() => {});
  }
  const karaoke = setUpKaraoke(song);
  const piazzaPlate = document.getElementById("piazza-plate");
  // render mode's stand-in for the crowd video (see renderPiazzaCanvas)
  const PIAZZA_VIDEO_FPS = 30;
  const PIAZZA_FRAMES_DIR = "render/out/piazza_frames/";
  let piazzaFrames = [];
  const piazzaVideo = RENDER ? renderPiazzaCanvas() : document.getElementById("piazza-bg");
  // Street starts empty (the plate, no people/cars) and only cuts over to
  // the looping crowd video once a year is actually on screen -- driven
  // from updateProspetto() below so it switches in lockstep with 1945's
  // audio-synced entrance (and with scrollama's idle preview), never on
  // its own timer.
  let crowdVisible = false;
  // render mode has a canvas instead of the video, drawn per frame as if it
  // had been playing since this moment (see syncRenderVideo)
  let crowdShownAt = null;
  function setCrowdVisible(visible) {
    if (visible === crowdVisible) return;
    crowdVisible = visible;
    if (visible) {
      piazzaPlate.style.display = "none";
      piazzaVideo.style.display = "block";
      if (RENDER) {
        crowdShownAt = performance.now();
      } else {
        piazzaVideo.currentTime = 0;
        piazzaVideo.play();
      }
    } else {
      if (!RENDER) piazzaVideo.pause();
      piazzaVideo.style.display = "none";
      piazzaPlate.style.display = "block";
    }
  }
  // Filled in once the facade SVG loads (see buildLogoAccentColorMap below);
  // the round timeline's first paint happens before that, so every arc
  // falls back to the muted base color until the real ones are ready.
  let logoAccentColor = new Map();
  const startYear = YEAR_START;
  const endYear = 2000; // one year past the data extent, matches the original animation range
  // null = nothing shown yet (just the facade video with its crowd) -- the
  // state before 1945's first appearance, both on initial load and during
  // the pre-roll below.
  let currentYear = null;

  // Two fixed landmarks in the audio track drive every other year's timing:
  // 1945 (the first year) at 0:20.3 and 2000 (the last year) at 3:00. The
  // per-year step is whatever makes those two exact -- nothing shows
  // before 1945, and 2000 holds from 3:00 on. These are when each year
  // visibly *starts* -- its signs' fade-in, the crowd video and its caption
  // all begin right on the mark.
  const YEAR_1945_AUDIO_SEC = 20.3;
  const YEAR_2000_AUDIO_SEC = 3 * 60;
  const YEAR_STEP_SEC =
    (YEAR_2000_AUDIO_SEC - YEAR_1945_AUDIO_SEC) / (endYear - startYear);

  // The year on screen is read straight off the song's position (see
  // seqFrame below) instead of counted by timers: a timer started on the
  // key press runs ahead of audio that takes a moment to actually start,
  // and setInterval drifts further over 3 minutes -- deriving it from
  // currentTime keeps every year frame-locked to the track, through
  // pauses and seeks too.
  function yearAtAudioTime(t) {
    if (t < YEAR_1945_AUDIO_SEC) return null;
    return Math.min(endYear, startYear + Math.floor((t - YEAR_1945_AUDIO_SEC) / YEAR_STEP_SEC));
  }

  const mapStart = new Map();
  const mapEnd = new Map();

  dataset.forEach(function (d) {
    const key = normalizeLogoKey(d.logoName);
    mapStart.set(key, +d.logoStart);
    mapEnd.set(key, +d.logoEnd);
  });

  function togglePlay() {
    if (playButton.text() == "Pause") {
      moving = false;
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
      if (song.currentTime === 0) startSequence();
      // the track (3:10.7) ends before the storyboard does (3:20) -- resuming
      // in that tail must not restart it from the top.
      if (!seqInTail) song.play();
    }
  }

  // Storyboard for the recorded video, timed on the song's clock (seconds):
  // black until 0:12 (with the MM title card shown 0:02-0:06), fading to the
  // bare street plate by 0:15; the usual year sequence (1945 lands at
  // 0:20.3, 2000 at 3:00) held on 2000 until it fades back to black over
  // 3:02-3:05; black with the end credits rolling until 3:18.5, then black
  // until 3:20, when it stops.
  // "Black" is #seq-black, covering only the viz area, never the page.
  const SEQ_FADE_IN_START = 12;
  const SEQ_FADE_IN_END = 15;
  const SEQ_FADE_OUT_START = 3 * 60 + 2;
  const SEQ_FADE_OUT_END = 3 * 60 + 5;
  const SEQ_END = 3 * 60 + 20;
  // Things shown on the black screen ease in from their start time and
  // out from their end time, each over this long.
  const SEQ_CARD_EASE = 0.5;
  const SEQ_TITLE_WINDOWS = [[2, 6]];
  // The song-title signs (svg/title_neons.svg) light up one by one, in a
  // shuffled order, on the black screen behind the MM card: the first half
  // a second after the card starts to appear, the last at SEQ_NEON_LAST,
  // evenly spaced, each with the facade signs' 0.35s fade-in. All go out
  // together over SEQ_CARD_EASE from SEQ_FADE_IN_START, as the street
  // starts to show through.
  const SEQ_NEON_FIRST = SEQ_TITLE_WINDOWS[0][0] + 0.5;
  const SEQ_NEON_LAST = SEQ_FADE_IN_START - 1;
  const SEQ_NEON_FADE = 0.35;
  // The "Milan me bel belèe" title sign (svg/title_card.svg) takes the
  // centre in front of them: from a second after the MM card has gone until
  // 1.5s before the street starts fading in, easing like the MM card.
  const SEQ_TITLE_CARD_WINDOWS = [
    [SEQ_TITLE_WINDOWS[0][1] + SEQ_CARD_EASE + 1, SEQ_FADE_IN_START - 1.5],
  ];
  // Before any year is on screen, the year caption's slot names the place
  // instead -- from a second into the street fading in until shortly before
  // 1945 takes the slot over (fading out by then, so 1945 arrives on a
  // blank caption, see fadeTextTo).
  const SEQ_PLACE_CAPTION = "Piazza del Duomo, Milano";
  const SEQ_PLACE_FROM = SEQ_FADE_IN_START + 1;
  const SEQ_PLACE_UNTIL = 19.8;
  const yearDisplay = document.getElementById("year-display");
  // End credits roll up the black screen at a steady pace: their top edge
  // enters from the bottom once the scene has gone fully black, and their
  // bottom edge leaves the top 1.5s before the end.
  const SEQ_CREDITS_FROM = SEQ_FADE_OUT_END;
  const SEQ_CREDITS_UNTIL = SEQ_END - 1.5;
  const seqCredits = document.getElementById("seq-credits");
  let seqCreditsSvg = null;
  let seqPlaceShown = false;
  const seqBlack = document.getElementById("seq-black");
  const seqTitle = document.getElementById("seq-title");
  const seqTitleCard = document.getElementById("seq-title-card");
  const seqTitles = document.getElementById("seq-titles");
  let seqNeons = [];
  const seqTimer = document.getElementById("seq-timer");
  const seqScrub = document.getElementById("seq-scrub");
  seqScrub.max = SEQ_END;
  let seqClock = 0;
  let seqStarted = false;
  let seqEnded = false;
  // past the song's end (3:10.7 -> 3:20) there's no audio clock to read,
  // so the sequence runs on frame time there instead.
  let seqInTail = false;
  let seqLastFrame = null;
  let seqScrubbing = false;
  // a seek in flight: until the audio lands there, its currentTime may
  // still read the old spot, which would snap everything straight back.
  let seqSeekTarget = null;

  function seqBlackOpacity(t) {
    if (t < SEQ_FADE_IN_START) return 1;
    if (t < SEQ_FADE_IN_END)
      return 1 - (t - SEQ_FADE_IN_START) / (SEQ_FADE_IN_END - SEQ_FADE_IN_START);
    if (t < SEQ_FADE_OUT_START) return 0;
    if (t < SEQ_FADE_OUT_END)
      return (t - SEQ_FADE_OUT_START) / (SEQ_FADE_OUT_END - SEQ_FADE_OUT_START);
    return 1;
  }

  function easeInOut(x) {
    const c = Math.min(1, Math.max(0, x));
    return c * c * (3 - 2 * c);
  }

  function seqTitleOpacity(t, windows = SEQ_TITLE_WINDOWS) {
    for (const [from, to] of windows) {
      if (t >= from && t < to + SEQ_CARD_EASE) {
        return Math.min(
          easeInOut((t - from) / SEQ_CARD_EASE),
          1 - easeInOut((t - to) / SEQ_CARD_EASE)
        );
      }
    }
    return 0;
  }

  function seqNeonOpacity(t, index) {
    const every = seqNeons.length > 1 ? (SEQ_NEON_LAST - SEQ_NEON_FIRST) / (seqNeons.length - 1) : 0;
    const on = SEQ_NEON_FIRST + index * every;
    if (t < on || t >= SEQ_FADE_IN_START + SEQ_CARD_EASE) return 0;
    return Math.min(
      easeInOut((t - on) / SEQ_NEON_FADE),
      1 - easeInOut((t - SEQ_FADE_IN_START) / SEQ_CARD_EASE)
    );
  }

  function updateSeqCredits(t) {
    const p = (t - SEQ_CREDITS_FROM) / (SEQ_CREDITS_UNTIL - SEQ_CREDITS_FROM);
    const rolling = seqCreditsSvg !== null && p >= 0 && p <= 1;
    seqCredits.style.display = rolling ? "" : "none";
    if (!rolling) return;
    const viewH = seqCredits.clientHeight;
    const rollH = seqCreditsSvg.getBoundingClientRect().height;
    seqCreditsSvg.style.transform = `translateY(${viewH - (viewH + rollH) * p}px)`;
  }

  const creditsLoaded = d3.xml("svg/credits.svg" + CACHE_BUST).then((xml) => {
    const svg = document.importNode(xml.documentElement, true);
    // drawn at the 1920-frame scale: its own width (e.g. 905) out of 1920
    svg.style.width = `${(+svg.getAttribute("width") / 1920) * 100}%`;
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    seqCredits.appendChild(svg);
    seqCreditsSvg = svg;
  });

  function updateSeqNeons(t) {
    let anyLit = false;
    seqNeons.forEach((pair, i) => {
      const o = seqNeonOpacity(t, i);
      if (o > 0) anyLit = true;
      pair.forEach((el) => (el.style.opacity = o));
    });
    // nothing lit -> drop the whole layer, so its blur filters cost nothing
    // for the rest of the video
    seqTitles.style.display = anyLit ? "" : "none";
  }

  // title_neons.svg holds the same design twice, each copy under its own
  // layer blur and the second one shifted a little, with one group per sign
  // inside each. Figma exports no names, so each sign is paired with its
  // twin by position: the copy's own offset applied, the nearest group.
  // Both twins light up together; the file's own blur and drop shadows are
  // all the glow they get.
  function buildSeqNeons(svg) {
    // the frame's own full-size backdrop (the same purple-to-black as
    // #seq-black, but sized to a 1080-tall frame) would never fade and would
    // cover the street as it comes in -- #seq-black already provides it
    // (only drawn rects -- the clip-path's own frame-sized rect must stay)
    svg.querySelectorAll("rect").forEach((rect) => {
      if (rect.closest("defs, clipPath, mask")) return;
      if (+rect.getAttribute("width") >= +svg.getAttribute("viewBox").split(" ")[2]) rect.remove();
    });
    const copies = Array.from(svg.querySelectorAll("g[filter]")).filter(
      (g) => g.parentElement.closest("g[filter]") === null
    );
    const signsOf = (copy) => Array.from(copy.children).filter((el) => el.tagName === "g");
    // each sign's own red drop shadow is dropped; the copy-wide layer blur
    // (the filter on the copy itself) stays
    copies.forEach((copy) => signsOf(copy).forEach((sign) => sign.removeAttribute("filter")));
    const centerOf = (el) => {
      const b = el.getBBox();
      return [b.x + b.width / 2, b.y + b.height / 2];
    };
    const [first, ...others] = copies;
    const firstCopyBox = first.getBBox();
    const pairs = signsOf(first).map((sign) => [sign]);
    others.forEach((copy) => {
      const copyBox = copy.getBBox();
      const dx = copyBox.x - firstCopyBox.x;
      const dy = copyBox.y - firstCopyBox.y;
      const unmatched = pairs.slice();
      signsOf(copy).forEach((sign) => {
        const [cx, cy] = centerOf(sign);
        let best = 0;
        let bestDist = Infinity;
        unmatched.forEach((pair, k) => {
          const [px, py] = centerOf(pair[0]);
          const d = Math.hypot(px + dx - cx, py + dy - cy);
          if (d < bestDist) {
            bestDist = d;
            best = k;
          }
        });
        unmatched[best].push(sign);
        unmatched.splice(best, 1);
      });
    });

    // A fixed shuffle (seeded, not Math.random) so the order is "random" but
    // the same on every play, scrub and offline render.
    let seed = 20261030;
    const nextRandom = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let k = pairs.length - 1; k > 0; k--) {
      const r = Math.floor(nextRandom() * (k + 1));
      [pairs[k], pairs[r]] = [pairs[r], pairs[k]];
    }
    // The neon flicker animates opacity too, so it can't share an element
    // with the reveal fade above (a running animation always wins): each
    // sign's contents go in an inner group that flickers, twins in step.
    const svgNS = "http://www.w3.org/2000/svg";
    pairs.forEach((pair) => {
      const delay = `${(-nextRandom() * 9).toFixed(2)}s`;
      pair.forEach((sign) => {
        const flicker = document.createElementNS(svgNS, "g");
        flicker.classList.add("flicker-unit");
        flicker.style.setProperty("--flicker-delay", delay);
        while (sign.firstChild) flicker.appendChild(sign.firstChild);
        sign.appendChild(flicker);
        sign.style.opacity = 0;
      });
    });
    return pairs;
  }

  const titlesLoaded = d3.xml("svg/title_neons.svg" + CACHE_BUST).then((xml) => {
    const svg = document.importNode(xml.documentElement, true);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    seqTitles.appendChild(svg);
    // getBBox() needs the layer rendered; the next frame hides it again
    // until the first neon lights up.
    seqTitles.style.display = "";
    seqNeons = buildSeqNeons(svg);
  });

  function formatSeqClock(t) {
    const tenths = Math.floor(t * 10);
    const min = Math.floor(tenths / 600);
    const sec = Math.floor(tenths / 10) % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${tenths % 10}`;
  }

  function startSequence() {
    seqClock = 0;
    seqStarted = true;
    seqEnded = false;
    seqInTail = false;
    seqLastFrame = null;
  }

  function endSequence() {
    seqClock = SEQ_END;
    seqEnded = true;
    seqInTail = false;
    moving = false;
    playButton.text("Play");
    song.pause();
    song.currentTime = 0;
    // back to the pre-1945 state (bare plate, no signs) behind the black,
    // so the next press starts the storyboard cleanly from the top.
    currentYear = null;
    updateProspetto(currentYear);
    radialTimeline();
  }

  // Jump the whole storyboard to t seconds, playing or paused -- the audio
  // follows, and so (next frame) do the year, overlays and readout.
  function seekSequence(t) {
    seqStarted = true;
    seqEnded = false;
    seqClock = t;
    seqLastFrame = null;
    seqInTail = t >= song.duration;
    if (seqInTail) {
      song.pause();
      song.currentTime = song.duration;
    } else {
      seqSeekTarget = t;
      song.currentTime = t;
      if (moving && song.paused) song.play();
    }
  }

  function syncPlaceCaption() {
    const show =
      currentYear === null && seqClock >= SEQ_PLACE_FROM && seqClock < SEQ_PLACE_UNTIL;
    if (show === seqPlaceShown) return;
    seqPlaceShown = show;
    if (show) fadeTextTo(yearDisplay, SEQ_PLACE_CAPTION);
    // leaving the window by reaching a year: updateProspetto() already put
    // that year in the slot, so only blank it when no year took over
    else if (currentYear === null) fadeTextTo(yearDisplay, "");
  }

  function syncYearToClock() {
    const year = yearAtAudioTime(seqClock);
    if (year === currentYear) return;
    currentYear = year;
    updateProspetto(currentYear);
    radialTimeline();
    if (year !== null) slider.value(year);
  }

  // While the song plays its own currentTime is the clock, so the overlays,
  // the year and the readout all stay locked to the audio.
  let renderStartedAt = 0;
  let onFacadeReady = () => {};
  function paintSeq(now) {
    if (seqStarted && !seqEnded) {
      if (RENDER) {
        seqClock = RENDER_FROM + (performance.now() - renderStartedAt) / 1000;
      } else if (seqScrubbing) {
        // the handle is the clock while it's held, whatever the audio says
        seqClock = +seqScrub.value;
      } else if (seqSeekTarget !== null) {
        seqClock = seqSeekTarget;
        if (!song.seeking) seqSeekTarget = null;
      } else if (!seqInTail) {
        if (song.ended) seqInTail = true;
        else seqClock = song.currentTime;
      }
      if (seqInTail && moving && seqLastFrame !== null) {
        seqClock += (now - seqLastFrame) / 1000;
      }
      syncYearToClock();
      syncPlaceCaption();
      // normally the song's own timeupdate drives the lyrics (see
      // setUpKaraoke), but in render mode the song never plays
      if (RENDER) karaoke.showAt(seqClock);
      if (seqClock >= SEQ_END) endSequence();
    }
    seqLastFrame = now;
    seqTimer.textContent = formatSeqClock(seqClock);
    seqBlack.style.opacity = seqStarted ? seqBlackOpacity(seqClock) : 0;
    seqTitle.style.opacity = seqStarted ? seqTitleOpacity(seqClock) : 0;
    seqTitleCard.style.opacity = seqStarted
      ? seqTitleOpacity(seqClock, SEQ_TITLE_CARD_WINDOWS)
      : 0;
    updateSeqNeons(seqStarted ? seqClock : -1);
    updateSeqCredits(seqStarted ? seqClock : -1);
    if (!seqScrubbing) seqScrub.value = seqClock;
  }

  function seqFrame(now) {
    paintSeq(now);
    if (RENDER) syncRenderAnimations();
    requestAnimationFrame(seqFrame);
  }
  requestAnimationFrame(seqFrame);

  // CSS animations/transitions and el.animate() run on the browser's real
  // clock, which the faked one doesn't touch -- so in render mode each one
  // is paused the moment it's first seen and then stepped by hand to the
  // faked time elapsed since. Checked on every (faked) animation frame, so
  // one is at most a frame late to start; finite ones are dropped once
  // done, leaving their end state in place.
  const renderAnimationStart = new WeakMap();
  function syncRenderAnimations() {
    const now = performance.now();
    document.getAnimations().forEach((animation) => {
      if (!renderAnimationStart.has(animation)) {
        renderAnimationStart.set(animation, now);
        animation.pause();
      }
      const elapsed = now - renderAnimationStart.get(animation);
      if (elapsed >= animation.effect.getComputedTiming().endTime) animation.cancel();
      else animation.currentTime = elapsed;
    });
  }

  // Seeking the <video> itself per frame proved unreliable in headless
  // Chrome (its seeked event sometimes never comes once screenshots are
  // being taken), so render mode swaps it for a canvas showing the crowd
  // video's own frames, which render.mjs extracts as PNGs beforehand
  // (?piazzaFrames=<count>). Same box, same .piazza-layer styling.
  function renderPiazzaCanvas() {
    const video = document.getElementById("piazza-bg");
    const canvas = document.createElement("canvas");
    canvas.className = video.className;
    // the video's own size
    canvas.width = 1376;
    canvas.height = 768;
    canvas.style.display = "none";
    video.replaceWith(canvas);
    return canvas;
  }

  // One at a time, each fully decoded up front so drawing it is instant:
  // decoding all 90 big PNGs at once in the browser sometimes failed
  // outright ("The source image cannot be decoded"), so each also gets a
  // couple of retries.
  async function loadPiazzaFrames() {
    const count = +RENDER_PARAMS.get("piazzaFrames");
    for (let i = 0; i < count; i++) {
      const url = `${PIAZZA_FRAMES_DIR}${String(i + 1).padStart(3, "0")}.png`;
      for (let attempt = 1; ; attempt++) {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`${url}: ${response.status}`);
          piazzaFrames[i] = await createImageBitmap(await response.blob());
          break;
        } catch (err) {
          if (attempt === 3) throw err;
        }
      }
    }
  }

  // Draws the frame the crowd video would be on had it been playing
  // (looping) since setCrowdVisible() showed it. The faked clock moves in
  // whole milliseconds (33, 67, 100...), so the frame is rounded, not
  // floored -- 33ms is frame 1, not frame 0 again.
  function syncRenderVideo() {
    if (!crowdVisible) return;
    const elapsed = (performance.now() - crowdShownAt) / 1000;
    const frame = Math.round(elapsed * PIAZZA_VIDEO_FPS) % piazzaFrames.length;
    piazzaVideo.getContext("2d").drawImage(piazzaFrames[frame], 0, 0);
  }

  if (RENDER) {
    const facadeReady = new Promise((resolve) => (onFacadeReady = resolve));
    const videoReady = loadPiazzaFrames();
    window.renderEnd = SEQ_END;
    window.renderReady = Promise.all([
      facadeReady,
      titlesLoaded,
      creditsLoaded,
      karaoke.ready,
      videoReady,
      document.fonts.ready,
    ]);
    // called once the faked clock is paused: the storyboard's RENDER_FROM
    // is pinned to this moment
    window.renderStart = () => {
      renderStartedAt = performance.now();
      startSequence();
    };
    // brings every layer to the faked clock's current time, ready to be
    // captured
    window.renderFrame = () => {
      paintSeq(performance.now());
      syncRenderAnimations();
      syncRenderVideo();
    };
  }

  seqScrub.addEventListener("pointerdown", () => (seqScrubbing = true));
  // released anywhere, not just over the bar (change doesn't fire at all
  // when the handle ends up where it started)
  ["pointerup", "pointercancel"].forEach((type) =>
    window.addEventListener(type, () => (seqScrubbing = false))
  );
  seqScrub.addEventListener("input", () => seekSequence(+seqScrub.value));

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
    logoAccentColor = buildLogoAccentColorMap(svgMap.querySelector("#Logos"));
    lazyBuildLogoWall(dataset, svgMap.querySelector("#Logos"), loghiSvg.node());
    // Only the node where each logo starts gets the year-based opacity
    // toggle: one with no [data-logo] ancestor, or one whose name differs
    // from its nearest ancestor's (a distinct sign nested inside another,
    // see sync-data-logo.py). Nested parts of the same sign inherit the
    // fade from it -- toggling them too would write an inline opacity:1
    // over their own authored opacity (e.g. Figma's dimmed, blurred
    // "broken neon" letters in farmacia1/2), flattening them to full.
    groups = d3
      .select("#Logos")
      .selectAll("[data-logo]")
      .filter(function () {
        const owner = this.parentElement.closest("[data-logo]");
        return !owner || owner.dataset.logo !== this.dataset.logo;
      });

    warnAboutUnmatchedLogos(dataset, groups);

    groups.style("opacity", function () {
      if (currentYear === null) return 0;
      const key = normalizeLogoKey(this.dataset.logo);
      return mapStart.get(key) <= currentYear && mapEnd.get(key) >= currentYear
        ? 1
        : 0;
    });
    // Mirrors updateProspetto()'s crowd toggle, in case Play was pressed
    // (advancing currentYear past null) before this slower SVG fetch
    // resolved -- without this the facade would catch up but the street
    // would stay stuck on the empty plate.
    setCrowdVisible(currentYear !== null);
    // Repaint now that logoAccentColor is populated -- the very first call
    // (below, right after this whole d3.xml().then() chain is set up) ran
    // before this slower fetch resolved, so every arc drew in the muted
    // fallback color until now.
    radialTimeline();
    onFacadeReady();
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

  // Some signs shouldn't glow at all -- e.g. copertura1990 is scaffolding
  // sheeting, not an illuminated sign, and a few real signs (benetton, the
  // acqua da tavola pair, jodont, radimi, dentifricioKnapp, the two
  // L'Europeo signs, safar, deDeFe) were asked to stay plain. Keyed by the
  // same normalized logoName used everywhere else to match CSV rows.
  const NO_GLOW_LOGOS = new Set(
    [
      "benetton",
      "copertura1990",
      "lAcquaDaTavola1",
      "acquaDaTavola2",
      "jodont",
      "radimi",
      "dentifricioKnapp",
      "lEuropeo",
      "lEuropeo2",
      "safar",
      "deDeFe",
    ].map(
      normalizeLogoKey
    )
  );

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
      if (NO_GLOW_LOGOS.has(normalizeLogoKey(group.dataset.logo))) {
        // painted/printed signs, not self-lit -- dimmed via CSS (.unlit)
        // so they read as lit only by the street, not glowing on their own.
        group.classList.add("unlit");
        return;
      }
      group.style.setProperty("--flicker-delay", `${(-Math.random() * 9).toFixed(2)}s`);

      const parts = Array.from(group.children).filter((c) => c.tagName === "g");

      if (parts.length === 0) {
        // A flat sign's flicker animation lands on this exact group -- and
        // a running CSS animation always wins over any other source for the
        // property it animates, so updateProspetto()'s year-based opacity
        // fade (also targeting [data-logo], also setting opacity) would be
        // silently overridden and the sign would stay visible forever.
        // Wrap it in an extra group carrying the same data-logo: the
        // wrapper owns the year-based fade untouched by any animation,
        // while the flicker keeps animating the original group inside it.
        const wrapper = document.createElementNS("http://www.w3.org/2000/svg", "g");
        wrapper.dataset.logo = group.dataset.logo;
        group.parentNode.insertBefore(wrapper, group);
        wrapper.appendChild(group);
      }

      const glowUnits = (parts.length > 0 ? parts : [group]).map((unit) => {
        // A part that carries its own authored filter or opacity (Figma's
        // layer blur on dimmed "broken neon" letters, e.g. coopFarmaceutica2)
        // would lose both to .glow-unit: the CSS drop-shadow filter replaces
        // the filter attribute, and the flicker animation overrides the
        // opacity. Glow and flicker go on a wrapper around it instead, so
        // the part keeps its own blur and dimming inside the glow.
        if (unit === group) return unit;
        if (!unit.hasAttribute("filter") && !unit.hasAttribute("opacity")) return unit;
        const wrapper = document.createElementNS("http://www.w3.org/2000/svg", "g");
        unit.parentNode.insertBefore(wrapper, unit);
        wrapper.appendChild(unit);
        return wrapper;
      });
      glowUnits.forEach((unit) => {
        unit.classList.add("glow-unit");
        const color = pickAccentColor(unit);
        if (color) unit.style.setProperty("--glow-color", color);
      });
    });
  }

  // One representative color per logo -- whatever applyNeonGlow already
  // picked for its glow -- so the round timeline's arcs (see
  // radialTimeline below) can be tinted and glow the same way instead of
  // rendering as a generic, uncolored chart.
  function buildLogoAccentColorMap(logosGroup) {
    const map = new Map();
    if (!logosGroup) return map;
    Array.from(logosGroup.children).forEach((g) => {
      if (g.tagName !== "g" || !g.dataset.logo) return;
      const key = normalizeLogoKey(g.dataset.logo);
      if (map.has(key)) return;
      const unit = g.classList.contains("glow-unit") ? g : g.querySelector(".glow-unit");
      const color = unit && unit.style.getPropertyValue("--glow-color");
      if (color) map.set(key, color);
    });
    return map;
  }

  // buildLogoWall clones ~5,000+ paths across ~120 tiles -- real cost even
  // before any filter/animation is applied -- so it's deferred until
  // #logo-wall is actually about to scroll into view (with margin, so it's
  // ready just before it's reached) instead of paid by every visitor at
  // page load regardless of whether they ever scroll this far.
  function lazyBuildLogoWall(dataset, logosGroup, facadeSvgRoot) {
    const section = document.getElementById("logo-wall");
    if (!section) return;
    if (!("IntersectionObserver" in window)) {
      buildLogoWall(dataset, logosGroup, facadeSvgRoot);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        buildLogoWall(dataset, logosGroup, facadeSvgRoot);
      },
      { rootMargin: "400px" }
    );
    observer.observe(section);
  }

  // Mirrors every logo that has real artwork (one CSV row with a matching
  // SVG group) into its own small always-on tile in #logo-wall-grid,
  // roughly in order of first appearance -- a "carpet" of every sign the
  // facade ever shows, glowing and flickering exactly like the main
  // timeline since each tile is a straight clone of the glow-ready group
  // (see applyNeonGlow above), just with the year-based opacity/display it
  // inherited from the clone stripped back off. A hover tooltip surfaces
  // each sign's years and provenance/category from the CSV.
  function buildLogoWall(dataset, logosGroup, facadeSvgRoot) {
    const container = document.getElementById("logo-wall-grid");
    if (!container || !logosGroup) return;

    const svgNS = "http://www.w3.org/2000/svg";
    // Paths with no fill of their own inherit one from the facade's root
    // <svg> (carried over from the source file, see the fill/stroke/color
    // copy above) -- each tile gets its own fresh <svg>, so without these
    // same attributes those paths fall back to SVG's true default fill,
    // black, showing up as solid black shapes instead of their real color.
    const inheritedAttrs = ["fill", "stroke", "color"]
      .map((attr) => [attr, facadeSvgRoot && facadeSvgRoot.getAttribute(attr)])
      .filter(([, value]) => value !== null && value !== undefined);
    const sourcesByKey = new Map();
    Array.from(logosGroup.children).forEach((g) => {
      if (g.tagName === "g" && g.dataset.logo) {
        sourcesByKey.set(normalizeLogoKey(g.dataset.logo), g);
      }
    });

    const seen = new Set();
    const rows = [...dataset]
      .sort((a, b) => a.logoStart - b.logoStart)
      .filter((d) => {
        const key = normalizeLogoKey(d.logoName);
        if (seen.has(key) || !sourcesByKey.has(key)) return false;
        seen.add(key);
        return true;
      });

    const PAD = 0.6; // breathing room around each sign's own bbox, in its own SVG units

    rows.forEach((d) => {
      const source = sourcesByKey.get(normalizeLogoKey(d.logoName));
      const bbox = source.getBBox();
      if (bbox.width === 0 || bbox.height === 0) return;

      const clone = source.cloneNode(true);
      clone.querySelectorAll("*").forEach((el) => {
        el.style.removeProperty("opacity");
        el.style.removeProperty("display");
      });
      clone.style.removeProperty("opacity");
      clone.style.removeProperty("display");

      const tileSvg = document.createElementNS(svgNS, "svg");
      tileSvg.setAttribute(
        "viewBox",
        `${bbox.x - PAD} ${bbox.y - PAD} ${bbox.width + PAD * 2} ${bbox.height + PAD * 2}`
      );
      inheritedAttrs.forEach(([attr, value]) => tileSvg.setAttribute(attr, value));
      tileSvg.appendChild(clone);

      const tile = document.createElement("div");
      tile.className = "logo-tile";
      const aspect = bbox.width / bbox.height;
      if (aspect >= 4) tile.classList.add("tile-w3");
      else if (aspect >= 1.8) tile.classList.add("tile-w2");
      else if (aspect <= 0.7) tile.classList.add("tile-tall");

      // A tooltip nested inside the tile (like an earlier version of this)
      // gets silently clipped: .logo-tile has content-visibility:auto for
      // off-screen performance, which carries implied paint containment
      // that crops anything extending past the tile's own box, hover or
      // not. The shared #timeline-tooltip (see showTimelineTooltip below)
      // lives outside any contained ancestor, so reuse that instead.
      tile.addEventListener("mouseover", (event) => showTimelineTooltip(event, d));
      tile.addEventListener("mousemove", (event) => showTimelineTooltip(event, d));
      tile.addEventListener("mouseout", hideTimelineTooltip);

      tile.appendChild(tileSvg);
      container.appendChild(tile);
    });
  }

  function pickAccentColor(group) {
    const counts = new Map();
    group.querySelectorAll("*").forEach((el) => {
      // stroke before fill: Array.sort is stable, so on an exact tie
      // (e.g. paglieri, where every path has both a fill and a different
      // stroke, 17-17) whichever was inserted into the map first wins --
      // checking stroke first means a tied outline color wins over a tied
      // fill color, since these signs are usually drawn as a colored neon
      // outline over a plain/dark fill, not the other way round.
      ["stroke", "fill"].forEach((attr) => {
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

  function updateProspetto(h) {
    fadeTextTo(document.getElementById("value"), h);
    fadeTextTo(document.getElementById("year-display"), h);
    groups.style("opacity", function () {
      if (h === null) return 0;
      const key = normalizeLogoKey(this.dataset.logo);
      return mapStart.get(key) <= h && mapEnd.get(key) >= h ? 1 : 0;
    });
    setCrowdVisible(h !== null);
  }

  const timelineCenter = { x: 500, y: 250 };

  const TIMELINE_BASE_COLOR = "#b0909d";

  function radialTimeline() {
    // Rounding each band's own thickness (never fully round, so thin outer
    // rings don't collapse into dots) softens the hard-edged sectors into
    // pill-like strokes -- same spirit as the facade signs' own rounded
    // neon tubing, applied to this abstract chart instead of lettering.
    const arc = d3.arc().cornerRadius((d) => Math.min(d.dy / 2, 3));

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
      // Same accent color as this sign's own glow on the facade/logo wall,
      // so this chart reads as "the same signs" rather than a generic plot.
      d.color = logoAccentColor.get(normalizeLogoKey(d.logoName)) || TIMELINE_BASE_COLOR;
    });

    overlayBands.forEach(function (d) {
      d.startAngle = angleScale(d.logoStart - YEAR_START);
      d.endAngle = angleScale(progressYear - YEAR_START);
      d.y = d.y + 50;
      d.color = logoAccentColor.get(normalizeLogoKey(d.logoName)) || TIMELINE_BASE_COLOR;
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
      .style("fill", (d) => d.color)
      .style("--glow-color", (d) => d.color)
      .on("mouseover", function (event, d) {
        d3.select(this).style("stroke", "#fff").style("stroke-width", 1);
        showTimelineTooltip(event, d);
      })
      .on("mousemove", function (event, d) {
        showTimelineTooltip(event, d);
      })
      .on("mouseout", function () {
        d3.select(this).style("stroke", null).style("stroke-width", null);
        hideTimelineTooltip();
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
      .style("fill", (d) => d.color)
      .style("--glow-color", (d) => d.color)
      // Lets hover/tooltip pass through to the .timeBand underneath even
      // over the portion an overlay currently covers, so the hit area for
      // a sign's tooltip is always its full lifespan arc, not just
      // whatever's left unprogressed.
      .style("pointer-events", "none")
      .style("display", (d) => {
        if (d.logoStart <= progressYear && d.logoEnd >= progressYear) {
          return "block";
        } else {
          return "none";
        }
      });
  }

  const timelineTooltip = document.getElementById("timeline-tooltip");

  function showTimelineTooltip(event, d) {
    if (!timelineTooltip) return;
    timelineTooltip.innerHTML = "";
    const nameEl = document.createElement("strong");
    nameEl.textContent = d.logoName;
    const yearsEl = document.createElement("div");
    yearsEl.textContent = `${d.logoStart}–${d.logoEnd}`;
    timelineTooltip.appendChild(nameEl);
    timelineTooltip.appendChild(yearsEl);
    const provenance = [d.provenienza, d.categoria].filter(Boolean).join(" · ");
    if (provenance) {
      const provEl = document.createElement("div");
      provEl.textContent = provenance;
      timelineTooltip.appendChild(provEl);
    }
    timelineTooltip.style.left = `${event.clientX}px`;
    timelineTooltip.style.top = `${event.clientY - 12}px`;
    timelineTooltip.style.opacity = "1";
  }

  function hideTimelineTooltip() {
    if (timelineTooltip) timelineTooltip.style.opacity = "0";
  }

  radialTimeline();

  // Set up scrollama (not while rendering: its step previews would set
  // a year of their own)
  if (!RENDER) scroller
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

// Briefly fades an element's text out, swaps it, then fades back in, so
// the year caption/readout and the karaoke line read as a soft crossfade
// instead of a hard cut. Matches the opacity transition duration declared
// in CSS for these elements. No-ops when the text isn't actually changing,
// since callers (a ~3s year cadence, a timeupdate firing many times a
// second) call this far more often than the displayed value changes.
const TEXT_FADE_MS = 150;
function fadeTextTo(el, text) {
  const next = text === null ? "" : String(text);
  if (el.textContent === next) return;
  // Nothing on screen to fade out (e.g. 1945's caption arriving from blank):
  // skip the dip and fade the new text straight in, so it starts on the
  // same frame as everything else instead of TEXT_FADE_MS late.
  if (el.textContent === "") {
    el.textContent = next;
    el.style.opacity = 1;
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: TEXT_FADE_MS, easing: "ease" });
    return;
  }
  el.style.opacity = 0;
  setTimeout(() => {
    el.textContent = next;
    el.style.opacity = 1;
  }, TEXT_FADE_MS);
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

// Drives #karaoke-line off the song's own currentTime, like the year
// sequence itself (see yearAtAudioTime), so the lyrics stay in sync with
// the audio. Render mode, where the song never plays, calls showAt() itself.
function setUpKaraoke(song) {
  const karaokeLine = document.getElementById("karaoke-line");
  let cues = [];
  function showAt(t) {
    const cue = cues.find((c) => t >= c.start && t <= c.end);
    fadeTextTo(karaokeLine, cue ? cue.text : "");
  }
  const ready = fetch("karaoke.srt" + CACHE_BUST)
    .then((response) => response.text())
    .then((text) => {
      cues = parseSrt(text);
      song.addEventListener("timeupdate", () => showAt(song.currentTime));
    });
  return { showAt, ready };
}
