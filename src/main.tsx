import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import App from "./App";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

const harness = new URLSearchParams(location.search).get("harness");

const root = createRoot(document.getElementById("root")!);

if (import.meta.env.DEV && harness?.startsWith("library")) {
  const { LibraryHarness } = await import("./dev/LibraryHarness");
  root.render(<LibraryHarness empty={harness === "library-empty"} />);
} else if (harness === "narration") {
  // Also on the live site: for trying voices and measuring a device's speed, no sign-in needed.
  const { NarrationHarness } = await import("./dev/NarrationHarness");
  root.render(<NarrationHarness />);
} else if (import.meta.env.DEV && harness) {
  const { Harness } = await import("./dev/Harness");
  root.render(<Harness name={harness} />);
} else {
  root.render(
    <StrictMode>
      {/* The ?code= that Google sends back is handled in <App>, so a refused account can be told why. */}
      <ConvexAuthProvider client={convex} shouldHandleCode={false}>
        <App />
      </ConvexAuthProvider>
    </StrictMode>,
  );
}
