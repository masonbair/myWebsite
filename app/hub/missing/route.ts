// A route handler, not a page, because Next sends a thrown notFound() as an empty body that only JavaScript fills.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Page not found | Hub</title>
<style>
:root { --canvas: #f7f6fd; --surface: #fdfcff; --ink: #1f1d33; --mute: #5d5a78; --accent-ink: #5b56b5; }
@media (prefers-color-scheme: dark) {
  :root { color-scheme: dark; --canvas: #121120; --surface: #1b1a2e; --ink: #ecebf7; --mute: #a9a6c6; --accent-ink: #a6a3e3; }
}
body { margin: 0; padding: 4rem 1rem; background: var(--canvas); color: var(--ink); font-family: ui-sans-serif, system-ui, sans-serif; }
main { max-width: 28rem; margin: 0 auto; padding: 2rem; border-radius: 1.5rem; background: var(--surface); box-shadow: 0 12px 40px -12px rgb(135 131 209 / 0.28); }
h1 { margin: 0; font-size: 1.875rem; font-weight: 600; letter-spacing: -0.025em; }
p { color: var(--mute); }
a { color: var(--accent-ink); font-weight: 500; text-underline-offset: 4px; }
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
