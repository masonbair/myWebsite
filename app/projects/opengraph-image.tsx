import { ogImage, ogSize } from "@/lib/og";

export const alt = "Mason Bair's projects and hackathon wins";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage({ title: "Projects", line: "Apps, games and hackathon wins by Mason Bair." });
}
