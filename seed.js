const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { db, createGroup, createPerson } = require("./db");

const sourcePath = path.join(__dirname, "seed-source.html");

function clean(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .replace(/^[0-9]+[.)]\s*/, "")
    .trim();
}

function formatPhone(digits) {
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

function extractPhones($, $el) {
  const byDigits = new Map();
  const add = (raw) => {
    let digits = String(raw || "").replace(/[^\d]/g, "");
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    if (digits.length < 7) return;
    if (!byDigits.has(digits)) byDigits.set(digits, formatPhone(digits));
  };
  $el.find("a[href^='tel:']").each((_, a) => {
    add(($(a).attr("href") || "").replace(/^tel:/, ""));
  });
  $el.find("p").each((_, p) => {
    const text = $(p).text();
    if (!text.includes("📞")) return;
    add(text);
  });
  return [...byDigits.values()];
}

function parseSource() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error("seed-source.html is missing");
  }
  const html = fs.readFileSync(sourcePath, "utf8");
  const $ = cheerio.load(html);
  const groups = [];

  $(".toggle-btn").each((groupIndex, btn) => {
    const name = clean($(btn).clone().children().remove().end().text());
    if (!name) return;
    const list = $(btn).nextAll("ul.group-content").first();
    const people = [];

    list.children("li").each((personIndex, li) => {
      const $li = $(li);
      const nameEl = $li.find("p.font-semibold").first();
      const personName = clean(nameEl.text());
      if (!personName) return;

      const img = $li.find("img").first();
      const photoUrl = img.attr("src") ? img.attr("src").trim() : "";
      const roleText = clean($li.find("p.text-gray-600").first().text());
      const mapLink = $li.find("a[href*='maps']").first();
      const mapsUrl = mapLink.attr("href") || "";
      const address = clean(mapLink.text()).replace(/^🏠\s*/, "");
      const phones = extractPhones($, $li);
      const family = [];
      $li.find("ul.sub-content li").each((_, member) => {
        const memberName = clean($(member).text());
        if (memberName) family.push(memberName);
      });

      const isHousehold = $li.find(".toggle-sub").length > 0 || phones.length > 0 || Boolean(address);
      people.push({
        kind: isHousehold ? "household" : "leader",
        name: personName,
        role: isHousehold || roleText.includes("📞") ? null : roleText,
        phones: isHousehold ? phones : [],
        address: isHousehold ? address : null,
        maps_url: isHousehold ? mapsUrl : null,
        photo_url: isHousehold ? "" : photoUrl,
        sort_order: personIndex,
        family: isHousehold ? family : [],
      });
    });

    groups.push({ name, sort_order: groupIndex, people });
  });

  return groups;
}

function seed({ force = false } = {}) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM groups").get().c;
  if (count > 0 && !force) {
    console.log("Database already has data; skip seed.");
    return { seeded: false, groups: count };
  }

  if (force) {
    db.exec("DELETE FROM family_members; DELETE FROM people; DELETE FROM groups;");
  }

  const groups = parseSource();
  const tx = db.transaction(() => {
    for (const group of groups) {
      const saved = createGroup({ name: group.name, sort_order: group.sort_order });
      for (const person of group.people) {
        createPerson({ ...person, group_id: saved.id });
      }
    }
  });
  tx();

  const people = db.prepare("SELECT COUNT(*) AS c FROM people").get().c;
  const members = db.prepare("SELECT COUNT(*) AS c FROM family_members").get().c;
  console.log(`Seeded ${groups.length} groups, ${people} people, ${members} family members.`);
  return { seeded: true, groups: groups.length, people, members };
}

if (require.main === module) {
  seed({ force: process.argv.includes("--force") });
}

module.exports = { seed, parseSource };
