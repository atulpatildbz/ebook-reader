// Reading the open book aloud, for the Reader: the narrator's lifecycle, the player's state, and
// the room the player needs at the bottom of the page.
import { useEffect, useRef, useState } from "react";
import { text, type FoliateView } from "../../lib/foliate";
import { setSettings, useSettings } from "../../lib/settings";
import { Narrator, type NarrationState } from "./narrator";

export function useNarration(
  view: FoliateView | null,
  opts: {
    title: string;
    author: string;
    color: string;
    /** Narration turns pages as it goes, which counts as reading: the position syncs. */
    onTurn: () => void;
    /** Whether the reader has just touched, scrolled or keyed. */
    userActive: () => boolean;
  },
) {
  const { narrationVoice: voice, narrationRate: rate } = useSettings();
  const narrator = useRef<Narrator | null>(null);
  const [listening, setListening] = useState(false); // the player is showing
  const [state, setState] = useState<NarrationState>({ status: "idle", engine: null, speed: null, ahead: null, left: null, stalls: 0, download: null, error: null });
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
      ribbon: optsRef.current.color,
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

  useEffect(() => narrator.current?.setColor(opts.color), [opts.color, view]);

  // Room is made at once when the player grows, and given back only once it has stayed smaller for
  // a while, so a passing message doesn't reflow the page twice.
  useEffect(() => {
    const want = listening ? playerRoom : 0;
    if (want >= room) {
      if (want > room) setRoom(want);
      return;
    }
    const t = window.setTimeout(() => setRoom(want), listening ? 4000 : 0);
    return () => window.clearTimeout(t);
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
