import { SignInButton } from "./SignInButton";

export default async function LoginPage({ searchParams }: PageProps<"/hub/login">) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto mt-16 max-w-md rounded-tile bg-surface p-8 shadow-tile">
      <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-3 text-mute">This part of the site is private. Sign in with GitHub to continue.</p>
      {error && (
        <p role="alert" className="mt-4 text-sm font-medium text-accent-ink">
          Sign in did not finish. Please try again.
        </p>
      )}
      <SignInButton />
    </main>
  );
}
