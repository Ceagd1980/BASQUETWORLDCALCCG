// Radar Básquet Mundial — función de Netlify que lee AnnaBet.com y devuelve JSON.
// Sin dependencias externas: usa fetch nativo (Node 18+) y un lector de tablas HTML propio.
//   /api/basket?league=serie_20_Euroleague   posiciones (general / casa / fuera) + partidos de la liga
//   /api/basket?part=leagues                 lista de ligas de básquet de AnnaBet
//   /api/basket?debug=1&league=...           diagnóstico: cómo viene la página

// ======================= CONFIGURACIÓN =======================
const SITE = "https://annabet.com/en/basketballstats/"; // versión en inglés: fechas "Thursday 24. September 2026"
// Lista de respaldo por si no se puede leer el menú de ligas
const FALLBACK_LEAGUES = [
  ["serie_20_Euroleague", "Euroliga"], ["serie_19_Eurocup", "Eurocup"],
  ["serie_1_NBA", "NBA (EE.UU.)"], ["serie_31_WNBA", "WNBA (EE.UU.)"],
  ["serie_5_Spanish_ACB", "España ACB"], ["serie_11_German_Bundesliga", "Alemania BBL"],
  ["serie_7_Italian_Serie_A", "Italia Serie A"], ["serie_18_French_Pro_A", "Francia Pro A"],
  ["serie_9_Greek_A1", "Grecia A1"], ["serie_12_Turkish_TBL", "Turquía BSL"],
  ["serie_42_Adriatic_League", "Liga Adriática (ABA)"], ["serie_15_Lithuanian_LKL", "Lituania LKL"],
  ["serie_14_Polish_DBE", "Polonia"], ["serie_13_Russian_Superleague", "Rusia"],
  ["serie_41_Australian_NBL", "Australia NBL"], ["serie_90_Korean_KBL", "Corea KBL"],
  ["serie_97_B.League", "Japón B.League"], ["serie_166_Chinese_CBA", "China CBA"],
  ["serie_165_LNBP", "México LNBP"], ["serie_167_Brazilian_NBB", "Brasil NBB"],
];
const MENU_PAGE = "serie_1_NBA"; // página de la que se lee el menú completo de ligas
// =============================================================

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tkey = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function num(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(",", ".").replace(/[^\d.\-+]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ---------- descarga con reintento y límite de tiempo ----------
async function getHtml(url, tries = 2, timeoutMs = 6000) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal, redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      if (!/<table/i.test(html)) throw new Error("la página no trae tablas (posible bloqueo o liga sin datos)");
      return html;
    } catch (e) {
      lastErr = e.name === "AbortError" ? new Error("tiempo de espera agotado") : e;
      if (i < tries - 1) await sleep(400);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastErr ? lastErr.message : "error desconocido");
}

// ---------- lector de tablas HTML ----------
function decode(s) {
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z])(acute|grave|tilde|uml|circ|cedil|ring|slash|caron);/gi, (_, c, t) =>
      (c + ({ acute: "́", grave: "̀", tilde: "̃", uml: "̈", circ: "̂", cedil: "̧", ring: "̊", slash: "", caron: "̌" }[t.toLowerCase()] || "")).normalize("NFC"))
    .replace(/\s+/g, " ")
    .trim();
}

function parseTables(html) {
  const out = [];
  const reTable = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = reTable.exec(html))) {
    const rows = [];
    const reRow = /<tr[\s\S]*?<\/tr>/gi;
    let r;
    while ((r = reRow.exec(m[0]))) {
      const cells = [];
      const reCell = /<t([hd])[^>]*>([\s\S]*?)<\/t\1>/gi;
      let c;
      while ((c = reCell.exec(r[0]))) cells.push(decode(c[2]));
      if (cells.length) rows.push(cells);
    }
    out.push({ index: m.index, end: m.index + m[0].length, rows });
  }
  return out;
}

// ---------- posiciones: General / Casa / Fuera ----------
// Cabecera tipo "# | Team | GP | W | L | W% | ØPF | ØPA | ØDiff" (o en español: Equipo, PJ, PG, PP...)
const H = {
  team: /^(team|equipo)$/i,
  gp: /^(gp|pj|g|games|played)$/i,
  w: /^(w|pg|won|wins|v)$/i,
  l: /^(l|pp|lost|losses|d)$/i,
  pf: /pf|pts?\s*for|puntos\s*a\s*favor|scored/i,
  pa: /pa\b|pc\b|pts?\s*against|en\s*contra|allowed/i,
};

function isStandingsHdr(r) {
  return r.some((c) => H.team.test(c)) && r.some((c) => H.w.test(c)) && r.some((c) => H.l.test(c));
}

