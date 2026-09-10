const { test, expect } = require("@playwright/test");
const { useFixture } = require("./fixture");

const SELECT = "#highlight-team";
const STORAGE_KEY = "ff-highlight-team";
const rows = page => page.locator("#standings-table tbody tr");
const options = page => page.locator(`${SELECT} option`);

/** Wait until the chart exists and its legend has been laid out. */
async function settleLegend(page) {
  await page.waitForFunction(() => {
    const chart = window.Chart?.getChart("positionChart");
    return !!chart && (chart.legend?.legendHitBoxes || []).length > 0;
  });
}

/** The styling the highlight routine actually put on each line. */
const lineStyles = page => page.evaluate(() =>
  window.Chart.getChart("positionChart").data.datasets.map(d => ({
    width: d.borderWidth, color: String(d.borderColor),
  })));

const stored = page => page.evaluate(k => localStorage.getItem(k), STORAGE_KEY);
const teamParam = page => new URL(page.url()).searchParams.get("team");

/** Click a legend entry the way a visitor does, through its own hit box. */
async function clickLegendItem(page, datasetIndex) {
  const point = await page.evaluate(i => {
    const chart = window.Chart.getChart("positionChart");
    const box = chart.legend.legendHitBoxes[i];
    const canvas = chart.canvas.getBoundingClientRect();
    return {
      x: canvas.left + box.left + box.width / 2,
      y: canvas.top + box.top + box.height / 2,
    };
  }, datasetIndex);
  await page.mouse.click(point.x, point.y);
}

test.describe("Highlight control", () => {
  test("lists None and then every team, by name, in standings order", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");

    await expect(options(page)).toHaveText(["None", ...data.teams.map(t => t.team_name)]);
    expect(await options(page).evaluateAll(os => os.map(o => o.value)))
      .toEqual(["", ...data.teams.map(t => t.team_abbrev)]);
    // A native select, so arrow keys and screen readers work unaided.
    await expect(page.locator(SELECT)).toHaveJSProperty("tagName", "SELECT");
  });

  test("tints exactly the chosen team's Standings row, and only while chosen", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");

    const pick = 3;
    await page.selectOption(SELECT, data.teams[pick].team_abbrev);
    await expect(rows(page).nth(pick)).toHaveClass(/highlight/);
    await expect(page.locator("#standings-table tbody tr.highlight")).toHaveCount(1);
    // The tint is its own wash, not the hover tint reused.
    const [tint, hover] = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return [style.getPropertyValue("--field-hl").trim(),
              style.getPropertyValue("--field-lt").trim()];
    });
    expect(tint).not.toBe("");
    expect(tint).not.toBe(hover);

    await page.selectOption(SELECT, "");
    await expect(page.locator("#standings-table tbody tr.highlight")).toHaveCount(0);
  });

  test("draws the chosen line heaviest and fades the rest, then restores on None", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");
    await settleLegend(page);

    const pick = 3;
    await page.selectOption(SELECT, data.teams[pick].team_abbrev);
    const on = await lineStyles(page);
    const others = on.filter((_, i) => i !== pick);
    expect(Math.min(...others.map(s => on[pick].width - s.width))).toBeGreaterThan(0);
    // Faded lines carry an alpha; the chosen one keeps its full palette colour.
    expect(on[pick].color).not.toMatch(/^rgba/);
    expect(others.every(s => /^rgba\(/.test(s.color))).toBe(true);

    await page.selectOption(SELECT, "");
    const off = await lineStyles(page);
    expect(new Set(off.map(s => s.width)).size).toBe(1);
    expect(off.some(s => /^rgba\(/.test(s.color))).toBe(false);
  });

  test("leaves legend visibility alone — clicks still toggle, and survive a highlight change", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");
    await settleLegend(page);

    await page.selectOption(SELECT, data.teams[3].team_abbrev);
    const visible = i => page.evaluate(
      n => window.Chart.getChart("positionChart").isDatasetVisible(n), i);

    await clickLegendItem(page, 0);
    await expect.poll(() => visible(0)).toBe(false);

    // Changing the highlight must not quietly un-hide what the legend hid.
    await page.selectOption(SELECT, data.teams[5].team_abbrev);
    expect(await visible(0)).toBe(false);

    await clickLegendItem(page, 0);
    await expect.poll(() => visible(0)).toBe(true);
  });
});

