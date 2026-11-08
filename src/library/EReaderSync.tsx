import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { KOSYNC_PATH } from "../../convex/shared";
import { copyText } from "../lib/clipboard";
import { Close } from "../ui/icons";

/** The KOReader sync API lives on the deployment's HTTP host (.convex.site, not .convex.cloud). */
const serverUrl = `${String(import.meta.env.VITE_CONVEX_URL ?? "").replace(/\.convex\.cloud\/?$/, ".convex.site")}${KOSYNC_PATH}`;

/** Setting up an e-reader (CrossPoint on the Xteink, or KOReader) to sync reading positions with Ribbon. */
export function EReaderSync({ onClose }: { onClose: () => void }) {
  const account = useQuery(api.kosync.account);
  const createKey = useAction(api.kosync.createKey);
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      setPassword((await createKey()).password);
    } catch {
      setError("The password could not be made. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-labelledby="reader-sync-title"
        className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="reader-sync-title" className="font-serif text-2xl font-medium">
            E-reader sync
          </h2>
          <button onClick={onClose} aria-label="Close" className="-mt-1 -mr-2 grid h-10 w-10 place-items-center rounded-full text-[var(--muted)] hover:text-[var(--fg)]">
            <Close />
          </button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          Your Xteink keeps its place in step with Ribbon through KOReader Sync. On the device, open its web settings page and fill in its CrossPoint Sync section with these.
        </p>

        <dl className="mt-5 space-y-3">
          <Field label="Server URL" value={serverUrl} />
          <Field label="Username" value={account?.username ?? "…"} />
          {password ? (
            <Field label="Password" value={password} note="Shown only now. Copy it to the device before closing this." />
          ) : (
            <div>
              <dt className="text-xs text-[var(--muted)]">Password</dt>
              <dd className="mt-1">
                <button
                  onClick={() => void make()}
                  disabled={busy || account === undefined}
                  className="rounded-full bg-[var(--ribbon)] px-4 py-2 text-sm font-medium text-[var(--on-ribbon)] disabled:opacity-60"
                >
                  {busy ? "Making password…" : account?.createdAt ? "Make a new password" : "Make a password"}
                </button>
                {account?.createdAt && (
                  <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
                    One was made on {new Date(account.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long" })}. A new one replaces it, so the device needs the new one too.
                  </p>
                )}
                {error && <p className="mt-2 text-sm text-[var(--ribbon)]">{error}</p>}
              </dd>
            </div>
          )}
        </dl>

        <p className="mt-6 border-t border-[var(--line)] pt-4 text-xs leading-relaxed text-[var(--muted)]">
          Books are matched by their file, so put the same EPUB on the device that you added here. With document matching set to Filename, keep its file name too; Binary matches even if it’s renamed.
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, note }: { label: string; value: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the value is selectable as text */
    }
  };
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 font-mono text-sm break-all select-all">{value}</code>
        <button onClick={() => void copy()} className="shrink-0 rounded-full border border-[var(--line)] px-3 py-2 text-sm">
          {copied ? "Copied" : "Copy"}
        </button>
      </dd>
      {note && <p className="mt-1.5 text-xs text-[var(--muted)]">{note}</p>}
    </div>
  );
}