function parseStandingsTable(t) {
  const hi = t.rows.findIndex(isStandingsHdr);
  const hdr = t.rows[hi];
  const ix = (re) => hdr.findIndex((c) => re.test(c));
  const iT = ix(H.team), iGP = ix(H.gp), iW = ix(H.w), iL = ix(H.l), iPF = ix(H.pf), iPA = ix(H.pa);
  const map = {};
  let pos = 0;
  for (const r of t.rows.slice(hi + 1)) {
    if (isStandingsHdr(r) || !r[iT]) continue;
    const W = num(r[iW]), L = num(r[iL]);
    if (W == null || L == null) continue;
    pos++;
    const pl = num(r[0]);
    const GP = iGP >= 0 && num(r[iGP]) != null ? num(r[iGP]) : W + L;
    map[tkey(r[iT])] = {
      team: r[iT], pos: pl && pl > 0 && pl < 500 ? pl : pos,
      gp: GP, w: W, l: L,
      pf: iPF >= 0 ? num(r[iPF]) : null,
      pa: iPA >= 0 ? num(r[iPA]) : null,
    };
  }
  return map;
}

// Toma las tablas de posiciones en orden. Lo normal: 1ª = todos los juegos, 2ª = casa, 3ª = fuera.
// Si el texto previo a la tabla dice "home/casa" o "away/fuera", se usa eso.
function parseStandings(html, tables) {
  const st = tables.filter((t) => t.rows.some(isStandingsHdr));
  if (!st.length) throw new Error("tabla de posiciones no encontrada");
  const out = { all: null, home: null, away: null, groups: 0 };
  const label = (t) => {
    const before = decode(html.slice(Math.max(0, t.index - 400), t.index)).toLowerCase();
    const last = before.slice(-120);
    if (/\b(at home|home|casa|local)\b/.test(last)) return "home";
    if (/\b(at away|away|fuera|visit)/.test(last)) return "away";
    return null;
  };
  const maps = st.map((t) => ({ t, lab: label(t), map: parseStandingsTable(t) })).filter((x) => Object.keys(x.map).length);
  // Caso típico: grupos de 3 tablas (general, casa, fuera). Si hay más (conferencias/grupos), se juntan.
  const merge = (dst, src) => Object.assign(dst, src);
  const order = ["all", "home", "away"];
  const hasLabels = maps.some((x) => x.lab);
  if (hasLabels) {
    for (const x of maps) out[x.lab || "all"] = merge(out[x.lab || "all"] || {}, x.map);
  } else if (maps.length % 3 === 0) {
    maps.forEach((x, i) => { const k = order[i % 3]; out[k] = merge(out[k] || {}, x.map); });
    out.groups = maps.length / 3;
  } else {
    // Sin casa/fuera identificables: todo como general
    for (const x of maps) out.all = merge(out.all || {}, x.map);
  }
  if (!out.all) out.all = {};
  return out;
}

