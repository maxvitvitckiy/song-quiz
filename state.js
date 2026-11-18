// @ts-check
// The host's game state, in one place. app.js runs the game; online.js follows it.
// Nothing in here touches the page, so tests/ can run it in Node.
//
// Phases (state.phase). Change them only with setPhase():
//   lobby    the setup screen
//   waiting  a round has started, its clip hasn't played yet
//   open     the clip has played; buzzers are open
//   reveal   the answer is showing
//   end      the final scores are showing
//
//   lobby → waiting → open → reveal → waiting → … → end → lobby
//   ("End game" jumps to end from any round.)
//
// Inside a round, each mode has one smaller state of its own:
//   party   state.pending  a box was guessed right and the host is choosing who got it
//   online  net.buzzer     a player is answering; Hear more and Give up wait (online.js)
//
// What happens is announced on `game`. app.js emits; online.js and app.js listen:
//   "phase"     (phase, before)  after every phase change
//   "start"                      a new game, before its first round
//   "hearMore"                   a longer clip was unlocked (state.step went up)
//   "scores"                     a score changed

/** @typedef {"party" | "solo" | "online"} Mode */
/** @typedef {{ name: string, score: number, online?: boolean }} Player */
/** @typedef {{ by: string | null, pts: number }} Solved  by: null when the host pressed "No points" */
/** @typedef {{ track: Track, title: Solved | null, artist: Solved | null }} RoundRecord */

const state = {
  phase: /** @type {Phase} */ ("lobby"),
  mode: /** @type {Mode} */ ("party"),           // of the game being played (pickedMode() is the setup screen's choice)

  // Setup
  sources: /** @type {Source[]} */ ([]),         // one per added playlist or album
  tracks: /** @type {Track[]} */ ([]),           // every playable song from all sources, once each (mergeTracks)
  partyPlayers: /** @type {Player[]} */ ([]),    // typed in on the setup screen
  steps: [2, 5, 10, 20],                         // clip lengths in seconds

  // The game
  queue: /** @type {Track[]} */ ([]),            // this game's songs, shuffled
  players: /** @type {Player[]} */ ([]),         // party roster or the online room (net.players)
  history: /** @type {RoundRecord[]} */ ([]),
  solo: { title: 0, artist: 0, streak: 0, best: 0 },
  soloPlayer: /** @type {Player} */ ({ name: "You", score: 0 }),

  // The round
  round: 0,                                      // 1-based once the game starts
  current: /** @type {Track | null} */ (null),
  step: 0,                                       // index into steps: how much has been heard
  offset: 0,                                     // where in the 30-second preview the clip starts
  solved: /** @type {Record<Field, Solved | null>} */ ({ title: null, artist: null }),
  pending: /** @type {Field | null} */ (null),       // party: waiting for "who got it?"
  queuedAward: /** @type {Field | null} */ (null),   // party: the other box was right at the same time
};

const game = new Emitter();

/** @param {Phase} phase */
function setPhase(phase) {
  const before = state.phase;
  state.phase = phase;
  game.emit("phase", phase, before);
}

const isSolo = () => state.mode === "solo";
const isOnline = () => state.mode === "online";
const onGameScreen = () => state.phase === "waiting" || state.phase === "open" || state.phase === "reveal";
const roundOver = () => state.phase !== "waiting" && state.phase !== "open";
const canHearMore = () => state.step < state.steps.length - 1;
const pointsForStep = (/** @type {number} */ step) => state.steps.length - step;
const unsolved = () => FIELDS.filter((f) => !state.solved[f]);
