# Security Policy

## Reporting a vulnerability

Please report it privately: open the repository's **Security** tab and choose **Report a vulnerability**
(https://github.com/lucas-saldanha-werneck/idea-shelf/security/advisories/new). Please do not open a public issue for a
security problem.

## Supported versions

Only the latest release (0.3.8) is supported. Fixes go into a new release.

## What idea-shelf accesses

- Keeps your parked ideas in Claude Code's own plugin store (one key per idea and folder). It reads and writes no other files.
- Makes no network requests and starts no programs.
- Nothing reaches the model until you press Send; then one message with the ideas is submitted, marked as sent by the plugin.
