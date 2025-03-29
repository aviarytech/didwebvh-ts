import { getResource } from '../src/resource';
import type { DIDDoc } from '../src/interfaces';
import { expect, test, describe, beforeEach, afterEach, mock } from 'bun:test';

describe('getResource', () => {
  const mockDIDDoc: DIDDoc = {
    id: 'did:webvh:example.com',
    service: [
      {
        id: '#files',
        type: 'relativeRef',
        serviceEndpoint: 'https://example.com'
      },
      {
        id: '#whois',
        type: 'LinkedVerifiablePresentation',
        serviceEndpoint: 'https://example.com/whois.vp'
      }
    ]
  };

  describe('remote resource resolution', () => {
    beforeEach(() => {
      global.fetch = mock(() => Promise.resolve(new Response('file content', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' }
      })));
    });

    afterEach(() => {
      mock.restore();
    });

    test('resolves file through files service endpoint', async () => {
      const result = await getResource({
        path: 'example.com',
        file: 'test.txt',
        isRemote: true,
        didDocument: mockDIDDoc
      });

      expect(result).toEqual({
        content: 'file content',
        contentType: 'text/plain'
      });
      expect(global.fetch).toHaveBeenCalledWith('https://example.com/test.txt');
    });

    test('resolves whois through whois service endpoint', async () => {
      global.fetch = mock(() => Promise.resolve(new Response('whois content', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/ld+json' }
      })));

      const result = await getResource({
        path: 'example.com',
        file: 'whois',
        isRemote: true,
        didDocument: mockDIDDoc
      });

      expect(result).toEqual({
        content: 'whois content',
        contentType: 'application/ld+json'
      });
      expect(global.fetch).toHaveBeenCalledWith('https://example.com/whois.vp');
    });

    test('falls back to domain-based URL when service endpoint not found', async () => {
      const result = await getResource({
        path: 'example.com',
        file: 'test.txt',
        isRemote: true,
        didDocument: { id: 'did:webvh:example.com' }
      });

      expect(result).toEqual({
        content: 'file content',
        contentType: 'text/plain'
      });
      expect(global.fetch).toHaveBeenCalledWith('https://example.com/test.txt');
    });

    test('handles 404 errors', async () => {
      global.fetch = mock(() => Promise.resolve(new Response('Not Found', {
        status: 404,
        statusText: 'Not Found'
      })));

      await expect(getResource({
        path: 'example.com',
        file: 'nonexistent.txt',
        isRemote: true,
        didDocument: mockDIDDoc
      })).rejects.toThrow('Error 404: Not Found');
    });

    test('handles other HTTP errors', async () => {
      global.fetch = mock(() => Promise.resolve(new Response('Internal Server Error', {
        status: 500,
        statusText: 'Internal Server Error'
      })));

      await expect(getResource({
        path: 'example.com',
        file: 'test.txt',
        isRemote: true,
        didDocument: mockDIDDoc
      })).rejects.toThrow('Error 500: Internal Server Error');
    });
  });

  describe('local resource resolution', () => {
    const originalFile = Bun.file;
    
    beforeEach(() => {
      // Mock Bun.file
      Object.defineProperty(Bun, 'file', {
        value: mock(() => ({
          text: () => Promise.resolve('local file content')
        }))
      });
    });

    afterEach(() => {
      // Restore original Bun.file
      Object.defineProperty(Bun, 'file', {
        value: originalFile
      });
      mock.restore();
    });

    test('resolves well-known file', async () => {
      const result = await getResource({
        path: '.well-known',
        file: 'did.jsonl',
        isRemote: false
      });

      expect(result).toEqual({
        content: 'local file content'
      });
      expect(Bun.file).toHaveBeenCalledWith('./src/routes/.well-known/did.jsonl');
    });

    test('resolves whois file', async () => {
      const result = await getResource({
        path: 'example.com',
        file: 'whois',
        isRemote: false
      });

      expect(result).toEqual({
        content: 'local file content'
      });
      expect(Bun.file).toHaveBeenCalledWith('./src/routes/example.com/whois.vp');
    });

    test('resolves file in path', async () => {
      const result = await getResource({
        path: 'example.com',
        file: 'test.txt',
        isRemote: false
      });

      expect(result).toEqual({
        content: 'local file content'
      });
      expect(Bun.file).toHaveBeenCalledWith('./src/routes/example.com/test.txt');
    });

    test('resolves file in root path', async () => {
      const result = await getResource({
        path: '',
        file: 'test.txt',
        isRemote: false
      });

      expect(result).toEqual({
        content: 'local file content'
      });
      expect(Bun.file).toHaveBeenCalledWith('./src/routes/test.txt');
    });
  });
}); 