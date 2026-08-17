# Security policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose user documents, API credentials, private analytics, or the owner dashboard. Report it privately through the repository owner's GitHub profile and include only the minimum information needed to reproduce it.

Do not include real user documents, full prompts, API keys, raw IP addresses, or production database exports in a report.

## Supported version

The production version on [ragforall.com](https://ragforall.com) and the latest commit on `main` are the supported versions during the public beta.

## Secrets

Local secrets belong in `.env.local`; hosted secrets belong in the deployment platform's encrypted environment. Both are excluded from source control. If a credential is ever committed, revoke it before attempting to remove it from Git history.
