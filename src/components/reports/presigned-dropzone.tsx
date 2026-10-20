'use client';

import React, { useState, useRef } from 'react';
import { UploadIcon, CheckCircleIcon, XIcon, RefreshCwIcon } from '../ui/icons';

interface PresignedDropzoneProps {
  orgId: string;
  onUploadSuccess: (imageId: string) => void;
  onClear?: () => void;
}

export function PresignedDropzone({ orgId, onUploadSuccess, onClear }: PresignedDropzoneProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<'idle' | 'uploading' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (selectedFile: File) => {
    const validMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validMimes.includes(selectedFile.type)) {
      setErrorMessage('Please upload a valid image (JPEG, PNG, WebP).');
      return;
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      setErrorMessage('Maximum file size is 10 MB.');
      return;
    }

    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));
    setErrorMessage(null);

    try {
      setStage('uploading');

      // 1. Try Direct Server-Side Upload (strips EXIF immediately & avoids browser S3 CORS)
      const formData = new FormData();
      formData.append('file', selectedFile);
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

      // 2. Fallback to S3 Presigned Upload (matching PresignUploadSchema)
      const presignRes = await fetch('/api/v1/uploads/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          contentType: selectedFile.type,
          byteSize: selectedFile.size,
        }),
      });

      const presignData = await presignRes.json();
      if (!presignRes.ok) {
        throw new Error(presignData.error?.message || 'Failed to initialize upload slot');
      }

      const { imageId, putUrl } = presignData.data;

      const uploadRes = await fetch(putUrl, {
        method: 'PUT',
        headers: { 'Content-Type': selectedFile.type },
        body: selectedFile,
      });

      if (!uploadRes.ok) {
        throw new Error('Direct S3 upload failed. Please try again.');
      }

      setStage('ready');
      onUploadSuccess(imageId);
    } catch (err: any) {
      setStage('error');
      setErrorMessage(err.message || 'Upload error');
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
              Direct S3 upload • EXIF/GPS stripped automatically
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
                {stage === 'uploading' ? (
                  <span className="text-indigo-600 font-medium flex items-center gap-1">
                    <RefreshCwIcon className="w-2.5 h-2.5 animate-spin" /> Uploading to S3...
                  </span>
                ) : stage === 'ready' ? (
                  <span className="text-emerald-700 font-semibold flex items-center gap-1">
                    <CheckCircleIcon className="w-3 h-3 text-emerald-500" /> Upload verified (EXIF will be stripped)
                  </span>
                ) : (
                  <span className="text-rose-600 font-medium">Upload failed</span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleReset}
            className="text-slate-400 hover:text-slate-600 p-1 shrink-0"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {errorMessage && (
        <p className="text-[11px] text-rose-600 font-medium mt-1.5">{errorMessage}</p>
      )}
    </div>
  );
}
