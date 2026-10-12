// UI strings in English and Spanish. Game content carries its own { en, es } (schema Text).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { EventType, Text } from "./schema";

export type Lang = "en" | "es";
const LANG_KEY = "dfc-film-lang";

const en = {
  appTitle: "Game film",
  library: "Game film library",
  teamOnly: "Team only",
  teamPassword: "Team password",
  keepSignedIn: "Keep me signed in on this device",
  showPassword: "Show password",
  open: "Open",
  checking: "Checking…",
  badPassword: "That password didn't work. Check it with your coach and try again.",
  loading: "Loading…",
  loadFailed: "Couldn't load this page. Check your connection and try again.",
  retry: "Try again",
  lock: "Lock",
  language: "Español",
  languageLabel: "Ver en español",
  allGames: "All games",
  gamesReviewed: "games reviewed",
  record: "W-D-L",
  goalsFor: "Goals",
  listIntro: "Newest first · highlights to watch, the play-by-play to follow along, the breakdown for what to train",
  listFooter: "Highlights are the key moments of each game. Each play-by-play lists every logged moment with its time in the full recording. Each coaches' breakdown covers the game by third of the field and by unit, with a training plan.",
  vs: "vs",
  playByPlay: "Play-by-play",
  coachesBreakdown: "Coaches' breakdown",
  highlights: "Highlights",
  matchReport: "Match report",
  notFound: "That game isn't in the library.",
  // play-by-play
  filterEvents: "Filter events",
  team: "Team",
  both: "Both",
  show: "Show",
  everything: "Everything",
  goals: "Goals",
  shotsGoals: "Shots & goals",
  turnovers: "Turnovers",
  ballWins: "Ball wins",
  passesRuns: "Passes & runs",
  setPieces: "Set pieces, fouls & cards",
  eventsShown: "{n} of {total} events",
  colClock: "Clock", colGame: "Game", colVideo: "Video", colClip: "Clip @ time in clip", colEvent: "Event", colWhat: "What happened",
  nothingLogged: "Nothing logged in this half for that filter.",
  onTarget: "on target",
  offTarget: "off target",
  half1: "1st half", half2: "2nd half",
  sections: "Sections",
  // report
  fullTime: "Full time",
  halfTime: "Half time",
  story: "Story", numbers: "Numbers", takeaways: "Takeaways", clips: "Clips",
  shotAbove: "{team} shot (above)",
  shotBelow: "{team} shot (below)",
  largeGoal: "Large marker = goal",
  timelineLabel: "Shot timeline. {us} shots above the line, opponent shots below. Goals marked with the score.",
  statGoals: "Goals", statShots: "Shots logged", statOn: "On target", statTurnovers: "Gave ball away", statWins: "Ball wins", statCards: "Cards",
  vid: "vid",
  ht: "HT",
  // coaches
  priorities: "Priorities", byThird: "By third", byUnit: "By unit", trainingPlan: "Training plan",
  priority: "Priority {n}",
  priHigh: "High", priMed: "Medium", priLow: "Low",
  keepDoing: "Keep doing",
  coachIt: "Coach it:",
  attackDir: "{us} attack →",
  pitchLabel: "Pitch split into thirds with the top priority for each.",
  colTopic: "Topic", colMoment: "Moment", colAt: "At", colUnit: "Unit",
  // highlights
  loadClip: "Load clip · {mb} MB",
  loadingClip: "Loading…",
  decrypting: "Decrypting…",
  clipFailed: "Couldn't load. Tap to retry",
  fullVideo: "Full video {from}–{to}",
  tag_Goal: "Goal", tag_Conceded: "Conceded", tag_Save: "Save", tag_Chance: "Chance", "tag_Build-up": "Build-up",
  tag_Defending: "Defending", tag_Card: "Card", "tag_Set piece": "Set piece",
  // notes
  coach: "Coach",
  coachSignIn: "Coach sign-in",
  coachPassword: "Coach password",
  coachSignInHelp: "Coaches only. Notes are encrypted on this device before they're saved.",
  signIn: "Sign in",
  signOut: "Sign out",
  cancel: "Cancel",
  close: "Close",
  notes: "Notes",
  notesFor: "Coach notes",
  gameNote: "Whole game",
  addNote: "Add note",
  addNoteHere: "Add a note",
  notePlaceholder: "Write a note for the coaching staff…",
  author: "Signed as (optional)",
  authorPlaceholder: "e.g. Head coach",
  save: "Save",
  saving: "Saving…",
  edit: "Edit",
  delete: "Delete",
  confirmDelete: "Delete this note?",
  noNotes: "No notes yet.",
  notesError: "Couldn't reach the notes service. Try again in a moment.",
  notesSetup: "Coach notes aren't set up yet.",
  badCoachPassword: "That coach password didn't work.",
  updated: "Updated {when}",
  noteOn: "On: {what}",
} as const;

