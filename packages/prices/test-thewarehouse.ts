import { fetchPage } from "./src/pipeline/fetch-page.ts";

const url = "https://www.thewarehouse.co.nz/p/kpop-demon-hunters-comforter-set-2-piece-double/R3064250.html";
const r = await fetchPage(url, { productId: "diag" });
if (!r) {
  console.error("RESULT: FAILED (null)");
  process.exit(1);
}
console.log("status: ok");
console.log("final url:", r.url);
console.log("html length:", r.html.length);
console.log('contains "price":', r.html.includes('"price":'));
console.log('contains "InStock":', r.html.includes("InStock"));
