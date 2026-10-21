import { AppError } from '@/src/lib/errors';

/**
 * Creates a transform stream that counts incoming bytes and aborts immediately
 * if the accumulated payload exceeds maxBytes.
 * This ensures that streaming multipart uploads cannot bypass byte ceilings
 * even when Content-Length is missing or falsified.
 */
export function createBoundedStream(
  readable: ReadableStream<Uint8Array>,
  maxBytes: number
): ReadableStream<Uint8Array> {
  let accumulatedBytes = 0;

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      accumulatedBytes += chunk.byteLength;
      if (accumulatedBytes > maxBytes) {
        controller.error(
          new AppError(
            'VALIDATION_ERROR',
            `Upload stream exceeded maximum allowed size of ${(maxBytes / (1024 * 1024)).toFixed(1)}MB.`
          )
        );
        return;
      }
      controller.enqueue(chunk);
    },
  });

  return readable.pipeThrough(transform);
}
