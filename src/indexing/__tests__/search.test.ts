import { describe, it, expect, beforeEach } from 'vitest';
import { SearchIndex, type SearchDocument, type SearchResult } from '../search.js';

// Import the tokenize function directly (it's not exported, so we access it from the module)
const tokenize = (text: string): string[] => {
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

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token));
};

describe('SearchIndex', () => {
  let searchIndex: SearchIndex;

  beforeEach(() => {
    searchIndex = new SearchIndex();
  });



  describe('upsert', () => {
    it('should add a new document to the index', () => {
      const doc: SearchDocument = {
        id: 'doc1',
        url: 'https://example.com',
        title: 'Test Document',
        section: 'General',
        optional: false,
        text: 'This is a test document with some content',
      };

      searchIndex.upsert(doc);

      const results = searchIndex.search('test', 10);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('doc1');
    });

    it('should update existing document', () => {
      const doc1: SearchDocument = {
        id: 'doc1',
        url: 'https://example.com',
        title: 'Test Document',
        section: 'General',
        optional: false,
        text: 'This is a test document',
      };

      const doc2: SearchDocument = {
        id: 'doc1',
        url: 'https://example.com',
        title: 'Updated Test Document',
        section: 'General',
        optional: false,
        text: 'This is an updated test document with more content',
      };

      searchIndex.upsert(doc1);
      searchIndex.upsert(doc2);

      // Should only have one document
      const results = searchIndex.search('test', 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Updated Test Document');
    });

    it('should handle optional documents with lower scoring', () => {
      const requiredDoc: SearchDocument = {
        id: 'required',
        url: 'https://example.com/required',
        title: 'Required Document',
        section: 'General',
        optional: false,
        text: 'This is a required document with test content',
      };

      const optionalDoc: SearchDocument = {
        id: 'optional',
        url: 'https://example.com/optional',
        title: 'Optional Document',
        section: 'General',
        optional: true,
        text: 'This is an optional document with test content',
      };

      searchIndex.upsert(requiredDoc);
      searchIndex.upsert(optionalDoc);

      const results = searchIndex.search('test', 10);
      expect(results).toHaveLength(2);

      // Required document should have higher score
      const requiredResult = results.find(r => r.id === 'required');
      const optionalResult = results.find(r => r.id === 'optional');
      expect(requiredResult!.score).toBeGreaterThan(optionalResult!.score);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      // Add some test documents
      const docs: SearchDocument[] = [
        {
          id: 'doc1',
          url: 'https://example.com/doc1',
          title: 'Machine Learning Guide',
          section: 'AI',
          optional: false,
          text: 'Machine learning is a subset of artificial intelligence that enables computers to learn without being explicitly programmed',
        },
        {
          id: 'doc2',
          url: 'https://example.com/doc2',
          title: 'Deep Learning Tutorial',
          section: 'AI',
          optional: false,
          text: 'Deep learning uses neural networks with multiple layers to solve complex problems in computer vision and natural language processing',
        },
        {
          id: 'doc3',
          url: 'https://example.com/doc3',
          title: 'Python Programming',
          section: 'Programming',
          optional: false,
          text: 'Python is a high-level programming language known for its simplicity and readability',
        },
        {
          id: 'doc4',
          url: 'https://example.com/doc4',
          title: 'JavaScript Programming',
          section: 'Programming',
          optional: true,
          text: 'JavaScript is a programming language used for web development and creating interactive websites',
        },
      ];

      docs.forEach(doc => searchIndex.upsert(doc));
    });

    it('should return empty results for empty query', () => {
      const results = searchIndex.search('', 10);
      expect(results).toEqual([]);
    });

    it('should return empty results for stop word only queries', () => {
      const results = searchIndex.search('the and or', 10);
      expect(results).toEqual([]);
    });

    it('should find documents matching single term', () => {
      const results = searchIndex.search('machine', 10);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('doc1');
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should find documents matching multiple terms', () => {
      const results = searchIndex.search('learning python', 10);
      expect(results).toHaveLength(3); // doc1, doc2, doc3
      expect(results.map(r => r.id).sort()).toEqual(['doc1', 'doc2', 'doc3']);
    });

    it('should rank results by relevance score', () => {
      const results = searchIndex.search('programming', 10);
      expect(results).toHaveLength(2);
      // doc3 should rank higher than doc4 (required vs optional)
      expect(results[0].id).toBe('doc3');
      expect(results[1].id).toBe('doc4');
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('should respect limit parameter', () => {
      const results = searchIndex.search('computer', 1);
      expect(results).toHaveLength(1);
    });

    it('should filter by section when specified', () => {
      const results = searchIndex.search('learning', 10, 'AI');
      expect(results).toHaveLength(2);
      expect(results.map(r => r.id).sort()).toEqual(['doc1', 'doc2']);

      const programmingResults = searchIndex.search('programming', 10, 'Programming');
      expect(programmingResults).toHaveLength(2);
      expect(programmingResults.map(r => r.id).sort()).toEqual(['doc3', 'doc4']);
    });

    it('should return empty results when section filter excludes all matches', () => {
      const results = searchIndex.search('machine', 10, 'Programming');
      expect(results).toEqual([]);
    });

    it('should generate proper snippets', () => {
      const results = searchIndex.search('machine', 10);
      expect(results[0].snippet).toContain('Machine');
      expect(results[0].snippet.length).toBeLessThanOrEqual(240);
    });

    it('should handle case insensitive search', () => {
      const results1 = searchIndex.search('Machine', 10);
      const results2 = searchIndex.search('machine', 10);
      expect(results1).toEqual(results2);
    });

    it('should handle multi-word queries with proper scoring', () => {
      const results = searchIndex.search('artificial intelligence', 10);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('doc1');
      expect(results[0].score).toBeGreaterThan(0);
    });
  });

  describe('clear', () => {
    it('should clear all documents and reset statistics', () => {
      const doc: SearchDocument = {
        id: 'doc1',
        url: 'https://example.com',
        title: 'Test Document',
        section: 'General',
        optional: false,
        text: 'This is a test document',
      };

      searchIndex.upsert(doc);
      expect(searchIndex.search('test', 10)).toHaveLength(1);

      searchIndex.clear();

      expect(searchIndex.search('test', 10)).toEqual([]);
    });

    it('should reset internal statistics after clear', () => {
      const doc: SearchDocument = {
        id: 'doc1',
        url: 'https://example.com',
        title: 'Test Document',
        section: 'General',
        optional: false,
        text: 'This is a test document with multiple words to test statistics',
      };

      searchIndex.upsert(doc);
      searchIndex.clear();

      // Add a new document and verify statistics are reset
      const newDoc: SearchDocument = {
        id: 'doc2',
        url: 'https://example.com/new',
        title: 'New Document',
        section: 'General',
        optional: false,
        text: 'New content for testing',
      };

      searchIndex.upsert(newDoc);
      const results = searchIndex.search('new', 10);
      expect(results).toHaveLength(1);
    });
  });

  describe('BM25 scoring', () => {
    it('should apply length normalization', () => {
      const shortDoc: SearchDocument = {
        id: 'short',
        url: 'https://example.com/short',
        title: 'Short Document',
        section: 'General',
        optional: false,
        text: 'Short document with test',
      };

      const longDoc: SearchDocument = {
        id: 'long',
        url: 'https://example.com/long',
        title: 'Long Document',
        section: 'General',
        optional: false,
        text: 'This is a very long document that contains many words and has a lot of content but still includes the test word that we are searching for in this particular test case',
      };

      searchIndex.upsert(shortDoc);
      searchIndex.upsert(longDoc);

      const results = searchIndex.search('test', 10);
      expect(results).toHaveLength(2);

      // Short document should score relatively higher due to length normalization
      const shortResult = results.find(r => r.id === 'short');
      const longResult = results.find(r => r.id === 'long');
      expect(shortResult!.score).toBeGreaterThan(longResult!.score);
    });
  });
});