import { describe, it, expect } from 'vitest';
import { createBoundedStream } from '@/src/modules/uploads/stream-limiter';

describe('Streaming Request Size Limiter', () => {
  it('allows streams under the maximum byte ceiling', async () => {
    const chunk = new Uint8Array([1, 2, 3, 4, 5]);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });

    const bounded = createBoundedStream(stream, 10);
    const reader = bounded.getReader();
    const { value, done } = await reader.read();
    expect(value?.length).toBe(5);
    expect(done).toBe(false);
  });

  it('aborts the stream when bytes exceed maximum limit even without Content-Length', async () => {
    const chunk1 = new Uint8Array(10);
    const chunk2 = new Uint8Array(10);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });

    const bounded = createBoundedStream(stream, 15);
    const reader = bounded.getReader();
    await reader.read(); // 10 bytes: ok

    await expect(reader.read()).rejects.toThrowError(/Upload stream exceeded/);
  });

  it('works with Request.formData() when under limit', async () => {
    const boundary = '----WebKitFormBoundaryABC123';
    const bodyStr = `--${boundary}\r\nContent-Disposition: form-data; name="field"\r\n\r\nhello\r\n--${boundary}--\r\n`;
    const encoded = new TextEncoder().encode(bodyStr);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    });

    const bounded = createBoundedStream(stream, 1000);
    const req = new Request('http://localhost:3000/upload', {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bounded,
      duplex: 'half',
    } as any);

    const formData = await req.formData();
    expect(formData.get('field')).toBe('hello');
  });

  it('aborts Request.formData() parsing when stream exceeds maxBytes', async () => {
    const boundary = '----WebKitFormBoundaryABC123';
    const bigContent = 'x'.repeat(200);
    const bodyStr = `--${boundary}\r\nContent-Disposition: form-data; name="field"\r\n\r\n${bigContent}\r\n--${boundary}--\r\n`;
    const encoded = new TextEncoder().encode(bodyStr);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    });

    // Limit to 50 bytes (body is >200 bytes)
    const bounded = createBoundedStream(stream, 50);
    const req = new Request('http://localhost:3000/upload', {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bounded,
      duplex: 'half',
    } as any);

    await expect(req.formData()).rejects.toThrow();
  });
});
