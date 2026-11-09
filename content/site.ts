export type SiteImage = { src: string; alt: string; width: number; height: number };

export type Work = {
  title: string;
  org: string;
  dates: string;
  summary: string;
  tech: string[];
  image: SiteImage;
};

export type Achievement = { title: string; summary: string; tech: string[]; image?: SiteImage };

export const about: string[] = [
  "I'm Mason. I graduated from Kent State University in May 2026 with a B.S. in Computer Science and a 3.97 GPA, and now I travel and work remotely. My work sits across DevSecOps, system administration, and software development.",
  "I spent a full year studying abroad at Tartu University in Estonia, from August 2024 to June 2025. It changed how I think about technology and working with people from other countries.",
  "As an Assistant System Administrator at Kent State, I set up GPU servers for research, automated work with Ansible, and kept more than 20 research servers in line with security rules. Before that, as a DevSecOps intern at Nationwide, I built tools that save over $10K a year and simplified CI/CD pipelines for more than 1,000 applications.",
  "Outside of work I was President of HacKSU, Kent State's largest CS club. I organized hackathons and mentored other students. I travel, I bake artisan bread, and I'm an Eagle Scout. As a Choose Ohio First scholarship recipient, I cared about building tech communities and making technology open to everyone.",
];

export const portrait: SiteImage = {
  src: "/misc/Mason_dressed_nicely.webp",
  alt: "Mason taking a mirror selfie in a khaki button up shirt in front of a blue patterned curtain",
  width: 3000,
  height: 4000,
};

export const work: Work[] = [
  {
    title: "Assistant System Administrator",
    org: "Kent State University",
    dates: "August 2025 to May 2026",
    summary:
      "I set up and deployed Dell R760 GPU servers for faculty research. I automated Tenable agents, updates, and compliance across 20+ servers with Ansible, and I wrote VPN guides for several operating systems for the CS department.",
    tech: ["Ubuntu Server", "Ansible", "SSSD", "LDAP", "Docker", "Lambda AI Stack"],
    image: {
      src: "/misc/Mason_at_RSM_office.webp",
      alt: "Mason in a dark coat taking a selfie at an office front desk",
      width: 3000,
      height: 4000,
    },
  },
  {
    title: "DevSecOps Intern",
    org: "Nationwide",
    dates: "May 2025 to August 2025",
    summary:
      "I built Python apps that pull in SonarQube data to reprioritize issues across 1,000+ apps. I migrated CI/CD workflows and built the Sonar Sweep tool, which saves $10K+ a year.",
    tech: ["Python", "GitHub Actions", "SonarQube", "CI/CD", "Docker"],
    image: {
      src: "/misc/Mason_at_RSM_office_2.webp",
      alt: "Mason smiling in a dark coat next to a wood paneled office wall",
      width: 3000,
      height: 4000,
    },
  },
  {
    title: "President",
    org: "HacKSU",
    dates: "May 2025 to May 2026",
    summary:
      "I led Kent State's largest CS club with a team of 6. We ran weekly meetings for 10 to 30 people, the Kent Hack Enough hackathon, and talks from industry speakers.",
    tech: ["Leadership", "Event management", "Community building"],
    image: {
      src: "/misc/Mason_infront_of_hacksu_sign.webp",
      alt: "Mason crouching with a yellow crown headband in front of a HacKSU table while other students stand behind it",
      width: 3000,
      height: 4000,
    },
  },
  {
    title: "Study abroad",
    org: "Tartu University, Estonia",
    dates: "August 2024 to June 2025",
    summary: "A full academic year studying Computer Science at Tartu University while exploring Eastern European tech culture.",
    tech: ["International perspective", "Cultural adaptation", "Tech diversity"],
    image: {
      src: "/misc/Mason_traveling.webp",
      alt: "Mason smiling in a red bucket hat and sunglasses, taking a selfie on a roadside with green mountains behind him",
      width: 3000,
      height: 4000,
    },
  },
  {
    title: "Undergraduate Researcher",
    org: "ImageJ Web App",
    dates: "September 2023 to May 2025",
    summary:
      "I led the build of a web version of ImageJ for biology students. I containerized it with Docker and deployed it with Apache, WSGI, and Ray clusters for distributed processing.",
    tech: ["Angular", "Python", "TypeScript", "Docker", "Apache", "Ray"],
    image: {
      src: "/misc/Mason_at_carnegie_mellon.webp",
      alt: "Mason in a black puffer jacket and white cap on a snowy campus path under a Carnegie Mellon University banner",
      width: 4284,
      height: 5712,
    },
  },
  {
    title: "IT Help Desk Technician",
    org: "Kent State University",
    dates: "August 2023 to August 2024",
    summary:
      "First line of support for Windows, Linux, and macOS. I tracked down and fixed software issues and worked on my Apple Repair Certification.",
    tech: ["Technical support", "Multi OS troubleshooting", "Customer service"],
    image: {
      src: "/misc/image_of_code.webp",
      alt: "A laptop and a monitor showing code in a dark editor in a dim room",
      width: 3000,
      height: 4000,
    },
  },
];

