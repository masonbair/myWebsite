// A route handler, not a page, because Next sends a thrown notFound() as an empty body that only JavaScript fills.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Page not found | Hub</title>
<style>
:root { --canvas: #f7f6fd; --surface: #fdfcff; --ink: #1f1d33; --mute: #4d4a68; --accent-ink: #4f4aa8; --line: #1f1d33; --shadow: #1f1d33; --dot: rgb(31 29 51 / 0.12); }
@media (prefers-color-scheme: dark) {
  :root { color-scheme: dark; --canvas: #15142a; --surface: #221f3b; --ink: #f3f2fb; --mute: #bdbad8; --accent-ink: #b9b6f2; --line: #e9e7fb; --shadow: #8783d1; --dot: rgb(233 231 251 / 0.08); }
}
body { margin: 0; padding: 4rem 1rem; background: var(--canvas) radial-gradient(var(--dot) 1.2px, transparent 1.3px) 0 0 / 18px 18px; color: var(--ink); font-family: "Space Grotesk", ui-sans-serif, system-ui, sans-serif; }
main { max-width: 28rem; margin: 0 auto; padding: 2rem; border: 2.5px solid var(--line); border-radius: 18px; background: var(--surface); box-shadow: 5px 5px 0 var(--shadow); }
h1 { margin: 0; font-size: 1.875rem; font-weight: 700; letter-spacing: -0.04em; }
p { color: var(--mute); }
a { color: var(--accent-ink); font-weight: 700; text-underline-offset: 4px; }
</style>
</head>
<body>
<main>
<h1>Page not found</h1>
<p>This page does not exist, or the account you signed in with cannot see it.</p>
<a href="/hub/login">Sign in with another account</a>
</main>
</body>
</html>
`;

export function GET(): Response {
  return new Response(PAGE, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
}
