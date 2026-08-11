-- Messaging now uses signed TUS uploads, with an application cap of 250 MiB
-- per video, 100 MiB per image/document, and 500 MiB combined per message.
-- Keep the bucket private and enforce the largest individual-file cap at the
-- Storage layer as defense in depth.
update storage.buckets
set public = false,
    file_size_limit = 262144000,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
      'application/pdf',
      'text/plain',
      'text/csv',
      'application/csv',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-m4v'
    ]::text[]
where id = 'message-attachments';
