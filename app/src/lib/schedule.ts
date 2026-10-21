// The team's schedule from NOLA DFC Manager (its team_events table, synced from the team calendar).
// tools/manager/manager.ts reads it with the service key and writes private/data/schedule.json; the build
// seals it into the scorekeeper's squad file so a new game can be set up from it in one tap, and the
// same matching links each finished breakdown back to its game in the manager's schedule.
import type { ScheduledGame } from "../schema";

/** A team_events row, as the manager stores it. */
export interface ManagerEvent {
  id: string;
  title: string | null;
  location: string | null;
  event_date: string | null;   // timestamptz
  event_type: string | null;   // 'league' | 'tournament' | 'friendly' | 'practice' | 'event'
  is_cancelled: boolean | null;
}

const GAME_TYPES = new Set(["league", "tournament", "friendly"]);
/** A tournament row stands for every game in it, up to this many days after its first. */
export const TOURNAMENT_DAYS = 3;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The calendar date and kickoff ("17:00") of an instant, where the team plays. */
export function localParts(iso: string, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso)).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * The opponent in a calendar title, and whether it's away. Feeds are typed by hand, so this reads the usual
 * shapes ("Game vs Opp", "Game @ Opp", "Team – Game – Opp", "Opp – Team") and gives up ("") on anything else.
 * Only "@" says where: "vs" is written for home and away games alike.
 */
export function parseTitle(title: string, teamNames: string[]): { opponent: string; home: boolean | null } {
  const ours = teamNames.map(fold).filter(Boolean);
  const isOurs = (s: string) => { const f = fold(s); return !f || ours.some(n => f === n || f.includes(n) || n.includes(f)); };
  const tidy = (s: string) => s.split(/\s+[–—-]\s+/)[0].replace(/\s*[([].*$/, "").trim();
  const t = title.replace(/^\(cancel+ed\)\s*/i, "").trim();
  const at = /(?:^|\s)@\s*(.+)$/.exec(t);
  if (at) { const o = tidy(at[1]); return { opponent: isOurs(o) ? "" : o, home: false }; }
  const vs = /(?:^|\s)(?:vs?\.?|versus)\s+(.+)$/i.exec(t);
  if (vs) { const o = tidy(vs[1]); return { opponent: isOurs(o) ? "" : o, home: null }; }
  // A matchup: our name on one side of a dash, theirs on the other.
  const parts = t.split(/\s+[–—-]\s+/).map(s => s.trim());
  const rest = parts.filter(s => !isOurs(s) && !/^(game|match|scrimmage|friendly)\b/i.test(s));
  const matchup = parts.length > 1 && parts.some(isOurs) && rest.length === 1;
  return { opponent: matchup ? rest[0].replace(/\s*[([].*$/, "").trim() : "", home: null };
}

/** The games in the manager's schedule, oldest first. Practices, team events and cancelled games are left out. */
export function toSchedule(events: ManagerEvent[], { timeZone, teamNames }: { timeZone: string; teamNames: string[] }): ScheduledGame[] {
  return events
    .filter(e => e.event_date && !e.is_cancelled && GAME_TYPES.has(e.event_type ?? ""))
    .map(e => {
      const { date, time } = localParts(e.event_date!, timeZone);
      const title = (e.title ?? "").trim();
      const tournament = e.event_type === "tournament";
      const { opponent, home } = tournament ? { opponent: "", home: null } : parseTitle(title, teamNames);
      return { eventId: e.id, date, time, title, opponent, home, location: (e.location ?? "").trim(), tournament };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Scheduled games to offer when setting up a game on `today`: today's first, then the next few days'. */
export function upcoming(schedule: ScheduledGame[], today: string, days = 6, max = 4): ScheduledGame[] {
  const until = addDays(today, days);
  return schedule.filter(g => g.date >= today && g.date <= until).slice(0, max);
}

/**
 * The scheduled game a game file is about: same date and opponent, else the only game that day, else a
 * tournament running that day (its row covers every game in it). Null when it can't tell.
 */
export function matchGame(game: { date: string; opponent: string; time?: string }, schedule: ScheduledGame[]): ScheduledGame | null {
  const opp = fold(game.opponent);
  const sameDay = schedule.filter(s => !s.tournament && s.date === game.date);
  // "BRSC Red" in the file finds "Game vs BRSC Red" in the calendar, and "BRSC" finds "BRSC Red".
  const named = !opp ? [] : sameDay.filter(s => {
    const o = fold(s.opponent);
    return fold(s.title).includes(opp) || (!!o && (o.includes(opp) || opp.includes(o)));
  });
  if (named.length === 1) return named[0];
  if (named.length > 1) return named.find(s => s.time === game.time) ?? null;
  if (sameDay.length === 1) return sameDay[0];
  if (sameDay.length > 1) return sameDay.find(s => !!game.time && s.time === game.time) ?? null;
  const cups = schedule.filter(s => s.tournament && s.date <= game.date && game.date <= addDays(s.date, TOURNAMENT_DAYS));
  return cups.length === 1 ? cups[0] : null;
}
