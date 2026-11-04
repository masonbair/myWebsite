import { ImageResponse } from "next/og";

export const ogSize = { width: 1200, height: 630 };

// Palette from globals.css, inlined because next/og can't read CSS variables.
const canvas = "#f7f6fd";
const night = "#1f1d33";
const mute = "#5d5a78";
const accentInk = "#5b56b5";
const tea = "#d1abad";
const rose = "#aa9aba";

/** Shared share-card layout: a big title and one line under it. Uses next/og's built-in font, so no font file ships. */
export function ogImage({ title, line }: { title: string; line: string }) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: canvas, padding: 24 }}>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            borderRadius: 40,
            background: "#fdfcff",
            border: `2px solid ${rose}55`,
            padding: "64px 72px",
          }}
        >
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 56, height: 14, borderRadius: 7, background: accentInk }} />
            <div style={{ width: 28, height: 14, borderRadius: 7, background: tea }} />
            <div style={{ width: 14, height: 14, borderRadius: 7, background: rose }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 104, fontWeight: 700, letterSpacing: -4, color: night, lineHeight: 1 }}>{title}</div>
            <div style={{ marginTop: 28, fontSize: 38, color: mute, lineHeight: 1.3 }}>{line}</div>
          </div>
          <div style={{ fontSize: 30, color: accentInk }}>masonbair.com</div>
        </div>
      </div>
    ),
    ogSize,
  );
}
