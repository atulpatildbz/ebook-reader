// Which keys turn the page. Separate so the rules can be written down in tests/spec/page-keys.json.

/** What the key was pressed on: the page itself, a button or link, or a control that uses keys. */
type KeyTarget = "page" | "button" | "field";

export function keyTarget(target: EventTarget | null): KeyTarget {
  const el = target as Partial<Element> | null;
  if (el?.closest?.("input,select,textarea,[contenteditable]")) return "field";
  if (el?.closest?.("button,a[href],summary,[role=button]")) return "button";
  return "page";
}

export function pageKey(key: string, shift: boolean, target: KeyTarget, panelOpen: boolean): "left" | "right" | "next" | "prev" | null {
  if (panelOpen || target === "field") return null;
  if (key === " " && target === "button") return null; // presses the button
  if (key === "ArrowLeft" || key === "h") return "left";
  if (key === "ArrowRight" || key === "l") return "right";
  if (key === "PageDown" || (key === " " && !shift) || key === "j") return "next";
  if (key === "PageUp" || (key === " " && shift) || key === "k") return "prev";
  return null;
}
