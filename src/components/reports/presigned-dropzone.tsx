'use client';

import React, { useState, useRef } from 'react';
import { UploadIcon, CheckCircleIcon, XIcon, RefreshCwIcon, AlertTriangleIcon } from '../ui/icons';

interface PresignedDropzoneProps {
  orgId: string;
  onUploadSuccess: (imageId: string) => void;
  onClear?: () => void;
}

/**
 * Compresses an image client-side to ensure it never exceeds Vercel's 4.5MB serverless payload limit.
 * Resizes down to maxDim (1600px) and converts to 85% quality JPEG.
 */
async function compressImageClientSide(file: File, maxDim = 1600, quality = 0.85): Promise<File> {
  // If file is already small (< 800KB), return as is
  if (file.size < 800 * 1024) {
    return file;
  }

  return new Promise((resolve) => {
    try {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        let { width, height } = img;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          resolve(file);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            const cleanName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
            const compressedFile = new File([blob], cleanName, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          },
          'image/jpeg',
          quality
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
      };

      img.src = objectUrl;
    } catch {
      resolve(file);
    }
  });
}

export function PresignedDropzone({ orgId, onUploadSuccess, onClear }: PresignedDropzoneProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<'idle' | 'optimizing' | 'uploading' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (selectedFile: File) => {
    const validMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validMimes.includes(selectedFile.type)) {
      setErrorMessage('Please upload a valid image (JPEG, PNG, WebP).');
      return;
    }

    if (selectedFile.size > 15 * 1024 * 1024) {
      setErrorMessage('Maximum file size is 15 MB.');
      return;
    }

    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));
    setErrorMessage(null);

    try {
      // 1. Client-Side Compression to prevent hitting Vercel 4.5MB payload limit
      setStage('optimizing');
      let fileToUpload = selectedFile;
      try {
        fileToUpload = await compressImageClientSide(selectedFile);
      } catch (compErr) {
        console.warn('Client-side compression skipped:', compErr);
      }

      setStage('uploading');

      // 2. Direct Server-Side Upload (strips EXIF, resizes to WebP, supports DB/S3 storage)
      const formData = new FormData();
      formData.append('file', fileToUpload);
      formData.append('orgId', orgId);

      const directRes = await fetch('/api/v1/uploads/direct', {
        method: 'POST',
        body: formData,
      });

      if (directRes.ok) {
        const directData = await directRes.json();
        const { imageId, thumbUrl } = directData.data;
        if (thumbUrl) setPreviewUrl(thumbUrl);
        setStage('ready');
        onUploadSuccess(imageId);
        return;
      }

      // If direct upload returned an error, parse it
      let directErrorMsg = `Upload failed (Status ${directRes.status})`;
      try {
        const errJson = await directRes.json();
        if (errJson.error?.message) {
          directErrorMsg = errJson.error.message;
        }
      } catch {
        if (directRes.status === 413) {
          directErrorMsg = 'File exceeds maximum upload size (4.5 MB serverless limit).';
        } else if (directRes.status === 401) {
          directErrorMsg = 'Your session has expired. Please sign in again.';
        } else if (directRes.status === 404) {
          directErrorMsg = 'Campus organization context not found. Please refresh.';
        }
      }

      // 3. Fallback: Check if Presigned S3 Upload is configured
      const presignRes = await fetch('/api/v1/uploads/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          contentType: fileToUpload.type,
          byteSize: fileToUpload.size,
        }),
      });

      if (!presignRes.ok) {
        // Presign is not available or returned error; report the direct error
        throw new Error(directErrorMsg);
      }

      const presignData = await presignRes.json();
      const { imageId, putUrl } = presignData.data;

      // PUT directly to S3 bucket
      const uploadRes = await fetch(putUrl, {
        method: 'PUT',
        headers: { 'Content-Type': fileToUpload.type },
        body: fileToUpload,
      });

      if (!uploadRes.ok) {
        throw new Error(`Direct cloud storage upload failed (HTTP ${uploadRes.status}).`);
      }

      setStage('ready');
      onUploadSuccess(imageId);
    } catch (err: any) {
      console.error('Image upload failed:', err);
      setStage('error');
      setErrorMessage(err.message || 'Upload failed. Please try a different photo.');
    }
  };

  const handleReset = () => {
    setFile(null);
    setPreviewUrl(null);
    setStage('idle');
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (onClear) onClear();
  };

  return (
    <div>
      <input
        type="file"
        ref={fileInputRef}
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleFileSelect(e.target.files[0]);
          }
        }}
        className="hidden"
      />

      {stage === 'idle' ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
              handleFileSelect(e.dataTransfer.files[0]);
            }
          }}
          className="border border-dashed border-slate-300 hover:border-indigo-500 bg-slate-50/70 hover:bg-slate-50 rounded-xl p-4 text-center cursor-pointer transition flex items-center justify-center gap-3 group"
        >
          <div className="w-8 h-8 rounded-lg bg-white shadow-xs border border-slate-200 flex items-center justify-center text-slate-400 group-hover:text-indigo-600 transition shrink-0">
            <UploadIcon className="w-4 h-4" />
          </div>
          <div className="text-left">
            <span className="text-xs font-semibold text-slate-800 block">
              Upload photo (optional)
            </span>
            <span className="text-[10px] text-slate-400 block">
              Auto-compressed • EXIF &amp; GPS stripped for privacy
            </span>
          </div>
        </div>
      ) : (
        <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Preview"
                className="w-10 h-10 object-cover rounded-lg border border-slate-200 shrink-0"
              />
            )}
            <div className="min-w-0">
              <span className="text-xs font-semibold text-slate-800 truncate block">
                {file?.name}
              </span>
              <div className="text-[10px] flex items-center gap-1.5 mt-0.5">
                {stage === 'optimizing' ? (
                  <span className="text-indigo-600 font-medium flex items-center gap-1">
                    <RefreshCwIcon className="w-2.5 h-2.5 animate-spin" /> Optimizing photo...
                  </span>
                ) : stage === 'uploading' ? (
                  <span className="text-indigo-600 font-medium flex items-center gap-1">
                    <RefreshCwIcon className="w-2.5 h-2.5 animate-spin" /> Stripping EXIF &amp; saving...
                  </span>
                ) : stage === 'ready' ? (
                  <span className="text-emerald-700 font-semibold flex items-center gap-1">
                    <CheckCircleIcon className="w-3 h-3 text-emerald-500" /> Photo verified &amp; ready
                  </span>
                ) : (
                  <span className="text-rose-600 font-medium flex items-center gap-1">
                    <AlertTriangleIcon className="w-2.5 h-2.5" /> Upload failed
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {stage === 'error' && (
              <button
                type="button"
                onClick={() => file && handleFileSelect(file)}
                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold rounded-lg transition"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={handleReset}
              className="text-slate-400 hover:text-slate-600 p-1"
              title="Remove photo"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="mt-1.5 p-2 bg-rose-50 border border-rose-200 rounded-xl text-[11px] text-rose-700 font-medium flex items-start gap-1.5">
          <AlertTriangleIcon className="w-3.5 h-3.5 text-rose-600 mt-0.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}
