/**
 * Verify pet catalog: no Water Margin names, humanoids expanded, front/back sync.
 * Run: npx --yes tsx scripts/verify-pet-roster.ts
 */
import { readFileSync } from "node:fs";
import {
  PET_CATALOG,
  PET_CATEGORIES,
  type PetCategoryId,
} from "../src/lib/petCatalog";

function check(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("OK:", msg);
  }
}

const banned = [
  "武松",
  "林冲",
  "鲁智深",
  "宋江",
  "李逵",
  "扈三娘",
  "燕青",
  "吴用",
  "英雄列传",
];
const bannedIds = [
  "wusong",
  "linchong",
  "luzhishen",
  "songjiang",
  "likui",
  "husanniang",
  "yanqing",
  "wuyong",
];

for (const p of PET_CATALOG) {
  for (const b of banned) {
    check(!p.name.includes(b) && !p.vibe.includes(b), `no banned name in ${p.id}`);
  }
  check(!bannedIds.includes(p.id), `no banned id ${p.id}`);
}
check(!PET_CATEGORIES.some((c) => c.id === ("hero" as PetCategoryId)), "no hero category");

const companion = PET_CATALOG.filter((p) => p.category === "companion");
check(companion.length >= 20, `companion humanoids >= 20 (got ${companion.length})`);

const ids = PET_CATALOG.map((p) => p.id);
check(new Set(ids).size === ids.length, "unique pet ids");

const rust = readFileSync("src-tauri/src/state.rs", "utf8");
const rustSpecies = [...rust.matchAll(/species: "([^"]+)"/g)].map((m) => m[1]);
const onlyFront = ids.filter((id) => !rustSpecies.includes(id));
const onlyRust = rustSpecies.filter((id) => !ids.includes(id));
check(onlyFront.length === 0, `frontend⊆rust (missing ${onlyFront.join(",") || "none"})`);
check(onlyRust.length === 0, `rust⊆frontend (extra ${onlyRust.join(",") || "none"})`);

for (const p of PET_CATALOG) {
  const path = `public${p.sprite}`;
  try {
    readFileSync(path);
  } catch {
    check(false, `sprite exists ${p.sprite}`);
  }
}
check(true, `all ${PET_CATALOG.length} sprites readable`);

console.log(
  `\ncompanion (${companion.length}):`,
  companion.map((p) => p.name).join("、"),
);
console.log(`total pets: ${PET_CATALOG.length}`);
if (!process.exitCode) console.log("\nAll pet-roster verifications passed.");
