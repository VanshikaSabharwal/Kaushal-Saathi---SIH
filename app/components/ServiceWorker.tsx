"use client";

import { useEffect } from "react";

/** Registers public/sw.js, which keeps the app's files on the device for repeat visits. */
export default function ServiceWorker() {
  useEffect(() => {
    // Not in development: a cache in front of hot reload serves stale code.
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Not supported or blocked (private mode): the app works the same without it.
    });
  }, []);

  return null;
}
