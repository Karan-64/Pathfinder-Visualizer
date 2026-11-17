(function () {
  var $ = function (id) { return document.getElementById(id); };
  var cv = $('c'), cx = cv.getContext('2d'), stage = document.querySelector('.stage');

  // ---- Grid setup ----
  var avail = Math.min(stage.clientWidth - 28, 920);
  var narrow = avail < 520;
  var cols = narrow ? 16 : 34, rows = narrow ? 22 : 20;
  var cell = Math.floor(avail / cols);
  var dpr = window.devicePixelRatio || 1;
  cv.style.width = cols * cell + 'px';
  cv.style.height = rows * cell + 'px';
  cv.width = cols * cell * dpr;
  cv.height = rows * cell * dpr;
  cx.scale(dpr, dpr);

  var N = cols * rows;
  var terrain = new Uint8Array(N);   // 0 open, 1 wall, 2 mud
  var state = new Uint8Array(N);     // 0 none, 1 searched, 2 frontier, 3 route
  var mid = Math.floor(rows / 2) * cols;
  var start = mid + 2, goal = mid + cols - 3;
  var brush = 1, raf = null, busy = false;

  var NOTES = {
    astar: 'Guided by distance to the goal. Finds the cheapest route with little wasted search.',
    dijkstra: 'Expands evenly by cost. Always cheapest, but searches in every direction.',
    bfs: 'Counts steps and ignores mud. Fewest steps, not always cheapest.',
    greedy: 'Heads straight for the goal. Fast, but the route can be longer than needed.'
  };

  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  // ---- Drawing ----
  function draw() {
    var c = {
      bg: css('--bg'), line: css('--line'), wall: css('--wall'), mud: css('--mud'),
      vis: css('--vis'), front: css('--front'), route: css('--route'),
      start: css('--start'), goal: css('--goal')
    };
    cx.fillStyle = c.bg;
    cx.fillRect(0, 0, cols * cell, rows * cell);

    for (var i = 0; i < N; i++) {
      var x = (i % cols) * cell, y = Math.floor(i / cols) * cell, fill = null;
      if (terrain[i] === 1) fill = c.wall;
      else if (state[i] === 3) fill = c.route;
      else if (state[i] === 2) fill = c.front;
      else if (state[i] === 1) fill = c.vis;
      else if (terrain[i] === 2) fill = c.mud;
      if (fill) { cx.fillStyle = fill; cx.fillRect(x, y, cell, cell); }
      if (terrain[i] === 2 && state[i] && state[i] !== 3) {
        cx.fillStyle = c.mud; cx.fillRect(x + cell * .3, y + cell * .3, cell * .4, cell * .4);
      }
    }

    cx.strokeStyle = c.line; cx.lineWidth = 1; cx.beginPath();
    for (var a = 0; a <= cols; a++) { cx.moveTo(a * cell + .5, 0); cx.lineTo(a * cell + .5, rows * cell); }
    for (var b = 0; b <= rows; b++) { cx.moveTo(0, b * cell + .5); cx.lineTo(cols * cell, b * cell + .5); }
    cx.stroke();

    marker(start, c.start, c.bg);
    marker(goal, c.goal, c.bg);
  }

  function marker(i, col, ring) {
    var x = (i % cols) * cell + cell / 2, y = Math.floor(i / cols) * cell + cell / 2;
    cx.fillStyle = col; cx.beginPath(); cx.arc(x, y, cell * .38, 0, Math.PI * 2); cx.fill();
    cx.strokeStyle = ring; cx.lineWidth = 2; cx.stroke();
  }

  function setStats(v, l, c) { $('sv').textContent = v; $('sl').textContent = l; $('sc').textContent = c; }

  // ---- Search helpers ----
  function cost(i) { return terrain[i] === 2 ? 5 : 1; }
  function neighbors(i) {
    var r = [], x = i % cols, y = (i - x) / cols;
    if (y > 0) r.push(i - cols);
    if (x < cols - 1) r.push(i + 1);
    if (y < rows - 1) r.push(i + cols);
    if (x > 0) r.push(i - 1);
    return r;
  }
  function heur(i) {
    return Math.abs(i % cols - goal % cols) + Math.abs(Math.floor(i / cols) - Math.floor(goal / cols));
  }

  function stop() { if (raf) cancelAnimationFrame(raf); raf = null; busy = false; }
  function resetState() { state.fill(0); setStats(0, '–', '–'); }
  function clearPath() { stop(); resetState(); draw(); }

  // ---- Run a search ----
  function run() {
    clearPath();
    busy = true;
    var alg = $('alg').value;
    var g = new Float64Array(N).fill(Infinity);
    var prev = new Int32Array(N).fill(-1);
    var closed = new Uint8Array(N), inOpen = new Uint8Array(N), order = new Float64Array(N);
    var open = [start], counter = 0, seen = 0;
    g[start] = 0; inOpen[start] = 1;

    function key(i) {
      if (alg === 'bfs') return order[i];
      if (alg === 'dijkstra') return g[i];
      if (alg === 'astar') return g[i] + heur(i);
      return heur(i);
    }

    function finish(found) {
      busy = false;
      if (!found) { setStats(seen, 'none', '–'); draw(); return; }
      var p = [], k = goal;
      while (k !== -1) { p.push(k); k = prev[k]; }
      p.reverse();
      var total = 0;
      for (var j = 1; j < p.length; j++) total += cost(p[j]);
      var idx = 0;
      (function trace() {
        if (idx < p.length) { state[p[idx++]] = 3; draw(); raf = requestAnimationFrame(trace); }
        else setStats(seen, p.length - 1, total);
      })();
    }

    function frame() {
      var perFrame = +$('spd').value;
      for (var s = 0; s < perFrame; s++) {
        if (!open.length) { finish(false); return; }
        var bi = 0, bk = key(open[0]);
        for (var j = 1; j < open.length; j++) {
          var kk = key(open[j]);
          if (kk < bk) { bk = kk; bi = j; }
        }
        var cur = open.splice(bi, 1)[0];
        inOpen[cur] = 0; closed[cur] = 1; seen++; state[cur] = 1;
        if (cur === goal) { finish(true); return; }

        var ns = neighbors(cur);
        for (var q = 0; q < ns.length; q++) {
          var m = ns[q];
          if (terrain[m] === 1 || closed[m]) continue;
          var ng = g[cur] + (alg === 'bfs' ? 1 : cost(m));
          var better = alg === 'bfs' ? g[m] === Infinity : ng < g[m];
          if (better) {
            g[m] = ng; prev[m] = cur;
            if (alg === 'bfs') order[m] = counter++;
            if (!inOpen[m]) { inOpen[m] = 1; open.push(m); state[m] = 2; }
          }
        }
      }
      setStats(seen, '…', '…');
      draw();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  // ---- Pointer input ----
  var drag = null;
  function cellAt(e) {
    var r = cv.getBoundingClientRect();
    var x = Math.floor((e.clientX - r.left) / cell), y = Math.floor((e.clientY - r.top) / cell);
    return (x < 0 || y < 0 || x >= cols || y >= rows) ? -1 : y * cols + x;
  }
  function paint(i) {
    if (busy || i === start || i === goal) return;
    terrain[i] = brush;
    if (state[i]) resetState();
    draw();
  }
  cv.addEventListener('pointerdown', function (e) {
    var i = cellAt(e); if (i < 0) return;
    cv.setPointerCapture(e.pointerId);
    drag = i === start ? 's' : i === goal ? 'g' : 'b';
    if (drag === 'b') paint(i);
  });
  cv.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var i = cellAt(e); if (i < 0) return;
    if (drag === 'b') paint(i);
    else if (!busy && i !== start && i !== goal && terrain[i] !== 1) {
      if (drag === 's') start = i; else goal = i;
      resetState(); draw();
    }
  });
  ['pointerup', 'pointercancel'].forEach(function (t) {
    cv.addEventListener(t, function () { drag = null; });
  });

  // ---- Controls ----
  document.querySelectorAll('.seg button').forEach(function (b) {
    b.onclick = function () {
      brush = +b.dataset.b;
      document.querySelectorAll('.seg button').forEach(function (o) {
        o.setAttribute('aria-pressed', o === b);
      });
    };
  });
  $('alg').onchange = function () { $('algNote').textContent = NOTES[this.value]; };
  $('run').onclick = run;
  $('clr').onclick = clearPath;
  $('rst').onclick = function () { clearPath(); terrain.fill(0); draw(); };
  $('maze').onclick = function () {
    clearPath(); terrain.fill(0);
    for (var i = 0; i < N; i++) {
      if (i === start || i === goal) continue;
      var r = Math.random();
      terrain[i] = r < .26 ? 1 : r < .34 ? 2 : 0;
    }
    draw();
  };

  $('algNote').textContent = NOTES.astar;
  draw();
})();
