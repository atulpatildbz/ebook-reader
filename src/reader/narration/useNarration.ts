// Reading the open book aloud, for the Reader: the narrator's lifecycle, the player's state, and
// the room the player needs at the bottom of the page.
import { useEffect, useRef, useState } from "react";
import { text, type FoliateView } from "../../lib/foliate";
import { setSettings, useSettings } from "../../lib/settings";
import { IDLE, Narrator } from "./narrator";
import { DEFAULT_VOICE } from "./voices";

export function useNarration(
  view: FoliateView | null,
  opts: {
    title: string;
    author: string;
    /** Narration turns pages as it goes, which counts as reading: the position syncs. */
    onTurn: () => void;
    /** Whether the reader has just touched, scrolled or keyed. */
    userActive: () => boolean;
  },
) {
  const { narrationVoice: voice = DEFAULT_VOICE, narrationRate: rate } = useSettings();
  const narrator = useRef<Narrator | null>(null);
  const [listening, setListening] = useState(false); // the player is showing
  const [state, setState] = useState(IDLE);
  const [playerRoom, setPlayerRoom] = useState(0);
  const [room, setRoom] = useState(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!view) return;
    const n = new Narrator(view, {
      get title() {
        return optsRef.current.title;
      },
      get author() {
        return optsRef.current.author;
      },
      lang: text(view.book.metadata?.language) || "en",
      onChange: setState,
      onTurn: () => optsRef.current.onTurn(),
      userActive: () => optsRef.current.userActive(),
    });
    narrator.current = n;
    return () => {
      n.destroy();
      narrator.current = null;
      setListening(false);
    };
  }, [view]);

  // While listening, room is only ever added (to the most the player has needed), so messages
  // coming and going don't lay the page out again each time; it's all given back on closing.
  // Each change lays the page out again, around what's being read so it stays on screen.
  useEffect(() => {
    const want = listening ? Math.max(room, playerRoom) : 0;
    if (want === room) return;
    let cancelled = false;
    void (narrator.current?.holdPlace() ?? Promise.resolve()).then(() => !cancelled && setRoom(want));
    return () => {
      cancelled = true;
    };
  }, [listening, playerRoom, room]);

  return {
    state,
    listening,
    /** px at the bottom of the screen the player covers. */
    room,
    voice,
    rate,
    listen() {
      setListening(true);
      void narrator.current?.play(voice, rate);
    },
    toggle() {
      const n = narrator.current;
      if (!n) return;
      if (state.status === "playing" || state.status === "loading") n.pause();
      else void n.play(voice, rate);
    },
    skip: (d: number) => narrator.current?.skip(d),
    readFrom: (range: Range) => void narrator.current?.playFrom(range, voice, rate),
    setRate(r: number) {
      setSettings({ narrationRate: r });
      narrator.current?.setRate(r);
    },
    setVoice(v: string) {
      setSettings({ narrationVoice: v });
      narrator.current?.setVoice(v);
    },
    close() {
      narrator.current?.stop();
      setListening(false);
    },
    setPlayerRoom,
  };
}
