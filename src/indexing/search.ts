export interface SearchDocument {
  id: string;
  url: string;
  title: string;
  section: string;
  optional: boolean;
  text: string;
}

export interface SearchResult {
  id: string;
  url: string;
  title: string;
  section: string;
  score: number;
  snippet: string;
}

const stopWords = new Set([
  "the",
  "and",
  "or",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "you",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "its",
  "about",
  "can",
  "will",
  "not",
  "use",
  "using",
  "used",
  "via",
  "how",
  "what",
  "when",
  "where",
  "who",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

export class SearchIndex {
  private documents = new Map<string, SearchDocument>();
  private termDocFreq = new Map<string, number>();
  private termFreq = new Map<string, Map<string, number>>();
  private docLengths = new Map<string, number>();
  private avgDocLength = 0;

  // BM25 parameters
  private readonly k1 = 1.5; // term frequency saturation parameter
  private readonly b = 0.75; // length normalization parameter

  upsert(doc: SearchDocument) {
    this.documents.set(doc.id, doc);
    const tokens = tokenize(doc.text);
    const freqMap = new Map<string, number>();
    for (const token of tokens) {
      freqMap.set(token, (freqMap.get(token) ?? 0) + 1);
    }
    this.termFreq.set(doc.id, freqMap);
    this.docLengths.set(doc.id, tokens.length);

    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      this.termDocFreq.set(token, (this.termDocFreq.get(token) ?? 0) + 1);
    }

    // Update average document length
    this.updateAvgDocLength();
  }

  private updateAvgDocLength() {
    if (this.docLengths.size === 0) {
      this.avgDocLength = 0;
      return;
    }
    let totalLength = 0;
    for (const length of this.docLengths.values()) {
      totalLength += length;
    }
    this.avgDocLength = totalLength / this.docLengths.size;
  }

  clear() {
    this.documents.clear();
    this.termDocFreq.clear();
    this.termFreq.clear();
    this.docLengths.clear();
    this.avgDocLength = 0;
  }

  search(query: string, limit = 5, section?: string): SearchResult[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const results: SearchResult[] = [];
    const totalDocs = Math.max(this.documents.size, 1);

    for (const [id, doc] of this.documents.entries()) {
      if (section && doc.section.toLowerCase() !== section.toLowerCase()) {
        continue;
      }
      const freqMap = this.termFreq.get(id);
      if (!freqMap) continue;

      let score = 0;
      const docLength = this.docLengths.get(id) ?? 1;
      const avgLength = Math.max(1, this.avgDocLength);
      
      for (const token of tokens) {
        const tf = freqMap.get(token) ?? 0;
        if (!tf) continue;
        const df = this.termDocFreq.get(token) ?? 1;
        
        // BM25 IDF component
        const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
        
        // BM25 TF component with length normalization
        const lengthNorm = 1 - this.b + this.b * (docLength / avgLength);
        const tfScore = (tf * (this.k1 + 1)) / (tf + this.k1 * lengthNorm);
        
        score += idf * tfScore;
      }
      
      // Scale score for better readability
      score *= 100;

      if (doc.optional) {
        score *= 0.7;
      }

      if (score > 0) {
        results.push({
          id,
          url: doc.url,
          title: doc.title,
          section: doc.section,
          score,
          snippet: snippetFor(doc.text, tokens),
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

function snippetFor(text: string, tokens: string[]) {
  const lower = text.toLowerCase();
  let index = -1;
  for (const token of tokens) {
    index = lower.indexOf(token);
    if (index >= 0) break;
  }
  if (index < 0) {
    return text.slice(0, 240).trim();
  }
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + 160);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}