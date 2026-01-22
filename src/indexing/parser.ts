export interface LlmsLink {
  title: string;
  url: string;
  description?: string;
  section: string;
  optional: boolean;
}

export interface ParsedLlms {
  title: string;
  summary?: string;
  sections: Map<string, LlmsLink[]>;
  links: LlmsLink[];
}

const linkRegex = /-\s+\[([^\]]+)\]\(([^)]+)\)(?::\s*(.*))?/;

export function parseLlmsTxt(markdown: string): ParsedLlms {
  const lines = markdown.split(/\r?\n/);
  let title = "";
  let summary: string | undefined;
  let currentSection = "General";
  let optionalSection = false;

  const sections = new Map<string, LlmsLink[]>();
  const links: LlmsLink[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!title && trimmed.startsWith("# ")) {
      title = trimmed.replace(/^#\s+/, "").trim();
      continue;
    }

    if (!summary && trimmed.startsWith(">")) {
      summary = trimmed.replace(/^>\s?/, "").trim();
      continue;
    }

    if (trimmed.startsWith("## ")) {
      currentSection = trimmed.replace(/^##\s+/, "").trim();
      optionalSection = currentSection.toLowerCase() === "optional";
      continue;
    }

    const match = trimmed.match(linkRegex);
    if (match) {
      const [, linkTitle, url, description] = match;
      const entry: LlmsLink = {
        title: linkTitle.trim(),
        url: url.trim(),
        description: description?.trim(),
        section: currentSection,
        optional: optionalSection,
      };
      if (!sections.has(currentSection)) {
        sections.set(currentSection, []);
      }
      sections.get(currentSection)?.push(entry);
      links.push(entry);
    }
  }

  if (!title) {
    throw new Error("llms.txt is missing required H1 title (# ...)");
  }

  return {
    title,
    summary,
    sections,
    links,
  };
}