'use client';

import React, { useState, useRef } from 'react';
import { UploadIcon, CheckCircleIcon, LockIcon, XIcon, RefreshCwIcon, ImageIcon } from '../ui/icons';

interface PresignedDropzoneProps {
  orgId: string;
  onUploadSuccess: (imageId: string) => void;
  onClear?: () => void;
}

export function PresignedDropzone({ orgId, onUploadSuccess, onClear }: PresignedDropzoneProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [step, setStep] = useState<'idle' | 'reserving' | 'uploading' | 'complete' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (selectedFile: File) => {
    // 1. Client-side MIME & size validation
    const validMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validMimes.includes(selectedFile.type)) {
      setErrorMessage('Please upload a valid image (JPEG, PNG, or WebP).');
      return;
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      setErrorMessage('File size exceeds the 10 MB maximum limit.');
      return;
    }

    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));
    setErrorMessage(null);

    try {
      // Step 1: Request presigned URL
      setStep('reserving');
      const presignRes = await fetch('/api/v1/uploads/presign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orgId,
          mimeType: selectedFile.type,
          sizeBytes: selectedFile.size,
          purpose: 'REPORT_IMAGE',
        }),
      });

      const presignData = await presignRes.json();
      if (!presignRes.ok) {
        throw new Error(presignData.error?.message || 'Failed to reserve upload slot');
      }

      const { imageId, uploadUrl } = presignData.data;

      // Step 2: Direct S3 PUT Upload
      setStep('uploading');
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': selectedFile.type,
        },
        body: selectedFile,
      });

      if (!uploadRes.ok) {
        throw new Error('Direct storage upload failed. Please try again.');
      }

      // Step 3: Complete & queued for sanitization
      setStep('complete');
      onUploadSuccess(imageId);
    } catch (err: any) {
      setStep('error');
      setErrorMessage(err.message || 'An error occurred during image upload');
    }
  };

  const handleReset = () => {
    setFile(null);
    setPreviewUrl(null);
    setStep('idle');
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (onClear) onClear();
  };

  return (
    <div className="space-y-3">
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

      {step === 'idle' && (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
              handleFileSelect(e.dataTransfer.files[0]);
            }
          }}
          className="border-2 border-dashed border-slate-300 hover:border-indigo-400 bg-slate-50 hover:bg-slate-100/60 rounded-2xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 group"
        >
          <div className="w-10 h-10 rounded-xl bg-white shadow-xs border border-slate-200 flex items-center justify-center text-slate-500 group-hover:text-indigo-600 transition">
            <UploadIcon className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-800 block">
              Click to upload photo, or drag and drop
            </span>
            <span className="text-[11px] text-slate-400 mt-0.5 block">
              PNG, JPG, or WebP up to 10MB • All EXIF & GPS location metadata stripped automatically
            </span>
          </div>
        </div>
      )}

      {step !== 'idle' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center gap-3">
            {/* Preview image */}
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Upload preview"
                className="w-14 h-14 object-cover rounded-xl border border-slate-200 shrink-0"
              />
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 truncate block">
                  {file?.name}
                </span>
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Multi-stage pipeline visualization */}
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px]">
                  {step === 'reserving' ? (
                    <span className="text-indigo-600 font-semibold flex items-center gap-1">
                      <RefreshCwIcon className="w-3 h-3 animate-spin" />
                      1/3 Reserving secure presigned slot...
                    </span>
                  ) : step === 'uploading' ? (
                    <span className="text-indigo-600 font-semibold flex items-center gap-1">
                      <RefreshCwIcon className="w-3 h-3 animate-spin" />
                      2/3 Uploading directly to private storage...
                    </span>
                  ) : step === 'complete' ? (
                    <span className="text-emerald-700 font-semibold flex items-center gap-1">
                      <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500" />
                      3/3 Upload verified • Queued for EXIF stripping
                    </span>
                  ) : (
                    <span className="text-rose-600 font-semibold">Upload failed</span>
                  )}
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      step === 'reserving'
                        ? 'w-1/3 bg-indigo-500'
                        : step === 'uploading'
                        ? 'w-2/3 bg-indigo-600'
                        : step === 'complete'
                        ? 'w-full bg-emerald-500'
                        : 'w-full bg-rose-500'
                    }`}
                  />
                </div>
              </div>
            </div>
          </div>

          {step === 'complete' && (
            <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-1.5 text-[11px] text-slate-500">
              <LockIcon className="w-3 h-3 text-slate-400" />
              <span>
                Background worker will remove GPS coordinates & convert to safe WebP thumbnail upon creation.
              </span>
            </div>
          )}
        </div>
      )}

      {errorMessage && (
        <p className="text-xs text-rose-600 font-medium px-1">{errorMessage}</p>
      )}
    </div>
  );
}