export const achievements: Achievement[] = [
  {
    title: "NexHacks, 1st and 2nd place",
    summary:
      "1st place with The Token Company. 2nd place with DevSwarm, which triages tasks for large teams using n8n workflows with triage, coding, and confidence agents.",
    tech: ["Svelte", "Python", "n8n", "AI agents"],
    image: {
      src: "/misc/Mason_with_nexhacks_team.webp",
      alt: "Mason and three teammates posing at night around a bronze terrier statue in a brick courtyard",
      width: 3024,
      height: 4032,
    },
  },
  {
    title: "Hack Ohi/O",
    summary:
      "An adaptive AI learning platform with 50+ widgets and tools. Its Adaptive Composition Engine shapes the experience around how each person learns.",
    tech: ["LLM integration", "AI agents", "Adaptive learning"],
  },
  {
    title: "Honors",
    summary:
      "Choose Ohio First Scholarship in Computer Science, 2023 to May 2026. Eagle Scout with Scouts BSA, St. Francis Xavier, 2016 to 2022. Active in the MLH community and the hackathon circuit.",
    tech: [],
  },
  {
    title: "Hack Dearborn 4, 1st place overall",
    summary:
      "A Bluetooth mesh service that passes messages between devices with no central server. I built the UI and the API for the mesh network.",
    tech: ["Bluetooth mesh", "API development", "Decentralized networks"],
    image: {
      src: "/misc/Mason_coding_at_hackathon.webp",
      alt: "Mason in headphones and a gray hoodie working on a laptop at a crowded hackathon table, seen from a low selfie angle",
      width: 3000,
      height: 4000,
    },
  },
  {
    title: "RecipleRecollection",
    summary:
      "A recipe web app in C# and ASP.NET Core, with Python scraping for recipe details, user accounts, a SQL database, and container deploys on Azure.",
    tech: ["C#", "ASP.NET", "Python", "SQL", "Azure", "Docker"],
  },
  {
    title: "Markov Maze Prediction Calculator",
    summary: "A C++ calculator that uses linear algebra and Markov chains to predict paths through a maze.",
    tech: ["C++", "Linear algebra", "Algorithm design"],
  },
];

export const gallery: SiteImage[] = [
  {
    src: "/misc/Mason_networking_at_hackathon.webp",
    alt: "Mason in a red bucket hat and yellow hoodie posing with another student outside at a hackathon",
    width: 1024,
    height: 1536,
  },
  {
    src: "/misc/Mason_thinking_at_hackathon_horizontal.webp",
    alt: "Mason in a yellow hoodie sitting cross legged on a window seat, thinking over his laptop",
    width: 2400,
    height: 1600,
  },
  {
    src: "/misc/MLH_hackcon_solo.webp",
    alt: "Mason in a red bucket hat and colorful patchwork pants, arms crossed, in front of a wall of MLH logos",
    width: 2268,
    height: 3024,
  },
  {
    src: "/misc/Mason_networking_at_hackathon_horizontal.webp",
    alt: "Mason in a red bucket hat and yellow hoodie standing next to a student in front of a Rocket recruiting banner",
    width: 1024,
    height: 683,
  },
];

export const skills: { label: string; items: string }[] = [
  { label: "Languages", items: "C++, Python, Java, TypeScript, PHP, C#, .NET, HTML, CSS, R" },
  {
    label: "Tools and frameworks",
    items: "Docker, GitHub Actions, Harness, Flask, Angular, Apache, Ansible, AWS (ECS, ECR, S3, Bedrock, IAM)",
  },
  {
    label: "Platforms and services",
    items: "Azure, Kubernetes, Ray Clusters, GitHub, SonarQube, MCPs, AI Agents, Strands Agents",
  },
  {
    label: "System administration",
    items: "Ansible, Networking, TCP/IP, Apache, DNS, SSSD, Autofs, LDAP, Email Servers, OS Installation",
  },
];

export const education: { school: string; detail: string; dates: string }[] = [
  { school: "Kent State University", detail: "B.S. in Computer Science, GPA 3.97", dates: "Graduated May 2026" },
  { school: "Tartu University, Estonia", detail: "Computer Science study abroad", dates: "August 2024 to June 2025" },
];

export const contact = {
  email: "bair.s.mason@gmail.com",
  github: "https://github.com/masonbair",
  linkedin: "https://www.linkedin.com/in/masonbair/",
};

export const coffeeChat = { href: "/coffee", label: "Book a coffee chat" };

export const resumeHref = "/misc/Mason_Bair_Resume_01_20_2026.pdf";

export const siteUrl = "https://masonbair.com";

// Bump when the copy on this site changes; feeds the sitemap and the home page's dateModified.
export const siteUpdated = "2026-11-04";

export const hello = {
  tag: "Open to coffee chats",
  heading: "Hi, I'm Mason.",
  body: "I'm a software engineer who bakes, travels, and builds from wherever I land. Glad you're here.",
  note: "30 min, video, no agenda needed",
};
