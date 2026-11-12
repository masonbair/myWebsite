/** Only what the board already shows publicly; the terminal can never say more than the tiles do. */
export type TerminalData = {
  place: string | null;
  countries: number;
  projects: { name: string; url: string }[];
  contributions30d: number | null;
};

const MAX_ECHO = 40;

const HELP = [
  "whereami     where I am right now",
  "ls projects  my live side projects",
  "whoami       the short version of me",
  "coffee       grab a time to chat",
  "clear        wipe the screen",
];

function whereami(d: TerminalData): string[] {
  const countries = `${d.countries} ${d.countries === 1 ? "country" : "countries"} so far.`;
  return [d.place ? `${d.place}. ${countries}` : `Somewhere new. ${countries}`];
}

function projects(d: TerminalData): string[] {
  if (d.projects.length === 0) return ["Nothing live right now. Check back soon."];
  return d.projects.map((p) => `${p.name}  ${p.url}`);
}

function whoami(d: TerminalData): string[] {
  const busy = d.contributions30d ? ` ${d.contributions30d.toLocaleString("en-US")} GitHub contributions in the last 30 days.` : "";
  return [`Mason. Software engineer, digital nomad, and a baker on the side.${busy}`];
}

/** The lines a command prints; `clear` is handled by the terminal itself. */
export function runCommand(input: string, data: TerminalData): string[] {
  const command = input.trim().toLowerCase().replace(/\s+/g, " ");
  switch (command) {
    case "":
      return [];
    case "help":
      return HELP;
    case "whereami":
      return whereami(data);
    case "ls":
    case "ls projects":
      return projects(data);
    case "whoami":
      return whoami(data);
    case "coffee":
      return ["30 min, video, free. Book one at /coffee"];
    default:
      return [`command not found: ${command.split(" ")[0].slice(0, MAX_ECHO)}. Try help.`];
  }
}
