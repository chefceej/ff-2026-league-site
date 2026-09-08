const { test, expect } = require("@playwright/test");
const { useFixture } = require("./fixture");

const GOLD = [0xc8, 0xa2, 0x3c];   // --gold, the Standings cutoff stripe
const GRID = [0xe6, 0xdc, 0xc4];   // --line, every other gridline
const TOLERANCE = 4;               // room for canvas colour conversion

// In a real season the pack crowds the cutoff, so the twelve team lines paint
// over the zero row and leave no pixel of it to sample. Hold each team to the
// side it finished on and push it clear of zero: the shape of every line is
// kept, but nothing crosses the cutoff, so the zero row is the gridline alone.
const MARGIN = 6;
const clearOfZero = data => {
  for (const team of data.teams) {
    const side = team.normalized_by_week.at(-1) >= 0 ? 1 : -1;
    team.normalized_by_week =
      team.normalized_by_week.map(v => side * (Math.abs(v) + MARGIN));
  }
  return data;
};

/** Wait for the chart's entry animation to finish, so a sampled frame is final. */
async function settleChart(page) {
  await page.waitForFunction(() => {
    const chart = window.Chart?.getChart("positionChart");
    return !!chart && !window.Chart.animator.has(chart);
  });
}

/**
 * Read what is actually painted on the gridline for `value` and on its
 * neighbouring gridline: the share of that row's pixels matching each colour,
 * and the colour that covers most of it.
 */
function gridRow(page, value) {
  return page.evaluate(([value, tolerance]) => {
    const chart = window.Chart.getChart("positionChart");
    const dpr = chart.currentDevicePixelRatio;
    const ctx = chart.canvas.getContext("2d");
    const { left, right } = chart.chartArea;
    const y = chart.scales.y;

    const index = y.ticks.findIndex(t => t.value === value);
    if (index === -1) return { tickExists: false };
    // Chart.js aligns a gridline so its stroke starts on a whole device pixel.
    const width = index === y.ticks.findIndex(t => t.value === 0) ? 2 : 1;
    const row = Math.round(
      (y.getPixelForValue(value) - Math.max(width / 2, 0.5)) * dpr);

    const x0 = Math.round((left + 2) * dpr);
    const span = Math.round((right - 2) * dpr) - x0;
    const { data } = ctx.getImageData(x0, row, span, 1);
    const near = (i, c) => [0, 1, 2].every(k => Math.abs(data[i + k] - c[k]) <= tolerance);
    const counts = new Map();
    let gold = 0, grid = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (near(i, [0xc8, 0xa2, 0x3c])) gold++;
      if (near(i, [0xe6, 0xdc, 0xc4])) grid++;
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let dominant = "", seen = 0;
    for (const [key, n] of counts) if (n > seen) { dominant = key; seen = n; }
    return {
      tickExists: true,
      gold: gold / span,
      grid: grid / span,
      dominant: dominant.split(",").map(Number),
      dominantShare: seen / span,
    };
  }, [value, TOLERANCE]);
}

const expectColor = (actual, expected) => {
  expect(actual).toHaveLength(3);
  actual.forEach((channel, i) =>
    expect(Math.abs(channel - expected[i])).toBeLessThanOrEqual(TOLERANCE));
};

test.describe("Playoff-cutoff zero line", () => {
  test("the zero gridline is painted in the gold cutoff accent", async ({ page }) => {
    await useFixture(page, clearOfZero);
    await page.goto("/index.html");
    await settleChart(page);

    const zero = await gridRow(page, 0);
    expect(zero.tickExists).toBe(true);
    expectColor(zero.dominant, GOLD);
    expect(zero.gold).toBe(1);
    // The cutoff line replaces the ordinary gridline; it does not sit beside it.
    expect(zero.grid).toBe(0);
  });

  test("a neighbouring gridline keeps the ordinary grid colour", async ({ page }) => {
    await useFixture(page, clearOfZero);
    await page.goto("/index.html");
    await settleChart(page);

    const step = await page.evaluate(() => {
      const ticks = window.Chart.getChart("positionChart").scales.y.ticks;
      const zero = ticks.findIndex(t => t.value === 0);
      return (ticks[zero + 1] || ticks[zero - 1]).value;
    });
    const neighbor = await gridRow(page, step);
    expectColor(neighbor.dominant, GRID);
    expect(neighbor.gold).toBe(0);
  });

  test("the gold literal matches the --gold custom property", async ({ page }) => {
    await useFixture(page);
    await page.goto("/index.html");

    const gold = await page.evaluate(() => getComputedStyle(document.documentElement)
      .getPropertyValue("--gold").trim());
    expect(gold.toLowerCase()).toBe(
      "#" + GOLD.map(c => c.toString(16).padStart(2, "0")).join(""));
  });

  test("hovering a point still shows a tooltip with a signed value", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");
    await settleChart(page);

    // The league leader's last point: whichever team the chart picks as nearest
    // up there is above the cutoff, so the "+" branch of the label is exercised.
    const week = data.metadata.completed_weeks - 1;
    const leader = data.teams
      .map((t, i) => i)
      .sort((a, b) => data.teams[b].normalized_by_week[week]
                    - data.teams[a].normalized_by_week[week])[0];

    const point = await page.evaluate(([team, week]) => {
      const chart = window.Chart.getChart("positionChart");
      const el = chart.getDatasetMeta(team).data[week];
      const box = chart.canvas.getBoundingClientRect();
      return { x: box.left + el.x, y: box.top + el.y };
    }, [leader, week]);
    await page.mouse.move(point.x, point.y);

    await page.waitForFunction(() =>
      (window.Chart.getChart("positionChart").tooltip?.body || []).length > 0);
    // Ask the chart which point it settled on, so an overlapping line can never
    // make this test flake, then check the label against that point's value.
    const shown = await page.evaluate(() => {
      const tooltip = window.Chart.getChart("positionChart").tooltip;
      const [active] = tooltip.getActiveElements();
      return {
        lines: tooltip.body.flatMap(b => b.lines),
        team: active.datasetIndex,
        week: active.index,
      };
    });

    const team = data.teams[shown.team];
    const value = team.normalized_by_week[shown.week];
    expect(value).toBeGreaterThan(0);
    expect(shown.lines).toContain(`${team.team_name}: +${value}`);
  });
});
