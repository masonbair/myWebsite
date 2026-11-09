import { ImageResponse } from "next/og";

export const ogSize = { width: 1200, height: 630 };

// Palette from globals.css, inlined because next/og can't read CSS variables.
const canvas = "#f7f6fd";
const night = "#1f1d33";
const mute = "#4d4a68";
const accent = "#8783d1";
const accentInk = "#4f4aa8";
const tea = "#d1abad";
const rose = "#aa9aba";

/** Shared share-card layout: a big title and one line under it. Uses next/og's built-in font, so no font file ships. */
export function ogImage({ title, line }: { title: string; line: string }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: canvas,
          backgroundImage: `radial-gradient(${night}22 2px, transparent 2.5px)`,
          backgroundSize: "28px 28px",
          padding: "40px 52px 52px 40px",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            borderRadius: 28,
            background: "#fdfcff",
            border: `6px solid ${night}`,
            boxShadow: `14px 14px 0 ${night}`,
            padding: "56px 68px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                fontSize: 34,
                fontWeight: 700,
                color: night,
                border: `5px solid ${night}`,
                borderRadius: 16,
                padding: "4px 18px",
                background: "#fdfcff",
                boxShadow: `5px 5px 0 ${night}`,
                transform: "rotate(-2deg)",
              }}
            >
              mason bair
              <div style={{ width: 18, height: 36, marginLeft: 6, background: accent }} />
            </div>
            <div style={{ width: 40, height: 18, borderRadius: 9, border: `4px solid ${night}`, background: tea }} />
            <div style={{ width: 18, height: 18, borderRadius: 9, border: `4px solid ${night}`, background: rose }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 104, fontWeight: 700, letterSpacing: -5, color: night, lineHeight: 1 }}>{title}</div>
            <div style={{ marginTop: 28, fontSize: 38, color: mute, lineHeight: 1.3 }}>{line}</div>
          </div>
          <div style={{ fontSize: 30, fontWeight: 700, color: accentInk }}>masonbair.com</div>
        </div>
      </div>
    ),
    ogSize,
  );
}
