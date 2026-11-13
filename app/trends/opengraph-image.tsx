import { ogImage, ogSize } from "@/lib/og";

export const alt = "What six newsletters talked about";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage({ title: "Newsletter trends", line: "What six newsletters Mason Bair reads talked about, day by day." });
}
