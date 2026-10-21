// The squad from NOLA DFC Manager merged into roster.json. The manager is the source of truth for who is on
// the team, their names and shirt numbers; positions stay this site's own (the manager doesn't keep them).
// Players the manager no longer lists stay in the roster, because old lineups and pages still name them.
import type { Roster } from "../schema";

// jersey_number is text in the schema file but comes back as a number from the live database; take either.
export interface ManagerPlayer { id: string; first_name: string; last_name: string; jersey_number: string | number | null; status: string }
type Player = Roster["players"][number];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const numberOf = (j: string | number | null) => {
  const s = j == null ? "" : String(j).trim();
  return /^\d+$/.test(s) ? Number(s) : null;
};

export interface Merge {
  roster: Roster;
  added: string[];                 // new to the roster (positions to fill in)
  renamed: [from: string, to: string][];
  renumbered: [name: string, from: number | null, to: number | null][];
  notListed: string[];             // in the roster but not an active player in the manager
}

export function mergeRoster(current: Roster, managerPlayers: ManagerPlayer[]): Merge {
  const active = managerPlayers.filter(p => p.status === "active");
  const players: Player[] = current.players.map(p => ({ ...p }));
  const out: Merge = { roster: { players }, added: [], renamed: [], renumbered: [], notListed: [] };
  const claimed = new Set<Player>();
  for (const m of active) {
    const name = `${m.first_name} ${m.last_name}`.replace(/\s+/g, " ").trim();
    const num = numberOf(m.jersey_number);
    // Already linked; else the same name; else the same first name and shirt number (a corrected surname).
    const hit = players.find(p => p.managerId === m.id)
      ?? players.find(p => !claimed.has(p) && !p.managerId && fold(p.name) === fold(name))
      ?? players.find(p => !claimed.has(p) && !p.managerId && num != null && p.number === num && fold(p.name).split(" ")[0] === fold(m.first_name));
    if (!hit) {
      const p: Player = { name, number: num, positions: [], managerId: m.id };
      players.push(p); claimed.add(p); out.added.push(name);
      continue;
    }
    claimed.add(hit);
    hit.managerId = m.id;
    if (hit.name !== name) { out.renamed.push([hit.name, name]); hit.name = name; }
    // A blank number in the manager keeps the one here.
    if (num != null && hit.number !== num) { out.renumbered.push([name, hit.number ?? null, num]); hit.number = num; }
  }
  out.notListed = players.filter(p => !claimed.has(p)).map(p => p.name);
  return out;
}

/** roster.json in its hand-kept style: one player per line. */
export function formatRoster(r: Roster): string {
  const line = (p: Player) => {
    const parts = [`"name": ${JSON.stringify(p.name)}`];
    if (p.number != null) parts.push(`"number": ${p.number}`);
    parts.push(`"positions": [${p.positions.map(x => JSON.stringify(x)).join(",")}]`);
    if (p.managerId) parts.push(`"managerId": ${JSON.stringify(p.managerId)}`);
    return `    { ${parts.join(", ")} }`;
  };
  return `{\n  "players": [\n${r.players.map(line).join(",\n")}\n  ]\n}\n`;
}

/** lineups.json (or any JSON text) with each renamed player's name replaced, formatting kept. */
export function renameInJson(text: string, renamed: [string, string][]): string {
  return renamed.reduce((t, [from, to]) => t.split(JSON.stringify(from)).join(JSON.stringify(to)), text);
}
