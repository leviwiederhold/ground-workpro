# Message video attachments

Video messages extend the existing private `message-attachments` Supabase Storage bucket and
`message_attachments` rows. Upload and download URLs stay short-lived and signed; the API only
issues them after confirming the authenticated user is a participant in the company-scoped thread.
No public bucket or public object URL is used.

## Limits

- Video formats: MP4 (`video/mp4`), MOV (`video/quicktime`), M4V (`video/x-m4v`), and WebM
  (`video/webm`).
- Maximum individual attachment size: 45 MiB per file while production uses the Supabase Free plan.
- Maximum video duration: 10 minutes.
- Maximum combined attachment size: 450 MiB per message.
- Maximum attachment count: 10 per message.

The client reads browser-native video metadata before requesting a signed upload token. Every
attachment uploads directly to Supabase's TUS endpoint in the required 6 MB chunks, with automatic
retry delays and real byte progress. Interrupted transfers resume from accepted chunks rather than
restarting the entire file. Exhausted/canceled TUS uploads are terminated; completed-but-unsent
objects are removed through the participant-scoped discard API on failure, removal, thread switch,
or page exit. Supabase also expires unfinished TUS upload URLs after 24 hours.

The API revalidates declared duration, MIME type, extension, individual size, combined size, company
path, and the completed Storage object's actual byte count and content type before linking it to a
message. A message is created only after every object finishes and passes that validation.

## Storage configuration required before deployment

Migration `20260811_02_message_attachment_storage_limits.sql` keeps the existing
`message-attachments` bucket private, sets its bucket limit to 45 MiB, and preserves the existing
image/document MIME types alongside:

- `video/mp4`
- `video/quicktime`
- `video/webm`
- `video/x-m4v`

The Supabase Free-plan global Storage limit is 50 MiB and takes precedence over the bucket. The
application and private bucket intentionally use a 45 MiB ceiling so Groundwork rejects oversized
metadata before requesting a signed upload and retains provider headroom. No attachment-table schema
change is required. Existing rows, indexes, RLS, private signed downloads, and authorization continue
to apply. Push dispatch
only counts attachments for a generic safe preview; it does not read or send media paths, signed
URLs, MIME metadata, or tokens.

Large private downloads consume Storage egress each time they are served. Videos keep
`preload="metadata"` so opening a conversation does not eagerly download every video body.

## Raising the limit after a Supabase upgrade

The resumable upload design does not change. Update the single
`MESSAGE_ATTACHMENT_SIZE_LIMIT_MIB` constant in `src/lib/messages/attachmentPolicy.ts`, update the
private `message-attachments` bucket's `file_size_limit` (and this migration for new environments),
and keep both values at or below the new Supabase global Storage limit. Client validation, API token
issuance, send-time object verification, progress, retries, chunking, and cleanup all continue to use
the same signed TUS path.
