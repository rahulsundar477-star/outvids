// Tell IndexNow search engines (Bing, Yandex, Seznam, Naver, Yep…) that these URLs changed.
// Run after a deploy: npm run indexnow
const HOST = "outvids.lol";
const KEY = "195dff258231f2b2b904576ec904ceb6"; // served at https://outvids.lol/<KEY>.txt (public/)
const urls = ["https://outvids.lol/", "https://outvids.lol/about"];

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls }),
});
console.log(`IndexNow ${res.status} ${res.statusText} — ${urls.length} URLs`);
if (res.status >= 400) console.log(await res.text());