test.describe("Remembered and shareable selection", () => {
  test("remembers the choice across a reload", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");

    const abbrev = data.teams[4].team_abbrev;
    await page.selectOption(SELECT, abbrev);
    expect(await stored(page)).toBe(abbrev);
    expect(teamParam(page)).toBe(abbrev);

    await page.reload();
    await expect(page.locator(SELECT)).toHaveValue(abbrev);
    await expect(rows(page).nth(4)).toHaveClass(/highlight/);
  });

  test("writes the query parameter without navigating away", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");

    const entries = () => page.evaluate(() => history.length);
    const before = await entries();
    await page.selectOption(SELECT, data.teams[2].team_abbrev);
    expect(await entries()).toBe(before);

    // None clears both halves of the memory.
    await page.selectOption(SELECT, "");
    expect(teamParam(page)).toBe(null);
    expect(await stored(page)).toBe(null);
    expect(await entries()).toBe(before);
  });

  test("a link's team beats a remembered one", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");
    const remembered = data.teams[1].team_abbrev;
    const linked = data.teams[7].team_abbrev;
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, remembered]);

    await page.goto(`/index.html?team=${encodeURIComponent(linked)}`);
    await expect(page.locator(SELECT)).toHaveValue(linked);
    await expect(rows(page).nth(7)).toHaveClass(/highlight/);
  });

  test("ignores unknown teams in the link and in storage, and writes nothing", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");
    await page.evaluate(k => localStorage.setItem(k, "GONE"), STORAGE_KEY);

    await page.goto("/index.html?team=NOPE");
    // Prove the control was actually built: an empty-state page would satisfy
    // every assertion below without the highlight code ever running.
    await expect(options(page)).toHaveCount(data.teams.length + 1);
    await expect(page.locator(SELECT)).toHaveValue("");
    await expect(page.locator("#standings-table tbody tr.highlight")).toHaveCount(0);
    expect(await stored(page)).toBe("GONE");
  });

  test("an empty abbreviation cannot pass itself off as None", async ({ page }) => {
    // The fetch script defaults team_abbrev to "", which is also this feature's
    // "nothing highlighted" token — so an unkeyed team must not answer to it.
    const EMPTIED = 4;
    const data = await useFixture(page, d => {
      d.teams[EMPTIED].team_abbrev = "";
      return d;
    });
    await page.goto("/index.html");

    // A plain first load highlights nothing at all.
    await expect(page.locator(SELECT)).toHaveValue("");
    await expect(page.locator("#standings-table tbody tr.highlight")).toHaveCount(0);

    // And that team is still selectable on its own terms, then clearable.
    const fallback = data.teams[EMPTIED].team_name;
    expect(await options(page).evaluateAll(os => os.map(o => o.value)))
      .toEqual(["", ...data.teams.map(t => t.team_abbrev || t.team_name)]);
    await page.selectOption(SELECT, fallback);
    await expect(rows(page).nth(EMPTIED)).toHaveClass(/highlight/);
    await page.selectOption(SELECT, "");
    await expect(page.locator("#standings-table tbody tr.highlight")).toHaveCount(0);
  });

  test("still renders, and still takes a link, where site data is blocked", async ({ page }) => {
    const data = await useFixture(page);
    // Nothing the page does may raise: a blocked write happens last, so only an
    // uncaught error would give it away.
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    // Some privacy modes throw on the mere act of touching local storage.
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() { throw new DOMException("blocked", "SecurityError"); },
      });
    });
    const abbrev = data.teams[2].team_abbrev;

    // A plain load is the one that actually reads storage: with no team in the
    // link there is nothing to short-circuit the lookup.
    await page.goto("/index.html");
    await expect(page.locator(SELECT)).toHaveValue("");
    // The sections main() renders after the highlight must survive it.
    await expect(page.locator("#ranking-section")).not.toHaveClass(/hidden/);
    await expect(page.locator("#topscorers-section")).not.toHaveClass(/hidden/);

    // The write path must not throw either; the link keeps carrying the choice.
    await page.selectOption(SELECT, abbrev);
    expect(teamParam(page)).toBe(abbrev);
    await expect(rows(page).nth(2)).toHaveClass(/highlight/);

    // And a shared link still resolves with no storage to fall back on.
    await page.goto(`/index.html?team=${encodeURIComponent(abbrev)}`);
    await expect(page.locator(SELECT)).toHaveValue(abbrev);
    await expect(page.locator("#ranking-section")).not.toHaveClass(/hidden/);

    expect(errors).toEqual([]);
  });

  test("round-trips an abbreviation containing a URL-significant character", async ({ page }) => {
    // Real abbreviations carry characters like "$"; pin one through the fixture
    // seam so the test does not depend on the frozen data still having one.
    const index = 2, abbrev = "A&B$C";
    await useFixture(page, d => { d.teams[index].team_abbrev = abbrev; return d; });

    await page.goto("/index.html");
    await page.selectOption(SELECT, abbrev);
    // The raw query string carries the escape, not the bare character.
    expect(new URL(page.url()).search).toContain(encodeURIComponent(abbrev));
    expect(teamParam(page)).toBe(abbrev);

    await page.reload();
    await expect(page.locator(SELECT)).toHaveValue(abbrev);
    await expect(rows(page).nth(index)).toHaveClass(/highlight/);
  });
});
