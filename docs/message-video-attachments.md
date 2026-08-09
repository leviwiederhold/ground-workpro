# Message video attachments

Video messages extend the existing private `message-attachments` Supabase Storage bucket and
`message_attachments` rows. Upload and download URLs stay short-lived and signed; the API only
issues them after confirming the authenticated user is a participant in the company-scoped thread.
No public bucket or public object URL is used.

## Limits

- Video formats: MP4 (`video/mp4`), MOV (`video/quicktime`), M4V (`video/x-m4v`), and WebM
  (`video/webm`).
- Maximum video size: 25 MB per file.
- Maximum video duration: 60 seconds.
- Existing image/document maximum: 10 MB per file.
- Maximum combined attachment size: 50 MB per message.
- Maximum attachment count: 10 per message.

The client reads browser-native video metadata before requesting an upload URL. The API revalidates
the declared duration, MIME type, extension, individual size, combined size, company path, and the
completed Storage object's actual byte count and content type before linking it to a message. There
is no client-side transcoding in the first version: it would increase failure modes and browser/native
differences while the strict size and duration limits already bound storage and bandwidth.

## Storage configuration required before deployment

The existing `message-attachments` bucket must remain private. Raise its file-size limit from 10 MB
to 25 MB and add these allowed MIME types without removing the existing image/document types:

- `video/mp4`
- `video/quicktime`
- `video/webm`
- `video/x-m4v`

No database migration is required. The existing attachment table, indexes, RLS, and signed URL flow
already cover videos. Push dispatch only counts attachments for a generic safe preview; it does not
read or send media paths, signed URLs, MIME metadata, or tokens.
