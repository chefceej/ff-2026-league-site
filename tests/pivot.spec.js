const { test, expect } = require("@playwright/test");
const { useFixture } = require("./fixture");

const DASH = "—";

/**
 * Read the rendered pivot into a shape the assertions can address by label:
 * every row carries its label cells (the rowSpan'd group label is carried down
 * to the rows it covers) and its value cells line up with the tail of the head
 * row. Works for all four views, which differ only in how many label columns
 * they have.
 */
const readPivot = page => page.evaluate(() => {
  const clean = el => el.textContent.replace(/[▼▲]/g, "").trim();
  const head = [...document.querySelectorAll("#pivot-head th")].map(clean);
  let carried = null;
  const rows = [];
  for (const tr of document.querySelectorAll("#pivot-body tr")) {
    const tds = [...tr.children];
    const labels = [];
    let i = 0;
    while (i < tds.length &&
           (tds[i].classList.contains("sticky-col") || tds[i].classList.contains("sticky-col2"))) {
      if (tds[i].rowSpan > 1) carried = clean(tds[i]);
      labels.push(clean(tds[i]));
      i++;
    }
    const valueTds = tds.slice(i);
    // A row covered by the group cell above it starts one label short.
    while (labels.length < head.length - valueTds.length) labels.unshift(carried);
    rows.push({
      labels,
      cells: valueTds.map(td => ({
        text: clean(td),
        neg: td.classList.contains("neg"),
        inlineBg: td.style.background,
        color: getComputedStyle(td).color,
      })),
    });
  }
  return { head, rows };
});

/** The cell at the intersection of a row's labels and a column heading. */
function cell(pivot, labels, column) {
  const row = pivot.rows.find(r =>
    labels.length === r.labels.length && labels.every((l, i) => r.labels[i] === l));
  if (!row) throw new Error(`no row labelled ${labels.join(" / ")}`);
  const offset = pivot.head.length - row.cells.length;
  const ci = pivot.head.indexOf(column) - offset;
  if (ci < 0) throw new Error(`no column ${column} in ${pivot.head.join(" | ")}`);
  return row.cells[ci];
}

async function setView(page, view, time) {
  await page.click(`#view-toggle .pivot-toggle-btn[data-value="${view}"]`);
  await page.click(`#time-toggle .pivot-toggle-btn[data-value="${time}"]`);
}

/** Narrow the pivot to a single week, so a season total equals that week. */
async function setWeekRange(page, w) {
  await page.uncheck("#all-weeks-cb");
  await page.selectOption("#start-week", String(w));
  await page.selectOption("#end-week", String(w));
}

/** First (week, team, position) in the fixture whose value satisfies `pred`. */
function findCell(data, pred) {
  const weeks = data.position_scores_by_week;
  for (let w = 0; w < weeks.length; w++) {
    for (const [team, buckets] of Object.entries(weeks[w])) {
      for (const [pos, val] of Object.entries(buckets)) {
        if (pred(val)) return { w, team, pos, val };
      }
    }
  }
  throw new Error("fixture has no cell matching the predicate");
}

const findNegative = data => findCell(data, v => v < 0);
const findZero = data => findCell(data, v => v === 0);

/** The site's brick red, resolved the way the browser resolves it. */
const negColor = page => page.evaluate(() => {
  const probe = document.body.appendChild(document.createElement("span"));
  probe.style.color = "var(--neg)";
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
});

// The four views, and where a given (team, position) cell lands in each. The
// Season Total views are pinned to the cell's own week, so the aggregate under
// test is that one value.
const VIEWS = [
  { name: "By Team / By Week", view: "byTeam", time: "byWeek",
    labels: c => [c.team, c.pos], column: c => `Wk ${c.w + 1}` },
  { name: "By Position / By Week", view: "byPosition", time: "byWeek",
    labels: c => [c.pos, c.team], column: c => `Wk ${c.w + 1}` },
  { name: "By Team / Season Total", view: "byTeam", time: "total", oneWeek: true,
    labels: c => [c.team], column: c => c.pos },
  { name: "By Position / Season Total", view: "byPosition", time: "total", oneWeek: true,
    labels: c => [c.pos], column: c => c.team },
];

/** Open the pivot in `spec`'s view, showing the week `target` lives in. */
async function openAt(page, spec, target) {
  await page.goto("/position.html");
  await setView(page, spec.view, spec.time);
  if (spec.oneWeek) await setWeekRange(page, target.w);
  return cell(await readPivot(page), spec.labels(target), spec.column(target));
}

