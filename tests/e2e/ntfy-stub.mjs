// Preloaded into bin/hub by the dry run, so phone pings reach the spec's local stub and never ntfy.sh.
const stubUrl = process.env.NTFY_STUB_URL;
if (!stubUrl) throw new Error("NTFY_STUB_URL must be set when ntfy-stub.mjs is preloaded");

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  return url.startsWith("https://ntfy.sh") ? realFetch(stubUrl, init) : realFetch(input, init);
};
