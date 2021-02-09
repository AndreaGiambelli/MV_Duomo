let scroller = scrollama();

/// SVG ///
let margin = { top: 50, right: 50, bottom: 0, left: 50 },
  width = 960 - margin.left - margin.right,
  height = 500 - margin.top - margin.bottom;

// Timeline generator set-up
let timeline = d3
  .timeline()
  .size([53, 200])
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
  .extent([1946, 1999]);

d3.csv("logos_tempNoEmptyValues.csv", type).then(function (data) {
  let dataset = data;
  let groups;

  /// Date slider set-up
  let slider = d3
    .sliderHorizontal()
    .min(1946)
    .max(1999)
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
    .attr("class", "slider-sticky")
    .attr("width", 1000)
    .attr("height", 100)
    .append("g")
    .attr("transform", "translate(30,30)")
    .call(slider);

  d3.select("#slider").selectAll(".tick").select("line").attr("y2", "4");
  d3.select("#slider").selectAll(".tick").select("text").attr("y", "16");

  let moving = false;
  // let currentValue = 0;
  // let targetValue = width;
  const playButton = d3.select("#play-button");
  const startYear = 1946;
  const endYear = 2000;
  let currentYear = startYear;
  const numberOfSteps = endYear - startYear + 1;
  const yearWidth = Math.round(width / numberOfSteps);

  // Create array of pixel values for each year
  const range = d3.range(55).map((d) => d * yearWidth);

  // Quantize scale from year to pixels
  var xq = d3.scaleQuantize().domain([startYear, endYear]).range(range);

  var mapStart = d3.map();
  var mapEnd = d3.map();

  d3.map(dataset, function (d) {
    mapStart.set(d.logoName, +d.logoStart);
  });

  d3.map(dataset, function (d) {
    mapEnd.set(d.logoName, +d.logoEnd);
  });

  playButton.on("click", function () {
    var button = d3.select(this);
    if (button.text() == "Pause") {
      moving = false;
      clearInterval(timer);
      button.text("Play");
    } else {
      moving = true;
      timer = setInterval(step, 1000);
      button.text("Pause");
    }
  });

  //////// SVG PROSPETTO ////////

  let loghi;

  d3.xml("svg/CARMINATI_REAL_forSVG.svg").then(function (xml) {
    var mw = 1400; // map container width
    var mh = 600; // map container height
    let loghi_svg = d3
      .select("#map")
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%").attr("viewBox", "0 0 " + window.innerWidth + " " + 600);

    var svgMap = xml.getElementsByTagName("g")[0];

    loghi = loghi_svg.node().appendChild(svgMap);
    groups = d3.select("#Logos").selectAll("g");

    /// TESTS FOR SCATTERPLOT
    // groups
    // .attr('transform', function (d, i) {

    //         return `translate (${i*50}, ${i*20})`
    //     })
    // .attr('transform', function (d) {
    //     const start = mapStart.get(this.id)
    //     const end = mapEnd.get(this.id)
    //     const string = `translate (${start/10}, ${end/10})`
    //     console.log(string)
    //     return string;
    // })
    // .style('display', 'block')

    groups.style("display", function (d) {
      if (
        (mapStart.get(this.id) <= currentYear &&
          mapEnd.get(this.id) >= currentYear) ||
        (mapStart.get(this.parentNode.id) <= currentYear &&
          mapEnd.get(this.parentNode.id) >= currentYear)
      ) {
        return "block";
      } else {
        return "none";
      }
    });
  });

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
    groups.style("display", function (d) {
      if (
        (mapStart.get(this.id) <= h && mapEnd.get(this.id) >= h) ||
        (mapStart.get(this.parentNode.id) <= h &&
          mapEnd.get(this.parentNode.id) >= h)
      ) {
        return "block";
      } else {
        return "none";
      }
    });
  }

  function radialTimeline() {
    console.log("inizio funzione" + currentYear);

    var arc = d3.arc();

    d3.selectAll(".timeBand").remove();
    d3.selectAll(".timeBand__overlay").remove();

    timelineBands = timeline(dataset);
    overlayBands = timeline(dataset);

    angleScale = d3
      .scaleLinear()
      .domain([0, 53]) // total number of years
      .range([0, 1.5 * Math.PI]);

    timelineBands.forEach(function (d) {
      d.startAngle = angleScale(d.logoStart - 1946);
      d.endAngle = angleScale(d.logoEnd - 1946);
      d.y = d.y + 50;
    });

    overlayBands.forEach(function (d) {
      d.startAngle = angleScale(d.logoStart - 1946);
      d.endAngle = angleScale(currentYear - 1946);
      d.y = d.y + 50;
    });

    let timelineGrid = d3
      .select("#timelineSvg")
      .append("g")
      .classed(".timeline-grid", "true")
      .attr("transform", "translate(500,250)");

    // timelineGrid
    //   .append("circle")
    //   .attr("cx", 0)
    //   .attr("cy", 0)
    //   .attr("r", 250)
    //   .style("fill", "coral")
    //   .style("fill-opacity", "0.5");

    const gridData = [4, 14, 24, 34, 44];

    timelineGrid
      .selectAll(".gridline")
      .data(gridData)
      .enter()
      .append("line")
      .attr("class", ".gridLine")
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
      .attr("transform", "translate(500,250)")
      .attr("d", function (d) {
        return arc.innerRadius(d.y).outerRadius(d.y + d.dy)(d);
      })
      .style("fill", "#b0909d")
      .on("mouseover", function (d) {
        console.log(d.logoName);
        d3.select(this).style("fill", "teal");
      })
      .on("mouseout", function (d) {
        d3.select(this).style("fill", "#b0909d");
      });

    d3.select("#timelineSvg")
      .selectAll(".timeBand__overlay")
      .data(overlayBands)
      .enter()
      .append("path")
      .attr("class", "timeBand__overlay")
      .attr("transform", "translate(500,250)")
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
      })
      .on("mouseover", function (d) {
        console.log(this);
      });

    var size = timelineBands.length;
  }
  radialTimeline();


// Set up scrollama
scroller
  .setup({
    step: "#scrolly .scroll-p",
    offset: 0.75,
    debug: true,
  })
  .onStepEnter(handleStepEnter);

// On step enter
function handleStepEnter(response) {
  // response = { element, direction, index }
  console.log(response);

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
  d.logoName = d.logoName;
  d.logoStart = +d.logoStart;
  d.logoEnd = +d.logoEnd;
  return d;
}

// Horizontal timeline test
// let timeline2 = d3
//   .timeline()
//   .size([600, 200])
//   .bandStart(function (d) {
//     return d.logoStart;
//   })
//   .bandEnd(function (d) {
//     return d.logoEnd;
//   });

// d3.csv("logos_tempNoEmptyValues.csv").then(function (data) {
//   timelineBands2 = timeline2(data);
//   ("");
//   d3.select("#test")
//     .selectAll("rect")
//     .data(timelineBands2)
//     .enter()
//     .append("rect")
//     .attr("x", function (d) {
//       return d.start;
//     })
//     .attr("y", function (d) {
//       return d.y;
//     })
//     .attr("height", function (d) {
//       return d.dy;
//     })
//     .attr("width", function (d) {
//       return d.end - d.start;
//     })
//     .style("fill", "#687a97")
//     .style("stroke", "black");
// });


