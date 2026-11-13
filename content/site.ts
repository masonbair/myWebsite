export type SiteImage = { src: string; alt: string; width: number; height: number };

export type Work = {
  title: string;
  org: string;
  dates: string;
  summary: string;
  tech: string[];
  image: SiteImage;
};

export type Achievement = { title: string; summary: string; tech: string[]; image?: SiteImage; href?: string };

export const about: string[] = [
  "Good day beautiful people, my name is Mason. Welcome to my site. I am a 22 year old with a hunger for excitement. Each day is a new day, and I like to say yolo!",
  "I am currently a Forward Deployed Engineer and a digital nomad traveling around the world. It has always been a dream of mine to explore the world, and I am so lucky and fortunate I am able to do this. But the journey here was not easy.",
  "During my time in university, I was the president for HacKSU (hacksu.com), where I helped to not only lead a group of 11 other organizers, but also helped to host weekly meetings and run Kent Hack Enough (khe.io). But as the president, I was able to make lots of connections, one of them being a connector that pointed me in the direction of the current job I have now. Without putting in the amount of work I did to build HacKSU’s connection pool, I would not be where I am today.",
  "As for some fun facts, I spent a full school year at Tartu University in Estonia, August 2024 to June 2025. I still miss it. My classmates came from all over the world and I built some relationships there that will last a lifetime. This was not a cheap trip either, I worked hard to get over $12,000 worth in scholarship to help pay for the 2 semesters of tuition, and because of my job during university, I used this money I made to pay for my room and food.",
  "Some work that I did while in school, I was the industry outreach intern for the CS department at my university. I helped work side by side with our industry liaison professor to reach out to companies to invite them in to give a presentation to the students for our industry seminar series. As well, I was an Assistant System Administrator. I set up GPU servers for research and used Ansible to keep 20+ research servers in line with security rules. Before that I interned in DevSecOps at Nationwide, writing Python tools for security data and upgrading CI/CD pipelines.",
  "When I'm home I bake a lot. Mostly banana bread and pumpkin bread, sometimes pumpkin pie, brownies or cookies. I don't use white sugar, everything gets sweetened with honey. Baking's on hold while I travel though. Also, I'm an Eagle Scout and in April 2026 I got the Distinguished Student Leadership Award granted from Kent State University.",
  "As for travel, I have been to 23 countries, all over North America, Europe and Asia. My favorite countries to visit have been Estonia, Japan, and Guatemala. I am a slow traveller, taking my time to explore every city I visit. I also volunteered for 1.5 months in Puerto Escondido at a Viajero hostel, leading all of the evening social events. I organized everything from Karaoke, to trivia and bar games.",
];

export const portrait: SiteImage = {
  src: "/misc/Mason_dressed_nicely.webp",
  alt: "Mason taking a mirror selfie in a khaki button up shirt in front of a blue patterned curtain",
  width: 3000,
  height: 4000,
};

export const work: Work[] = [
  {
    title: "Forward Deployed Engineer",
    org: "Fullsend Solutions",
    dates: "May 2026 to now",
    summary: "My first full-time job after graduating. I build software for Fullsend, fully remote, so I can work from wherever I'm traveling.",
    tech: ["Software development", "Remote work"],
    image: {
      src: "/misc/image_of_code.webp",
      alt: "A laptop and a monitor showing code in a dark editor in a dim room",
      width: 3000,
      height: 4000,
    },
  },
  {
    title: "Assistant System Administrator",
    org: "Kent State University",
    dates: "August 2025 to May 2026",
    summary:
      "I set up Dell R760 GPU servers for faculty research. I used Ansible to automate Tenable agents, updates and compliance on 20+ servers, and I wrote the CS department's VPN guides.",
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
      "I built Python apps that pull in SonarQube data to reprioritize security issues across 1,000+ apps. I also migrated CI/CD workflows. It was my first real look at security at a big company.",
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
      "I led Kent State's biggest CS club with a team of 6. We ran weekly meetings for 10 to 30 people and put on the Kent Hack Enough hackathon. I also brought in speakers from industry.",
    tech: ["Leadership", "Event management", "Community building"],
    image: {
      src: "/misc/Mason_infront_of_hacksu_sign.webp",
      alt: "Mason crouching with a yellow crown headband in front of a HacKSU table while other students stand behind it",
      width: 3000,
      height: 4000,
    },
  },
  {
    title: "Industry Outreach",
    org: "Kent State University",
    dates: "September 2025 to May 2026",
    summary:
      "I reached out to companies and people in tech to connect them with Kent State CS. Mostly that meant emailing people and setting up coffee chats. I met some really cool people this way.",
    tech: ["Outreach", "Networking", "Coffee chats"],
    image: {
      src: "/misc/Mason_networking_at_hackathon.webp",
      alt: "Mason in a red bucket hat and yellow hoodie posing with another student outside at a hackathon",
      width: 1024,
      height: 1536,
    },
  },
  {
    title: "Study abroad",
    org: "Tartu University, Estonia",
    dates: "August 2024 to June 2025",
    summary: "A full school year studying CS at Tartu University. I traveled around Europe on the side.",
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
      "I led the build of a web version of ImageJ so biology students could open huge cell images without using up their own laptops. It runs in Docker with Apache, WSGI and Ray clusters.",
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
      "I was the first person you talked to when your Windows, Linux or Mac broke. I fixed a lot of weird bugs and worked toward my Apple Repair Certification.",
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
    title: "Where Are My Friends",
    summary:
      "My newest side project: a free iPhone and Android app that shows which city each of your friends is in, and who just landed somewhere new. City only, never an exact dot. Not in the app stores yet.",
    tech: ["iOS", "Android", "Maps"],
    href: "https://wamf.masonbair.com",
  },
  {
    title: "NexHacks, 1st and 2nd place",
    summary:
      "1st place with The Token Company and 2nd with DevSwarm. DevSwarm sorts tasks for big teams using n8n workflows with triage, coding and confidence agents.",
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
      "An AI learning platform with 50+ widgets and tools. Its Adaptive Composition Engine changes the experience based on how each person learns.",
    tech: ["LLM integration", "AI agents", "Adaptive learning"],
  },
  {
    title: "Honors",
    summary:
      "Distinguished Student Leadership Award, April 2026. Choose Ohio First Scholarship in Computer Science, 2023 to May 2026. Eagle Scout with Scouts BSA, St. Francis Xavier, 2016 to 2022. I'm also pretty active in the MLH hackathon community.",
    tech: [],
  },
  {
    title: "Hack Dearborn 4, 1st place overall",
    summary:
      "A Bluetooth mesh that passes messages from device to device with no central server. I built the UI and the API for it.",
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
      "A recipe app (of course) in C# and ASP.NET Core, with Python scraping for recipe details, user accounts, a SQL database and container deploys on Azure.",
    tech: ["C#", "ASP.NET", "Python", "SQL", "Azure", "Docker"],
  },
  {
    title: "Markov Maze Prediction Calculator",
    summary: "A C++ calculator that uses linear algebra and Markov chains to predict where you'll end up in a maze.",
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
export const siteUpdated = "2026-11-09";

export const hello = {
  tag: "Open to coffee chats",
  heading: "Hey! I'm Mason.",
  body: "I'm a forward deployed engineer and a digital nomad. I work from wherever I'm at, and I'm always up for a coffee chat with someone who has something interesting to share.",
  note: "30 min, video, free",
};
