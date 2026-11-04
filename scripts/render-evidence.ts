/** Renders the seeded seller evidence images into public/evidence. Run: npx tsx scripts/render-evidence.ts */
import path from "node:path";
import { chromium } from "playwright";

const src = (f: string) => "file://" + path.join(process.cwd(), "scripts/evidence-src", f);
const out = (f: string) => path.join(process.cwd(), "public/evidence", f);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(src("carrier.html"));
  await page.screenshot({ path: out("carrier-tracking-NL4471029385US.png"), fullPage: true });
  await page.setViewportSize({ width: 900, height: 680 });
  await page.goto(src("bowl.html?t=listing"));
  await page.screenshot({ path: out("listing-cobalt-bowl.jpg"), type: "jpeg", quality: 85 });
  await page.goto(src("bowl.html?t=buyer"));
  await page.screenshot({ path: out("buyer-photo-cobalt-bowl.jpg"), type: "jpeg", quality: 82 });
  await browser.close();
  console.log("Rendered evidence images to public/evidence");
})();
