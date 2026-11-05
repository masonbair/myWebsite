const manifest = {
  id: "/hub/",
  name: "Mason's hub",
  short_name: "Hub",
  description: "Quick capture into Mason's inbox.",
  start_url: "/hub/capture",
  scope: "/hub/",
  display: "standalone",
  background_color: "#f7f6fd",
  theme_color: "#f7f6fd",
  icons: [
    { src: "/hub/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/hub/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/hub/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
  share_target: {
    action: "/hub/share",
    method: "POST",
    enctype: "multipart/form-data",
    params: { title: "title", text: "text", url: "url" },
  },
};

export function GET() {
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" },
  });
}
