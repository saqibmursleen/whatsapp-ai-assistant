import { readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "businesses");

const businesses = new Map();

export function loadBusinesses() {
  businesses.clear();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
    const business = JSON.parse(readFileSync(path.join(DIR, file), "utf8"));
    businesses.set(business.id, business);
  }
  console.log(`Loaded ${businesses.size} business profile(s): ${[...businesses.keys()].join(", ")}`);
  return businesses;
}

export function getBusiness(id) {
  return businesses.get(id);
}

export function listBusinesses() {
  return [...businesses.values()].map((b) => ({
    id: b.id,
    name: b.name,
    type: b.type,
    emoji: b.emoji || "💬",
  }));
}

export function getBusinessByPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return undefined;
  return [...businesses.values()].find((b) => b.whatsapp?.phoneNumberId === phoneNumberId);
}
