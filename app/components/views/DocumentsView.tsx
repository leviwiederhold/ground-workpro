/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, InlineError, SkeletonBlock } from '@/app/components/ui/FeedbackBlocks';

const confirmDelete = (targetLabel) => window.confirm(`Delete ${targetLabel}? This cannot be undone.`);

export function DocumentsView({ currentRole, ui }) {
  const { SearchInput, Button, Icon, Card, formatDate } = ui;
      const canManageDocuments = currentRole === 'executive' || currentRole === 'operations';
      const fileInputRef = useRef(null);

      const [documents, setDocuments] = useState([]);
      const [loading, setLoading] = useState(false);
      const [uploading, setUploading] = useState(false);
      const [deletingId, setDeletingId] = useState(null);
      const [error, setError] = useState('');
      const [search, setSearch] = useState('');

      const formatFileSize = (value) => {
        const size = Number(value || 0);
        if (!size || Number.isNaN(size)) return '-';
        if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
        if (size >= 1024) return `${Math.round(size / 1024)} KB`;
        return `${size} B`;
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
          setDocuments(payload?.attachments || []);
        } catch {
          setError('Failed to load documents');
          setDocuments([]);
        } finally {
          setLoading(false);
        }
      }, []);

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

          const response = await fetch('/api/attachments/upload', {
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
          setDocuments((prev) => prev.filter((item) => item.id !== attachmentId));
        } catch {
          setError('Failed to delete document');
        } finally {
          setDeletingId(null);
        }
      };

      const filteredDocs = documents.filter((doc) => {
        const query = search.trim().toLowerCase();
        if (!query) return true;
        const fileName = String(doc.fileName || '').toLowerCase();
        const contentType = String(doc.contentType || '').toLowerCase();
        return fileName.includes(query) || contentType.includes(query);
      });

      return (
        <div className="space-y-4 sm:space-y-6 min-w-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput
              placeholder="Search documents..."
              value={search}
              onChange={setSearch}
            />
            <div className="flex items-center gap-2">
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

          {!canManageDocuments && (
            <Card>
              <p className="text-sm text-gray-600">Read-only: only admin/pm can upload or delete documents.</p>
            </Card>
          )}

          {loading ? (
            <SkeletonBlock lines={3} testId="documents-loading" />
          ) : error ? (
            <InlineError testId="documents-error">{error}</InlineError>
          ) : filteredDocs.length === 0 ? (
            <EmptyState testId="documents-empty">No documents uploaded yet.</EmptyState>
          ) : (
            <div className="space-y-2" data-testid="documents-list">
              {filteredDocs.map((doc) => {
                const downloadUrl = doc.download_url || doc.signedDownloadUrl || null;
                const isDeleting = deletingId === doc.id;
                return (
                  <Card key={doc.id} className="p-3 sm:p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between min-w-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 break-all" data-testid="documents-file-name">
                          {doc.fileName || 'Untitled file'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1 break-all">
                          {doc.contentType || 'file'} • {formatFileSize(doc.fileSize)} • {doc.createdAt ? formatDate(doc.createdAt) : '-'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {downloadUrl ? (
                          <a
                            href={downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs px-2 py-1 rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-100"
                            data-testid="documents-download-link"
                          >
                            Download
                          </a>
                        ) : (
                          <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500 border border-gray-200">
                            No link
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(doc.id)}
                          disabled={!canManageDocuments || isDeleting || uploading || loading}
                          data-testid="documents-delete-button"
                        >
                          <Icon name="trash" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      );
}
