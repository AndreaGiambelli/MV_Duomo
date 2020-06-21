/// SVG ///
let margin = { top: 50, right: 50, bottom: 0, left: 50 },
  width = 960 - margin.left - margin.right,
  height = 500 - margin.top - margin.bottom;

let timeline = d3
  .timeline()
  .size([1500, 200])
  .bandStart(function(d) {
    return d.logoStart;
  })
  .bandEnd(function(d) {
    return d.logoEnd;
  })
  //.dateFormat(function (d) {return parseInt(d)})
  .padding(5)
  .extent([1946, 1999]);
//.maxBandHeight(4);

d3.csv("logos.csv", type).then(function(data) {
  let dataset = data;
  let datasetForFilter = data;
  let dataset2 = data;

  let aaa = dataset2.map(({ logoName, logoStart, logoEnd }) => [
    logoName,
    [+logoStart, +logoEnd]
  ]);

  let bbb = new Map(
    dataset2.map(({ logoName, logoStart, logoEnd }) => [
      logoName,
      [+logoStart, +logoEnd]
    ])
  );

  // console.log(bbb);
  // console.log(bbb.get("cinzano1"));

  var map = new Map([
    [1, 2],
    [2, 3]
  ]);

  // console.log(aaa);
  // console.log(dataset2.length);

  let groups;

  let svg = d3
    .select("#vis")
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);

  /// DATE SLIDER ///
  let slider = d3
    .sliderHorizontal()
    .min(1946)
    .max(2000)
    .step(1)
    .width(width)
    .tickFormat(d3.format(""))
    .displayValue(false)
    .on("onchange", val => {
      d3.select("#value").text(val);
      currentYear = val;
      updateViz(val);
      radialTimeline();
    });

  d3.select("#slider2")
    .append("svg")
    .attr("width", 1000)
    .attr("height", 100)
    .append("g")
    .attr("transform", "translate(30,30)")
    .call(slider);

  d3.select("#slider2")
    .selectAll(".tick")
    .select("line")
    .attr("y2", "4");

  d3.select("#slider2")
    .selectAll(".tick")
    .select("text")
    .attr("y", "16");

  let moving = false;
  let currentValue = 0;
  let targetValue = width;
  const playButton = d3.select("#play-button2");
  //
  const startYear = 1946;
  const endYear = 2000;
  let currentYear = startYear;

  const numberOfSteps = endYear - startYear + 1;
  const yearWidth = Math.round(width / numberOfSteps);

  // Generate pixel values for each year
  const generator = function(i) {
    return yearWidth * i;
  };

  // Create array of pixel values for each year
  const range = d3.range(55).map(generator);

  // Quantize scale from year to pixels
  var xq = d3
    .scaleQuantize()
    .domain([startYear, endYear])
    .range(range);

  var rateById = d3.map();
  var rateById2 = d3.map();

  let mapStart = d3.map(dataset, function(d) {
    rateById.set(d.logoName, +d.logoStart);
  });

  let mapEnd = d3.map(dataset, function(d) {
    rateById2.set(d.logoName, +d.logoEnd);
  });

  playButton.on("click", function() {
    var button = d3.select(this);
    if (button.text() == "Pause") {
      moving = false;
      clearInterval(timer);
      // timer = 0;
      button.text("Play");
    } else {
      moving = true;
      timer = setInterval(step, 1000);
      button.text("Pause");
    }
    console.log("Animation playing: " + moving);
  });

  let loghi;

  //////// SVG TEST ////////

  d3.xml("svg/CARMINATI_REAL_forSVG.svg").then(function(xml) {
    var mw = 1400; // map container width
    var mh = 600; // map container height
    let loghi_svg = d3
      .select("#map")
      .append("svg")
      .attr("width", mw)
      .attr("height", mh);

    var svgMap = xml.getElementsByTagName("g")[0];

    //console.log(svgMap)

    loghi = loghi_svg.node().appendChild(svgMap);

    groups = d3.select("#Logos").selectAll("g");
    console.log(groups);

    /// TESTS FOR SCATTERPLOT
    // groups
    // .attr('transform', function (d, i) {

    //         return `translate (${i*50}, ${i*20})`
    //     })
    // .attr('transform', function (d) {
    //     const start = rateById.get(this.id)
    //     const end = rateById2.get(this.id)
    //     const string = `translate (${start/10}, ${end/10})`
    //     console.log(string)
    //     return string;
    // })
    // .style('display', 'block')

    groups.style("display", function(d) {
      // console.log(rateById.get(this.id))
      // console.log(currentYear)

      if (
        (rateById.get(this.id) <= currentYear &&
          rateById2.get(this.id) >= currentYear) ||
        (rateById.get(this.parentNode.id) <= currentYear &&
          rateById2.get(this.parentNode.id) >= currentYear)
      ) {
        return "block";
      } else {
        return "none";
      }
    });
  });

  function step() {
    updateViz(currentYear);

    slider.value(currentYear);
    currentYear = currentYear + 1;

    if (currentYear > endYear) {
      moving = false;
      currentYear = startYear;
      clearInterval(timer);
      playButton.text("Play");
    }
  }

  function updateViz(h) {
    //        if (h > 1970) {
    //            console.log('hey!')
    //            d3.selectAll("#Maxell")
    //                .style('display', 'none');
    //        } else {
    //            d3.selectAll("#Maxell")
    //                .style('display', 'block');
    //        }

    groups.style("display", function(d) {
      // console.log(rateById.get(this.id))
      // console.log(currentYear)

      if (
        (rateById.get(this.id) <= currentYear &&
          rateById2.get(this.id) >= currentYear) ||
        (rateById.get(this.parentNode.id) <= currentYear &&
          rateById2.get(this.parentNode.id) >= currentYear)
      ) {
        return "block";
      } else {
        return "none";
      }
    });

    // filter data set and redraw plot
    var newData = dataset.filter(function(d) {
      return d.date < h;
    });

    //        drawPlot(newData);
  }

  function radialTimeline() {
    console.log(currentYear);

    var arc = d3.arc();

    //        datasetForFilter = data.filter( function(d){
    //            return d.logoStart < currentYear && d.logoEnd > currentYear;
    //        })

    d3.selectAll(".timeBand").remove();

    timelineBands = timeline(datasetForFilter);

    angleScale = d3
      .scaleLinear()
      .domain([0, 2000])
      .range([0, 2 * Math.PI]);

    console.log(angleScale(1946));

    timelineBands.forEach(function(d) {
      d.startAngle = angleScale(d.start);
      if (d.start < currentYear * 0.75) {
        if (d.end > currentYear * 0.75) {
          d.endAngle = angleScale(currentYear * 0.75);
        } else {
          d.endAngle = angleScale(d.end);
        }
      }

      d.y = d.y + 50;
    });

    // console.log(timelineBands);

    d3.select("#timelineSvg")
      .selectAll("path")
      .data(timelineBands)
      .enter()
      .append("path")
      .attr("class", "timeBand")
      .attr("transform", "translate(500,250)")
      .style("fill-opacity", 0)
      .attr("d", function(d) {
        return arc.innerRadius(d.y).outerRadius(d.y + d.dy)(d);
      })
      //            .attr("x", function (d) {return d.start})
      //            .attr("y", function (d) {return d.y})
      //            .attr("height", function (d) {return d.dy})
      //            .attr("width", function (d) {
      //
      //            return d.end - d.start
      //        })
      .style("fill", function(d) {
        if (d.logoStart < currentYear && d.logoEnd > currentYear) {
          return "red";
        } else {
          return "#b0909d";
        }
      })
      .style("fill-opacity", 1)

      .on("mouseover", function(d) {
        console.log(d.logoName);
        d3.select(this).style("fill", "teal");
      })
      .on("mouseout", function(d) {
        d3.select(this).style("fill", "#b0909d");
      });

    var size = timelineBands.length;
  }
  radialTimeline();
});

function type(d) {
  d.logoName = d.logoName;
  d.logoStart = +d.logoStart;
  d.logoEnd = +d.logoEnd;
  return d;
}
