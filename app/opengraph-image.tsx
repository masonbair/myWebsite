import { ogImage, ogSize } from "@/lib/og";

export const alt = "Mason Bair, forward deployed engineer";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage({ title: "Mason Bair", line: "Forward deployed engineer and digital nomad." });
}