export type Key = keyof typeof en;

const es: Record<Key, string> = {
  appTitle: "Vídeos de partidos",
  library: "Biblioteca de partidos",
  teamOnly: "Solo el equipo",
  teamPassword: "Contraseña del equipo",
  keepSignedIn: "Mantener la sesión iniciada en este dispositivo",
  showPassword: "Mostrar contraseña",
  open: "Entrar",
  checking: "Comprobando…",
  badPassword: "Esa contraseña no funciona. Confírmala con tu entrenador y vuelve a intentarlo.",
  loading: "Cargando…",
  loadFailed: "No se pudo cargar esta página. Revisa tu conexión y vuelve a intentarlo.",
  retry: "Reintentar",
  lock: "Bloquear",
  language: "English",
  languageLabel: "View in English",
  allGames: "Todos los partidos",
  gamesReviewed: "partidos analizados",
  record: "G-E-P",
  goalsFor: "Goles",
  listIntro: "Del más reciente al más antiguo · resúmenes para ver, la crónica minuto a minuto para seguir el partido, el análisis para saber qué entrenar",
  listFooter: "Los resúmenes son los momentos clave de cada partido. Cada crónica minuto a minuto recoge cada momento registrado con su tiempo en la grabación completa. Cada análisis de los entrenadores repasa el partido por tercio del campo y por línea, con un plan de entrenamiento.",
  vs: "vs",
  playByPlay: "Minuto a minuto",
  coachesBreakdown: "Análisis de los entrenadores",
  highlights: "Resumen",
  matchReport: "Crónica del partido",
  notFound: "Ese partido no está en la biblioteca.",
  filterEvents: "Filtrar jugadas",
  team: "Equipo",
  both: "Ambos",
  show: "Mostrar",
  everything: "Todo",
  goals: "Goles",
  shotsGoals: "Tiros y goles",
  turnovers: "Pérdidas",
  ballWins: "Recuperaciones",
  passesRuns: "Pases y carreras",
  setPieces: "Balón parado, faltas y tarjetas",
  eventsShown: "{n} de {total} jugadas",
  colClock: "Reloj", colGame: "Minuto", colVideo: "Vídeo", colClip: "Clip @ tiempo en el clip", colEvent: "Jugada", colWhat: "Qué pasó",
  nothingLogged: "No hay nada registrado en esta parte con ese filtro.",
  onTarget: "a puerta",
  offTarget: "fuera",
  half1: "1.ª parte", half2: "2.ª parte",
  sections: "Secciones",
  fullTime: "Final",
  halfTime: "Descanso",
  story: "Resumen", numbers: "Números", takeaways: "Conclusiones", clips: "Clips",
  shotAbove: "Tiro de {team} (arriba)",
  shotBelow: "Tiro de {team} (abajo)",
  largeGoal: "Marcador grande = gol",
  timelineLabel: "Cronología de tiros. Tiros de {us} por encima de la línea, del rival por debajo. Los goles llevan el marcador.",
  statGoals: "Goles", statShots: "Tiros registrados", statOn: "A puerta", statTurnovers: "Balones perdidos", statWins: "Recuperaciones", statCards: "Tarjetas",
  vid: "víd",
  ht: "Desc.",
  priorities: "Prioridades", byThird: "Por tercio", byUnit: "Por línea", trainingPlan: "Plan de entrenamiento",
  priority: "Prioridad {n}",
  priHigh: "Alta", priMed: "Media", priLow: "Baja",
  keepDoing: "Seguir haciendo",
  coachIt: "Cómo entrenarlo:",
  attackDir: "{us} ataca →",
  pitchLabel: "Campo dividido en tercios con la prioridad principal de cada uno.",
  colTopic: "Tema", colMoment: "Momento", colAt: "Tiempo", colUnit: "Línea",
  loadClip: "Cargar clip · {mb} MB",
  loadingClip: "Cargando…",
  decrypting: "Descifrando…",
  clipFailed: "No se pudo cargar. Toca para reintentar",
  fullVideo: "Vídeo completo {from}–{to}",
  tag_Goal: "Gol", tag_Conceded: "Gol en contra", tag_Save: "Parada", tag_Chance: "Ocasión", "tag_Build-up": "Construcción",
  tag_Defending: "Defensa", tag_Card: "Tarjeta", "tag_Set piece": "Balón parado",
  coach: "Entrenador",
  coachSignIn: "Acceso de entrenadores",
  coachPassword: "Contraseña de entrenadores",
  coachSignInHelp: "Solo entrenadores. Las notas se cifran en este dispositivo antes de guardarse.",
  signIn: "Entrar",
  signOut: "Salir",
  cancel: "Cancelar",
  close: "Cerrar",
  notes: "Notas",
  notesFor: "Notas de los entrenadores",
  gameNote: "Todo el partido",
  addNote: "Añadir nota",
  addNoteHere: "Añadir una nota",
  notePlaceholder: "Escribe una nota para el cuerpo técnico…",
  author: "Firmado como (opcional)",
  authorPlaceholder: "p. ej. Entrenador principal",
  save: "Guardar",
  saving: "Guardando…",
  edit: "Editar",
  delete: "Borrar",
  confirmDelete: "¿Borrar esta nota?",
  noNotes: "Todavía no hay notas.",
  notesError: "No se pudo conectar con el servicio de notas. Inténtalo de nuevo en un momento.",
  notesSetup: "Las notas de los entrenadores aún no están configuradas.",
  badCoachPassword: "Esa contraseña de entrenadores no funciona.",
  updated: "Actualizada {when}",
  noteOn: "Sobre: {what}",
};

