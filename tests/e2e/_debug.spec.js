import { test } from "@playwright/test";

test("capture init state", async ({ page }) => {
  const msgs = [];
  page.on("console", (m) => msgs.push(`[console.${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) =>
    msgs.push(`[pageerror] ${e.message} :: stack=${e.stack}`)
  );
  await page.goto("/?e2e=1");
  await page.waitForTimeout(2000);
  const state = await page.evaluate(() => {
    return {
      hasBpc: typeof window.__bpc,
      hasGame: !!(window.__bpc && window.__bpc.game),
      tutorial: !!(
        window.__bpc &&
        window.__bpc.game &&
        window.__bpc.game.tutorial
      ),
      search: location.search,
    };
  });
  console.log(
    "---CAPTURED---\nstate=" +
      JSON.stringify(state) +
      "\n" +
      msgs.join("\n") +
      "\n---END---"
  );
});
