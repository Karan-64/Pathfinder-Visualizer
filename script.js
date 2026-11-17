(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("c");
  const ctx = canvas.getContext("2d");
  const stage = document.querySelector(".stage");

  const COLORS = {
    bg: "#0b1727", line: "rgba(128, 158, 194, .18)",
    wall: "#354760", mud: "#a9783f", explored: "#1b4161",
    frontier: "#28799d", route: "#53d6c2", start: "#5ce0a0",
    goal: "#ff728e"
  };

  let cols = 34, rows = 20, cell = 20, dpr = 1;
  let terrain = new Uint8Array(cols * rows);
  let state = new Uint8Array(cols * rows);
  let start = Math.floor(rows / 2) * cols + 2;
  let goal = Math.floor(rows / 2) * cols + cols - 3;
  let brush = 1, raf = null, busy = false, drag = null;
  let lastRunToken = 0;

  const NOTES = {
    astar: "Balances distance travelled and estimated distance remaining. Usually explores fewer nodes.",
    dijkstra: "Expands by total travel cost. Guarantees the cheapest route when terrain has different costs.",
    bfs: "Explores by number of steps. Finds the fewest-step route, but ignores mud cost.",
    greedy: "Moves toward the goal using only the heuristic. Can be quick, but is not guaranteed optimal."
  };

  function indexOf(x, y) { return y * cols + x; }
  function cost(i) { return terrain[i] === 2 ? 5 : 1; }
  function heuristic(i) {
    return Math.abs(i % cols - goal % cols) +
      Math.abs(Math.floor(i / cols) - Math.floor(goal / cols));
  }
  function neighbors(i) {
    const x = i % cols, y = Math.floor(i / cols), out = [];
    if (y > 0) out.push(i - cols);
    if (x < cols - 1) out.push(i + 1);
    if (y < rows - 1) out.push(i + cols);
    if (x > 0) out.push(i - 1);
    return out;
  }

  function fitCanvas() {
    const available = Math.max(280, Math.min(stage.clientWidth - 28, 920));
    const previousCols = cols, previousRows = rows;
    const narrow = available < 520;
    const nextCols = narrow ? 16 : 34;
    const nextRows = narrow ? 22 : 20;
    const previousTerrain = terrain;
    cols = nextCols;
    rows = nextRows;
    cell = Math.max(12, Math.floor(available / cols));
    dpr = Math.max(1, window.devicePixelRatio || 1);
    const oldCols = previousCols, oldRows = previousRows;
    const previousStart = start, previousGoal = goal;
    terrain = new Uint8Array(cols * rows);
    state = new Uint8Array(cols * rows);
    start = Math.floor(rows / 2) * cols + 2;
    goal = Math.floor(rows / 2) * cols + cols - 3;

    if (previousTerrain.length && oldCols) {
      for (let y = 0; y < Math.min(rows, oldRows); y++) {
        for (let x = 0; x < Math.min(cols, oldCols); x++) {
          terrain[indexOf(x, y)] = previousTerrain[y * oldCols + x];
        }
      }
      const sx = previousStart % oldCols, sy = Math.floor(previousStart / oldCols);
      const gx = previousGoal % oldCols, gy = Math.floor(previousGoal / oldCols);
      if (sx < cols && sy < rows) start = indexOf(sx, sy);
      if (gx < cols && gy < rows) goal = indexOf(gx, gy);
    }
    if (start === goal) goal = Math.max(0, terrain.length - 3);
    canvas.style.width = (cols * cell) + "px";
    canvas.style.height = (rows * cell) + "px";
    canvas.width = Math.round(cols * cell * dpr);
    canvas.height = Math.round(rows * cell * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    $("gridSize").textContent = `${cols} × ${rows} GRID`;
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, cols * cell, rows * cell);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, cols * cell, rows * cell);

    for (let i = 0; i < terrain.length; i++) {
      const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
      let fill = null;
      if (terrain[i] === 1) fill = COLORS.wall;
      else if (state[i] === 3) fill = COLORS.route;
      else if (state[i] === 2) fill = COLORS.frontier;
      else if (state[i] === 1) fill = COLORS.explored;
      else if (terrain[i] === 2) fill = COLORS.mud;
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      }
      if (terrain[i] === 2 && state[i] !== 3) {
        ctx.fillStyle = "rgba(255,226,181,.75)";
        ctx.font = `${Math.max(7, cell * .42)}px Manrope, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("×5", x + cell / 2, y + cell / 2);
      }
    }

    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cols; x++) {
      ctx.moveTo(x * cell + .5, 0);
      ctx.lineTo(x * cell + .5, rows * cell);
    }
    for (let y = 0; y <= rows; y++) {
      ctx.moveTo(0, y * cell + .5);
      ctx.lineTo(cols * cell, y * cell + .5);
    }
    ctx.stroke();
    marker(start, COLORS.start, "S");
    marker(goal, COLORS.goal, "G");
  }

  function marker(i, color, label) {
    const x = (i % cols) * cell + cell / 2;
    const y = Math.floor(i / cols) * cell + cell / 2;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.arc(x, y, Math.max(5, cell * .34), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (cell >= 17) {
      ctx.fillStyle = "#07111d";
      ctx.font = `800 ${Math.max(8, cell * .48)}px Manrope, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x, y + .5);
    }
  }

  function setStats(explored, length, total) {
    $("sv").textContent = explored;
    $("sl").textContent = length;
    $("sc").textContent = total;
  }
  function stop() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    busy = false;
    $("run").disabled = false;
    $("run").innerHTML = '<span class="play-icon">▶</span> Find shortest path <span class="button-arrow">↗</span>';
  }
  function resetState() {
    state.fill(0);
    setStats(0, "—", "—");
  }
  function clearPath() {
    lastRunToken++;
    stop();
    resetState();
    draw();
  }

  function run() {
    clearPath();
    const token = ++lastRunToken;
    busy = true;
    $("run").disabled = true;
    $("run").textContent = "Searching…";
    const algorithm = $("alg").value;
    const count = terrain.length;
    const distance = new Float64Array(count).fill(Infinity);
    const previous = new Int32Array(count).fill(-1);
    const closed = new Uint8Array(count);
    const inOpen = new Uint8Array(count);
    const order = new Float64Array(count);
    const open = [start];
    let sequence = 0, explored = 0;
    distance[start] = 0;
    inOpen[start] = 1;

    function priority(i) {
      if (algorithm === "bfs") return order[i];
      if (algorithm === "dijkstra") return distance[i];
      if (algorithm === "astar") return distance[i] + heuristic(i);
      return heuristic(i);
    }

    function finish(found) {
      if (token !== lastRunToken) return;
      busy = false;
      $("run").disabled = false;
      $("run").innerHTML = '<span class="play-icon">▶</span> Find shortest path <span class="button-arrow">↗</span>';
      if (!found) {
        setStats(explored, "No route", "—");
        draw();
        return;
      }
      const path = [];
      let node = goal;
      while (node !== -1) {
        path.push(node);
        node = previous[node];
      }
      path.reverse();
      let totalCost = 0;
      for (let p = 1; p < path.length; p++) totalCost += cost(path[p]);
      let cursor = 0;
      function reveal() {
        if (token !== lastRunToken) return;
        if (cursor < path.length) {
          state[path[cursor++]] = 3;
          draw();
          raf = requestAnimationFrame(reveal);
        } else {
          raf = null;
          setStats(explored, path.length - 1, totalCost);
        }
      }
      reveal();
    }

    function frame() {
      if (token !== lastRunToken) return;
      const perFrame = Number($("spd").value);
      for (let step = 0; step < perFrame; step++) {
        if (!open.length) { finish(false); return; }
        let bestIndex = 0;
        for (let j = 1; j < open.length; j++) {
          const candidate = priority(open[j]);
          const best = priority(open[bestIndex]);
          if (candidate < best || (candidate === best && distance[open[j]] < distance[open[bestIndex]])) bestIndex = j;
        }
        const current = open.splice(bestIndex, 1)[0];
        inOpen[current] = 0;
        if (closed[current]) continue;
        closed[current] = 1;
        explored++;
        state[current] = 1;
        if (current === goal) { finish(true); return; }

        for (const next of neighbors(current)) {
          if (terrain[next] === 1 || closed[next]) continue;
          const stepCost = algorithm === "bfs" ? 1 : cost(next);
          const nextDistance = distance[current] + stepCost;
          const improved = algorithm === "bfs" ? distance[next] === Infinity : nextDistance < distance[next];
          if (improved) {
            distance[next] = nextDistance;
            previous[next] = current;
            if (algorithm === "bfs") order[next] = sequence++;
            if (!inOpen[next]) {
              inOpen[next] = 1;
              open.push(next);
              state[next] = 2;
            }
          }
        }
      }
      setStats(explored, "…", "…");
      draw();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  function cellAt(event) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / (rect.width / cols));
    const y = Math.floor((event.clientY - rect.top) / (rect.height / rows));
    if (x < 0 || y < 0 || x >= cols || y >= rows) return -1;
    return indexOf(x, y);
  }
  function paint(i) {
    if (busy || i < 0 || i === start || i === goal) return;
    if (terrain[i] === brush) return;
    terrain[i] = brush;
    if (state[i]) resetState();
    draw();
  }

  canvas.addEventListener("pointerdown", (event) => {
    const i = cellAt(event);
    if (i < 0) return;
    canvas.setPointerCapture(event.pointerId);
    if (i === start) drag = "start";
    else if (i === goal) drag = "goal";
    else { drag = "paint"; paint(i); }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag || busy) return;
    const i = cellAt(event);
    if (i < 0) return;
    if (drag === "paint") paint(i);
    else if (i !== start && i !== goal && terrain[i] !== 1) {
      if (drag === "start") start = i;
      else goal = i;
      resetState();
      draw();
    }
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(type => {
    canvas.addEventListener(type, () => { drag = null; });
  });

  document.querySelectorAll(".seg button").forEach(button => {
    button.addEventListener("click", () => {
      brush = Number(button.dataset.b);
      document.querySelectorAll(".seg button").forEach(item => {
        item.setAttribute("aria-pressed", String(item === button));
      });
    });
  });

  $("alg").addEventListener("change", () => {
    $("algNote").textContent = NOTES[$("alg").value];
  });
  $("spd").addEventListener("input", () => {
    $("speedValue").textContent = `${$("spd").value} steps / frame`;
  });
  $("run").addEventListener("click", run);
  $("clr").addEventListener("click", clearPath);
  $("rst").addEventListener("click", () => {
    clearPath();
    terrain.fill(0);
    draw();
  });
  $("maze").addEventListener("click", () => {
    clearPath();
    terrain.fill(0);
    for (let i = 0; i < terrain.length; i++) {
      if (i === start || i === goal) continue;
      const value = Math.random();
      terrain[i] = value < .25 ? 1 : value < .34 ? 2 : 0;
    }
    draw();
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      clearPath();
      fitCanvas();
    }, 120);
  });

  $("algNote").textContent = NOTES.astar;
  $("speedValue").textContent = `${$("spd").value} steps / frame`;
  fitCanvas();
})();
