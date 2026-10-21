// The squad and lineups: coach password only, so both load with the coach-area key.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useNotes } from "./notes";
import type { GameEvent, Lineups, PublicGame, Roster } from "./schema";
import { useSite } from "./site";
import { halfLengths, lineupFor, playLineup, playSec } from "./lib/lineup";
import { nameMoment } from "./lib/naming";
import { playerLabel, type RosterPlayer } from "./lib/positions";

/** The squad list, if one is published; a roster that won't load just leaves the tooltips plain. */
export function useRoster() {
  const { contentKey } = useNotes();
  const { loadRoster } = useSite();
  const [roster, setRoster] = useState<Roster | null>(null);
  useEffect(() => {
    if (!contentKey) { setRoster(null); return; }
    let live = true;
    loadRoster(contentKey).then(r => live && setRoster(r), () => live && setRoster(null));
    return () => { live = false; };
  }, [contentKey, loadRoster]);
  return roster;
}

/** Every game's lineup; null until loaded or when none is published. */
export function useLineups() {
  const { contentKey } = useNotes();
  const { loadLineups } = useSite();
  const [lineups, setLineups] = useState<Lineups | null>(null);
  useEffect(() => {
    if (!contentKey) { setLineups(null); return; }
    let live = true;
    loadLineups(contentKey).then(l => live && setLineups(l), () => live && setLineups(null));
    return () => { live = false; };
  }, [contentKey, loadLineups]);
  return lineups;
}

type Namer = (e: Pick<GameEvent, "h" | "c" | "t">, text: string) => string;

/** For a game with a confirmed lineup (coach area only): swaps positions in a moment's description for
 *  the player who held them. Null for estimated lineups, or without the coach password. */
export function useNamer(g: PublicGame): Namer | null {
  const roster = useRoster();
  const lineups = useLineups();
  return useMemo(() => {
    const r = lineupFor(lineups, g.slug);
    if (!r || r.estimated || !roster) return null;
    const len = halfLengths(g);
    const { stints } = playLineup(r.lineup, len);
    return (e, text) => (e.t === "N" ? text : nameMoment(text, stints, playSec(len, e.h, e.c), g.opponent, p => p));
  }, [roster, lineups, g]);
}

/** Provided by a page that shows a game's moments; rows read it to name players. */
export const NamerContext = createContext<Namer | null>(null);
export function useNamed(): Namer {
  const n = useContext(NamerContext);
  return n ?? ((_, text) => text);
}

/** "#7 Alex Smith" for a name in the roster, or the bare name. */
export function labelOf(players: RosterPlayer[] | undefined, name: string) {
  const p = players?.find(x => x.name === name);
  return p ? playerLabel(p) : name;
}

/** A URL-safe id for a player page: "alex-smith". */
export const playerId = (name: string) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
