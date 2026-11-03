const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "directory.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('leader', 'household')),
    name TEXT NOT NULL,
    role TEXT,
    phones TEXT NOT NULL DEFAULT '[]',
    address TEXT,
    maps_url TEXT,
    photo_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS family_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
  );
`);

function parsePhones(value) {
  if (Array.isArray(value)) {
    return value.map((p) => String(p).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,;]+/)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return [];
}

function getDirectory() {
  const groups = db.prepare("SELECT * FROM groups ORDER BY sort_order, name").all();
  const people = db.prepare("SELECT * FROM people ORDER BY sort_order, id").all();
  const members = db.prepare("SELECT * FROM family_members ORDER BY sort_order, id").all();

  const membersByPerson = {};
  for (const member of members) {
    if (!membersByPerson[member.person_id]) membersByPerson[member.person_id] = [];
    membersByPerson[member.person_id].push(member);
  }

  const peopleByGroup = {};
  for (const person of people) {
    person.phones = JSON.parse(person.phones || "[]");
    person.family = membersByPerson[person.id] || [];
    if (!peopleByGroup[person.group_id]) peopleByGroup[person.group_id] = [];
    peopleByGroup[person.group_id].push(person);
  }

  return groups.map((group) => ({
    ...group,
    people: peopleByGroup[group.id] || [],
  }));
}

function createGroup({ name, sort_order }) {
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM groups").get().m;
  const info = db
    .prepare("INSERT INTO groups (name, sort_order) VALUES (?, ?)")
    .run(name.trim(), sort_order ?? maxOrder + 1);
  return db.prepare("SELECT * FROM groups WHERE id = ?").get(info.lastInsertRowid);
}

function updateGroup(id, { name, sort_order }) {
  const current = db.prepare("SELECT * FROM groups WHERE id = ?").get(id);
  if (!current) return null;
  db.prepare("UPDATE groups SET name = ?, sort_order = ? WHERE id = ?").run(
    name != null ? name.trim() : current.name,
    sort_order != null ? sort_order : current.sort_order,
    id
  );
  return db.prepare("SELECT * FROM groups WHERE id = ?").get(id);
}

function deleteGroup(id) {
  return db.prepare("DELETE FROM groups WHERE id = ?").run(id);
}

function createPerson(payload) {
  const phones = JSON.stringify(parsePhones(payload.phones));
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM people WHERE group_id = ?")
    .get(payload.group_id).m;
  const info = db
    .prepare(
      `INSERT INTO people (group_id, kind, name, role, phones, address, maps_url, photo_url, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      payload.group_id,
      payload.kind,
      payload.name.trim(),
      payload.role || null,
      phones,
      payload.address || null,
      payload.maps_url || null,
      payload.photo_url || null,
      payload.sort_order ?? maxOrder + 1
    );
  replaceFamily(info.lastInsertRowid, payload.family);
  return getPerson(info.lastInsertRowid);
}

function updatePerson(id, payload) {
  const current = db.prepare("SELECT * FROM people WHERE id = ?").get(id);
  if (!current) return null;
  db.prepare(
    `UPDATE people SET group_id = ?, kind = ?, name = ?, role = ?, phones = ?, address = ?, maps_url = ?, photo_url = ?, sort_order = ?
     WHERE id = ?`
  ).run(
    payload.group_id ?? current.group_id,
    payload.kind ?? current.kind,
    payload.name != null ? payload.name.trim() : current.name,
    payload.role !== undefined ? payload.role || null : current.role,
    payload.phones !== undefined ? JSON.stringify(parsePhones(payload.phones)) : current.phones,
    payload.address !== undefined ? payload.address || null : current.address,
    payload.maps_url !== undefined ? payload.maps_url || null : current.maps_url,
    payload.photo_url !== undefined ? payload.photo_url || null : current.photo_url,
    payload.sort_order != null ? payload.sort_order : current.sort_order,
    id
  );
  if (payload.family !== undefined) replaceFamily(id, payload.family);
  return getPerson(id);
}

function deletePerson(id) {
  return db.prepare("DELETE FROM people WHERE id = ?").run(id);
}

function getPerson(id) {
  const person = db.prepare("SELECT * FROM people WHERE id = ?").get(id);
  if (!person) return null;
  person.phones = JSON.parse(person.phones || "[]");
  person.family = db
    .prepare("SELECT * FROM family_members WHERE person_id = ? ORDER BY sort_order, id")
    .all(id);
  return person;
}

function replaceFamily(personId, family) {
  db.prepare("DELETE FROM family_members WHERE person_id = ?").run(personId);
  const names = Array.isArray(family) ? family : [];
  const insert = db.prepare(
    "INSERT INTO family_members (person_id, name, sort_order) VALUES (?, ?, ?)"
  );
  names.forEach((item, index) => {
    const name = typeof item === "string" ? item : item?.name;
    if (!name || !String(name).trim()) return;
    insert.run(personId, String(name).trim(), index);
  });
}

module.exports = {
  db,
  getDirectory,
  createGroup,
  updateGroup,
  deleteGroup,
  createPerson,
  updatePerson,
  deletePerson,
  getPerson,
};
