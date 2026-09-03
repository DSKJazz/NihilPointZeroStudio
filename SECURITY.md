# Security Policy

## Supported Versions

Security fixes are applied to the latest published release and the default branch.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository when available. If private reporting is unavailable, contact the repository owner through the GitHub profile and include:

- affected version or commit
- operating system and reproduction conditions
- minimal reproduction steps
- impact and any suggested mitigation

Do not include API keys, private phone-access links, tokens, personal data, or complete credential material in a report.

## Credential Handling

- Never commit API keys, private keys, tokens, or user data.
- Portable mode stores provider credentials with weaker protection than installed mode; use portable copies only on devices and media you control.
- CI logs and uploaded artifacts must be checked for secrets before sharing.
- If a secret may have been committed, revoke or rotate it immediately, then remove it from the repository history using an approved history-rewrite process.