test.describe("Non-positive pivot cells", () => {
  for (const spec of VIEWS) {
    test(`${spec.name} shows the negative value in red, not a dash`, async ({ page }) => {
      const data = await useFixture(page);
      const neg = findNegative(data);

      const c = await openAt(page, spec, neg);
      expect(c.text).toBe(neg.val.toFixed(1));
      expect(c.text).not.toBe(DASH);
      expect(c.neg).toBe(true);
      expect(c.color).toBe(await negColor(page));
      expect(c.inlineBg).toBe("");
    });

    test(`${spec.name} shows a goose egg as 0.0, unstyled`, async ({ page }) => {
      const data = await useFixture(page);
      const zero = findZero(data);

      const c = await openAt(page, spec, zero);
      expect(c.text).toBe("0.0");
      expect(c.neg).toBe(false);
      expect(c.inlineBg).toBe("");
    });
  }

  test("a row total that is negative over the chosen weeks is red, not a dash",
    async ({ page }) => {
      const data = await useFixture(page);
      const neg = findNegative(data);
      await page.goto("/position.html");
      await setView(page, "byTeam", "byWeek");
      await setWeekRange(page, neg.w);

      // The Total column carries its own color rule; the negative class outranks it.
      const c = cell(await readPivot(page), [neg.team, neg.pos], "Total");
      expect(c.text).toBe(neg.val.toFixed(1));
      expect(c.neg).toBe(true);
      expect(c.color).toBe(await negColor(page));
      expect(c.inlineBg).toBe("");
    });
});

test.describe("Absent pivot cells", () => {
  /** A bucket recorded in more than one week, so deleting one week keeps the total. */
  function findRepeated(data) {
    const weeks = data.position_scores_by_week;
    for (let w = 0; w < weeks.length; w++) {
      for (const [team, buckets] of Object.entries(weeks[w])) {
        for (const pos of Object.keys(buckets)) {
          const elsewhere = weeks.some((wk, i) => i !== w && wk[team]?.[pos] != null);
          if (elsewhere) return { w, team, pos };
        }
      }
    }
    throw new Error("fixture has no bucket recorded in two weeks");
  }

  /** Serve the fixture with one team-week's bucket deleted. */
  async function useFixtureMissingOne(page) {
    let target;
    await useFixture(page, data => {
      target = findRepeated(data);
      delete data.position_scores_by_week[target.w][target.team][target.pos];
      return data;
    });
    return target;
  }

  test("a deleted bucket is a dash in both By Week views", async ({ page }) => {
    const gone = await useFixtureMissingOne(page);
    await page.goto("/position.html");

    await setView(page, "byTeam", "byWeek");
    expect(cell(await readPivot(page), [gone.team, gone.pos], `Wk ${gone.w + 1}`).text)
      .toBe(DASH);

    await setView(page, "byPosition", "byWeek");
    expect(cell(await readPivot(page), [gone.pos, gone.team], `Wk ${gone.w + 1}`).text)
      .toBe(DASH);
  });

  test("the season total still shows a number when other weeks have the bucket",
    async ({ page }) => {
      const gone = await useFixtureMissingOne(page);
      await page.goto("/position.html");

      await setView(page, "byTeam", "byWeek");
      expect(cell(await readPivot(page), [gone.team, gone.pos], "Total").text)
        .toMatch(/^-?\d+\.\d$/);

      await setView(page, "byTeam", "total");
      expect(cell(await readPivot(page), [gone.team], gone.pos).text)
        .toMatch(/^-?\d+\.\d$/);
    });
});

test.describe("Sorting", () => {
  /** Every team's total for `pos` over `weeks`, the way the page sums it. */
  const totalsFor = (data, pos, weeks) =>
    [...new Set(data.position_scores_by_week.flatMap(w => Object.keys(w)))]
      .map(team => [team, weeks.reduce(
        (s, w) => s + (data.position_scores_by_week[w][team]?.[pos] ?? 0), 0)]);

  const lowestOf = totals => totals.reduce((a, b) => (b[1] < a[1] ? b : a));

  test("Team / Season Total sorted by a position puts the lowest total last",
    async ({ page }) => {
      const data = await useFixture(page);
      const neg = findNegative(data);
      await page.goto("/position.html");
      await setView(page, "byTeam", "total");
      await page.click(`#pivot-head th:has-text("${neg.pos}")`);

      const allWeeks = data.position_scores_by_week.map((_, i) => i);
      const lowest = lowestOf(totalsFor(data, neg.pos, allWeeks));

      const pivot = await readPivot(page);
      const last = pivot.rows[pivot.rows.length - 1];
      expect(last.labels[0]).toBe(lowest[0]);
      expect(cell(pivot, last.labels, neg.pos).text).toBe(lowest[1].toFixed(1));
    });

  test("a negative total sorts below every positive one", async ({ page }) => {
    const data = await useFixture(page);
    const neg = findNegative(data);
    await page.goto("/position.html");
    await setView(page, "byTeam", "total");
    await setWeekRange(page, neg.w);   // a range where the lowest total is negative
    await page.click(`#pivot-head th:has-text("${neg.pos}")`);

    const lowest = lowestOf(totalsFor(data, neg.pos, [neg.w]));
    expect(lowest[1]).toBeLessThan(0);

    const pivot = await readPivot(page);
    const last = pivot.rows[pivot.rows.length - 1];
    expect(last.labels[0]).toBe(lowest[0]);
    expect(cell(pivot, last.labels, neg.pos).text).toBe(lowest[1].toFixed(1));
  });
});
