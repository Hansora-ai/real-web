# Netlify function runtime

The deploy failed while uploading functions because the site's Lambda-style
functions share an environment larger than AWS Lambda's 4KB limit. The modern
Netlify runtime does not have this limit:
https://docs.netlify.com/build/functions/environment-variables/

The build generates modern entry points under `netlify/runtime-functions` for
the same 158 endpoint names. Existing code under `netlify/functions` stays in
place. Lambda handlers use Netlify's official `@netlify/aws-lambda-compat`
adapter; existing native functions retain their handlers and route config.
Background suffixes and configured schedules stay in place. No secrets are
written into generated files or public assets.

## Before merging

In Netlify's environment settings, update the existing
`AWS_LAMBDA_JS_RUNTIME` value from `nodejs20.x` to `nodejs22.x`. The build pins
Node 22.22.0. The adapter requires Node >=22.12 and LiveKit requires >=22.22.
The UI variable overrides the default function runtime; changing build Node
alone does not override an existing runtime pin. Keep all other variables.

## Verification

`npm run test:runtime` tests request/body and response compatibility, webhook
authentication, upload bytes, and locally bundles all 158 functions with
Netlify's bundler, asserting that each uses API v2. This performs no deployment.
The Automation suite verifies the unchanged handlers separately.

After the owner merges, verify the Netlify deployment succeeds. Then check
Instagram DMs/comments and Creative uploads before testing the browser call.
Browser audio also needs the separate LiveKit voice worker to be running.