// ---------- partidos ----------
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// Reconoce "Thursday 24. September 2026", "24. September 2026", "24.9.2026", "24.09.26", "24.9."
function findDate(text) {
  const t = String(text || "");
  let m = /\b(\d{1,2})\.?\s+([A-Za-zé]+)\s+(\d{4})\b/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = /\b([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/.exec(t);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = /\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/.exec(t);
  if (m && +m[2] >= 1 && +m[2] <= 12) { let y = +m[3]; if (y < 100) y += 2000; return iso(y, +m[2], +m[1]); }
  m = /(?:^|\s)(\d{1,2})\.(\d{1,2})\.(?:\s|$)/.exec(t);
  if (m && +m[2] >= 1 && +m[2] <= 12) {
    // sin año: el más cercano a hoy
    const now = new Date(), y = now.getUTCFullYear();
    const cands = [y - 1, y, y + 1].map((yy) => iso(yy, +m[2], +m[1]));
    return cands.sort((a, b) => Math.abs(new Date(a) - now) - Math.abs(new Date(b) - now))[0];
  }
  return null;
}

// Un partido = una fila de tabla que contiene DOS equipos conocidos (de las posiciones).
// Si trae marcador "98 - 97" es un resultado; si no, es un partido por jugar.
function parseGames(tables, knownKeys, nameOf) {
  const games = [];
  const seen = new Set();
  let curDate = null;
  const teamIn = (cell) => {
    const k = tkey(cell);
    if (knownKeys.has(k)) return k;
    // celda "Equipo A - Equipo B"
    return null;
  };
  for (const t of tables) {
    for (const r of t.rows) {
      const rowText = r.join(" | ");
      const d = findDate(rowText);
      // fila solo de fecha (cabecera de día)
      const teamsInRow = [];
      for (const c of r) {
        const k = teamIn(c);
        if (k) teamsInRow.push(k);
        else if (/\s[-–]\s/.test(c)) {
          const parts = c.split(/\s[-–]\s/).map((p) => p.trim());
          if (parts.length === 2 && knownKeys.has(tkey(parts[0])) && knownKeys.has(tkey(parts[1]))) teamsInRow.push(tkey(parts[0]), tkey(parts[1]));
        }
      }
      if (d && teamsInRow.length < 2) { curDate = d; continue; }
      if (teamsInRow.length < 2) continue;
      const [hk, ak] = teamsInRow;
      if (hk === ak) continue;
      const date = d || curDate;
      // Marcador: celda "98 - 97" (no confundir con la hora "18:00"); en básquet ambos ≥ 20
      let score = null;
      for (const c of r) {
        const m = /^\s*(\d{2,3})\s*[-–]\s*(\d{2,3})\s*(?:\(.*\))?\s*$/.exec(c);
        if (m && +m[1] >= 20 && +m[2] >= 20) { score = m; break; }
      }
      const time = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(rowText);
      const odds = r.map((c) => c.trim()).filter((c) => /^\d{1,2}\.\d{2}$/.test(c)).map(Number);
      const id = `${date}|${hk}|${ak}`;
      if (seen.has(id)) continue;
      seen.add(id);
      games.push({
        date, time: time ? time[0] : "",
        home: nameOf(hk), away: nameOf(ak), homeKey: hk, awayKey: ak,
        score: score ? [+score[1], +score[2]] : null,
        odds: odds.length >= 2 ? odds.slice(0, 3) : null,
      });
    }
  }
  return games;
}

// ---------- ligas ----------
function parseLeagues(html) {
  const re = /href="[^"]*?(serie_(\d+)_([^"\/]+?))\.html"[^>]*>([\s\S]*?)<\/a>/gi;
  const out = new Map();
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    const txt = decode(m[4]) || m[3].replace(/_/g, " ");
    if (!out.has(id)) out.set(id, txt);
  }
  return [...out.entries()];
}

const json = (body, status, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });

const cleanLeague = (s) => (s && /^serie_\d+_[A-Za-z0-9._-]+$/.test(s) ? s : null);

async function leaguesResponse() {
  try {
    const html = await getHtml(`${SITE}${MENU_PAGE}.html`);
    const list = parseLeagues(html);
    if (list.length < 5) throw new Error("menú de ligas no encontrado");
    return json({ ok: true, leagues: list, source: "annabet" }, 200, {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": "public, durable, s-maxage=86400",
      "Netlify-Vary": "query=part",
    });
  } catch (e) {
    return json({ ok: true, leagues: FALLBACK_LEAGUES, source: "respaldo", warning: e.message }, 200, { "Cache-Control": "no-store" });
  }
}

async function debugResponse(league) {
  const u = `${SITE}${league}.html`;
  try {
    const r = await fetch(u, { headers: HEADERS });
    const html = await r.text();
    const tables = parseTables(html);
    return json({
      url: u, status: r.status, bytes: html.length, tablas: tables.length,
      muestra: tables.slice(0, 12).map((t, i) => ({
        n: i, filas: t.rows.length,
        antes: decode(html.slice(Math.max(0, t.index - 300), t.index)).slice(-120),
        primeras: t.rows.slice(0, 4),
      })),
      fechasEncontradas: [...new Set((decode(html).match(/\b\d{1,2}\.\s+[A-Z][a-z]+\s+\d{4}\b/g) || []))].slice(0, 10),
      ligasEnMenu: parseLeagues(html).length,
    }, 200, { "Cache-Control": "no-store" });
  } catch (e) {
    return json({ url: u, error: e.message }, 200, { "Cache-Control": "no-store" });
  }
}

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("part") === "leagues") return leaguesResponse();
  const league = cleanLeague(url.searchParams.get("league")) || "serie_20_Euroleague";
  if (url.searchParams.get("debug")) return debugResponse(league);

  let html;
  try {
    html = await getHtml(`${SITE}${league}.html`);
  } catch (e) {
    return json({ ok: false, error: `No se pudo leer la liga en AnnaBet (${e.message}).`, league }, 502, { "Cache-Control": "no-store" });
  }

  const warnings = [];
  const tables = parseTables(html);
  let standings;
  try {
    standings = parseStandings(html, tables);
  } catch (e) {
    return json({ ok: false, error: `La liga no tiene tabla de posiciones en AnnaBet (${e.message}).`, league }, 502, { "Cache-Control": "no-store" });
  }
  if (!standings.home || !standings.away) warnings.push("Esta liga no trae tablas de casa y fuera: se usa la general para todo.");

  const names = {};
  for (const m of [standings.all, standings.home, standings.away]) for (const [k, v] of Object.entries(m || {})) names[k] ||= v.team;
  const known = new Set(Object.keys(names));
  const games = parseGames(tables, known, (k) => names[k]);
  if (!games.length) warnings.push("No se encontraron partidos en la página de esta liga.");
  const noDate = games.filter((g) => !g.date).length;
  if (noDate) warnings.push(`${noDate} partido(s) sin fecha reconocida.`);

  const title = decode((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1] || "") || league.replace(/^serie_\d+_/, "").replace(/_/g, " ");

  return json(
    { ok: true, league, title, updated: new Date().toISOString(), standings, games, warnings },
    200,
    {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": "public, durable, s-maxage=900, stale-while-revalidate=3600",
      "Netlify-Vary": "query=league",
    }
  );
};

export const config = { path: "/api/basket" };
