




let loghi; 

//////// SVG TEST ////////

d3.xml("svg/test3.svg").then(function(xml) {

    console.log(xml)

    

    var mw = 1200;	// map container width
    var mh = 700;	// map container height
    let loghi_svg = d3.select("#map")
    .append("svg")
    .attr('width', mw)
    .attr('height', mh);

    var svgMap = xml.getElementsByTagName("g")[0];


    console.log(svgMap)

    loghi = loghi_svg.node().appendChild(svgMap);
    
    
    
    const groups = d3.select('#Logos').selectAll('g'); 

    
//    logos.select("#Maxell")
//        .attr('class', 'show');
    
    groups.attr('class', function(d) {
        
        if ((this.id==='Maxell') ||
            (this.parentNode.id==='Maxell')) {
                
            return 'show'
            } else {
                return 'hidden'
            }
    })
    
})

/////// DATE SLIDER ////////

function dateSlider() {
    
    
    /// SVG ///
    var margin = {top:50, right:50, bottom:0, left:50},
        width = 960 - margin.left - margin.right,
        height = 500 - margin.top - margin.bottom;

    var svg = d3.select("#vis")
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom); 
    
    /// THE SLIDER ///
     var slider = d3
    .sliderHorizontal()
    .min(1946)
    .max(2000)
    .step(1)
    .width(width)
    .displayValue(false)
    .on('onchange', val => {
      d3.select('#value').text(val);
        updateViz(val)
    });

  d3.select('#slider2')
    .append('svg')
    .attr('width', 1000)
    .attr('height', 100)
    .append('g')
    .attr('transform', 'translate(30,30)')
    .call(slider);

    
    
    
//    var formatDateIntoYear = d3.timeFormat("%Y");
//    var formatDate = d3.timeFormat("%b %Y");
//    var parseDate = d3.timeParse("%m/%d/%y");
//
//    var startDate = new Date("1946-01-01"),
//        endDate = new Date("2000-01-01");
//
//     
//
//    ////////// slider //////////
    
//
    let moving = false;
    let currentValue = 0;
    let targetValue = width;
    const playButton = d3.select("#play-button2");
//
    const startYear = 1946;
    const endYear = 2000;
    let currentYear = startYear; 
    
//
//    var x = d3.scaleTime()
//    .domain([startDate, endDate])
//    .range([0, targetValue])
//    .clamp(true);
//
    const numberOfSteps = endYear - startYear + 1;
    const yearWidth = Math.round(width/numberOfSteps); 
    console.log(yearWidth)

    // Generate pixel values for each year
    const generator = function(i) { 
        return (yearWidth)*i; 
    }

    // Create array of pixel values for each year
    const range = d3.range(55).map(generator); 

    // Quantize scale from year to pixels
    var xq = d3.scaleQuantize()
    .domain([startYear, endYear])
    .range(range); 
