// A tiny stand-in for the Anthropic Messages API, for the learn e2e spec only: it never calls Claude.
import { createServer } from "node:http";

const port = Number(process.env.HUB_ANTHROPIC_STUB_PORT);

const grade = {
  grade: "A-",
  worked: "You led with what the client lost, in plain words.",
  fix: "End by checking they followed.",
  better: "Your site moved to a new home, and its address took about an hour to reach everyone.",
  resources: [
    { title: "Stub reading one", url: "https://example.com/one" },
    { title: "Stub reading two", url: "https://example.com/two" },
  ],
  jargonOpening: false,
  delivery: "Two filler words; about 130 words per minute; a clear opening.",
};

function reply(model, body) {
  return {
    id: "msg_stub",
    type: "message",
    role: "assistant",
    model,
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(body) }],
    usage: { input_tokens: 100, output_tokens: 100 },
  };
}

createServer((req, res) => {
  if (req.method === "GET") {
    res.writeHead(200).end("ok");
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let model = "claude-opus-5-5";
    try {
      model = JSON.parse(raw).model ?? model;
    } catch {}
    const body = model.includes("haiku")
      ? { accepted: raw.includes("STUB-ACCEPT"), feedback: raw.includes("STUB-ACCEPT") ? "Specific and from the article." : "Too general." }
      : grade;
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reply(model, body)));
  });
}).listen(port, "127.0.0.1");
