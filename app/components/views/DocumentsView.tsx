/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @next/next/no-img-element */
// @ts-nocheck
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MobileSheet } from '@/app/components/ui/MobileSheet';
import { EmptyState, InlineError, SkeletonBlock } from '@/app/components/ui/FeedbackBlocks';

const confirmDelete = (targetLabel) => window.confirm(`Delete ${targetLabel}? This cannot be undone.`);
const PREVIEWABLE_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpg',
  'image/jpeg',
  'image/webp',
]);

const inferContentTypeFromName = (fileName) => {
  const normalized = String(fileName || '').trim().toLowerCase();
  if (normalized.endsWith('.pdf')) return 'application/pdf';
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg')) return 'image/jpg';
  if (normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (normalized.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (normalized.endsWith('.zip')) return 'application/zip';
  if (normalized.endsWith('.txt')) return 'text/plain';
  return '';
};

const resolveDocumentContentType = (doc) =>
  String(doc?.contentType || inferContentTypeFromName(doc?.fileName) || 'application/octet-stream')
    .trim()
    .toLowerCase();

const isPreviewableDocument = (doc) => PREVIEWABLE_CONTENT_TYPES.has(resolveDocumentContentType(doc));
const isImageDocument = (doc) => resolveDocumentContentType(doc).startsWith('image/');
const isPdfDocument = (doc) => resolveDocumentContentType(doc) === 'application/pdf';

const getDocumentFileTypeLabel = (doc) => {
  const contentType = resolveDocumentContentType(doc);
  if (contentType === 'application/pdf') return 'PDF';
  if (contentType === 'image/png') return 'PNG';
  if (contentType === 'image/jpg' || contentType === 'image/jpeg') return 'JPG';
  if (contentType === 'image/webp') return 'WEBP';
  if (contentType.includes('wordprocessingml')) return 'DOCX';
  if (contentType.includes('spreadsheetml')) return 'XLSX';
  if (contentType === 'application/zip') return 'ZIP';
  if (contentType === 'text/plain') return 'TXT';
  const fileName = String(doc?.fileName || '');
  const parts = fileName.split('.');
  return parts.length > 1 ? String(parts.pop() || 'FILE').toUpperCase() : 'FILE';
};

const getDocumentLink = (doc) => doc?.download_url || doc?.signedDownloadUrl || '';
const getDocumentIconName = (doc) => {
  if (isPdfDocument(doc)) return 'file-pdf';
  if (isImageDocument(doc)) return 'image';
  const type = getDocumentFileTypeLabel(doc);
  if (type === 'DOCX') return 'file-word';
  if (type === 'XLSX') return 'file-excel';
  if (type === 'ZIP') return 'file-zipper';
  return 'file-lines';
};

export function DocumentsView({ currentRole, moduleAccess = {}, ui }) {
  const {
    SearchInput,
    Button,
    Icon,
    Card,
    formatDate,
    suppressSetupRefreshDuringFilePicker,
    clearSetupRefreshSuppression,
  } = ui;
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
  const [previewDocumentId, setPreviewDocumentId] = useState(null);
  const [hoveredDocumentId, setHoveredDocumentId] = useState(null);
  const [supportsHoverPreview, setSupportsHoverPreview] = useState(false);
  const categoryOptions = [
    ['all', 'All'],
    ['contracts', 'Contracts'],
    ['invoices', 'Invoices'],
    ['compliance', 'Compliance'],
    ['safety', 'Safety'],
    ['photos', 'Photos'],
  ];

  const formatFileSize = (value) => {
    const size = Number(value || 0);
    if (!size || Number.isNaN(size)) return '-';
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    if (size >= 1024) return `${Math.round(size / 1024)} KB`;
    return `${size} B`;
  };

  const normalizeText = (value) => String(value || '').trim().toLowerCase();

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    const syncMatches = () => setSupportsHoverPreview(mediaQuery.matches);
    syncMatches();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncMatches);
      return () => mediaQuery.removeEventListener('change', syncMatches);
    }
    mediaQuery.addListener(syncMatches);
    return () => mediaQuery.removeListener(syncMatches);
  }, []);

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
    clearSetupRefreshSuppression?.();
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

      if (!response.ok || !payload?.attachment) {
        setError(payload?.error || raw || 'Failed to upload document');
        return;
      }

      setSelectedDocumentId(payload.attachment.id);
      setDocuments((prev) => {
        const nextDocs = [payload.attachment, ...prev.filter((item) => item.id !== payload.attachment.id)];
        return nextDocs;
      });
      await loadDocuments();
    } catch {
      setError('Failed to upload document');
    } finally {
      clearSetupRefreshSuppression?.();
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
  const previewDocument = documents.find((doc) => doc.id === previewDocumentId) || null;
  const hoveredPreviewDocument = filteredDocs.find((doc) => doc.id === hoveredDocumentId) || null;
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
            onClick={() => {
              suppressSetupRefreshDuringFilePicker?.();
              fileInputRef.current?.click();
            }}
            disabled={!canManageDocuments || uploading || deletingId !== null || loading}
            data-testid="documents-upload-button"
          >
            <Icon name="cloud-arrow-up" className="mr-2" />
            {uploading ? 'Uploading...' : 'Upload Document'}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="sm:hidden">
          <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Category</label>
          <select
            value={activeView}
            onChange={(e) => setActiveView(e.target.value)}
            className="block h-11 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 [color-scheme:light]"
          >
            {categoryOptions.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="hidden flex-wrap gap-2 sm:flex">
          {categoryOptions.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveView(key)}
              className={`rounded-full border px-3 py-1.5 text-xs ${activeView === key ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-gray-300 bg-white text-gray-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
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
                  className={`relative p-3 sm:p-4 cursor-pointer ${isSelected ? 'ring-2 ring-brand-500' : ''}`}
                  onClick={() => {
                    setSelectedDocumentId(doc.id);
                    setPreviewDocumentId(doc.id);
                  }}
                  onMouseEnter={() => {
                    if (supportsHoverPreview && isPreviewableDocument(doc)) {
                      setHoveredDocumentId(doc.id);
                    }
                  }}
                  onMouseLeave={() => {
                    if (hoveredDocumentId === doc.id) setHoveredDocumentId(null);
                  }}
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
                  {supportsHoverPreview && hoveredPreviewDocument?.id === doc.id && isPreviewableDocument(doc) && (
                    <div className="pointer-events-none absolute right-4 top-[calc(100%-0.5rem)] z-20 hidden w-56 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl lg:block dark:border-zinc-700 dark:bg-zinc-900">
                      <div className="border-b border-gray-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:border-zinc-800 dark:text-zinc-400">
                        Quick Preview
                      </div>
                      {isImageDocument(doc) ? (
                        <img
                          src={getDocumentLink(doc)}
                          alt={doc.fileName || 'Document preview'}
                          className="h-40 w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-40 flex-col items-center justify-center gap-2 bg-gradient-to-br from-red-50 to-white text-red-700 dark:from-zinc-950 dark:to-zinc-900 dark:text-red-300">
                          <Icon name="file-pdf" className="text-3xl" />
                          <p className="px-3 text-center text-xs font-medium">PDF preview available on click</p>
                        </div>
                      )}
                    </div>
                  )}
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
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Type</span><span className="text-gray-900 break-all">{getDocumentFileTypeLabel(selectedDocument)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Size</span><span className="text-gray-900">{formatFileSize(selectedDocument.fileSize)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Uploaded</span><span className="text-gray-900">{selectedDocument.createdAt ? formatDate(selectedDocument.createdAt) : '-'}</span></div>
                </div>
                <div className="pt-2 border-t border-gray-100 flex gap-2">
                  {getDocumentLink(selectedDocument) ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setPreviewDocumentId(selectedDocument.id)}
                      data-testid="documents-preview-button"
                    >
                      <Icon name="eye" className="mr-2" />
                      Preview
                    </Button>
                  ) : null}
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
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 p-5 text-center text-gray-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                <p className="font-medium text-gray-600 dark:text-zinc-300">Document details stay here.</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-zinc-500">Open a file to review its preview, upload info, and download action.</p>
              </div>
            )}
          </Card>
        </div>
      )}

      {previewDocument && (
        <MobileSheet
          isOpen={Boolean(previewDocument)}
          onClose={() => setPreviewDocumentId(null)}
          title={previewDocument.fileName || 'Untitled file'}
          subtitle={`${getDocumentFileTypeLabel(previewDocument)} • ${formatFileSize(previewDocument.fileSize)} • ${previewDocument.createdAt ? formatDate(previewDocument.createdAt) : 'Unknown upload date'}`}
          size="xl"
          panelClassName="h-full max-h-full dark:bg-zinc-950 sm:h-[85vh]"
          headerClassName="dark:border-zinc-800"
          bodyClassName="bg-gray-50 p-4 sm:p-6 dark:bg-zinc-900/60"
        >
            <div className="mb-4 flex justify-end">
              {getDocumentLink(previewDocument) ? (
                <a
                  href={getDocumentLink(previewDocument)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  data-testid="documents-preview-download"
                >
                  <Icon name="download" className="mr-2" />
                  Download
                </a>
              ) : null}
            </div>
              {isImageDocument(previewDocument) && getDocumentLink(previewDocument) ? (
                <div
                  className="flex h-full min-h-full items-center justify-center overflow-auto rounded-3xl border border-gray-200 bg-white/80 p-2 shadow-inner dark:border-zinc-700 dark:bg-zinc-950/80 sm:p-4"
                  style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
                >
                  <div className="mx-auto flex min-h-full w-full items-center justify-center">
                    <img
                      src={getDocumentLink(previewDocument)}
                      alt={previewDocument.fileName || 'Document preview'}
                      className="mx-auto block h-auto w-auto max-h-full max-w-full rounded-2xl object-contain shadow-lg"
                      style={{ maxWidth: 'min(100%, 1200px)', maxHeight: 'min(100%, 1200px)' }}
                      data-testid="documents-preview-image"
                    />
                  </div>
                </div>
              ) : isPdfDocument(previewDocument) && getDocumentLink(previewDocument) ? (
                <iframe
                  title={previewDocument.fileName || 'PDF preview'}
                  src={getDocumentLink(previewDocument)}
                  className="h-full min-h-[60dvh] w-full rounded-2xl border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"
                  data-testid="documents-preview-pdf"
                />
              ) : (
                <div
                  className="flex h-full min-h-[60dvh] flex-col items-center justify-center rounded-3xl border border-dashed border-gray-300 bg-white px-6 text-center dark:border-zinc-700 dark:bg-zinc-950"
                  data-testid="documents-preview-fallback"
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 text-gray-600 dark:bg-zinc-900 dark:text-zinc-300">
                    <Icon name={getDocumentIconName(previewDocument)} className="text-2xl" />
                  </div>
                  <h4 className="mt-4 text-lg font-semibold text-gray-900 dark:text-zinc-100">Preview not available</h4>
                  <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-zinc-400">
                    This file type can&apos;t be previewed in the app yet. You can still download it safely.
                  </p>
                  <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-left dark:border-zinc-800 dark:bg-zinc-900">
                    <p className="text-sm font-medium text-gray-900 break-all dark:text-zinc-100">{previewDocument.fileName || 'Untitled file'}</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                      {getDocumentFileTypeLabel(previewDocument)} • {formatFileSize(previewDocument.fileSize)}
                    </p>
                  </div>
                </div>
              )}
        </MobileSheet>
      )}
    </div>
  );
}
