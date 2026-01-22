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
  private totalDocLength = 0;

  // BM25 parameters
  private readonly k1 = 1.5; // term frequency saturation parameter
  private readonly b = 0.75; // length normalization parameter
  private readonly idfSmoothing = 0.5; // IDF smoothing factor to prevent negative IDF values

  upsert(doc: SearchDocument) {
    // Remove old document data if updating
    const oldDoc = this.documents.get(doc.id);
    if (oldDoc) {
      const oldTokens = tokenize(oldDoc.text);
      const oldLength = this.docLengths.get(doc.id) ?? 0;
      
      // Remove old document length from total
      this.totalDocLength -= oldLength;
      
      // Decrement term document frequencies for old terms
      const oldUniqueTokens = new Set(oldTokens);
      for (const token of oldUniqueTokens) {
        const count = this.termDocFreq.get(token) ?? 0;
        if (count > 1) {
          this.termDocFreq.set(token, count - 1);
        } else {
          this.termDocFreq.delete(token);
        }
      }
    }

    this.documents.set(doc.id, doc);
    const tokens = tokenize(doc.text);
    const freqMap = new Map<string, number>();
    for (const token of tokens) {
      freqMap.set(token, (freqMap.get(token) ?? 0) + 1);
    }
    this.termFreq.set(doc.id, freqMap);
    
    // Update document length tracking
    const docLength = tokens.length;
    this.docLengths.set(doc.id, docLength);
    this.totalDocLength += docLength;
    this.avgDocLength = this.documents.size > 0 
      ? this.totalDocLength / this.documents.size 
      : 0;

    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      this.termDocFreq.set(token, (this.termDocFreq.get(token) ?? 0) + 1);
    }
  }

  clear() {
    this.documents.clear();
    this.termDocFreq.clear();
    this.termFreq.clear();
    this.docLengths.clear();
    this.avgDocLength = 0;
    this.totalDocLength = 0;
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
        const idf = Math.log(1 + (totalDocs - df + this.idfSmoothing) / (df + this.idfSmoothing));
        
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

function snippetFor(text: string, tokens: string[], maxLength = 400) {
  const lower = text.toLowerCase();
  
  // Find the best position that contains the most tokens
  let bestIndex = -1;
  let bestMatchCount = 0;
  
  for (const token of tokens) {
    let idx = 0;
    while ((idx = lower.indexOf(token, idx)) !== -1) {
      // Count how many tokens appear near this position
      const windowStart = Math.max(0, idx - 150);
      const windowEnd = Math.min(text.length, idx + 250);
      const window = lower.slice(windowStart, windowEnd);
      
      let matchCount = 0;
      for (const t of tokens) {
        if (window.includes(t)) matchCount++;
      }
      
      if (matchCount > bestMatchCount) {
        bestMatchCount = matchCount;
        bestIndex = idx;
      }
      idx++;
    }
  }
  
  if (bestIndex < 0) {
    // No match found, return start of document
    return text.slice(0, maxLength).trim();
  }
  
  // Create snippet centered around best match position
  const contextBefore = Math.floor(maxLength * 0.35);
  const contextAfter = maxLength - contextBefore;
  const start = Math.max(0, bestIndex - contextBefore);
  const end = Math.min(text.length, bestIndex + contextAfter);
  
  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  
  // Add ellipsis if truncated
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  
  return snippet;
}