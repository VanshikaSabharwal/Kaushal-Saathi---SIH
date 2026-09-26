"use client";

/**
 * The last resort, for a crash in the root layout itself. It replaces the
 * whole document, so it carries its own minimal styling.
 */

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const detail = [error.name, error.message, error.digest && `digest ${error.digest}`].filter(Boolean).join(": ");

  return (
    <html lang="hi">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "40px 16px", textAlign: "center", background: "#faf8f5", color: "#1f2937" }}>
        <title>कौशल साथी</title>
        <p style={{ fontSize: 20, fontWeight: 600 }}>यह पेज खुल नहीं पाया।</p>
        <p>
          <button onClick={() => retry()} style={{ fontSize: 18, padding: "12px 20px", margin: 4, borderRadius: 12, border: 0, background: "#2e3a8c", color: "#fff" }}>
            फिर कोशिश करें
          </button>
          <button onClick={() => window.location.reload()} style={{ fontSize: 18, padding: "12px 20px", margin: 4, borderRadius: 12, border: "2px solid #2e3a8c", background: "#fff", color: "#2e3a8c" }}>
            पेज फिर से लोड करें
          </button>
        </p>
        <p translate="no" style={{ fontFamily: "monospace", fontSize: 12, color: "#6b7280", wordBreak: "break-word", maxWidth: 520, margin: "16px auto" }}>
          {detail || "Unknown error"}
        </p>
      </body>
    </html>
  );
}
