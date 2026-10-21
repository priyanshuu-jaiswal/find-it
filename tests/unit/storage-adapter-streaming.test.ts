import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageAdapter } from '@/src/modules/uploads/storage-adapter';
import { Readable } from 'stream';

describe('StorageAdapter: Incremental Bounded Streaming Reader', () => {
  let adapter: StorageAdapter;
  let mockClientSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new StorageAdapter();

    // Enable storage adapter with mocked client
    mockClientSend = vi.fn();
    (adapter as any).isConfigured = true;
    (adapter as any).client = {
      send: mockClientSend,
    };
  });

  describe('Node.js Async-Iterable Stream Support', () => {
    it('successfully buffers valid Node.js stream within byte limit', async () => {
      const chunk1 = Buffer.from('hello ');
      const chunk2 = Buffer.from('world');
      const stream = Readable.from([chunk1, chunk2]);

      mockClientSend.mockResolvedValue({
        ContentLength: 11,
        Body: stream,
      });

      const buffer = await adapter.getObjectBuffer('test-key.jpg', 1024);
      expect(buffer.toString()).toBe('hello world');
    });

    it('terminates and destroys Node stream immediately when accumulated bytes exceed limit', async () => {
      // Chunk size 1 MB, 12 chunks (12 MB > 10 MB limit)
      const chunkSize = 1024 * 1024;
      let chunksProduced = 0;
      let destroyed = false;

      const stream = new Readable({
        read() {
          if (chunksProduced < 12) {
            this.push(Buffer.alloc(chunkSize, 'A'));
            chunksProduced++;
          } else {
            this.push(null);
          }
        },
        destroy(err, callback) {
          destroyed = true;
          callback(err);
        },
      });

      mockClientSend.mockResolvedValue({
        // ContentLength unannounced / undefined
        ContentLength: undefined,
        Body: stream,
      });

      // Limit is 10 MB
      await expect(adapter.getObjectBuffer('test-key.jpg', 10 * 1024 * 1024)).rejects.toThrow(
        /Streamed object exceeded maximum allowable limit/
      );

      // Stream destroy hook must be invoked to stop upstream data consumption
      expect(destroyed).toBe(true);
      // Chunks produced must not exceed limit + 1 chunk (stopped pulling immediately)
      expect(chunksProduced).toBeLessThanOrEqual(11);
    });
  });

  describe('Web ReadableStream Support', () => {
    it('successfully buffers Web ReadableStream within byte limit', async () => {
      const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
      let index = 0;

      const webStream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index < chunks.length) {
            controller.enqueue(chunks[index]);
            index++;
          } else {
            controller.close();
          }
        },
      });

      mockClientSend.mockResolvedValue({
        ContentLength: 6,
        Body: webStream,
      });

      const buffer = await adapter.getObjectBuffer('test-key.jpg', 1024);
      expect(buffer).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
    });

    it('cancels Web ReadableStream reader immediately when accumulated bytes exceed limit', async () => {
      let cancelled = false;
      const chunkSize = 1024 * 1024; // 1 MB
      let chunksSent = 0;

      const webStream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunksSent < 12) {
            controller.enqueue(new Uint8Array(chunkSize));
            chunksSent++;
          } else {
            controller.close();
          }
        },
        cancel() {
          cancelled = true;
        },
      });

      mockClientSend.mockResolvedValue({
        ContentLength: undefined,
        Body: webStream,
      });

      await expect(adapter.getObjectBuffer('test-key.jpg', 10 * 1024 * 1024)).rejects.toThrow(
        /Streamed object exceeded maximum allowable limit/
      );

      expect(cancelled).toBe(true);
      expect(chunksSent).toBeLessThanOrEqual(12);
    });
  });

  describe('Content-Length Pre-Check & Fail-Closed Behavior', () => {
    it('aborts immediately before reading stream if Content-Length exceeds limit', async () => {
      const readSpy = vi.fn();
      const mockStream = {
        getReader: readSpy,
        [Symbol.asyncIterator]: readSpy,
      };

      mockClientSend.mockResolvedValue({
        ContentLength: 15 * 1024 * 1024, // 15 MB > 10 MB limit
        Body: mockStream,
      });

      await expect(adapter.getObjectBuffer('test-key.jpg', 10 * 1024 * 1024)).rejects.toThrow(
        /Object size \(15728640 bytes\) exceeds maximum allowable limit/
      );

      // Stream must not even be touched
      expect(readSpy).not.toHaveBeenCalled();
    });

    it('safely handles missing ContentLength if stream remains under limit', async () => {
      const stream = Readable.from([Buffer.from('valid data under limit')]);

      mockClientSend.mockResolvedValue({
        ContentLength: undefined, // Missing header
        Body: stream,
      });

      const buffer = await adapter.getObjectBuffer('test-key.jpg', 1024);
      expect(buffer.toString()).toBe('valid data under limit');
    });

    it('fails closed before accumulating if body type cannot be safely bounded', async () => {
      // Plain object without getReader or Symbol.asyncIterator
      const unsupportedBody = {
        transformToByteArray: vi.fn(), // Unbounded buffer method
      };

      mockClientSend.mockResolvedValue({
        ContentLength: 100,
        Body: unsupportedBody,
      });

      await expect(adapter.getObjectBuffer('test-key.jpg', 1024)).rejects.toThrow(
        /Storage body stream type cannot be safely bounded; failing closed/
      );

      // Must never call transformToByteArray
      expect(unsupportedBody.transformToByteArray).not.toHaveBeenCalled();
    });
  });
});