//
//    //    console.log(xq.domain())
//    console.log(xq.range())
//    //    console.log(xq(1970))
//    console.log(xq.range()[54])
//
//
//    //    for (i = 0; i < 55; i++) {
//    //        console.log(Math.floor(xq.invertExtent(i*16)[1]))
//    //    }
//
//
//    var slider = svg.append("g")
//    .attr("class", "slider")
//    .attr("transform", "translate(" + margin.left + "," + height/5 + ")");
//
//    slider.append("line")
//        .attr("class", "track")
//        .attr("x1", xq.range()[0])
//        .attr("x2", xq.range()[54])
//        .select(function() { return this.parentNode.appendChild(this.cloneNode(true)); })
//        .attr("class", "track-inset")
//        .select(function() { return this.parentNode.appendChild(this.cloneNode(true)); })
//        .attr("class", "track-overlay")
//        .call(d3.drag()
//              .on("start.interrupt", function() { slider.interrupt(); })
//              .on("start drag", function() {
//        currentValue = d3.event.x;
//        console.log(currentValue)
//        //        let invertValue = Math.floor(xq.invertExtent(currentValue)[1])
//        console.log(xq.invertExtent(currentValue))
//        //        update(invertValue); 
//    })
//             );
//
//    slider.insert("g", ".track-overlay")
//        .attr("class", "ticks")
//        .attr("transform", "translate(0," + 18 + ")")
//        .selectAll("text")
//        .data(xq.ticks(10))
//        .enter()
//        .append("text")
//        .attr("x", xq)
//        .attr("y", 10)
//        .attr("text-anchor", "middle")
//        .text(function(d) { //console.log(d); 
//        return d; });
//
//    var handle = slider.insert("circle", ".track-overlay")
//    .attr("class", "handle")
//    .attr("r", 9);
//
//    var label = slider.append("text")  
//    .attr("class", "label")
//    .attr("text-anchor", "middle")
//    .text(startYear)
//    .attr("transform", "translate(0," + (-25) + ")")
//
//    ////////// plot //////////
//
//    var dataset;
//
//    var plot = svg.append("g")
//    .attr("class", "plot")
//    .attr("transform", "translate(" + margin.left + "," + margin.top + ")");
    
    var rateById = d3.map();
//
    d3.csv("logos.csv", type).then(function(data) {
        dataset = data;
        //console.log(dataset)

        // drawPlot(dataset);

        let map = d3.map(dataset, function(d) {
            
            rateById.set(d.logoName, +d.logoStart, +d.logoEnd)
                                              });
        
        console.log(rateById)

        playButton
            .on("click", function() {
            var button = d3.select(this);
            if (button.text() == "Pause") {
                moving = false;
                clearInterval(timer);
                // timer = 0;
                button.text("Play");
            } else {
                moving = true;
                timer = setInterval(step, 100);
                button.text("Pause");
            }
            console.log("Animation playing: " + moving);
        })


    }); // d3.csv

    function type(d) {
        d.logoName = d.logoName;
        d.logoStart = +d.logoStart;
                d.logoEnd = +d.logoEnd;

        return d;
    }

    function step() {
        updateViz(currentYear);
        
        slider.value(currentYear)
        currentYear = currentYear + 1; 

        if (currentYear > endYear) {
            moving = false;
            currentYear = startYear;
            clearInterval(timer);
            playButton.text("Play");
        }
    }
//
//    function drawPlot(data) {
//        var locations = plot.selectAll(".location")
//        .data(data);
//
//        // if filtered dataset has more circles than already existing, transition new ones in
//        locations.enter()
//            .append("circle")
//            .attr("class", "location")
//            .attr("cx", function(d) { return x(d.date); })
//            .attr("cy", height/2)
//            .style("fill", function(d) { return d3.hsl(d.date/1000000000, 0.8, 0.8)})
//            .style("stroke", function(d) { return d3.hsl(d.date/1000000000, 0.7, 0.7)})
//            .style("opacity", 0.5)
//            .attr("r", 8)
//            .transition()
//            .duration(400)
//            .attr("r", 25)
//            .transition()
//            .attr("r", 8);
//
//        // if filtered dataset has less circles than already existing, remove excess
//        locations.exit()
//            .remove();
//
//    }
//
    function updateViz(h) {

        if (h > 1970) {
            console.log('hey!')
                d3.selectAll("#Maxell")
            .style('display', 'none'); 
            } else {
                d3.selectAll("#Maxell")
            .style('display', 'block'); 
            }
        
        // filter data set and redraw plot
        var newData = dataset.filter(function(d) {
            return d.date < h;
        })

//        drawPlot(newData);

    }


}

dateSlider(); 



//// Generate years
//const yearGenerator = function(i) { 
//    return 1946 + i; 
//}
//
//// Create array of all years
//const allYears = d3.range(55).map(yearGenerator); 
//
//console.log(allYears)






//d3.csv() {
//    
//    // Read data
//    
//    d3.xml() {
//        
//    }
//    
//    // Date Slider
//    
//    
//}









