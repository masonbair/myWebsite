import { ogImage, ogSize } from "@/lib/og";

export const alt = "Mason Bair, software engineer";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage({ title: "Mason Bair", line: "Software engineer and digital nomad." });
}
