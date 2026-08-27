# Security policy

## Supported version

Security fixes are applied to the current `main` branch and the version running at [ragforall.com](https://ragforall.com).

## Reporting a vulnerability

Please report suspected vulnerabilities privately through the repository's **Security** tab using a private vulnerability report, or through the repository owner's GitHub profile when private reporting is unavailable. Do not include API keys, uploaded documents, personal data, raw IP addresses, database exports, or exploit details in a public issue.

Useful reports include the affected URL or component, reproduction steps that avoid accessing other users' data, the expected impact, and a suggested remediation when available.

Please do not perform denial-of-service testing, access another visitor's data, or generate avoidable third-party API costs. Good-faith reports will be investigated before public disclosure.

## Secrets

Local secrets belong in `.env.local`; hosted secrets belong in the deployment platform's encrypted environment. Both are excluded from source control. If a credential is ever committed or disclosed, revoke it before attempting to remove it from Git history.
