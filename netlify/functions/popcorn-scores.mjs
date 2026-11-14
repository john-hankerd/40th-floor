// Leaderboard for the Popcorn Sort game at /popcorn/.
// Keeps the 5 lowest move counts for each level in Netlify Blobs (no database, no keys to set).
//
//   GET  /.netlify/functions/popcorn-scores?levels=1,2,3
//        -> { ok, boards: { "1": [{ n: "ABC", m: 12 }, ...], ... } }
//   POST { action: "check",  level, moves, device }            -> { ok, qualifies, board }
//   POST { action: "submit", level, moves, device, initials }  -> { ok, rank, board }
//
// One phone (device id) holds at most one spot per level. Ties go to whoever got there first.

import { getStore } from "@netlify/blobs";

const TOP = 5;
const PUZZLE_SET = 1; // bump together with PUZZLE_SET in popcorn/index.html if the level mixes ever change
const BLOCKED = new Set(["ASS", "FUK", "FUC", "FUQ", "FCK", "FKU", "SEX", "KKK", "NIG", "NGR", "FAG", "CUM", "TIT", "DIK", "DIC", "COK", "KOK", "JEW", "JAP", "GAY", "PIS", "POO", "CNT", "VAG", "WTF", "HOE", "SUK", "SUC"]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const key = (level) => `set${PUZZLE_SET}/level-${level}`;
const validLevel = (v) => Number.isInteger(v) && v >= 1 && v <= 9999;
const validMoves = (v) => Number.isInteger(v) && v >= 2 && v <= 999;
const validDevice = (v) => typeof v === "string" && /^[a-z0-9]{12,40}$/.test(v);
const publicBoard = (list) => list.slice(0, TOP).map((e) => ({ n: e.n, m: e.m }));

function sortBoard(list) {
  return list.slice().sort((a, b) => a.m - b.m || a.t - b.t);
}

// Would this score earn a spot?
export function qualifies(list, device, moves) {
  const own = list.find((e) => e.d === device);
  if (own && own.m <= moves) return false;
  const others = sortBoard(list.filter((e) => e.d !== device));
  return others.length < TOP || moves < others[TOP - 1].m;
}

// Returns the new list and the 1-based rank of the new entry (0 if it didn't make it).
export function addScore(list, entry) {
  if (!qualifies(list, entry.d, entry.m)) return { list: sortBoard(list).slice(0, TOP), rank: 0 };
  const next = sortBoard(list.filter((e) => e.d !== entry.d).concat([entry])).slice(0, TOP);
  return { list: next, rank: next.indexOf(entry) + 1 };
}

async function readBoard(store, level) {
  const data = await store.get(key(level), { type: "json" });
  return Array.isArray(data) ? data.filter((e) => e && typeof e.n === "string" && Number.isInteger(e.m)) : [];
}

export default async (req) => {
  try {
    const store = getStore({ name: "popcorn-scores", consistency: "strong" });

    if (req.method === "GET") {
      const raw = new URL(req.url).searchParams.get("levels") || "";
      const levels = [...new Set(raw.split(",").map((v) => parseInt(v, 10)).filter(validLevel))].slice(0, 60);
      const boards = {};
      await Promise.all(
        levels.map(async (lv) => {
          boards[lv] = publicBoard(sortBoard(await readBoard(store, lv)));
        })
      );
      return json({ ok: true, boards });
    }

    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

    const text = await req.text();
    if (text.length > 500) return json({ ok: false, error: "too big" }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch (e) {
      return json({ ok: false, error: "bad json" }, 400);
    }
    const { action, level, moves, device } = body || {};
    if (!validLevel(level) || !validMoves(moves) || !validDevice(device)) return json({ ok: false, error: "bad input" }, 400);

    const list = await readBoard(store, level);

    if (action === "check") {
      return json({ ok: true, qualifies: qualifies(list, device, moves), board: publicBoard(sortBoard(list)) });
    }

    if (action === "submit") {
      const initials = typeof body.initials === "string" ? body.initials.toUpperCase() : "";
      if (!/^[A-Z]{3}$/.test(initials)) return json({ ok: false, error: "bad initials" }, 400);
      if (BLOCKED.has(initials)) return json({ ok: true, rejected: true, board: publicBoard(sortBoard(list)) });
      const result = addScore(list, { n: initials, m: moves, d: device, t: Date.now() });
      if (result.rank) await store.setJSON(key(level), result.list);
      return json({ ok: true, rank: result.rank, board: publicBoard(result.list) });
    }

    return json({ ok: false, error: "bad action" }, 400);
  } catch (err) {
    console.error("popcorn-scores failed", err);
    return json({ ok: false, error: "server" }, 500);
  }
};
