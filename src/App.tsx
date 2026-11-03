import { useEffect, useRef, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import { useApplyTheme, useTheme } from "./lib/settings";
import { useRoute } from "./lib/route";
import { Library } from "./components/Library";
import { SyncedReader } from "./components/Reader";
import { RibbonMark } from "./components/icons";

function errorText(e: unknown) {
  return e instanceof Error ? `${e.message} ${String((e as { data?: unknown }).data ?? "")}` : String(e);
}

/** Finishes a Google sign-in when the page comes back with ?code=… */
function useOAuthCode(onRefused: () => void) {
  const { signIn } = useAuthActions();
  const [busy, setBusy] = useState(() => new URL(location.href).searchParams.has("code"));
  const done = useRef(false);
  useEffect(() => {
    const url = new URL(location.href);
    const code = url.searchParams.get("code");
    if (!code || done.current) return;
    done.current = true;
    url.searchParams.delete("code");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    (signIn as unknown as (p: undefined, o: { code: string }) => Promise<unknown>)(undefined, { code })
      .catch((e) => {
        console.error(e);
        if (errorText(e).includes("not-allowed")) onRefused();
      })
      .finally(() => setBusy(false));
  }, [signIn, onRefused]);
  return busy;
}

export default function App() {
  const theme = useTheme();
  useApplyTheme(theme);
  const { isLoading, isAuthenticated } = useConvexAuth();
  const [refused, setRefused] = useState(false);
  const finishing = useOAuthCode(() => setRefused(true));
  const me = useQuery(api.books.me, isAuthenticated ? {} : "skip");
  const route = useRoute();

  if (isLoading || finishing || (isAuthenticated && me === undefined)) return <Splash />;
  if (!isAuthenticated) return <SignIn refused={refused} />;
  if (!me) return <NoAccess />;
  return route.name === "read" ? <SyncedReader key={route.bookId} bookId={route.bookId} /> : <Library me={me} />;
}

function Splash() {
  return (
    <div className="grid h-dvh place-items-center">
      <RibbonMark className="h-10 w-10 animate-pulse text-[var(--ribbon)]" />
    </div>
  );
}

function SignIn({ refused }: { refused: boolean }) {
  const { signIn } = useAuthActions();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await signIn("google", { redirectTo: location.origin + location.pathname });
    } catch (e) {
      console.error(e);
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <RibbonMark className="mb-8 h-12 w-12 text-[var(--ribbon)]" />
      <h1 className="font-serif text-4xl leading-tight font-medium tracking-tight">Ribbon</h1>
      <p className="mt-3 text-lg leading-relaxed text-[var(--muted)]">
        Your books, on every device, right where you left off.
      </p>
      {refused && (
        <p role="alert" className="mt-8 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3 leading-relaxed">
          That Google account doesn’t have access to this library. Sign in with the account it belongs to.
        </p>
      )}
      <button
        onClick={go}
        disabled={busy}
        className="mt-10 inline-flex items-center justify-center gap-3 self-start rounded-full bg-[var(--fg)] px-6 py-3 text-[var(--bg)] font-medium transition-opacity disabled:opacity-60"
      >
        <GoogleG />
        {busy ? "Opening Google…" : "Sign in with Google"}
      </button>
    </main>
  );
}

function NoAccess() {
  const { signOut } = useAuthActions();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <h1 className="font-serif text-3xl font-medium">This account no longer has access</h1>
      <p className="mt-3 leading-relaxed text-[var(--muted)]">Sign out and sign in with the account this library belongs to.</p>
      <button onClick={() => void signOut()} className="mt-8 self-start rounded-full border border-[var(--line)] px-5 py-2.5">
        Sign out
      </button>
    </main>
  );
}

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
