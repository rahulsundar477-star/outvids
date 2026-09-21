// Guards /.well-known/security.txt (RFC 9116): the required fields are there, and Expires isn't about
// to lapse. A stale file is worse than none, so this fails a month ahead to leave time to renew.
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../public/.well-known/security.txt", import.meta.url), "utf8");
const field = (name) => text.match(new RegExp(`^${name}:\s*(.+)$`, "mi"))?.[1]?.trim();
const fail = (msg) => {
  console.log(`FAIL  security.txt: ${msg}`);
  process.exit(1);
};

const contact = field("Contact");
const expires = field("Expires");
if (!contact || !/^(https:\/\/|mailto:)/.test(contact)) fail("Contact must be an https: or mailto: URI");
if (!expires || Number.isNaN(Date.parse(expires))) fail("Expires must be an ISO 8601 date");
const days = (Date.parse(expires) - Date.now()) / 86_400_000;
if (days < 30) fail(`Expires is ${Math.floor(days)} days away — set a new date (at most a year out)`);
if (days > 366) fail("Expires is more than a year out, which RFC 9116 advises against");
if (field("Canonical") !== "https://outvids.lol/.well-known/security.txt") fail("Canonical must be the live URL");
console.log(`PASS  security.txt: Contact ${contact}, expires in ${Math.floor(days)} days`);
