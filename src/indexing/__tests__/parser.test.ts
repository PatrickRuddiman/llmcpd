import { describe, it, expect } from 'vitest';
import { parseLlmsTxt, type ParsedLlms, type LlmsLink } from '../parser.js';

describe('parseLlmsTxt', () => {
  it('should parse a basic llms.txt with title and links', () => {
    const markdown = `# My LLM Collection

- [GPT-4](https://openai.com/gpt4) - Advanced language model
- [Claude](https://anthropic.com/claude) - Helpful AI assistant`;

    const result = parseLlmsTxt(markdown);

    expect(result.title).toBe('My LLM Collection');
    expect(result.summary).toBeUndefined();
    expect(result.links).toHaveLength(2);
    expect(result.sections.size).toBe(1);

    const generalSection = result.sections.get('General');
    expect(generalSection).toHaveLength(2);

    expect(result.links[0]).toEqual({
      title: 'GPT-4',
      url: 'https://openai.com/gpt4',
      description: 'Advanced language model',
      section: 'General',
      optional: false,
    });

    expect(result.links[1]).toEqual({
      title: 'Claude',
      url: 'https://anthropic.com/claude',
      description: 'Helpful AI assistant',
      section: 'General',
      optional: false,
    });
  });

  it('should parse llms.txt with summary', () => {
    const markdown = `# AI Models

> A collection of powerful AI models for various tasks

- [GPT-4](https://openai.com/gpt4)`;

    const result = parseLlmsTxt(markdown);

    expect(result.title).toBe('AI Models');
    expect(result.summary).toBe('A collection of powerful AI models for various tasks');
  });

  it('should parse sections correctly', () => {
    const markdown = `# AI Tools

## Text Generation
- [GPT-4](https://openai.com/gpt4)

## Image Generation
- [DALL-E](https://openai.com/dalle)`;

    const result = parseLlmsTxt(markdown);

    expect(result.sections.size).toBe(2);
    expect(result.sections.get('Text Generation')).toHaveLength(1);
    expect(result.sections.get('Image Generation')).toHaveLength(1);
  });

  it('should handle optional sections', () => {
    const markdown = `# AI Tools

## Optional
- [Experimental Model](https://example.com/experimental)

## Required
- [Stable Model](https://example.com/stable)`;

    const result = parseLlmsTxt(markdown);

    const optionalLink = result.links.find(l => l.title === 'Experimental Model');
    const requiredLink = result.links.find(l => l.title === 'Stable Model');

    expect(optionalLink?.optional).toBe(true);
    expect(requiredLink?.optional).toBe(false);
  });

  it('should parse links without descriptions', () => {
    const markdown = `# Models

- [GPT-4](https://openai.com/gpt4)
- [Claude](https://anthropic.com/claude)`;

    const result = parseLlmsTxt(markdown);

    expect(result.links[0].description).toBeUndefined();
    expect(result.links[1].description).toBeUndefined();
  });

  it('should handle malformed links gracefully', () => {
    const markdown = `# Models

- Not a link
- [Incomplete](incomplete-url
- [Another](https://example.com) - Valid link`;

    const result = parseLlmsTxt(markdown);

    expect(result.links).toHaveLength(1);
    expect(result.links[0].title).toBe('Another');
  });

  it('should throw error for missing title', () => {
    const markdown = `- [Model](https://example.com)`;

    expect(() => parseLlmsTxt(markdown)).toThrow('llms.txt is missing required H1 title (# ...)');
  });

  it('should handle empty markdown', () => {
    const markdown = '';

    expect(() => parseLlmsTxt(markdown)).toThrow('llms.txt is missing required H1 title (# ...)');
  });

  it('should handle complex link descriptions', () => {
    const markdown = `# Models

- [GPT-4](https://openai.com/gpt4) - Advanced AI model with 175B parameters, supports multi-modal input including text, images, and code`;

    const result = parseLlmsTxt(markdown);

    expect(result.links[0].description).toBe('Advanced AI model with 175B parameters, supports multi-modal input including text, images, and code');
  });

  it('should preserve section order and link order within sections', () => {
    const markdown = `# Models

## Section B
- [Model B1](https://b1.com)
- [Model B2](https://b2.com)

## Section A
- [Model A1](https://a1.com)
- [Model A2](https://a2.com)`;

    const result = parseLlmsTxt(markdown);

    expect([...result.sections.keys()]).toEqual(['Section B', 'Section A']);
    expect(result.links).toHaveLength(4);
    expect(result.links[0].title).toBe('Model B1');
    expect(result.links[1].title).toBe('Model B2');
    expect(result.links[2].title).toBe('Model A1');
    expect(result.links[3].title).toBe('Model A2');
  });

  it('should handle URLs with special characters', () => {
    const markdown = `# Models

- [Model](https://example.com/path?param=value&other=test#fragment)`;

    const result = parseLlmsTxt(markdown);

    expect(result.links[0].url).toBe('https://example.com/path?param=value&other=test#fragment');
  });

  it('should handle titles with special characters', () => {
    const markdown = `# Models

- [GPT-4 Turbo (v2.0)](https://openai.com/gpt4) - Latest version with improvements`;

    const result = parseLlmsTxt(markdown);

    expect(result.links[0].title).toBe('GPT-4 Turbo (v2.0)');
  });
});