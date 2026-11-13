import { role, roleLower } from "@/content/site";
import { ogImage, ogSize } from "@/lib/og";

export const alt = `Mason Bair, ${roleLower}`;
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage({ title: "Mason Bair", line: `${role.title} and digital nomad.` });
}
