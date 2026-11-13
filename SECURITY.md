# Security Policy

## Reporting a vulnerability

Please report it privately: open the repository's **Security** tab and choose **Report a vulnerability**
(https://github.com/lucas-saldanha-werneck/idea-shelf/security/advisories/new). Please do not open a public issue for a
security problem.

## Supported versions

Only the latest release is supported. Fixes go into a new release.

## What idea-shelf accesses

- Keeps your parked ideas as plain text in Claude Code's own plugin store, one key per idea, named with the folder path (or a hash of it when the path is long). It reads and writes no other files.
- Sees the text of each prompt and turn start in the session, only to check whether its own message got in. It keeps nothing from them.
- Makes no network requests and starts no programs. It lists the session's slash commands and runs side-stack's `/stack` when that plugin is installed.
- Nothing reaches the model until you press Send or type `/ideas send`; then one message with the ideas is submitted, marked as sent by the plugin.
