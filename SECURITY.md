# security policy

## reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce it, and the impact you see.

You can expect an acknowledgment within a few days. Fixes are released as soon as they are ready, and you will be credited if you want to be.

## what is in scope

- SSRF, open redirects or request smuggling through the media proxy (`api/src/stream/`, `api/src/security/`)
- bypassing link validation or tunnel tokens
- response header, content-type or file name injection
- denial of service that goes beyond what the rate limits and timeouts are meant to handle
- XSS or CSP bypasses in the web app

## out of scope

- the availability or behavior of the third-party provider
- findings that need a modified server or a hostile `PROVIDER_API_URL` set by the operator
- missing rate limits on a self-hosted instance that the operator disabled on purpose

## supported versions

Only the latest release receives security fixes.