const EVENT_ES: Record<EventType, string> = {
  Kickoff: "Saque inicial", "Half time": "Descanso", "Full time": "Final", Restart: "Reanudación",
  Goal: "Gol", Shot: "Tiro", Save: "Parada", Turnover: "Pérdida", "Ball win": "Recuperación", Pass: "Pase", Run: "Carrera",
  Corner: "Córner", "Throw-in": "Saque de banda", "Free kick": "Tiro libre", Foul: "Falta", Yellow: "Amarilla", Red: "Roja", Sub: "Cambio",
};
const EVENT_EN: Partial<Record<EventType, string>> = { Yellow: "Yellow card", Red: "Red card" };

const DICT = { en, es };

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key, vars?: Record<string, string | number>) => string;
  tx: (text: Text) => string;
  ev: (y: EventType) => string;
  /** "2H 12:54" → "2.ª 12:54" in Spanish. */
  halfRef: (s: string) => string;
  locale: string;
}

const Ctx = createContext<I18n | null>(null);

function initialLang(): Lang {
  try {
    const s = localStorage.getItem(LANG_KEY);
    if (s === "en" || s === "es") return s;
  } catch { /* storage blocked */ }
  return navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const value = useMemo<I18n>(() => ({
    lang,
    setLang: l => { setLangState(l); try { localStorage.setItem(LANG_KEY, l); } catch { /* storage blocked */ } },
    t: (k, vars) => (DICT[lang][k] ?? en[k]).replace(/\{(\w+)\}/g, (_, v) => String(vars?.[v] ?? "")),
    tx: text => text[lang] || text.en,
    ev: y => (lang === "es" ? EVENT_ES[y] : EVENT_EN[y] ?? y),
    halfRef: s => (lang === "es" ? s.replace(/\b([12])H\b/g, "$1.ª") : s),
    locale: lang === "es" ? "es-US" : "en-GB",
  }), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}

export function formatDate(iso: string, locale: string, style: "long" | "short" = "long") {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat(locale, style === "long"
    ? { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
    : { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(dt);
}
