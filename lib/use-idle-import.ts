import { useEffect, useState } from "react";

// Starts anyway if the load event is held up, e.g. by a slow third-party request.
const LOAD_FALLBACK_MS = 4000;

/** Runs `importer` once the page has loaded and the browser is idle, so the module stays off the first load; null until then or if it fails. */
export function useIdleImport<T>(importer: () => Promise<T>): T | null {
  const [mod, setMod] = useState<T | null>(null);
  useEffect(() => {
    let started = false;
    let alive = true;
    const load = () => {
      if (started) return;
      started = true;
      importer()
        .then((m) => alive && setMod(() => m))
        .catch(() => {
          // A failed chunk leaves the placeholder, which still reads fine.
        });
    };
    const idle = () => (window.requestIdleCallback ?? setTimeout)(load);
    const fallback = setTimeout(load, LOAD_FALLBACK_MS);
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
    return () => {
      alive = false;
      clearTimeout(fallback);
      window.removeEventListener("load", idle);
    };
    // The importer is a fixed module path; running once is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return mod;
}
