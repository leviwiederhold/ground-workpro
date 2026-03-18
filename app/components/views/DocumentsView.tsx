/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, InlineError, SkeletonBlock } from '@/app/components/ui/FeedbackBlocks';

const confirmDelete = (targetLabel) => window.confirm(`Delete ${targetLabel}? This cannot be undone.`);

export function DocumentsView({ currentRole, moduleAccess = {}, ui }) {
  const { SearchInput, Button, Icon, Card, formatDate } = ui;
  const normalizedRole = String(currentRole || '').trim().toLowerCase();
  const documentsAccess = String(moduleAccess?.documents || '').trim().toLowerCase();
  const canViewDocuments = documentsAccess === 'view' || documentsAccess === 'edit';
  const canManageDocuments =
    documentsAccess === 'edit' || ['executive', 'operations', 'admin', 'pm'].includes(normalizedRole);
  const fileInputRef = useRef(null);

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeView, setActiveView] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [selectedDocumentId, setSelectedDocumentId] = useState(null);

  const formatFileSize = (value) => {
    const size = Number(value || 0);
    if (!size || Number.isNaN(size)) return '-';
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    if (size >= 1024) return `${Math.round(size / 1024)} KB`;
    return `${size} B`;
  };

  const normalizeText = (value) => String(value || '').trim().toLowerCase();

  const classifyDocument = (doc) => {
    const fileName = normalizeText(doc.fileName);
    const contentType = normalizeText(doc.contentType);
    if (fileName.includes('invoice') || contentType.includes('invoice')) return 'invoices';
    if (fileName.includes('permit') || fileName.includes('license') || fileName.includes('cert')) return 'compliance';
    if (fileName.includes('safety') || fileName.includes('osha') || fileName.includes('incident')) return 'safety';
    if (fileName.includes('contract') || fileName.includes('agreement')) return 'contracts';
    if (contentType.startsWith('image/')) return 'photos';
    return 'general';
  };

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/attachments?entity_type=document', { cache: 'no-store' });
      const raw = await response.text();
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }
      if (!response.ok) {
        setError(payload?.error || raw || 'Failed to load documents');
        setDocuments([]);
        return;
      }
      const items = payload?.attachments || [];
      setDocuments(items);
      if (items.length > 0 && !selectedDocumentId) {
        setSelectedDocumentId(items[0].id);
      }
    } catch {
      setError('Failed to load documents');
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDocumentId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canManageDocuments) return;

    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('entity_type', 'document');
      formData.append('file', file);

      const response = await fetch('/api/attachments', {
        method: 'POST',
        body: formData,
      });

      const raw = await response.text();
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        setError(payload?.error || raw || 'Failed to upload document');
        return;
      }

      await loadDocuments();
    } catch {
      setError('Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (attachmentId) => {
    if (!canManageDocuments) return;
    const confirmed = confirmDelete('this document');
    if (!confirmed) return;

    setDeletingId(attachmentId);
    setError('');
    try {
      const response = await fetch(`/api/attachments/${attachmentId}`, { method: 'DELETE' });
      const raw = await response.text();
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }
      if (!response.ok || !payload?.success) {
        setError(payload?.error || raw || 'Failed to delete document');
        return;
      }
      setDocuments((prev) => {
        const nextDocs = prev.filter((item) => item.id !== attachmentId);
        if (selectedDocumentId === attachmentId) {
          setSelectedDocumentId(nextDocs[0]?.id || null);
        }
        return nextDocs;
      });
    } catch {
      setError('Failed to delete document');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredDocs = documents
    .filter((doc) => {
      const query = search.trim().toLowerCase();
      if (query) {
        const fileName = String(doc.fileName || '').toLowerCase();
        const contentType = String(doc.contentType || '').toLowerCase();
        if (!fileName.includes(query) && !contentType.includes(query)) return false;
      }
      if (activeView === 'all') return true;
      return classifyDocument(doc) === activeView;
    })
    .sort((a, b) => {
      if (sortBy === 'name') return String(a.fileName || '').localeCompare(String(b.fileName || ''));
      if (sortBy === 'size') return Number(b.fileSize || 0) - Number(a.fileSize || 0);
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });

  const selectedDocument = filteredDocs.find((doc) => doc.id === selectedDocumentId) || filteredDocs[0] || null;
  const totalDocuments = documents.length;
  const totalThisMonth = documents.filter((doc) => {
    if (!doc.createdAt) return false;
    const date = new Date(doc.createdAt);
    const now = new Date();
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }).length;
  const totalPdf = documents.filter((doc) => normalizeText(doc.contentType).includes('pdf')).length;
  const totalImages = documents.filter((doc) => normalizeText(doc.contentType).startsWith('image/')).length;

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-xs text-gray-500">Total</p>
          <p className="text-2xl font-semibold text-gray-900">{totalDocuments}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-gray-500">Uploaded This Month</p>
          <p className="text-2xl font-semibold text-gray-900">{totalThisMonth}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-gray-500">PDF Docs</p>
          <p className="text-2xl font-semibold text-gray-900">{totalPdf}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-gray-500">Photos</p>
          <p className="text-2xl font-semibold text-gray-900">{totalImages}</p>
        </Card>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          placeholder="Search documents..."
          value={search}
          onChange={setSearch}
        />
        <div className="flex items-center gap-2">
          <select
            className="text-sm border border-gray-300 rounded-lg px-3 py-2"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="newest">Newest</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </select>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleUpload}
            data-testid="documents-upload-input"
          />
          <Button
            variant="brand"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canManageDocuments || uploading || deletingId !== null || loading}
            data-testid="documents-upload-button"
          >
            <Icon name="cloud-arrow-up" className="mr-2" />
            {uploading ? 'Uploading...' : 'Upload Document'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ['all', 'All'],
          ['contracts', 'Contracts'],
          ['invoices', 'Invoices'],
          ['compliance', 'Compliance'],
          ['safety', 'Safety'],
          ['photos', 'Photos'],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveView(key)}
            className={`px-3 py-1.5 text-xs rounded-full border ${activeView === key ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-gray-300 text-gray-600'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {!canManageDocuments && canViewDocuments && (
        <Card>
          <p className="text-sm text-gray-600">Read-only: upload and delete require document edit access.</p>
        </Card>
      )}

      {loading ? (
        <SkeletonBlock lines={3} testId="documents-loading" />
      ) : error ? (
        <InlineError testId="documents-error">{error}</InlineError>
      ) : filteredDocs.length === 0 ? (
        <EmptyState testId="documents-empty">No documents uploaded yet.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 space-y-2" data-testid="documents-list">
            {filteredDocs.map((doc) => {
              const isSelected = selectedDocument && selectedDocument.id === doc.id;
              return (
                <Card
                  key={doc.id}
                  className={`p-3 sm:p-4 cursor-pointer ${isSelected ? 'ring-2 ring-brand-500' : ''}`}
                  onClick={() => setSelectedDocumentId(doc.id)}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between min-w-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 break-all" data-testid="documents-file-name">
                        {doc.fileName || 'Untitled file'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1 break-all">
                        {doc.contentType || 'file'} • {formatFileSize(doc.fileSize)} • {doc.createdAt ? formatDate(doc.createdAt) : '-'}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                      {classifyDocument(doc)}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>

          <Card className="p-4 h-fit sticky top-4">
            {selectedDocument ? (
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-900 break-all">{selectedDocument.fileName || 'Untitled file'}</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Category</span><span className="text-gray-900 capitalize">{classifyDocument(selectedDocument)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Type</span><span className="text-gray-900 break-all">{selectedDocument.contentType || '-'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Size</span><span className="text-gray-900">{formatFileSize(selectedDocument.fileSize)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Uploaded</span><span className="text-gray-900">{selectedDocument.createdAt ? formatDate(selectedDocument.createdAt) : '-'}</span></div>
                </div>
                <div className="pt-2 border-t border-gray-100 flex gap-2">
                  {(selectedDocument.download_url || selectedDocument.signedDownloadUrl) ? (
                    <a
                      href={selectedDocument.download_url || selectedDocument.signedDownloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs px-2 py-1 rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-100"
                      data-testid="documents-download-link"
                    >
                      Download
                    </a>
                  ) : (
                    <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500 border border-gray-200">No link</span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(selectedDocument.id)}
                    disabled={!canManageDocuments || deletingId === selectedDocument.id || uploading || loading}
                    data-testid="documents-delete-button"
                  >
                    <Icon name="trash" />
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Select a document to view details.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
