'use client';

import React, { useState, useEffect } from 'react';
import { MapPinIcon, PlusIcon, EditIcon, TrashIcon, CheckIcon, XIcon, ShieldIcon } from '../ui/icons';

export interface CampusLocationItem {
  id: string;
  name: string;
  area: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt?: string;
}

interface CampusLocationsManagerProps {
  orgId: string;
  orgSlug: string;
}

export function CampusLocationsManager({ orgId, orgSlug }: CampusLocationsManagerProps) {
  const [locations, setLocations] = useState<CampusLocationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modal / Form state for Creating
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newArea, setNewArea] = useState('');
  const [newSortOrder, setNewSortOrder] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal / Form state for Editing
  const [editingLocation, setEditingLocation] = useState<CampusLocationItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editArea, setEditArea] = useState('');
  const [editSortOrder, setEditSortOrder] = useState<number>(0);
  const [editIsActive, setEditIsActive] = useState<boolean>(true);

  useEffect(() => {
    let ignore = false;
    if (orgId) {
      fetch(`/api/v1/locations?orgId=${orgId}&all=true`)
        .then((res) => res.json())
        .then((data) => {
          if (!ignore) {
            setLocations(data.data || []);
            setIsLoading(false);
          }
        })
        .catch((err) => {
          if (!ignore) {
            setError(err.message || 'Error fetching campus locations');
            setIsLoading(false);
          }
        });
    }
    return () => {
      ignore = true;
    };
  }, [orgId]);

  const showNotification = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  // Handle Add
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    try {
      setIsSubmitting(true);
      setError(null);
      const res = await fetch('/api/v1/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          name: newName.trim(),
          area: newArea.trim() || undefined,
          sortOrder: Number(newSortOrder) || (locations.length + 1),
          isActive: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to create campus location');
      }

      setLocations((prev) => [...prev, data.data].sort((a, b) => a.sortOrder - b.sortOrder));
      setIsAddModalOpen(false);
      setNewName('');
      setNewArea('');
      setNewSortOrder(0);
      showNotification(`✓ Location "${data.data.name}" added successfully.`);
    } catch (err: any) {
      setError(err.message || 'Error adding location');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Start Edit
  const startEditing = (loc: CampusLocationItem) => {
    setEditingLocation(loc);
    setEditName(loc.name);
    setEditArea(loc.area || '');
    setEditSortOrder(loc.sortOrder);
    setEditIsActive(loc.isActive);
  };

  // Handle Save Edit
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLocation || !editName.trim()) return;

    try {
      setIsSubmitting(true);
      setError(null);
      const res = await fetch(`/api/v1/locations/${editingLocation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          area: editArea.trim() || undefined,
          sortOrder: Number(editSortOrder),
          isActive: editIsActive,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to update campus location');
      }

      setLocations((prev) =>
        prev
          .map((loc) => (loc.id === data.data.id ? data.data : loc))
          .sort((a, b) => a.sortOrder - b.sortOrder)
      );
      setEditingLocation(null);
      showNotification(`✓ Location "${data.data.name}" updated successfully.`);
    } catch (err: any) {
      setError(err.message || 'Error updating location');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quick Toggle Active
  const handleToggleActive = async (loc: CampusLocationItem) => {
    try {
      setError(null);
      const res = await fetch(`/api/v1/locations/${loc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isActive: !loc.isActive,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to toggle status');
      }

      setLocations((prev) =>
        prev.map((l) => (l.id === loc.id ? { ...l, isActive: data.data.isActive } : l))
      );
      showNotification(`✓ Location status updated.`);
    } catch (err: any) {
      setError(err.message || 'Error updating location status');
    }
  };

  // Handle Delete
  const handleDelete = async (loc: CampusLocationItem) => {
    if (!window.confirm(`Are you sure you want to delete campus location "${loc.name}"?`)) {
      return;
    }

    try {
      setError(null);
      const res = await fetch(`/api/v1/locations/${loc.id}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to delete location');
      }

      setLocations((prev) => prev.filter((l) => l.id !== loc.id));
      showNotification(`✓ Location removed.`);
    } catch (err: any) {
      setError(err.message || 'Error deleting location');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2 text-indigo-700 font-bold text-xs uppercase tracking-wider mb-1">
            <ShieldIcon className="w-3.5 h-3.5" />
            <span>Administrator Control</span>
          </div>
          <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
            Campus Locations &amp; Zones
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage the official campus zones where students can report and discover lost and found items.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setNewName('');
            setNewArea('');
            setNewSortOrder(locations.length + 1);
            setIsAddModalOpen(true);
          }}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer shrink-0 w-full sm:w-auto"
        >
          <PlusIcon className="w-4 h-4" />
          <span>Add New Location</span>
        </button>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-xl flex items-center justify-between shadow-xs">
          <span>{successMessage}</span>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-600 hover:text-emerald-900 ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold rounded-xl flex items-center justify-between shadow-xs">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-600 hover:text-rose-900 ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Locations List / Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-3.5 sm:p-4 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800">
            Active Campus Locations ({locations.filter((l) => l.isActive).length} active / {locations.length} total)
          </span>
          <span className="text-[11px] text-slate-500 hidden sm:inline">
            Ordered by priority in item submission dropdown
          </span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Loading campus locations...
          </div>
        ) : locations.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No campus locations configured yet. Click &ldquo;Add New Location&rdquo; to create your first campus zone.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {locations.map((loc, idx) => (
              <div
                key={loc.id}
                className={`p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                  loc.isActive ? 'hover:bg-slate-50/80' : 'bg-slate-50/50 opacity-70'
                }`}
              >
                {/* Location Info */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 border border-indigo-100">
                    {loc.sortOrder || idx + 1}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-xs sm:text-sm font-bold text-slate-900">
                        {loc.name}
                      </h4>
                      {loc.isActive ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <MapPinIcon className="w-3 h-3 text-slate-400" />
                        <span>Zone Area: <strong className="text-slate-700">{loc.area || 'General'}</strong></span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleActive(loc)}
                    title={loc.isActive ? 'Deactivate location' : 'Activate location'}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                      loc.isActive
                        ? 'border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900 bg-white'
                        : 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                    }`}
                  >
                    {loc.isActive ? 'Deactivate' : 'Activate'}
                  </button>

                  <button
                    type="button"
                    onClick={() => startEditing(loc)}
                    className="p-1.5 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition cursor-pointer"
                    title="Edit location"
                  >
                    <EditIcon className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(loc)}
                    className="p-1.5 rounded-lg border border-rose-200 hover:border-rose-300 hover:bg-rose-50 text-rose-600 hover:text-rose-900 transition cursor-pointer"
                    title="Delete location"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: Add Location */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xl max-w-md w-full p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-extrabold text-slate-900">
                Add Campus Location
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Location Name * (e.g. Mechanical Lab 304, Quadrangle Gate)
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Architecture Studio 4"
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Building / Area Tag (Optional)
                  </label>
                  <input
                    type="text"
                    value={newArea}
                    onChange={(e) => setNewArea(e.target.value)}
                    placeholder="e.g. Architecture"
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Display Priority / Sort
                  </label>
                  <input
                    type="number"
                    value={newSortOrder}
                    onChange={(e) => setNewSortOrder(parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer"
                >
                  {isSubmitting ? 'Saving...' : 'Add Location'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Location */}
      {editingLocation && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xl max-w-md w-full p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-extrabold text-slate-900">
                Modify Campus Location
              </h3>
              <button
                type="button"
                onClick={() => setEditingLocation(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Location Name *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Building / Area Tag
                  </label>
                  <input
                    type="text"
                    value={editArea}
                    onChange={(e) => setEditArea(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Display Priority / Sort
                  </label>
                  <input
                    type="number"
                    value={editSortOrder}
                    onChange={(e) => setEditSortOrder(parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="editIsActive"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="editIsActive" className="text-xs font-semibold text-slate-700 cursor-pointer">
                  Active (visible in student report submission dropdown)
                </label>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingLocation(null)}
                  className="px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer"
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
