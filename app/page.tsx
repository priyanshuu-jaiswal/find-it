export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-2xl bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-full mb-4">
          Phase 0 Complete • Production Ready
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-3">
          FindIt Campus Lost & Found
        </h1>
        <p className="text-slate-600 mb-6 text-base">
          Multi-tenant campus Lost-and-Found platform featuring deterministic matching,
          privacy-preserving ownership claims, and scoped organization moderation.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-xs font-semibold text-slate-400 block mb-1">Database</span>
            <span className="text-sm font-medium text-slate-800">PostgreSQL 16 + FTS</span>
          </div>
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-xs font-semibold text-slate-400 block mb-1">Storage</span>
            <span className="text-sm font-medium text-slate-800">Private S3 / MinIO</span>
          </div>
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-xs font-semibold text-slate-400 block mb-1">Auth</span>
            <span className="text-sm font-medium text-slate-800">Auth.js v5 (JWT/Google)</span>
          </div>
        </div>
      </div>
    </main>
  );
}
